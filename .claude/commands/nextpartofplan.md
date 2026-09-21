---
description: Execute the next unfinished part of the proctoring implementation plan
---

# Execute the next part of the proctoring plan

## Step 1 — Orient

Read exactly these two things, in this order:

1. `plans/proctoring/PROGRESS.md` — find the **first** part whose status is
   `⬜ NOT STARTED`. That is your part. Call it part N.
2. `plans/proctoring/README.md` — the shared overview, architecture decisions,
   and global constraints.

Then read **only** `plans/proctoring/part-NN-*.md` for your part N.

**Do not read the other part files.** They are deliberately separated so one
session's context holds the overview plus one part. Reading ahead defeats that
and leaves no room to do the work.

## Step 2 — Check you are safe to start

Stop and report instead of proceeding if any of these is true:

- The current branch is not `feat/proctoring`. Run `git branch --show-current`.
  If you are on `main`, **stop** — do not switch and do not commit.
- The working tree has uncommitted changes from a previous part
  (`git status --short`). A half-finished part must be resolved first.
- The previous part is `🟡 IN PROGRESS`. Read the Notes in `PROGRESS.md`,
  finish or explicitly abandon it, and do not stack work on top.
- Part N is 15. **Part 15 is gated.** Do not execute it. Report that Parts 1–14
  are complete and that release needs the owner's explicit go-ahead.

## Step 3 — Execute

Work through the part file's checkboxes **in order**. Tick each one in the file
as you complete it — edit the markdown, do not just track it mentally. A future
session reads those boxes to know where things stand.

Follow the global constraints in `README.md` without exception. The ones most
often violated:

- Both attempt kinds — `TestAttempt` **and** `WalkInAttempt`. A change to
  `student/test/[scheduleId]` that is not mirrored to
  `student/walkin-test/[testId]` is incomplete.
- Convention B for routes: `requireStudent`/`requireAdmin` → `HttpError` →
  `errorResponse(err, label, fallback)`. Never return `err.message` to a client.
- Prisma `undefined` means "leave this column alone". Use `null` to clear.
- Stop the dev server before `prisma generate` on Windows.

If the part file turns out to be wrong — a file moved, an interface does not
match, an assumption fails — **fix the part file too**, and note it in
`PROGRESS.md`. The plan is a living document, not a contract.

## Step 4 — Verify before claiming anything

Run these and read the actual output. Do not assert success without it:

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
npm test
```

If the part touched `scripts/`, also:

```bash
npx tsc --noEmit -p scripts/tsconfig.json
```

`npm test` must pass **in full**, not just the new tests. A pre-existing failure
is still a blocker — investigate it rather than waving it through.

Do **not** run `npm run lint`. It is declared in `package.json` but eslint is not
installed and there is no config, so it fails for reasons unrelated to any change.

## Step 5 — Commit locally

```bash
git add -A && git commit -m "proctoring part N: <what it delivers>"
```

**Never push. Never run `git push`. Never open a PR.**

Parts 1–14 are local-only by explicit instruction from the repo owner. `main` is
the deploy trigger for Render, and pushing partial proctoring work would ship it
to production. Part 15 handles release, and only on the owner's go-ahead.

Likewise: **do not run `prisma migrate deploy` against Supabase**, do not touch
Render, and do not set any production environment variable. All database work is
against local Postgres.

## Step 6 — Update the ledger

In `plans/proctoring/PROGRESS.md`:

- Set part N's status to `✅ DONE`, fill in the commit hash and today's date.
- Append a short entry to **Notes** covering anything the next session needs:
  surprises, deviations from the part file, decisions you had to make.

Then commit that update too (amend into the part commit, or a follow-up commit —
either is fine).

## Step 7 — Report

Tell the user, briefly:

- Which part you completed and what it delivers.
- The actual verification output — typecheck and test results, stated plainly.
  If something failed, say so; do not round up to success.
- What part is next, and anything blocking it.

Keep it short. They can read the ledger.
