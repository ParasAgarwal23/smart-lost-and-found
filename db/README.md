# Database scripts (PostgreSQL 18 + pgvector 0.8.6)

Source of truth: the ER diagram (`docs/lost_found_ER_diagram.drawio`), the relational schema (`docs/lost_found_relational_schema.drawio`) and the college requirements PDF. PNG exports of both are in `docs/diagrams/`. The nine non-primary-key foreign keys in LOST_REPORT, FOUND_REPORT, CLAIM and HANDOVER are NOT NULL. All primary-key components are implicitly NOT NULL; Password_Hash is explicitly NOT NULL. Other attributes remain nullable.

The scripts create the ten relations in PostgreSQL's standard `public` schema. Table and column identifiers are consistently quoted to preserve their exact spelling, including `"USER"`. pgvector is an **extension inside the same PostgreSQL server**, not a separate database.

## Databases and safety guards

| Database | Purpose |
| --- | --- |
| `smart_lost_found` | The real application database. Never written by tests. |
| `smart_lost_found_test` | Isolated clone for automated tests (`createdb -T smart_lost_found smart_lost_found_test`). |
| `smart_lost_found_demo` | Fresh install from these scripts + demo data, used for the demonstration and screenshots. |

Every setup/migration script refuses to run unless `current_database()` is one of these three names (an explicit allowlist), and `db/demo_seed.sql` runs **only** in `smart_lost_found_demo`. The test suites go further: `tests/support.mjs` retargets every connection to `smart_lost_found_test` and stops unless all of them really reach it.

## Fresh installation (setup order)

Run from the repository root as the database owner (`postgres`), against a new, empty database. PostgreSQL can prompt for the password, or use `%APPDATA%\postgresql\pgpass.conf`; never put passwords in commands or files.

```powershell
createdb -h localhost -U postgres smart_lost_found
$scripts = @('vector_setup.sql', 'schema.sql', 'views.sql', 'functions.sql', 'triggers.sql', 'indexes.sql',
             'vector_search.sql', 'roles.sql', 'security_functions.sql', 'procedures.sql', 'admin_reports.sql',
             'verify.sql', 'verify_roles.sql', 'seed.sql')
foreach ($script in $scripts) {
    psql -X -h localhost -U postgres -d smart_lost_found -v ON_ERROR_STOP=1 -f "db/$script"
    if ($LASTEXITCODE -ne 0) { throw "Database setup failed: $script" }
}
psql -X -h localhost -U postgres -d smart_lost_found -c "\password lf_web"
psql -X -h localhost -U postgres -d smart_lost_found -c "\password lf_admin_web"
```

The two `\password` commands set the application logins' passwords interactively (the SQL never contains them). Put the resulting connection URLs in `.env.local` (see `.env.example`). Then provision the first ADMIN account (`npm run provision:admin`, README) and fill embeddings (`npm run db:backfill-embeddings`).

`schema.sql`, `indexes.sql` and the HNSW part of `vector_search.sql` are one-time creation scripts and fail if their objects already exist. Every other script is rerunnable. `seed.sql` must only be run once, on an empty database.

## Migrating an existing database (created before 2026-10-31)

```powershell
foreach ($script in @('vector_setup.sql', 'constraints.sql', 'referential_actions.sql', 'functions.sql',
                      'roles.sql', 'security_functions.sql', 'procedures.sql', 'admin_reports.sql',
                      'verify.sql', 'verify_roles.sql')) {
    psql -X -h localhost -U postgres -d smart_lost_found -v ON_ERROR_STOP=1 -f "db/$script"
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $script" }
}
```

None of these scripts inserts, updates or deletes rows. The migration path and the fresh-install path were compared object by object (columns, defaults, constraints, indexes, views, routines, ACLs, policies, triggers): the 240 catalog entries were identical. **Back up first** (`pg_dump -Fc` and `pg_dumpall --globals-only`, kept outside the repository) and see *Recovery* below.

## pgvector setup (`vector_setup.sql`)

`CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public VERSION '0.8.6'`, after checking for PostgreSQL 18, an allowed database name and that pgvector 0.8.6 is installed on the server (clear errors otherwise). The rest of the vector design is split by purpose:

