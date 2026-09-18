# SpeedTest — project context

Campus hiring assessment platform. Next.js 15 App Router, Prisma + Postgres,
NextAuth. Deployed on Render.

---

## 1. Deployment — Render, through GitHub Actions

**Production is Render, and only Render.** Every trace of the earlier Vercel and
Cloudflare targets is gone: the config files (`vercel.json`, `wrangler.jsonc`,
`open-next.config.ts`), the `preview` / `cf:deploy` scripts, the
`vendor/prisma-client` engine shim, the workerd/Hyperdrive branch in
`src/lib/db.ts`, and the `@opennextjs/cloudflare` and `wrangler` dependencies.

`src/lib/db.ts` is now one path: a pg `Pool` behind Prisma's driver adapter,
built on first use and cached on `globalThis` so HMR does not open a new pool
per reload. It is still exported through a `Proxy` — not for per-request
clients as before, but so the client is constructed lazily; `next build`
imports this module while collecting page data, where `DATABASE_URL` need not
be set.

| | |
|---|---|
| Service | `srv-dam2ts67bikc7384h4mg` (`speedTest`, Ohio, free plan) |
| URL | https://speedtest-45s1.onrender.com |
| Branch | `main` |
| Build / start | `npm install; npm run build` / `npm run start` |

### Render's auto-deploy does not work — do not rely on it

The service reads `autoDeploy: yes, trigger: commit`, but **Render's GitHub App
is not installed on the `speed-innovations` org and the repo has no webhook**,
so a push never reaches Render. The setting is cosmetic. Every deploy in the
service's history shows `trigger: "api"`.

`.github/workflows/deploy.yml` is the real delivery path. On a push to `main`
it runs the checks and **only then** calls Render's deploy API, so a red build
cannot reach production — which a native webhook would not give us. It polls
the deploy to completion and fails on `build_failed`, `update_failed`,
`canceled` or `pre_deploy_failed`; treating the API's acceptance as success
would report a failed deploy as a green run.

Requires the `RENDER_API_KEY` repository secret. `RENDER_SERVICE_ID` may be set
as a repository variable, else it defaults to the service above.

### Migrations are not applied by the deploy

Render's build command is `prisma generate && next build`. It never runs
`prisma migrate deploy`, and neither does the workflow — CI only migrates its
own throwaway database. **A schema change must be applied to Supabase by hand,
before the code that depends on it is pushed.** Production sat three migrations
behind the repo until this was noticed.

Apply it with the Supabase URLs in the environment (dotenv does not override
variables already set, so these win over `.env`):

```bash
DATABASE_URL="<supabase pooled>" DIRECT_URL="<supabase session>" \
  DATABASE_CA_CERT_B64="<ca>" npx prisma migrate deploy
```

Check first with `prisma migrate status`, and confirm afterwards that the
change is really there rather than trusting the command's output.

### Every deployment must

1. Push to `main` and let the workflow deploy. Do not hand-trigger Render
   unless the workflow is broken — a manual deploy skips the test gate.
2. Watch the run to completion. `check` green and `deploy` green is the bar.
3. Confirm the deploy reached `live` for the intended commit, and that the app
   actually serves it — request the production URL and assert something the
   change introduced. A `live` status is not evidence the change is on screen.

### CI details worth knowing

- The job runs its own throwaway Postgres. `tests/responses.test.ts` and
  `tests/attempt-ownership.test.ts` are integration tests that write real rows;
  without an isolated database CI would be writing fixtures into production.
- `prisma/seed.ts` runs before the suite because `tests/responses.test.ts`
  borrows three existing questions instead of creating its own, and fails on an
  empty bank before reaching an assertion. That test is state-dependent — if
  the bank is ever emptied (`scripts/wipe-questions-candidates.ts`), it breaks.
- Node 24 in CI, matching Render's runtime. Checking on a different major than
  production is how "green in CI, broken on deploy" happens.

---

## 2. Databases

| | |
|---|---|
| Production | Supabase, `aws-0-ap-southeast-1.pooler.supabase.com` |
| Local | PostgreSQL 18 service, `speedtest:speedtest@localhost:5432/speedtest` |

`.env` is gitignored and holds both, one commented out. **It currently points
at local**, deliberately: the suite writes real rows, so running tests with
`.env` pointed at Supabase exercises production.

**`DATABASE_CA_CERT_B64` must be commented out together with the Supabase
URLs.** `src/lib/db.ts` `nodeSsl()` pins that CA with `rejectUnauthorized: true`
whenever the variable is set, and loopback Postgres serves no TLS, so leaving
it set while pointed at local fails the handshake with a confusing certificate
error.

`DATABASE_URL` is the pooler (6543); `DIRECT_URL` is the session port (5432).
Scripts use `DIRECT_URL ?? DATABASE_URL` because interactive `$transaction` is
unreliable over the pgBouncer transaction pooler.

