# Part 15 — Release

> ## 🔒 GATED
>
> **Do not execute this part without the repo owner's explicit go-ahead.**
>
> `/nextpartofplan` must **stop** when it reaches this file and report that
> Parts 1–14 are complete and release is awaiting approval. Completing Part 14 is
> not approval. A green local gate is not approval. Only the owner saying so is.

Everything here touches the outside world: GitHub, Supabase, Render, Cloudflare.
Up to this point nothing has left the machine.

---

## Order matters, and one step is irreversible in practice

The migration goes to Supabase **before** the code that needs it reaches Render.
Reverse that and production runs code querying tables that do not exist — for
every candidate, immediately.

`CLAUDE.md` records that production once sat three migrations behind the repo
because deploys do not migrate. That is exactly the failure this ordering avoids.

---

## Preconditions — verify, do not assume

- [ ] `PROGRESS.md` shows Parts 1–14 all `✅ DONE`.
- [ ] The owner has explicitly approved release, in this conversation.
- [ ] The working tree is clean: `git status --short` prints nothing.
- [ ] The full local gate from Part 14 still passes on the current commit.
- [ ] The manual browser test was completed against **real R2**, not mock.

---

## Steps

- [ ] **Step 1: Rebase onto current `main` and re-verify**

The branch has carried fourteen parts. If `main` moved, resolve it now.

```bash
git fetch origin && git log --oneline main..origin/main
```

If anything is listed:

```bash
git rebase origin/main
```

Then re-run the whole gate — a clean rebase is not a passing build:

```bash
npx tsc --noEmit -p tsconfig.json && npm test && npm run build
```

- [ ] **Step 2: Confirm no secret is in the diff**

```bash
git diff origin/main --stat
```

```bash
git diff origin/main | grep -nE "R2_SECRET_ACCESS_KEY=|R2_ACCESS_KEY_ID=|CRON_SECRET=" | grep -v "\.env\.example" && echo "STOP: a secret is in the diff" || echo "OK: no secrets"
```

`.env.example` must contain empty placeholders only.

- [ ] **Step 3: Apply the migration to Supabase, by hand**

Before the code ships. Check first:

```bash
DATABASE_URL="<supabase pooled>" DIRECT_URL="<supabase session>" \
  DATABASE_CA_CERT_B64="<ca>" npx prisma migrate status
```

Then apply:

```bash
DATABASE_URL="<supabase pooled>" DIRECT_URL="<supabase session>" \
  DATABASE_CA_CERT_B64="<ca>" npx prisma migrate deploy
```

- [ ] **Step 4: Verify the migration by inspection, not by the command's output**

`CLAUDE.md` is explicit that the command's success is not evidence. Confirm the
tables, the columns, and the CHECK constraint actually exist:

```bash
DATABASE_URL="<supabase pooled>" npx prisma db execute --stdin <<'SQL'
SELECT table_name FROM information_schema.tables
 WHERE table_name LIKE 'Proctoring%';
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'Test' AND column_name = 'proctoringEnabled';
SELECT conname FROM pg_constraint
 WHERE conname = 'ProctoringSession_exactly_one_attempt';
SQL
```

All three must return rows. If the CHECK is missing, **stop** — every downstream
guarantee assumes it.

- [ ] **Step 5: Set the Render environment variables**

In the Render dashboard for `srv-dam2ts67bikc7384h4mg`:

```
PROCTORING_ENABLED=false          <- deploy dark; turn on after verifying
PROCTORING_STORAGE_PROVIDER=r2
PROCTORING_STORAGE_SAFETY_BYTES=7000000000
R2_ACCOUNT_ID=...
R2_BUCKET_NAME=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
CRON_SECRET=...                   <- same value as the GitHub secret
```

`PROCTORING_ENABLED=false` at first is deliberate: the deploy can be verified
without any candidate hitting a new code path. It is one variable to flip after.

- [ ] **Step 6: Set the GitHub secrets and variables**

Settings → Secrets and variables → Actions:

```
CRON_SECRET   (secret)   - must match Render exactly
APP_URL       (variable) - https://speedtest-45s1.onrender.com
```

- [ ] **Step 7: Configure R2 for production**

- [ ] Add the production origin to the bucket's CORS (keep `localhost:3001`).
- [ ] Add the lifecycle rule: prefix `assessment-proctoring/`, delete after 3 days.
- [ ] Confirm the bucket is **private** — no public access, no `r2.dev` domain.

- [ ] **Step 8: Push and open the PR**

This is the first push. The workflow runs the full check job.

```bash
git push -u origin feat/proctoring
```

```bash
gh pr create --title "Add candidate proctoring" --body-file plans/proctoring/README.md
```

- [ ] **Step 9: Watch CI to completion**

`check` green is the bar. If the new Playwright step fails in CI but passed
locally, investigate rather than retrying — CI has no camera, and a genuine
difference in the media mocks is worth knowing about.

- [ ] **Step 10: Merge, and watch the deploy**

Merging to `main` triggers the deploy job, which polls Render to completion.

- [ ] **Step 11: Verify production actually serves the change**

A `live` status is not evidence, per `CLAUDE.md`. Assert something the change
introduced:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://speedtest-45s1.onrender.com/api/cron/proctoring-cleanup -X POST
```

Expect `401` — the route exists and is refusing an unauthenticated call. A `404`
means the deploy did not carry the change.

Then exercise it properly:

```bash
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://speedtest-45s1.onrender.com/api/cron/proctoring-cleanup
```

Expect a JSON cleanup report with zeroes.

- [ ] **Step 12: Verify the scheduled workflow**

It is only active now that it is on `main`. Trigger it by hand rather than
waiting an hour:

```bash
gh workflow run "Proctoring retention cleanup"
```

```bash
gh run list --workflow="Proctoring retention cleanup" --limit 1
```

It must succeed. A scheduled workflow that has never run successfully is not
infrastructure.

- [ ] **Step 13: Enable proctoring, carefully**

- [ ] Set `PROCTORING_ENABLED=true` on Render.
- [ ] Enable `proctoringEnabled` on **one** low-stakes test first — not a live
      campus drive.
- [ ] Run one real attempt end to end and review the evidence as an admin.
- [ ] Check the usage page: bytes recorded, capacity plausible.
- [ ] Only then enable it on a test that matters.

- [ ] **Step 14: Update `PROGRESS.md`** — mark Part 15 done, with the merge
      commit, the deploy id, and the date.

---

## Rollback

If production misbehaves:

1. **Set `PROCTORING_ENABLED=false` on Render.** This is the fastest and usually
   sufficient action — every proctoring branch is behind it, and non-proctored
   assessments were never affected.
2. If a code fault is broader, revert the merge commit and let the workflow
   deploy the revert.
3. **Leave the migration in place.** It is purely additive — new tables plus one
   defaulted column. Rolling it back would risk the working schema for no gain,
   and the unused tables cost nothing.
4. Already-uploaded media expires on its own schedule. Nothing needs manual
   deletion.

---

## Done when

- Supabase carries the migration, verified by inspecting the tables.
- Production serves the new routes, verified by request, not by deploy status.
- The scheduled cleanup workflow has completed at least one successful run.
- One real proctored attempt has been completed and reviewed.
- `PROGRESS.md` records the release.
