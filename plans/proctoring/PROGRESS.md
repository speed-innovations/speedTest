# Proctoring — progress ledger

`/nextpartofplan` reads this file, picks the first part whose status is
`NOT STARTED`, loads `README.md` plus that one part file, executes it, then
updates the row below and commits **locally**.

**Never push.** Parts 1–14 are local-only. Part 15 is the release gate and runs
only on the owner's explicit go-ahead.

Branch: `feat/proctoring`

---

## Status

| # | Part | Status | Commit | Date |
|---|---|---|---|---|
| 0 | Plan infrastructure | ✅ DONE | — | 2026-09-21 |
| 1 | Schema, migration, config | ⬜ NOT STARTED | — | — |
| 2 | Storage abstraction | ⬜ NOT STARTED | — | — |
| 3 | Quota and reservation | ⬜ NOT STARTED | — | — |
| 4 | Session lifecycle API | ⬜ NOT STARTED | — | — |
| 5 | Upload APIs | ⬜ NOT STARTED | — | — |
| 6 | Events API | ⬜ NOT STARTED | — | — |
| 7 | Client core services | ⬜ NOT STARTED | — | — |
| 8 | Gaze detection | ⬜ NOT STARTED | — | — |
| 9 | Candidate UI | ⬜ NOT STARTED | — | — |
| 10 | Admin review UI | ⬜ NOT STARTED | — | — |
| 11 | Retention and cleanup | ⬜ NOT STARTED | — | — |
| 12 | zod retrofit | ⬜ NOT STARTED | — | — |
| 13 | Playwright E2E | ⬜ NOT STARTED | — | — |
| 14 | Docs and local verification | ⬜ NOT STARTED | — | — |
| 15 | **Release — GATED** | 🔒 BLOCKED | — | — |

Statuses: `⬜ NOT STARTED` · `🟡 IN PROGRESS` · `✅ DONE` · `🔒 BLOCKED`

Part 15 stays `🔒 BLOCKED` until the owner says otherwise, even when 1–14 are
all done. `/nextpartofplan` must stop after Part 14 and report, not proceed.

---

## Definition of done for every part

A part is `✅ DONE` only when all of these are true:

- [ ] Every checkbox in its part file is ticked.
- [ ] `npx tsc --noEmit -p tsconfig.json` passes.
- [ ] `npx tsc --noEmit -p scripts/tsconfig.json` passes (if the part touched `scripts/`).
- [ ] `npm test` passes — **the whole suite**, not only the new tests.
- [ ] A local commit exists on `feat/proctoring` and its hash is in the table.
- [ ] Nothing was pushed.

If a part cannot be completed, set it `🟡 IN PROGRESS`, write what is blocking it
in the Notes below, and stop. Do not start the next part on top of a broken one.

---

## Notes

Running log — append, do not overwrite. Record surprises, deviations from the
part file, and anything the next session needs to know.

### Part 0 — 2026-09-21

Created `plans/proctoring/` and `.claude/commands/nextpartofplan.md` on branch
`feat/proctoring`, cut from `main` at `38e1bec`.

Pre-existing repo conditions worth knowing before starting Part 1:

- `npm run lint` is **dead** — `next lint` is declared in `package.json` but
  eslint is not installed and there is no config. CI never calls it (it runs
  `tsc --noEmit` twice instead). Do not add "run lint" to any part's
  verification; it will fail for reasons unrelated to the change.
- `next.config.js` still carries a webpack `externals` rule for
  `@app/prisma-client`, a shim that was deleted. It is inert but misleading.
  Out of scope here; flagged so nobody treats it as proctoring's doing.
- `.dev.vars`, `.open-next/`, `.wrangler/` are stale Cloudflare artifacts. All
  gitignored. Ignore them.
- Local Postgres is 18; production Supabase is not. The migration is additive
  DDL plus one `CHECK`, so divergence is unlikely — but Part 15 verifies the
  tables by inspection rather than trusting command output.