| Step | Script | Object |
| --- | --- | --- |
| 1 | `vector_setup.sql` | extension `vector` (type, `<=>` operator, HNSW method) |
| 2 | `schema.sql` | `"Embedding" VECTOR(384)` in LOST_REPORT and FOUND_REPORT |
| 3 | `triggers.sql` | `invalidate_report_embedding` clears a stale vector when the text changes |
| 4 | `vector_search.sql` | `find_potential_matches` (exact cosine ranking) and two HNSW `vector_cosine_ops` indexes |
| 5 | `lib/semantic-search.ts` | approximate nearest-neighbour search that uses the HNSW indexes |
| 6 | `procedures.sql` | `delete_own_report` (vector DELETE with its report) |

## Schema refinements (revision 2026-10-31)

### Referential actions and defaults (`referential_actions.sql`)

| Foreign key | ON DELETE | Why |
| --- | --- | --- |
| `MATCHES.Lost_ID`, `MATCHES.Found_ID` | CASCADE | A match is a derived association between two reports; it has no meaning without both. |
| `FOUND_PHOTOS.Found_ID` | CASCADE | Photos map a multivalued attribute of the found report. |
| every other FK (CLAIM, CLAIM_EVIDENCE, HANDOVER, reports→USER/CATEGORY/LOCATION) | NO ACTION | Claims, evidence and receipts are history: deleting a report can never delete them. A found report with claims therefore cannot be deleted at all. |

`CLAIM."Claim_Date"` and `HANDOVER."Handover_Date"` have `DEFAULT CURRENT_DATE`. The application no longer sends these columns, and `lf_user` has no INSERT privilege on them, so a client cannot backdate a claim or receipt.

The migration uses literal statements (`ALTER TABLE public."MATCHES" DROP CONSTRAINT ..., ADD CONSTRAINT ... ON DELETE CASCADE;` in one statement, so the table is never without its FK), each guarded by a psql `\if` catalog check so it can be rerun.

### Integrity constraints (CHECK and UNIQUE, `constraints.sql`)

**Requirement vs. design choice.** The college brief asks the design to identify "appropriate constraints" (§4), the SQL implementation to demonstrate constraints (§5), and "input validation … at the database level" (§12). These named constraints move rules the application already depends on into PostgreSQL. None changes a column, type, relationship or nullability, and no status vocabulary was invented.

| Constraint | Rule | Why it is needed |
| --- | --- | --- |
| `USER_Role_check` | `CHECK ("Role" IN ('USER', 'ADMIN'))` | Authorization trusts this column. |
| `USER_Email_key` | `UNIQUE ("Email")` | Sign-in looks users up by email. Race-safe duplicate detection for registration. |
| `USER_Email_format_check` (2026-10-31) | basic shape: one `@`, no spaces, a dot in the domain | Accounts are also provisioned from the terminal; this is a simple shape check, **not** full RFC 5322 email validation. The application validates too. |
| `USER_Email_lowercase_check` (2026-10-31) | `"Email" = lower(btrim("Email"))` | Emails are stored normalised, so `USER_Email_key` also rejects case variants. |
| `LOST_REPORT_Item_Name_check`, `FOUND_REPORT_Item_Name_check` | `CHECK (btrim("Item_Name") <> '')` | A whitespace-only name cannot be searched or recognised. |
| `CLAIM_EVIDENCE_Evidence_No_check` | `CHECK ("Evidence_No" >= 1)` | Domain of the weak entity's partial key. |
| `CLAIM_User_ID_Found_ID_key` | `UNIQUE ("User_ID", "Found_ID")` | One claim per user per found item. |

**Considered and rejected:** a `Match_Score` range (column unused), a `Status` value list (no approved vocabulary), "date not in the future" (`CURRENT_DATE` is not allowed in a CHECK; enforced by the application), phone format (seed data uses fictional `+91-DEMO-…` values; validated by registration instead).

The migration first checks every rule against the existing rows and stops with a list of conflicts — it never edits or deletes data — then adds each constraint only if it is missing.

## Database-level RBAC (`roles.sql`, `security_functions.sql`)

