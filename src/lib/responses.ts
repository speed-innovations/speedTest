import { Prisma } from '@prisma/client'

/**
 * Bulk writes for answer rows.
 *
 * The routes used to upsert one row per question, in batches of 5-10. A 60
 * question paper therefore cost 60 round trips to Postgres, and on submit all
 * of them ran inside an interactive transaction - so the transaction (and its
 * connection) was held open for the whole sequence. With a cohort of 30
 * finishing at the same minute that is 30 simultaneous long transactions
 * against one Hyperdrive pool, which is where the old code fell over.
 *
 * Each helper below is a single statement: the rows are shipped as parallel
 * arrays and expanded with unnest(), so an entire paper is one round trip.
 */

/** Table names are baked in rather than interpolated - never take one from a caller. */
type ResponseTable = 'CandidateResponse' | 'WalkInResponse'

/**
 * cuid-shaped id generator.
 *
 * The `id` columns have no database default - Prisma generates cuids in the
 * client - so a raw INSERT has to supply them. Shape matches Prisma's cuid v1
 * (`c` + timestamp + counter + fingerprint + randomness) so ids stay uniform
 * with rows written through the normal client.
 */
let counter = Math.floor(Math.random() * 1e6)
const FINGERPRINT = randomBlock(4)

function randomBlock(len: number): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, len)
}

export function newId(): string {
  counter = (counter + 1) % 1_679_616 // 36^4
  const ts = Date.now().toString(36)
  const count = counter.toString(36).padStart(4, '0')
  return `c${ts}${count}${FINGERPRINT}${randomBlock(8)}`
}

export interface AnswerRow {
  questionId: string
  selectedAnswer: string | null
  isCorrect?: boolean | null
  marksAwarded?: number | null
}

/** Anything exposing $executeRaw: the client itself or a transaction handle. */
type RawExecutor = { $executeRaw: (query: Prisma.Sql) => Promise<number> }

/**
 * Insert or update answer rows for one attempt in a single statement.
 *
 * `answeredAt` is only ever set on the first write for a question - a later
 * grading pass must not rewrite when the student answered. Grading columns are
 * only overwritten when this call actually carries them, so a plain autosave
 * cannot wipe a score.
 */
export async function upsertResponses(
  db: RawExecutor,
  table: ResponseTable,
  attemptId: string,
  rows: AnswerRow[]
): Promise<number> {
  if (rows.length === 0) return 0

  const ids = rows.map(() => newId())
  const questionIds = rows.map(r => r.questionId)
  const answers = rows.map(r => r.selectedAnswer ?? null)
  const correct = rows.map(r => (r.isCorrect === undefined ? null : r.isCorrect))
  const marks = rows.map(r => (r.marksAwarded === undefined ? null : r.marksAwarded))
  // Only rows that carry an answer get an answeredAt stamp.
  const now = new Date()

  const values = Prisma.sql`
    SELECT t.id, ${attemptId}, t."questionId", t."selectedAnswer", t."isCorrect",
           t."marksAwarded",
           CASE WHEN t."selectedAnswer" IS NULL THEN NULL ELSE ${now}::timestamp(3) END,
           false
    FROM unnest(
      ${ids}::text[], ${questionIds}::text[], ${answers}::text[],
      ${correct}::boolean[], ${marks}::double precision[]
    ) AS t(id, "questionId", "selectedAnswer", "isCorrect", "marksAwarded")
  `

  const columns = Prisma.sql`("id", "attemptId", "questionId", "selectedAnswer", "isCorrect", "marksAwarded", "answeredAt", "flagged")`

  // COALESCE on the update side keeps a previously written value when this call
  // does not supply one, so autosave and grading can write the same row safely.
  // The existing-row references have to be table-qualified: the SELECT feeding
  // the INSERT exposes the same column names, so a bare name is ambiguous.
  const onConflict = (t: ResponseTable) => Prisma.sql`
    DO UPDATE SET
      "selectedAnswer" = COALESCE(EXCLUDED."selectedAnswer", ${Prisma.raw(`"${t}"`)}."selectedAnswer"),
      "isCorrect"      = COALESCE(EXCLUDED."isCorrect", ${Prisma.raw(`"${t}"`)}."isCorrect"),
      "marksAwarded"   = COALESCE(EXCLUDED."marksAwarded", ${Prisma.raw(`"${t}"`)}."marksAwarded"),
      "answeredAt"     = COALESCE(${Prisma.raw(`"${t}"`)}."answeredAt", EXCLUDED."answeredAt")
  `

  const query =
    table === "CandidateResponse"
      ? Prisma.sql`INSERT INTO "CandidateResponse" ${columns} ${values}
          ON CONFLICT ("attemptId", "questionId") ${onConflict("CandidateResponse")}`
      : Prisma.sql`INSERT INTO "WalkInResponse" ${columns} ${values}
          ON CONFLICT ("attemptId", "questionId") ${onConflict("WalkInResponse")}`

  return db.$executeRaw(query)
}

/**
 * Mark one question as flagged, creating the row if the student has not
 * answered it yet. Separate from `upsertResponses` because `flagged` must not
 * be reset to false by an ordinary answer write.
 */
export async function flagResponse(
  db: RawExecutor,
  table: ResponseTable,
  attemptId: string,
  questionId: string
): Promise<number> {
  const id = newId()
  const query =
    table === 'CandidateResponse'
      ? Prisma.sql`INSERT INTO "CandidateResponse" ("id", "attemptId", "questionId", "flagged")
          VALUES (${id}, ${attemptId}, ${questionId}, true)
          ON CONFLICT ("attemptId", "questionId") DO UPDATE SET "flagged" = true`
      : Prisma.sql`INSERT INTO "WalkInResponse" ("id", "attemptId", "questionId", "flagged")
          VALUES (${id}, ${attemptId}, ${questionId}, true)
          ON CONFLICT ("attemptId", "questionId") DO UPDATE SET "flagged" = true`

  return db.$executeRaw(query)
}

/** Attempt tables that carry a `violations` JSONB array. */
type AttemptTable = 'TestAttempt' | 'WalkInAttempt'

/** Hard cap so a scripted client cannot grow the row without bound. */
export const MAX_VIOLATIONS = 500

/**
 * Append one violation to the attempt's JSONB array, in the database.
 *
 * Read-modify-write from the route lost entries: a single alt-tab fires both
 * `visibilitychange` and `blur`, so two requests read the same array and the
 * second overwrote the first. Appending server-side with `||` makes each write
 * atomic, and the cap is enforced in the same statement.
 *
 * Returns true if the entry was stored, false if the attempt was already at
 * the cap (or no longer exists).
 */
export async function appendViolation(
  db: RawExecutor,
  table: AttemptTable,
  attemptId: string,
  entry: { questionId: string | null; type: string; timestamp: string }
): Promise<boolean> {
  const json = JSON.stringify(entry)
  const query =
    table === 'TestAttempt'
      ? Prisma.sql`UPDATE "TestAttempt"
          SET "violations" = COALESCE("violations", '[]'::jsonb) || ${json}::jsonb
          WHERE "id" = ${attemptId}
            AND jsonb_array_length(COALESCE("violations", '[]'::jsonb)) < ${MAX_VIOLATIONS}`
      : Prisma.sql`UPDATE "WalkInAttempt"
          SET "violations" = COALESCE("violations", '[]'::jsonb) || ${json}::jsonb
          WHERE "id" = ${attemptId}
            AND jsonb_array_length(COALESCE("violations", '[]'::jsonb)) < ${MAX_VIOLATIONS}`

  return (await db.$executeRaw(query)) === 1
}
