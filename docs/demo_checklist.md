# DBMS Level 3 demonstration checklist

Use with the [project report](project_report.md). Never put passwords on slides, screenshots or in this repository.

## Before the presentation

- [ ] Run the demo against **`smart_lost_found_demo`** (fictional data), not the real database. Start the production build with `DATABASE_URL`/`ADMIN_DATABASE_URL` pointing at it (process environment overrides `.env.local`) and `npm start`.
- [ ] Demo accounts (one ADMIN, one USER) and their generated passwords are in the git-ignored `.local/demo-credentials.txt`. To rebuild the demo database: fresh install (db/README.md), `db/seed.sql`, `npm run provision:admin -- --generate-password --credentials-file .local/demo-credentials.txt …`, the USER via `node scripts/provision-account.mjs --role USER …`, then `psql -v demo_user_email=… -f db/demo_seed.sql` and `npm run db:backfill-embeddings`.
- [ ] Check `npm run db:backfill-embeddings -- --dry-run` reports nothing to do.
- [ ] Open the ER diagram, relational schema and architecture diagram (`docs/*.drawio` or `docs/diagrams/*.png`) and `db/roles.sql`.
- [ ] Have a psql window connected to the demo database as the owner (for `verify.sql`, `verify_roles.sql` and the queries below).

## Suggested live sequence

1. **Motivation and design:** problem, scope, why PostgreSQL + pgvector (one server), the ten-table ER/relational design, constraints, defaults, ON DELETE policy.
2. **Create Account:** visitor → Sign In → *Create an account*. Show a validation error (phone/password mismatch), then register. Show in psql that the row has `Role = 'USER'` and an `$argon2id$` hash. Explain why ADMIN cannot be registered (no role field, constant role in `register_user`, no INSERT on `"USER"` for the web login) and show `npm run provision:admin` as the only ADMIN path.
3. **USER journey (demo USER):** Search *exact words* vs *similar meaning* ("charger for my laptop with tape on the cable" finds "USB-C power adapter"); report a lost item; Possible matches; claim; add evidence; confirm receipt; My Claims progress.
4. **UPDATE, DELETE and procedures:** edit a lost report's description (trigger clears the vector; a new one is stored in the same transaction); delete an unclaimed report (CALL `delete_own_report`; the vector goes with the row); show that a claimed found report cannot be deleted; withdraw a claim (CALL `withdraw_claim`).
5. **ADMIN journey:** sign in as the demo ADMIN → Campus Summary: totals, **Daily Activity** (recursive CTE; quiet days; 30/90 days), **Location Hotspots** (HAVING vs the campus average), **Contested Items** (HAVING two claimants). Then show a USER being denied.
6. **Database RBAC live:** run `psql -f db/verify_roles.sql`; then, as an example of a denial:

   ```sql
   -- as the owner, simulate the web login's anonymous role inside a transaction
   BEGIN; SET LOCAL ROLE lf_anon;
   SELECT "Password_Hash" FROM public."USER";        -- ERROR: permission denied
   ROLLBACK;
   BEGIN; SET LOCAL ROLE lf_user; SELECT set_config('app.user_id', '<some user id>', true);
   SELECT count(*) FROM public."CLAIM";              -- only that user's claims (RLS)
   ROLLBACK;
   ```

7. **SQL evidence:** `SELECT * FROM admin_daily_activity(30);`, the hotspot and contested views, `EXPLAIN` of a vector query, and `node tests/vector-index.mjs --save-plan <file>` for the HNSW plan at volume. Mention `npm test` (56 checks) and the browser run (53 checks).
8. **Conclude:** what is implemented, limitations (rate limiting, uploads, approval workflow) and future work.

## Submission evidence

- [ ] The final report as PDF and DOCX (kept locally; submitted through the college form, not committed).
- [ ] README, report, diagrams (`.drawio` + PNG), SQL scripts, selected screenshots, tests and the GitHub history.
- [ ] Both members have filled their review/acceptance columns in `docs/contribution_matrix.md`.
- [ ] `.env.local`, `.local/` and database backups stay out of Git and out of screenshots.