| Role | Kind | Purpose |
| --- | --- | --- |
| `lf_anon` | NOLOGIN privilege role | public visitor: CATEGORY, LOCATION and public report columns (no `User_ID`), auth/registration functions |
| `lf_user` | NOLOGIN privilege role, inherits `lf_anon` | signed-in USER (and ADMIN acting as a user): own reports, claims, evidence and receipts |
| `lf_admin` | NOLOGIN privilege role | read-only campus analytics through `admin_*` objects only; **not** a member of `lf_user` |
| `lf_auth` | NOLOGIN owner | owns `auth_credentials`, `auth_session_user`, `register_user` |
| `lf_reporting` | NOLOGIN owner | owns `found_report_has_handover`, `found_report_claim_count`, `admin_*` views, `admin_daily_activity` |
| `lf_web` | LOGIN, NOINHERIT, CONNECTION LIMIT 20 | every web request; may `SET ROLE` to `lf_anon` or `lf_user` only |
| `lf_admin_web` | LOGIN, NOINHERIT, CONNECTION LIMIT 10, `default_transaction_read_only = on` | admin analytics only; may `SET ROLE` to `lf_admin` only |

No role is a superuser or has CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS. Memberships use PostgreSQL 16+ options (`WITH INHERIT FALSE, SET TRUE`): a login has **no** table privileges until `lib/db.ts` sets the role for the current transaction, so a query that skipped the wrapper fails. `lf_web` is not a member of `lf_admin`, so nothing done through the web login — not even an injected `SET ROLE` — can reach admin privileges.

