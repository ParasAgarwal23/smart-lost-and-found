# DBMS Level 3 demonstration checklist

Use with the [project report](project_report.md). Never put passwords on slides, screenshots or in this repository.

## Before the presentation

- [ ] Run the demo against **`smart_lost_found_demo`** (fictional data), not the real database: `npm run build`, then `npm run start:demo` (`.env.local` is not changed). Setup and refresh steps are in [demo_setup.md](demo_setup.md).
- [ ] Demo accounts (one ADMIN, four USERs) and their generated passwords are in the git-ignored `.local/demo-credentials.txt`.
- [ ] Back up the demo database (`pg_dump -Fc`, outside the repository) so it can be restored after the demonstration.
- [ ] Check `npm run demo -- npm run db:backfill-embeddings -- --dry-run` reports nothing to do.
- [ ] Open the ER diagram, relational schema and architecture diagram (`docs/*.drawio` or `docs/diagrams/*.png`) and `db/roles.sql`.
- [ ] Have a psql window connected to the demo database as the owner (for `verify.sql`, `verify_roles.sql` and the queries below).

## Rehearsal results (14 Nov 2026, production build, headless Chrome)

Read-only run against `smart_lost_found_demo` (database contents unchanged afterwards; every web-login connection was to the demo database):

- All five demo accounts signed in with their real passwords; ADMIN and USER labels correct; a USER is denied Campus Summary.
- Exact-words, category, location, lost-only and found-only searches returned exactly the rows an independent SQL query returns.
- Similar meaning (top result): "charger for my laptop with tape on the cable" → USB-C power adapter (48%); "silver watch with a dented rim" → Watch with metal strap (74%); "black headphones in a pouch" → Headphones in grey pouch (75%); "red pencil case with a compass inside" → Pencil case with compass (76%); "lost my maths book in the canteen" → Maths textbook with folded pages (59%); "key for a bicycle lock" (no matching report) → best only 43%.
- Possible matches for Ananya's *Maroon pencil pouch*: Pencil case with compass first (0.695, next 0.521), identical to `find_potential_matches`.
- My Reports and My Claims show each user's own records; Campus Summary totals equal SQL (22 lost, 24 found, 14 claims, 7 handovers); Daily Activity 30 days: 26 active days, 90 days: 43 active days; hotspots and contested items shown.

Write run against a disposable copy of the demo database (dropped afterwards):

- Create Account → USER with an Argon2id hash → sign-in; lost and found reports through the forms, each stored with a 384-dimension embedding and shown only in the owner's My Reports.
- Ananya: claim on *Pencil case with compass* → evidence → receipt; My Claims shows Receipt recorded, and the item is then no longer offered to another USER.

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

- [ ] The final report as PDF and DOCX (`docs/submission/`, generated from `docs/project_report.md`).
- [ ] README, report, diagrams (`.drawio` + PNG), SQL scripts, selected screenshots, tests and the GitHub history.
- [ ] Both members have filled their review/acceptance columns in `docs/contribution_matrix.md`.
- [ ] `.env.local`, `.local/` and database backups stay out of Git and out of screenshots.