Local and production both hold the same 212 questions: SQL 60, AI 50, Python
50, JavaScript 22, Aptitude 10, and 5 each in APIs, Cloud, GenAI and
Deployment.

### Local development

```bash
npm run dev        # http://localhost:3001
npm test           # includes integration tests; writes to DATABASE_URL
npm run db:seed    # only inserts when the bank is empty
npm run db:studio
```

There is no `preview` or `cf:deploy` script any more — those drove the
Cloudflare build, which is gone.

**On Windows, stop the dev server before `npm install` or `prisma generate`.**
A running server holds `node_modules/.prisma/client/query_engine-windows.dll.node`
open, and regeneration fails with `EPERM: operation not permitted, rename`. The
error names a temp file and gives no hint that a process is the cause.

---

## 3. Question bank

Question text may contain a fenced code block, which `src/components/QuestionText.tsx`
renders in a highlighted box with indentation preserved:

    What will be the output?

    ```python
    for i in range(3):
        print(i)
    ```

Indentation is load-bearing in output-prediction questions — a snippet whose
leading spaces are collapsed by HTML is unanswerable. Code uses
`white-space: pre` inside its own horizontal scroll; prose keeps `pre-wrap`.
Languages: python, javascript, sql, java, csharp (the last two are registered
by hand on top of Prism's `clike`). An untagged fence inherits the question's
assessment area.

### Scripts (all default to a dry run; `--yes` writes)

| Script | Purpose |
|---|---|
| `import-questions.ts <file.xlsx>` | Load a sheet. Idempotent — skips text already present for that area. Columns: Area, Question, Option A–D, Correct Answer, Marks, Difficulty |
| `fence-code-questions.ts` | Backfill ``` fences on rows written before fencing existed |
| `shuffle-options.ts --area X,Y` | Redistribute which letter holds the correct answer |
| `restore-options.ts --sheet AREA=path` | Rebuild options and keys from source sheets and seed scripts |
| `seed-sql.ts`, `seed-aptitude.ts` | The only record of those 70 questions — without them those rows cannot be restored |

### Adding an assessment area

`src/lib/areas.ts` is the single definition of the areas and their labels —
every dropdown, table, filter, and the import/export routes read from it. The
list used to be copy-pasted across nine files, and the results export
hard-coded one column per area, so a new area's scores were silently missing
from every exported report.

To add one:

1. Add the value to `AssessmentArea` in `prisma/schema.prisma`.
2. `npx prisma migrate dev --name <name> --create-only`, then apply it locally
   and **to production by hand** (see Migrations above). Adding enum values is
   additive and safe on a populated database.
3. Add the value and its label to `src/lib/areas.ts`. Nothing else needs
   editing; add a short label to `AREA_LABELS_SHORT` if the full one would wrap
   in a dense table.
4. `npx prisma generate` — stop the dev server first on Windows.

Existing tests keep their `assessmentConfig` as-is; a new area only appears in
a test once it is added to that test's configuration.

### Answer keys

Hand-authored sets put the correct answer at A almost every time (the AI set
arrived at 100% A). A candidate answering A throughout then outscores one
reasoning honestly, which makes the section useless for ranking. Check the
spread whenever questions are added, and run `shuffle-options.ts` if it is
skewed.

Two option types refer to their own position and cannot be moved blindly:

- **anchored** — "All of the above" / "None of these". Pinned in place; the
  others rearrange around it, which is safe because it refers to the rest as a
  set rather than in order.
- **blocking** — "Both A and B". Names specific letters, so any reshuffle
  changes what they point at. Those questions are skipped entirely.

---

## 4. Hard-won lessons — read before any bulk write

**Verify content, not row counts.** A `shuffle-options.ts` run corrupted 90
questions across four areas in the production bank. The dry run reported only
how many rows would change, which looked correct, so it was approved and
applied. A dry run must show what it will write, not just how much.

**Prisma reads `undefined` as "leave this column alone".** That is how the
corruption happened: an options array came up one element short, the last
position was filled with `undefined`, and the column silently kept its previous
value — duplicating a sibling option. A guard checking `new Set(options).size`
passed, because `undefined` counts as a distinct fourth value. Assert the real
invariant instead: a reshuffle is a permutation, so the sorted option texts
must be identical before and after.

**Keep a restore path.** The repair was only possible because the import
spreadsheets and the seed scripts existed. 70 of those rows had no other
record. Before any bulk edit, know what you would restore from.

**Nothing had been sat yet.** Zero test attempts existed at the time. On a bank
already used for scoring, the same mistake would have altered results.

---

## 5. Still open

- Render's GitHub App is not installed on the org. The Actions workflow covers
  it, but native auto-deploy remains broken.
- `tests/responses.test.ts` depends on questions already existing rather than
  creating its own.
- 3 Python questions use "Both A and B" and are excluded from shuffling; fixing
  them means rewriting the option text to not name letters.