**PUBLIC** loses CONNECT/TEMP on the database, USAGE on schema `public`, and EXECUTE on every project function (revoked by name, because a blanket revoke would also hit pgvector's own functions).

**Grants (summary).** Column-level where it matters: anonymous users cannot read report owner IDs; nobody but `lf_auth` can read `"USER"` (and only its ID, name, email, role and hash columns); `lf_user` may update only report text/category/location/date/embedding columns, cannot insert `Claim_Date`/`Handover_Date`, and has no UPDATE/DELETE on HANDOVER (receipts are history) and no TRUNCATE anywhere. `UPDATE ("Status")` on CLAIM exists only because PostgreSQL requires UPDATE privilege for `SELECT … FOR UPDATE` locks; RLS limits it to the caller's own claims and the application never updates CLAIM.

**Row-Level Security** on LOST_REPORT, FOUND_REPORT, CLAIM, HANDOVER and CLAIM_EVIDENCE (19 policies). "Owner" means `"User_ID" = app_current_user_id()`, the transaction-local identity that `lib/db.ts` sets from the server-verified session (never a browser field).

- Reports: anyone may read; only the owner may insert, update or delete. FOUND_REPORT's UPDATE policy is `USING (true) WITH CHECK (owner)`: claim, evidence and handover transactions lock another user's found report with `SELECT … FOR UPDATE`, and row locks check only `USING`; a real UPDATE must pass `WITH CHECK`, so only the owner can change it.
- Claims, evidence and receipts are visible only to the claimant. Cross-user questions go through two narrow helpers: `found_report_has_handover(id)` (a fact already shown publicly as "Returned") and `found_report_claim_count(id)` (answered only for the found report's owner).
- `lf_reporting` has explicit read policies (a NOLOGIN owner role does **not** bypass RLS).

**SECURITY DEFINER functions** each have a NOLOGIN owner with only the privileges it needs, `SET search_path = pg_catalog, pg_temp`, schema-qualified names, no dynamic SQL, and EXECUTE for named roles only:

- `auth_credentials(email)` → `User_ID`, `Role`, `Password_Hash` for one exact normalised email (Argon2id verification stays in Node.js).
- `auth_session_user()` → takes **no argument**; returns `User_ID`, `Name`, `Role` for `app.user_id` only, so it cannot be used to enumerate users and returns no email/phone/hash.
- `register_user(name, email, phone, password_hash)` → INSERT only, with the constant role `'USER'` (there is no role parameter), refuses anything that is not an Argon2id hash, normalises the email, retries only on a primary-key collision, and lets `USER_Email_key` report duplicates race-safely.

`verify_roles.sql` (read-only) checks role attributes, the four memberships and their options, 43 table/column and 18 EXECUTE privileges (allowed and denied), the absence of PUBLIC privileges, the 19 policies, and the owners/search_path of every SECURITY DEFINER routine.

## Accounts

Public registration (`/register`) always creates a USER through `register_user`. ADMIN accounts are created only from a terminal with the owner connection: `npm run provision:admin -- --name "…" --email … [--generate-password --credentials-file .local/demo-credentials.txt]` (`scripts/provision-account.mjs`). It refuses an existing email and never updates, replaces or deletes an account.

## Stored procedures (`procedures.sql`)

Both are `SECURITY INVOKER` (grants and RLS still apply), take their identity from `app_current_user_id()`, never COMMIT (they are atomic with the caller's transaction), and are called by the application with `CALL`:

- `withdraw_claim(p_claim_id, OUT p_removed_evidence)` — locks FOUND_REPORT then CLAIM (the same order as evidence and handover, so they cannot deadlock), refuses after a handover (`LF409`), deletes the evidence rows, then the claim. Foreign or missing claims raise `LF404`. Called by `withdrawClaim` in `app/actions/claim.ts`.
- `delete_own_report(p_report_type, p_report_id)` — owner-only. A lost report is deleted with its MATCHES rows (CASCADE). A found report is locked (the same lock `createClaim` takes first) and refused with `LF409` if anyone has claimed it; otherwise it is deleted with its photos and matches. The report's embedding is a column of the deleted row, so the vector is removed too. Called by `deleteReport` in `app/actions/report-delete.ts`.

## Campus analytics (`admin_reports.sql`)

Owned by `lf_reporting`, readable only by `lf_admin`, used by `/admin/campus-summary`:

- `admin_campus_totals` — four independent counts (scalar subqueries).
- `admin_reports_by_category`, `admin_reports_by_location` — ordinary CTE (`WITH reports AS (… UNION ALL …)`), LEFT JOIN, GROUP BY, `COUNT(*) FILTER`.
- `admin_location_hotspots` — **HAVING** with a nested scalar subquery: locations whose lost + found count is above the campus average per location.
- `admin_contested_items` — **HAVING `COUNT(DISTINCT "User_ID") >= 2`**: found items with competing claimants, with a correlated `EXISTS` showing whether one was handed over. No claimant identities.
- `admin_daily_activity(p_days)` — **`WITH RECURSIVE`** calendar (anchor = first day, recursive member = day + 1, termination at today), LEFT JOINed to per-day counts, so quiet days appear as zeros. `p_days` must be 7–366 (SQLSTATE 22023).

```sql
SELECT * FROM public.admin_daily_activity(30);
SELECT * FROM public.admin_location_hotspots ORDER BY total DESC;
SELECT * FROM public.admin_contested_items;
```

## Report detail views (`views.sql`)

`public.v_lost_report_details` and `public.v_found_report_details` expose report IDs, owner/category/location IDs, item name, description, report date and status, together with Category_Name, Location_Name and Building. Neither exposes Embedding or Password_Hash. The found-report view also returns a BIGINT Photo_Count (photos grouped by Found_ID before a LEFT JOIN, so one row per report). Anonymous and admin roles are granted every column except `User_ID`.

## Claim summary function (`functions.sql`)

`public.get_claim_summary(p_claim_id)` is a read-only SQL function (STABLE, SECURITY INVOKER) returning Claim_ID, Found_ID, Evidence_Count (correlated COUNT) and Handover_ID (LEFT JOIN). My Claims calls it with `CROSS JOIN LATERAL`. `functions.sql` also defines `app_current_user_id()`.

## Transaction demonstration (`transactions.sql`)

Run against an **empty** allowed database without concurrent writes. It creates minimal test-ID fixtures, commits a claim with two evidence rows, then shows that a duplicate evidence key (SQLSTATE 23505) followed by ROLLBACK removes both the claim and its first evidence row, cleans up, and verifies all ten tables are empty again. It runs as the owner connection.

## Embedding-invalidation triggers (`triggers.sql`)

`public.invalidate_report_embedding()` is attached to LOST_REPORT and FOUND_REPORT as row-level `BEFORE UPDATE OF "Item_Name", "Description"` triggers. If either text value actually changes (`IS DISTINCT FROM`), it sets `NEW."Embedding"` to NULL. The Edit report workflow (`lib/report-writes.ts` `updateReport`) generates the new vector before opening a transaction, then locks the owned row, runs the text UPDATE (the trigger clears the vector) and a second UPDATE storing the fresh vector — all in one transaction.

## Relational B-tree indexes (`indexes.sql`)

`idx_claim_found_id` (CLAIM.Found_ID) and `idx_matches_found_id` (MATCHES.Found_ID) supplement the indexes PostgreSQL creates for primary keys and UNIQUE constraints.

## Similarity search and HNSW (`vector_search.sql`)

Embeddings encode `Item_Name + "\n" + Description` with the application's Transformers.js distribution of all-MiniLM-L6-v2 (mean pooling, normalised, 384 values). `public.find_potential_matches(p_lost_id, p_limit)` returns found reports ranked by cosine similarity (`1 - (a <=> b)`); it materialises all distances before sorting, so it is an **exact** ranking. The file's second transaction creates `idx_lost_report_embedding_hnsw` and `idx_found_report_embedding_hnsw` (HNSW, `vector_cosine_ops`).

The public "Similar meaning" search (`lib/semantic-search.ts`) is the query that uses them: each branch is `ORDER BY "Embedding" <=> $query LIMIT k` over one table, with iterative index scans enabled when filters are applied. With the real data set (tens of rows) PostgreSQL correctly prefers a sequential scan. `tests/vector-index.mjs` inserts 4,000 synthetic vectors per table inside a rolled-back transaction and confirms with `EXPLAIN (ANALYZE, BUFFERS)` that the same SQL then uses both HNSW indexes (recall@10 against exact ranking ≈ 83%; see the project report).

## Embedding backfill

`npm run db:backfill-embeddings` (`scripts/backfill-embeddings.mjs`) uses `MAINTENANCE_DATABASE_URL`, selects only rows whose `Embedding IS NULL`, encodes them with the same model settings as `lib/embedding.ts`, and writes every vector in one transaction (skipping any row whose text changed meanwhile). Updating only `Embedding` does not fire the invalidation trigger.

## Demo database (`demo_seed.sql`)

Fictional data relative to the run date: 8 extra lost and 9 extra found reports across categories and two extra locations, differently worded matching pairs, open and completed claims, evidence, handovers, a found item with two competing claimants, unclaimed reports and a claimed report that cannot be deleted. It needs `-v demo_user_email=…` (the provisioned demo USER) and refuses any database other than `smart_lost_found_demo`.

## Verification

- `verify.sql` (read-only): 10 tables, 49 columns (types, NOT NULL, the two defaults, both `VECTOR(384)`), 10 PKs, 13 FKs with their ON DELETE actions, 3 UNIQUE, 6 CHECK, 17 indexes (2 HNSW), 7 views and their owners, 10 functions and 2 procedures (SECURITY DEFINER settings, owners, search_path), both triggers, and RLS on exactly the five workflow tables.
- `verify_roles.sql` (read-only): see *Database-level RBAC*.
- `drop_demo.sql`: live CREATE / ALTER … ADD / ALTER … DROP COLUMN / FK-aware DROP TABLE demonstration on temporary tables only.

## Recovery

1. **Preferred:** restore the pre-migration backup — `pg_restore` the `pg_dump -Fc` file into a new database (roles from `pg_dumpall --globals-only` first), check it, and point `.env.local` at it.
2. **In place:** `psql -X -v ON_ERROR_STOP=1 -d smart_lost_found -f db/roles_rollback.sql` disables RLS, drops the policies and the objects owned by `lf_auth`/`lf_reporting`, revokes every `lf_*` privilege and restores PostgreSQL's default PUBLIC privileges, without touching rows; add `-v drop_roles=1` after running it in every database to drop the roles. Then revert the RBAC application code and restore `DATABASE_URL` to the previous owner login. This was tested on the test clone (rollback → re-apply → both verifications pass, table fingerprints unchanged).
