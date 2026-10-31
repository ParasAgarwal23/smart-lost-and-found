# Smart Lost and Found Management System

**UE24CS351A — Database Management System**

DBMS Mini Project Report

| Name | SRN | Section |
| --- | --- | --- |
| Paras Agarwal | PES1UG24CS316 | F |
| Rahul Bellary | PES1UG24CS357 | F |

<!-- pagebreak -->

## 1. Abstract

Students and staff lose and find items across a campus every day, but the information is scattered: a finder does not know who lost an item, and an owner cannot easily tell whether someone has handed it in. The Smart Lost and Found Management System records lost and found reports with category, location and date, lets people search them by exact words or by *meaning*, and supports a traceable path from a claim, through supporting evidence, to a recorded handover.

The system is a Next.js 16 web application backed by PostgreSQL 18 with the pgvector extension. The relational part holds ten normalised relations with primary, foreign, UNIQUE and CHECK constraints, column defaults and deliberate referential actions. Item descriptions are converted into 384-dimension sentence embeddings (all-MiniLM-L6-v2), stored as `VECTOR(384)` beside the report and compared by cosine distance; HNSW indexes support approximate nearest-neighbour search. Security is enforced inside PostgreSQL as well as in the application: the web application connects through least-privilege login roles, every request runs with a transaction-local database role and user identity, column-level GRANTs and REVOKEs restrict access, and Row-Level Security limits reports, claims, evidence and handovers to their owners. The project demonstrates DDL and DML, joins, nested and correlated subqueries, ordinary and recursive CTEs, GROUP BY with HAVING, views, stored functions and procedures, triggers, transactions, indexing, vector CRUD and similarity search. Every feature was tested against an isolated copy of the database, and the evidence is included.

## 2. Problem statement

Campus lost-and-found processes rely on notice boards, chat groups and a front desk. Reports are not searchable, descriptions of the same item use different words ("phone in a navy cover" versus "black mobile with a blue case"), and there is no reliable record of who claimed an item, what evidence they gave and when it was returned. Anyone handling such records also needs to protect personal information: contact details, password data, private claim evidence and who claimed what.

## 3. Objectives

1. Store lost and found reports, claims, evidence and handovers in a normalised relational database with integrity enforced by the database.
2. Let anyone search reports by exact words, category, location and date, and by similar meaning using vector embeddings.
3. Suggest likely matches for a user's lost item, without treating similarity as proof of ownership.
4. Support an auditable claim → evidence → handover workflow that keeps one handover per found item and never loses history.
5. Provide public USER registration and a separate, maintenance-only way to create ADMIN accounts.
6. Enforce role-based access control in PostgreSQL itself (roles, GRANT/REVOKE, Row-Level Security), not only in application code.
7. Give administrators read-only campus analytics: totals, a daily activity timeline, location hotspots and contested items.

## 4. Scope

**In scope:** registration (USER only), sign in/out, ADMIN provisioning from the terminal, lost/found report creation, editing and deletion, exact and semantic search, potential matches, claims, evidence, handover, claim withdrawal, ADMIN Campus Summary, database-level RBAC, automated and browser tests.

**Out of scope:** file uploads for photos and evidence, notifications, a claim approval workflow and status vocabulary (the `Status` columns stay NULL), maps, payments, and login rate limiting.

## 5. Functional requirements

| # | Requirement | Implementation |
| --- | --- | --- |
| FR1 | Create a USER account | `/register`, `app/actions/register.ts`, `register_user()` |
| FR2 | Sign in and out; distinguish USER and ADMIN | `/login`, `app/actions/auth.ts`, `lib/auth.ts`, `auth_credentials()`, `auth_session_user()` |
| FR3 | Create ADMIN accounts only from a trusted terminal | `npm run provision:admin` (`scripts/provision-account.mjs`) |
| FR4 | Record lost and found reports with an embedding | `/lost-report`, `/found-report`, `lib/report-writes.ts` |
| FR5 | Edit and delete own reports | `/my-reports`, `/my-reports/edit`, `app/actions/report-edit.ts`, `app/actions/report-delete.ts` → `CALL delete_own_report` |
| FR6 | Search by exact words and filters | `/search`, `lib/search.ts` |
| FR7 | Search by similar meaning | `/search?mode=meaning`, `lib/semantic-search.ts` |
| FR8 | Suggest matches for one's lost report | `/potential-matches`, `find_potential_matches()` |
| FR9 | Claim, add evidence, confirm handover, withdraw | `/claim`, `/claim/evidence`, `/claim/handover`, `app/actions/claim*.ts`, `CALL withdraw_claim` |
| FR10 | Read-only campus analytics for ADMIN | `/admin/campus-summary`, `lib/admin-db.ts`, `db/admin_reports.sql` |

## 6. Technology stack

| Layer | Technology |
| --- | --- |
| Frontend and server | Next.js 16.3.8 (App Router, Server Components, Server Actions), React 19.3.0, TypeScript 6.0.3, Tailwind CSS 4.3.3 |
| Database | PostgreSQL 18.6 with the pgvector 0.8.6 extension |
| Database access | `pg` connection pools with parameterised SQL (no ORM) |
| Embeddings | Hugging Face Transformers.js, `Xenova/all-MiniLM-L6-v2` (384 dimensions), run on the server CPU |
| Security | Argon2id (`argon2`), `iron-session` encrypted cookies, Zod validation, PostgreSQL roles and RLS |
| Quality | ESLint, TypeScript type checking, Node.js test scripts, Chrome DevTools Protocol browser tests |
| Tools | psql / pg_dump, draw.io (diagrams), Git and GitHub |

## 7. Technology justification

The project uses **Option 2: SQL + vector database**, implemented as **PostgreSQL with the pgvector extension**. pgvector is an extension loaded into the same PostgreSQL server, not a separate database server.

| Data | Nature | Stored as | Why this technology |
| --- | --- | --- | --- |
| Users, roles, password hashes | Structured, sensitive | `"USER"` table, column grants, SECURITY DEFINER functions | Constraints (unique, lower-case email, role domain) and fine-grained privileges |
| Categories, locations | Small lookup data | `CATEGORY`, `LOCATION` | Normalisation: names stored once (3NF) |
| Lost/found reports | Structured fields + free text | `LOST_REPORT`, `FOUND_REPORT` | Foreign keys, CHECK, RLS ownership, transactions with the embedding |
| Claims, evidence, handovers | Linked workflow records, legal-style history | `CLAIM`, `CLAIM_EVIDENCE` (weak entity), `HANDOVER` | Referential integrity, row locks, atomic transactions, NO ACTION keys that protect history |
| Meaning of descriptions | High-dimensional numeric vectors | `"Embedding" VECTOR(384)` | Cosine distance `<=>`, HNSW approximate search, same transaction as the report |

**Why semantic matching.** Owners and finders describe the same object differently. Embeddings place descriptions with similar meaning close together. In the demo (Figure 9) the search text "charger for my laptop with tape on the cable" ranks the lost report "Laptop charger" (74% similar) and the found report "USB-C power adapter … blue tape wrapped round it" (48%) at the top, although the found report shares almost none of those words. Similarity is used only as a suggestion; ownership still needs a claim, evidence and a handover.

**Why PostgreSQL + pgvector together.** A report and its embedding are one row: they are written in one transaction, deleted together, protected by the same backups, roles, grants and RLS, and kept consistent by a trigger that clears a stale vector when the text changes. Queries can mix vector distance with relational filters (category, location, type) in one SQL statement.

**Why not a separate vector database (Qdrant, Chroma, Pinecone).** It would need dual writes and synchronisation (risking orphaned or stale vectors after edits and deletions), a second security model outside PostgreSQL's RBAC, and another server to run and back up. Its advantages — distributed indexing of millions of vectors — do not apply to a campus data set of thousands of reports, which pgvector's HNSW indexes handle comfortably.

## 8. ER diagram

![Figure 1. ER diagram (Chen notation)](diagrams/er_diagram.png)

Editable source: `docs/lost_found_ER_diagram.drawio`. Eight entities (seven strong, one weak) and eleven relationships. `CLAIM_EVIDENCE` is a weak entity identified through `HAS_EVIDENCE` (total participation); `Photos` is a multivalued attribute; `MATCHES` is the M:N relationship between lost and found reports. The ER diagram did not change in this revision: no entity, attribute or relationship was added or removed. Referential actions, defaults, CHECK constraints and security policies are relational/physical design decisions shown in the relational schema below.

## 9. Relational schema

![Figure 2. Relational schema with keys, NOT NULL foreign keys, constraints, defaults and ON DELETE actions](diagrams/relational_schema.png)

Editable source: `docs/lost_found_relational_schema.drawio`. Arrows run from each foreign key to the primary key it references. **NN** marks NOT NULL foreign keys, **CASCADE** marks the three `ON DELETE CASCADE` keys (MATCHES ×2, FOUND_PHOTOS), and **DEFAULT CURRENT_DATE** marks the two database-supplied dates.

## 10. Data dictionary

`PK` primary key, `FK` foreign key, `NN` not null, `UQ` unique, `CK` named CHECK. Other attributes are nullable.

| Relation | Columns: type and key/requirement |
| --- | --- |
| `USER` | `User_ID` INT PK; `Name` VARCHAR(100); `Email` VARCHAR(100) UQ, CK (basic format), CK (lower-case, trimmed); `Phone` VARCHAR(15); `Role` VARCHAR(20) CK (USER/ADMIN); `Password_Hash` VARCHAR(255) NN |
| `CATEGORY` | `Category_ID` INT PK; `Category_Name` VARCHAR(50) |
| `LOCATION` | `Location_ID` INT PK; `Location_Name` VARCHAR(50); `Building` VARCHAR(50) |
| `LOST_REPORT` | `Lost_ID` INT PK; `User_ID` INT FK→USER NN; `Category_ID` INT FK→CATEGORY NN; `Location_ID` INT FK→LOCATION NN; `Item_Name` VARCHAR(100) CK (not blank); `Description` TEXT; `Date_Lost` DATE; `Status` VARCHAR(20); `Embedding` VECTOR(384) |
| `FOUND_REPORT` | `Found_ID` INT PK; `User_ID`, `Category_ID`, `Location_ID` INT FK NN; `Item_Name` VARCHAR(100) CK; `Description` TEXT; `Date_Found` DATE; `Status` VARCHAR(20); `Embedding` VECTOR(384) |
| `FOUND_PHOTOS` | `Found_ID` INT PK part, FK→FOUND_REPORT ON DELETE CASCADE; `Photo_URL` VARCHAR(255) PK part |
| `MATCHES` | `Lost_ID` INT PK part, FK→LOST_REPORT ON DELETE CASCADE; `Found_ID` INT PK part, FK→FOUND_REPORT ON DELETE CASCADE; `Match_Score` DECIMAL(5,2); `Match_Status` VARCHAR(20); `Match_Date` DATE |
| `CLAIM` | `Claim_ID` INT PK; `User_ID` INT FK→USER NN; `Found_ID` INT FK→FOUND_REPORT NN (NO ACTION); `Claim_Date` DATE DEFAULT CURRENT_DATE; `Status` VARCHAR(20); UQ (`User_ID`, `Found_ID`) |
| `CLAIM_EVIDENCE` | `Claim_ID` INT PK part, FK→CLAIM; `Evidence_No` INT PK part, CK (≥ 1); `Evidence_Description` VARCHAR(255); `File_Path` VARCHAR(255) |
| `HANDOVER` | `Handover_ID` INT PK; `Claim_ID` INT FK→CLAIM NN UQ; `Handover_Date` DATE DEFAULT CURRENT_DATE; `Signature` VARCHAR(100) |

Totals verified by `db/verify.sql`: 10 tables, 49 columns, 10 primary keys, 13 foreign keys (3 CASCADE, 10 NO ACTION), 3 UNIQUE and 6 CHECK constraints, 2 defaults.

## 11. SQL DDL and constraints

**Setup order (fresh install):** `vector_setup.sql` → `schema.sql` → `views.sql` → `functions.sql` → `triggers.sql` → `indexes.sql` → `vector_search.sql` → `roles.sql` → `security_functions.sql` → `procedures.sql` → `admin_reports.sql` → `verify.sql` → `verify_roles.sql` → `seed.sql`. An existing database is migrated with `vector_setup.sql`, `constraints.sql`, `referential_actions.sql`, `functions.sql`, `roles.sql`, `security_functions.sql`, `procedures.sql`, `admin_reports.sql`. Both paths were run and produced identical catalogs (240 entries; `docs/evidence/catalog_equivalence.txt`).

**CREATE TABLE** with keys, constraints, defaults and referential actions (`db/schema.sql`, excerpt):

```sql
CREATE TABLE public."USER" (
    "User_ID" INT PRIMARY KEY,
    "Name" VARCHAR(100),
    "Email" VARCHAR(100),
    "Phone" VARCHAR(15),
    "Role" VARCHAR(20),
    "Password_Hash" VARCHAR(255) NOT NULL,
    CONSTRAINT "USER_Role_check" CHECK ("Role" IN ('USER', 'ADMIN')),
    CONSTRAINT "USER_Email_key" UNIQUE ("Email"),
    -- Basic shape only (one @, no spaces, a dot in the domain); not full RFC 5322 validation.
    CONSTRAINT "USER_Email_format_check" CHECK ("Email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    -- Stored lower-case and trimmed, so USER_Email_key also rejects case variants.
    CONSTRAINT "USER_Email_lowercase_check" CHECK ("Email" = lower(btrim("Email")))
);

CREATE TABLE public."MATCHES" (
    -- A match is a derived association: it is removed with either report.
    "Lost_ID" INT REFERENCES public."LOST_REPORT" ("Lost_ID") ON DELETE CASCADE,
    "Found_ID" INT REFERENCES public."FOUND_REPORT" ("Found_ID") ON DELETE CASCADE,
    "Match_Score" DECIMAL(5,2),
    "Match_Status" VARCHAR(20),
    "Match_Date" DATE,
    PRIMARY KEY ("Lost_ID", "Found_ID")
);

CREATE TABLE public."CLAIM" (
    "Claim_ID" INT PRIMARY KEY,
    "User_ID" INT NOT NULL REFERENCES public."USER" ("User_ID"),
    -- NO ACTION (default): a found report with claims cannot be deleted.
    "Found_ID" INT NOT NULL REFERENCES public."FOUND_REPORT" ("Found_ID"),
    "Claim_Date" DATE DEFAULT CURRENT_DATE,
    "Status" VARCHAR(20),
    CONSTRAINT "CLAIM_User_ID_Found_ID_key" UNIQUE ("User_ID", "Found_ID")
);
```

**ALTER** on the real tables (`db/referential_actions.sql`), literal and atomic — the FK is dropped and re-added in one statement:

```sql
ALTER TABLE public."MATCHES"
    DROP CONSTRAINT "MATCHES_Lost_ID_fkey",
    ADD CONSTRAINT "MATCHES_Lost_ID_fkey"
        FOREIGN KEY ("Lost_ID") REFERENCES public."LOST_REPORT" ("Lost_ID") ON DELETE CASCADE;

ALTER TABLE public."CLAIM" ALTER COLUMN "Claim_Date" SET DEFAULT CURRENT_DATE;
ALTER TABLE public."HANDOVER" ALTER COLUMN "Handover_Date" SET DEFAULT CURRENT_DATE;
```

`db/constraints.sql` adds the named CHECK/UNIQUE constraints with `ALTER TABLE … ADD CONSTRAINT` after checking existing rows for conflicts. **DROP** is demonstrated safely by `db/drop_demo.sql` on temporary tables: `ALTER TABLE … ADD COLUMN/CONSTRAINT`, `ALTER TABLE … DROP COLUMN`, a `DROP TABLE` refused by a foreign key (SQLSTATE 2BP01), `ALTER TABLE … DROP CONSTRAINT`, then `DROP TABLE`.

**Deletion policy.** CASCADE is used only where the child has no meaning without its parent (a match between two reports, a photo of a found item). Claims, evidence and handovers keep `NO ACTION` keys, so deleting a report can never erase claim history; a found report that anyone has claimed cannot be deleted.

**Considered and rejected:** a status value list (no approved vocabulary), a `Match_Score` range (unused column), a "date not in the future" CHECK (`CURRENT_DATE` is not allowed in CHECK constraints; enforced by the application), a phone-format CHECK (existing demo data uses fictional formats; registration validates phone numbers).

## 12. DML operations

| Operation | Where | Statement (excerpt) |
| --- | --- | --- |
| INSERT report + vector | `lib/report-writes.ts` `createReport` | `INSERT INTO public."LOST_REPORT" (…, "Embedding") VALUES ($1, …, $8::public.vector(384))` |
| INSERT claim (date by DEFAULT) | `app/actions/claim.ts` | `INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID") VALUES ($1, $2, $3)` |
| INSERT evidence, handover | `claim-evidence.ts`, `handover.ts` | `INSERT INTO public."HANDOVER" ("Handover_ID", "Claim_ID", "Signature") VALUES ($1, $2, $3)` |
| INSERT account | `register_user()` | `INSERT INTO public."USER" (…, "Role", …) VALUES (…, 'USER', …)` |
| UPDATE report, then vector | `lib/report-writes.ts` `updateReport` | `UPDATE … SET "Item_Name" = $3, "Description" = $4, …` then `UPDATE … SET "Embedding" = $2::public.vector(384)` |
| DELETE claim + evidence | `withdraw_claim` procedure | `DELETE FROM public."CLAIM_EVIDENCE" WHERE …; DELETE FROM public."CLAIM" WHERE …` |
| DELETE report (+ vector) | `delete_own_report` procedure | `DELETE FROM public."LOST_REPORT" WHERE "Lost_ID" = p_report_id AND "User_ID" = v_user` |
| SELECT | every page | joins, views, functions, CTEs (sections 13–16) |

All values are bound as parameters (`$1`, `$2`, …); identifiers come from fixed code, never from user input.

## 13. JOINs and nested queries

**JOIN with a view and a function** (My Claims, `app/claim/page.tsx`):

```sql
SELECT c."Claim_ID", c."Found_ID", f."Item_Name", f."Category_Name", f."Location_Name",
       summary."Evidence_Count"::text, summary."Handover_ID", h."Handover_Date"::text,
       public.found_report_has_handover(c."Found_ID") AS "Item_Handed_Over"
FROM public."CLAIM" c
JOIN public.v_found_report_details f ON f."Found_ID" = c."Found_ID"
CROSS JOIN LATERAL public.get_claim_summary(c."Claim_ID") summary
LEFT JOIN public."HANDOVER" h ON h."Claim_ID" = c."Claim_ID"
WHERE c."User_ID" = $1
ORDER BY c."Claim_Date" DESC NULLS LAST, c."Claim_ID" DESC;
```

**Nested (non-correlated) subqueries:** the hotspot HAVING compares each group with `(SELECT COUNT(*) FROM reports) / (SELECT COUNT(*) FROM "LOCATION")` (section 17); `lib/report-input.ts` checks `EXISTS (SELECT 1 FROM "CATEGORY" WHERE "Category_ID" = $1)`; `v_found_report_details` LEFT JOINs a grouped derived table of photo counts.

## 14. Correlated subqueries

`get_claim_summary` (`db/functions.sql`) counts evidence per claim with a subquery that refers to the outer row:

```sql
SELECT claim."Claim_ID", claim."Found_ID",
       (SELECT COUNT(*) FROM public."CLAIM_EVIDENCE" AS evidence
        WHERE evidence."Claim_ID" = claim."Claim_ID") AS "Evidence_Count",
       handover."Handover_ID"
FROM public."CLAIM" AS claim
LEFT JOIN public."HANDOVER" AS handover ON handover."Claim_ID" = claim."Claim_ID"
WHERE claim."Claim_ID" = p_claim_id;
```

Other correlated subqueries: `admin_contested_items` (`EXISTS (… WHERE handed."Found_ID" = f."Found_ID")`), the eligible-items query on My Claims (`NOT EXISTS (SELECT 1 FROM "CLAIM" c WHERE c."Found_ID" = f."Found_ID" AND c."User_ID" = $1)`), `found_report_claim_count`, and the RLS policies on HANDOVER and CLAIM_EVIDENCE (`EXISTS (… WHERE c."Claim_ID" = "HANDOVER"."Claim_ID" …)`).

## 15. Ordinary CTEs

Exact-words search (`lib/search.ts`) builds one row set from both report tables, then joins and filters it:

```sql
WITH reports AS (
  SELECT "Lost_ID" AS "Report_ID", 'Lost'::text AS "Report_Type", "Item_Name", "Description",
         "Category_ID", "Location_ID", "Date_Lost" AS report_date FROM public."LOST_REPORT"
  UNION ALL
  SELECT "Found_ID", 'Found'::text, "Item_Name", "Description",
         "Category_ID", "Location_ID", "Date_Found" FROM public."FOUND_REPORT"
)
SELECT r."Report_ID", r."Report_Type", r."Item_Name", c."Category_Name", l."Location_Name"
FROM reports r
JOIN public."CATEGORY" c ON c."Category_ID" = r."Category_ID"
JOIN public."LOCATION" l ON l."Location_ID" = r."Location_ID"
WHERE ($1::text = '' OR r."Item_Name" ILIKE $2::text OR r."Description" ILIKE $2::text) …
```

The same pattern feeds `admin_reports_by_category` and `admin_reports_by_location`; semantic search uses `WITH nearest AS (…)` (section 25), and `find_potential_matches` uses `WITH scored_candidates AS MATERIALIZED (…)` to force an exact ranking.

## 16. Recursive CTE

`admin_daily_activity(p_days)` (`db/admin_reports.sql`) builds a continuous calendar with `WITH RECURSIVE` and LEFT JOINs per-day counts onto it, so days without any report, claim or handover appear as zeros — a plain `GROUP BY` date would skip them. It is used by the Daily Activity section of Campus Summary (30 or 90 days; Figure 16).

```sql
WITH RECURSIVE calendar (day) AS (
    SELECT CURRENT_DATE - (p_days - 1)       -- anchor member
    UNION ALL
    SELECT calendar.day + 1                  -- recursive member
    FROM calendar
    WHERE calendar.day < CURRENT_DATE        -- termination condition
)
SELECT calendar.day, COALESCE(lost.n, 0), COALESCE(found.n, 0),
       COALESCE(claimed.n, 0), COALESCE(handed.n, 0)
FROM calendar
LEFT JOIN (SELECT "Date_Lost" AS d, COUNT(*) AS n FROM public."LOST_REPORT" GROUP BY "Date_Lost") AS lost
    ON lost.d = calendar.day
LEFT JOIN (SELECT "Date_Found" AS d, COUNT(*) AS n FROM public."FOUND_REPORT" GROUP BY "Date_Found") AS found
    ON found.d = calendar.day
LEFT JOIN (SELECT "Claim_Date" AS d, COUNT(*) AS n FROM public."CLAIM" GROUP BY "Claim_Date") AS claimed
    ON claimed.d = calendar.day
LEFT JOIN (SELECT "Handover_Date" AS d, COUNT(*) AS n FROM public."HANDOVER" GROUP BY "Handover_Date") AS handed
    ON handed.d = calendar.day
ORDER BY calendar.day;
```

`p_days` outside 7–366 raises SQLSTATE 22023. The automated test compares the 30 returned rows with counts computed independently in JavaScript; in the test database 20 of the 30 days were quiet and correctly returned as zeros.

## 17. GROUP BY and meaningful HAVING

**Location hotspots** — locations with more lost + found reports than the campus average per location (`admin_location_hotspots`):

```sql
WITH reports AS (
    SELECT "Location_ID" AS location_id, 'Lost'::TEXT AS type FROM public."LOST_REPORT"
    UNION ALL
    SELECT "Location_ID", 'Found' FROM public."FOUND_REPORT"
)
SELECT l."Location_ID" AS id, l."Location_Name" AS label, l."Building" AS building,
       COUNT(*) FILTER (WHERE r.type = 'Lost') AS lost,
       COUNT(*) FILTER (WHERE r.type = 'Found') AS found,
       COUNT(*) AS total
FROM public."LOCATION" AS l
JOIN reports AS r ON r.location_id = l."Location_ID"
GROUP BY l."Location_ID", l."Location_Name", l."Building"
HAVING COUNT(*) > (SELECT COUNT(*) FROM reports)::NUMERIC
                  / NULLIF((SELECT COUNT(*) FROM public."LOCATION"), 0);
```

**Contested items** — found reports claimed by at least two different users (`admin_contested_items`): `GROUP BY f."Found_ID", … HAVING COUNT(DISTINCT c."User_ID") >= 2`, with `COUNT`, `MIN` and `MAX` of claim dates and a correlated `EXISTS` for "handed over".

Both conditions genuinely filter groups: in the demo database 4 of 8 locations are above the 4.25 average and exactly one item has two claimants (Figure 17). Tests compare both views with independent calculations. Other grouping: category/location breakdowns (`COUNT(*) FILTER`), the photo-count derived table in `v_found_report_details`, the per-day counts in the timeline.

## 18. Stored functions

| Function | Language / security | Purpose |
| --- | --- | --- |
| `get_claim_summary(claim_id)` | SQL, STABLE, INVOKER | claim, evidence count (correlated), handover ID |
| `find_potential_matches(lost_id, limit)` | PL/pgSQL, STABLE, INVOKER | exact cosine ranking of found reports |
| `app_current_user_id()` | SQL, STABLE | transaction-local identity for RLS and procedures |
| `admin_daily_activity(days)` | PL/pgSQL, DEFINER (`lf_reporting`) | recursive-CTE timeline |
| `auth_credentials(email)`, `auth_session_user()`, `register_user(…)` | DEFINER (`lf_auth`) | login lookup, session lookup, USER registration |
| `found_report_has_handover(id)`, `found_report_claim_count(id)` | DEFINER (`lf_reporting`) | narrow cross-user facts under RLS |
| `invalidate_report_embedding()` | PL/pgSQL trigger function | section 20 |

## 19. Stored procedures

Both procedures are `SECURITY INVOKER` (grants and RLS apply inside them), take the user's identity from `app_current_user_id()` rather than a parameter, never COMMIT (they are atomic with the caller's transaction), and raise meaningful SQLSTATEs: `LF404` (not found or not yours), `LF409` (history must be kept), `42501` (not signed in). The application calls them with `CALL`.

```sql
CREATE OR REPLACE PROCEDURE public.withdraw_claim(IN p_claim_id INTEGER, OUT p_removed_evidence INTEGER)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user INTEGER := public.app_current_user_id();
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Sign in to withdraw a claim' USING ERRCODE = '42501';
    END IF;
    -- Lock order FOUND_REPORT, then CLAIM (same as evidence and handover): no deadlock.
    PERFORM 1 FROM public."FOUND_REPORT" AS f
    JOIN public."CLAIM" AS c ON c."Found_ID" = f."Found_ID"
    WHERE c."Claim_ID" = p_claim_id AND c."User_ID" = v_user
    FOR UPDATE OF f;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim not found or unavailable to your account' USING ERRCODE = 'LF404';
    END IF;
    PERFORM 1 FROM public."CLAIM" WHERE "Claim_ID" = p_claim_id AND "User_ID" = v_user FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public."HANDOVER" WHERE "Claim_ID" = p_claim_id) THEN
        RAISE EXCEPTION 'This claim has a recorded handover and cannot be withdrawn' USING ERRCODE = 'LF409';
    END IF;
    DELETE FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" = p_claim_id;
    GET DIAGNOSTICS p_removed_evidence = ROW_COUNT;
    DELETE FROM public."CLAIM" WHERE "Claim_ID" = p_claim_id AND "User_ID" = v_user;
END;
$$;
```

Application call (`app/actions/claim.ts`): `withTransaction((client) => client.query("CALL public.withdraw_claim($1, NULL)", [claimId]))`, then `LF404`/`LF409` are mapped to user messages.

`delete_own_report(p_report_type, p_report_id)` deletes an owner's lost report (MATCHES cascade) or found report; for a found report it first takes the same row lock as `createClaim` and refuses with `LF409` if anyone has claimed it. `app/actions/report-delete.ts` calls `CALL public.delete_own_report($1, $2)`.

## 20. Triggers

```sql
CREATE OR REPLACE FUNCTION public.invalidate_report_embedding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    IF NEW."Item_Name" IS DISTINCT FROM OLD."Item_Name"
        OR NEW."Description" IS DISTINCT FROM OLD."Description" THEN
        NEW."Embedding" := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_lost_report_invalidate_embedding
BEFORE UPDATE OF "Item_Name", "Description" ON public."LOST_REPORT"
FOR EACH ROW EXECUTE FUNCTION public.invalidate_report_embedding();
```

The same trigger is attached to FOUND_REPORT. A stale vector would describe old text; the Edit workflow updates the text (the trigger clears the vector) and stores the newly generated vector in a second UPDATE inside the same transaction.

## 21. Transactions and savepoints

- **Every query runs in a transaction** (`lib/db.ts` `withPrincipal`): BEGIN, set role and identity, query, COMMIT; any error → ROLLBACK (a connection that cannot roll back is discarded).
- **Multi-statement workflows** (claim, evidence, handover, edit, withdrawal, deletion) run in one transaction and lock parent rows with `SELECT … FOR UPDATE` in a consistent order (FOUND_REPORT, then CLAIM), so concurrent operations serialise instead of deadlocking. The test suite holds a lock and starts two competing handovers to prove exactly one succeeds.
- **Savepoints** let claim and handover inserts retry a random primary-key collision (`SAVEPOINT claim_insert` … `ROLLBACK TO SAVEPOINT`) without losing the transaction's locks.
- `db/transactions.sql` demonstrates a committed claim with two evidence rows and a failed transaction (duplicate key, SQLSTATE 23505) that ROLLBACK removes completely.

## 22. Indexing

| Index | Type | Purpose |
| --- | --- | --- |
| 13 key/UNIQUE indexes | B-tree (automatic) | primary keys, `USER_Email_key`, `CLAIM_User_ID_Found_ID_key`, `HANDOVER_Claim_ID_key` |
| `idx_claim_found_id`, `idx_matches_found_id` | B-tree | claims/matches of a found report |
| `idx_lost_report_embedding_hnsw`, `idx_found_report_embedding_hnsw` | HNSW, `vector_cosine_ops` | approximate nearest-neighbour search (section 26) |

## 23. pgvector setup and vector CRUD

```sql
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public VERSION '0.8.6';   -- db/vector_setup.sql
"Embedding" VECTOR(384)                                                       -- LOST_REPORT, FOUND_REPORT
CREATE INDEX idx_found_report_embedding_hnsw
ON public."FOUND_REPORT" USING hnsw ("Embedding" public.vector_cosine_ops);   -- db/vector_search.sql
```

| Operation | How | Verified by |
| --- | --- | --- |
| CREATE | the report INSERT stores `$8::public.vector(384)` generated from `Item_Name + "\n" + Description` | 384 finite values, unit norm (`vector_norm` = 1) |
| READ | `find_potential_matches` (exact) and semantic search (approximate, HNSW) | paraphrased phone/charger ranked first |
| UPDATE | trigger clears the old vector; the edit transaction stores the new one; backfill fills NULLs | stored vector equals a fresh embedding of the new text (distance < 1e-5) |
| DELETE | `delete_own_report` removes the row and therefore its vector | row gone; absent from semantic search and potential matches |

Exact ranking used for "Possible matches":

```sql
WITH scored_candidates AS MATERIALIZED (
    SELECT found."Found_ID" AS found_id, found."Item_Name" AS item_name, found."Description" AS description,
           found."Embedding" OPERATOR(public.<=>) query_embedding AS distance
    FROM public."FOUND_REPORT" AS found
    WHERE found."Embedding" IS NOT NULL AND public.vector_norm(found."Embedding") > 0
)
SELECT candidate.found_id, candidate.item_name, candidate.description,
       1::DOUBLE PRECISION - candidate.distance
FROM scored_candidates AS candidate
ORDER BY candidate.distance ASC, candidate.found_id ASC
LIMIT p_limit;
```

## 24. Embeddings

`lib/embedding.ts` holds the single pipeline: `pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { device: "cpu", dtype: "fp32" })`, mean pooling, `normalize: true`, and a check for exactly 384 finite values. `generateEmbedding(itemName, description)` embeds reports; `embedText(text)` embeds search text with the same model, so the two are directly comparable. Cosine similarity is `1 − (a <=> b)`.

## 25. Semantic search

Search → **Similar meaning** (`lib/semantic-search.ts`) embeds 3–200 characters of search text and ranks both lost and found reports. Each branch has the shape PostgreSQL can answer from an HNSW index; category/location names are joined afterwards so the join cannot prevent the index scan:

```sql
WITH nearest AS (
  (SELECT 'Found'::text AS "Report_Type", f."Found_ID" AS "Report_ID", f."Item_Name", f."Description",
          f."Category_ID", f."Location_ID", f."Date_Found" AS report_date,
          f."Embedding" OPERATOR(public.<=>) $1::public.vector(384) AS distance
   FROM public."FOUND_REPORT" f
   WHERE $5::text <> 'Lost' AND f."Embedding" IS NOT NULL
     AND ($2::integer IS NULL OR f."Category_ID" = $2) AND ($3::integer IS NULL OR f."Location_ID" = $3)
   ORDER BY f."Embedding" OPERATOR(public.<=>) $1::public.vector(384)
   LIMIT $4)
  UNION ALL
  ( … the same for LOST_REPORT … )
)
SELECT n."Report_ID", n."Report_Type", n."Item_Name", …, (1 - n.distance)::double precision AS "Similarity"
FROM nearest n
JOIN public."CATEGORY" c ON c."Category_ID" = n."Category_ID"
JOIN public."LOCATION" loc ON loc."Location_ID" = n."Location_ID"
ORDER BY n.distance, n."Report_Type", n."Report_ID"
LIMIT $4;
```

With a category or location filter the transaction sets `SET LOCAL hnsw.iterative_scan = relaxed_order` (pgvector 0.8), so the index scan continues until enough rows pass the filter. Exact-words search remains the default and is unchanged.

## 26. HNSW index and EXPLAIN evidence

On the real data set (tens of reports) PostgreSQL correctly chooses a sequential scan and a sort: reading every row is cheaper than walking a graph index. To verify the index honestly, `tests/vector-index.mjs` inserts 4,000 synthetic unit vectors into each report table **inside a transaction that is rolled back**, runs `ANALYZE`, switches to the anonymous application role, and runs `EXPLAIN (ANALYZE, BUFFERS)` on the exact exported semantic-search SQL. Abridged plan (captured from the verification run):

```text
Limit (actual rows=12.00 loops=1)
  ->  Incremental Sort   Sort Key: "*SELECT* 1".distance, ...
        ->  Nested Loop ...
              ->  Merge Append   Sort Key: "*SELECT* 1".distance
                    ->  Limit (actual rows=9.00 loops=1)
                          ->  Index Scan using idx_found_report_embedding_hnsw on "FOUND_REPORT" f
                                Order By: ("Embedding" <=> '[...384 values...]'::vector(384))
                    ->  Limit (actual rows=5.00 loops=1)
                          ->  Index Scan using idx_lost_report_embedding_hnsw on "LOST_REPORT" l
                                Order By: ("Embedding" <=> '[...384 values...]'::vector(384))
Execution Time: 2.792 ms
```

Both branches use their HNSW index, and Merge Append reads only as many candidates as the final limit needs. Because HNSW is approximate, the test also compares the index's top 10 with an exact ranking over 20 random queries: recall@10 was between 82% and 84% across runs with the default `ef_search` of 40. This is why "Possible matches", which needs exact results for one user's report, keeps the exact materialised ranking, while the public search uses the index-friendly form.

## 27. Authentication and database-level RBAC

**Application layer.** Passwords are hashed with Argon2id (`lib/password.ts`). A successful sign-in stores only `User_ID` in an encrypted, HTTP-only, SameSite=Lax `iron-session` cookie (8 hours; Secure in production). On every request the user's name and role are re-read from PostgreSQL; `requireRole("ADMIN")` protects the admin page, and `lib/admin-db.ts` repeats that check before it touches the admin connection.

**Database layer** (`db/roles.sql`, Figures 19–20). The application never connects as a superuser.

| Role | Kind | Can do |
| --- | --- | --- |
| `lf_web` | LOGIN, NOINHERIT, limit 20 | nothing by itself; may `SET ROLE` to `lf_anon` or `lf_user` only |
| `lf_admin_web` | LOGIN, NOINHERIT, limit 10, read-only by default | nothing by itself; may `SET ROLE` to `lf_admin` only |
| `lf_anon` | NOLOGIN | read categories, locations, public report columns (no owner IDs); call login/registration functions |
| `lf_user` | NOLOGIN, inherits `lf_anon` | own reports (insert, edit text columns, delete), own claims, evidence and receipts |
| `lf_admin` | NOLOGIN, **not** a member of `lf_user` | read `admin_*` views and the timeline function only |
| `lf_auth`, `lf_reporting` | NOLOGIN owners | own the SECURITY DEFINER functions/views; minimal SELECT/INSERT |

No role is a superuser or has CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS. `lib/db.ts` runs each query as:

```sql
BEGIN;  -- READ ONLY for anonymous requests
SELECT set_config('role', 'lf_user', true), set_config('app.user_id', '<session User_ID>', true);
-- the application's parameterised query
COMMIT;
```

The third argument `true` makes both settings transaction-local, so a pooled connection returns to plain `lf_web` with no identity after every request; the RBAC test interleaves 48 requests from different identities to prove it. Because `lf_web` is not a member of `lf_admin`, nothing done through the web login — even an injected `SET ROLE` — can reach admin privileges, and a USER cannot become ADMIN by changing a cookie or form field.

**GRANT / REVOKE (excerpt):**

```sql
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO lf_web, lf_admin_web;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO lf_anon, lf_admin, lf_auth, lf_reporting;
GRANT SELECT ("Found_ID", "Category_ID", "Location_ID", "Item_Name", "Description",
              "Date_Found", "Status", "Embedding") ON public."FOUND_REPORT" TO lf_anon;
GRANT SELECT, INSERT, DELETE ON public."LOST_REPORT", public."FOUND_REPORT" TO lf_user;
GRANT UPDATE ("Item_Name", "Description", "Category_ID", "Location_ID", "Date_Lost", "Embedding")
    ON public."LOST_REPORT" TO lf_user;
GRANT INSERT ("Claim_ID", "User_ID", "Found_ID") ON public."CLAIM" TO lf_user;   -- no Claim_Date: no backdating
GRANT SELECT ON public."HANDOVER" TO lf_user;                                    -- no UPDATE/DELETE: history
GRANT INSERT ("Handover_ID", "Claim_ID", "Signature") ON public."HANDOVER" TO lf_user;
REVOKE EXECUTE ON FUNCTION public.get_claim_summary(INTEGER), … FROM PUBLIC;  -- by name, not pgvector's
```

`db/verify_roles.sql` checks role attributes, the four memberships and their INHERIT/SET options, 43 table/column and 18 EXECUTE privileges (allowed and denied), the absence of PUBLIC privileges, all 19 policies and every SECURITY DEFINER owner and `search_path`; it passes on the fresh demo database.

## 28. Row-Level Security

RLS is enabled on LOST_REPORT, FOUND_REPORT, CLAIM, HANDOVER and CLAIM_EVIDENCE (19 policies). "Owner" means `"User_ID" = public.app_current_user_id()`.

```sql
CREATE POLICY found_report_read ON public."FOUND_REPORT"
    FOR SELECT TO lf_anon, lf_user, lf_reporting USING (true);
CREATE POLICY found_report_insert_own ON public."FOUND_REPORT"
    FOR INSERT TO lf_user WITH CHECK ("User_ID" = public.app_current_user_id());
-- Claimants lock another user's found report (SELECT ... FOR UPDATE); locks check only USING.
CREATE POLICY found_report_update_own ON public."FOUND_REPORT"
    FOR UPDATE TO lf_user USING (true) WITH CHECK ("User_ID" = public.app_current_user_id());
CREATE POLICY claim_read_own ON public."CLAIM"
    FOR SELECT TO lf_user USING ("User_ID" = public.app_current_user_id());
CREATE POLICY evidence_read_own ON public."CLAIM_EVIDENCE"
    FOR SELECT TO lf_user
    USING (EXISTS (SELECT 1 FROM public."CLAIM" AS c
                   WHERE c."Claim_ID" = "CLAIM_EVIDENCE"."Claim_ID"
                     AND c."User_ID" = public.app_current_user_id()));
```

- Reports are readable by everyone; only owners insert, change or delete them. The FOUND_REPORT UPDATE policy is `USING (true) WITH CHECK (owner)` deliberately: the claim, evidence and handover transactions must lock a found report that belongs to someone else, and a lock checks only `USING`; a real UPDATE still fails `WITH CHECK` for anyone but the owner (and `User_ID` is not updatable).
- Claims, evidence and receipts are visible only to the claimant. Cross-user questions use two narrow SECURITY DEFINER helpers: `found_report_has_handover(id)` (already shown publicly as "Returned") and `found_report_claim_count(id)` (answered only for the found report's owner).
- `lf_reporting` has explicit read policies — a NOLOGIN owner does not bypass RLS.
- RLS protects against application logic errors (for example a missing `WHERE "User_ID"`); the identity itself is set by the application, so parameterised queries remain essential.

## 29. User registration and login workflow

1. **Create Account** (`/register`, Figures 5–6): full name, email, phone (7–15 digits), password (10–128 characters) and confirmation; Zod validates on the server and the confirmation mismatch is also shown immediately in the browser.
2. The `register` Server Action hashes the password with Argon2id; only the hash leaves Node.js.
3. As `lf_anon` it calls `register_user(name, email, phone, hash)`. The function is SECURITY DEFINER (owner `lf_auth`, `search_path = pg_catalog, pg_temp`), normalises the email, rejects anything that is not an Argon2id hash, inserts with the **constant role `'USER'`**, retries only on a primary-key collision, and returns only the new ID and name. A duplicate email (any case) raises `USER_Email_key`, shown as "An account with this email already exists."
4. Redirect to Sign In with a confirmation; sign-in uses `auth_credentials(email)` and Argon2id verification, then creates the session.

**Why public registration cannot create an ADMIN:** the form has no role field; the action never reads a submitted role (a forged `role=ADMIN` field is ignored, and this is tested); `register_user` has no role parameter (calling it with a fifth argument fails with SQLSTATE 42883); and the web login has no INSERT or UPDATE privilege on `"USER"`. **ADMIN accounts** are created only with `npm run provision:admin`, which requires the owner (maintenance) connection, prompts for the password without echoing it or generates one into a git-ignored file, refuses an existing email and never updates or deletes accounts. The test suite shows the web login cannot use it.

## 30. Application architecture

![Figure 3. Application and database architecture](diagrams/architecture.png)

The browser talks only to the Next.js server. Server Components read data and Server Actions perform writes; both go through `lib/db.ts` (least-privilege `lf_web` pool, role and identity per transaction) or, for admin analytics, `lib/admin-db.ts` (ADMIN check, read-only `lf_admin_web` pool). The embedding model runs on the server. Configuration and credentials come from the git-ignored `.env.local`; the owner connection (`MAINTENANCE_DATABASE_URL`) is used only by setup scripts, provisioning, the embedding backfill and test fixtures.

## 31. Next.js project structure

Generated from the repository's file list (`git ls-files --cached --others --exclude-standard`); screenshot and evidence folders are summarised.

```text
smart-lost-and-found/
├── app/
│   ├── actions/
│   │   ├── auth.ts
│   │   ├── claim-evidence.ts
│   │   ├── claim.ts
│   │   ├── found-report.ts
│   │   ├── handover.ts
│   │   ├── lost-report.ts
│   │   ├── register.ts
│   │   ├── report-delete.ts
│   │   └── report-edit.ts
│   ├── admin/
│   │   └── campus-summary/
│   │       ├── loading.tsx
│   │       └── page.tsx
│   ├── claim/
│   │   │   └── page.tsx
│   │   ├── handover/
│   │   │   ├── handover-form.tsx
│   │   │   └── page.tsx
│   │   ├── claim-form.tsx
│   │   ├── claim-link.tsx
│   │   ├── claim-picker.tsx
│   │   ├── page.tsx
│   │   ├── withdraw-claim.tsx
│   │   └── withdraw-notice.tsx
│   ├── found-report/
│   │   └── page.tsx
│   ├── login/
│   │   ├── login-form.tsx
│   │   └── page.tsx
│   ├── lost-report/
│   │   └── page.tsx
│   ├── my-reports/
│   │   ├── edit/
│   │   │   └── page.tsx
│   │   ├── delete-report.tsx
│   │   └── page.tsx
│   ├── potential-matches/
│   │   └── page.tsx
│   ├── register/
│   │   ├── page.tsx
│   │   └── register-form.tsx
│   ├── search/
│   │   └── page.tsx
│   ├── error.tsx
│   ├── globals.css
│   ├── icon.svg
│   ├── layout.tsx
│   ├── loading.tsx
│   ├── not-found.tsx
│   └── page.tsx
├── components/
│   ├── auto-submit.tsx
│   ├── expandable-text.tsx
│   ├── form.tsx
│   ├── icons.tsx
│   ├── report-form.tsx
│   ├── report-page.tsx
│   ├── sign-in-again.tsx
│   ├── site-header.tsx
│   ├── site-nav.tsx
│   └── ui.tsx
├── db/
│   ├── admin_reports.sql
│   ├── constraints.sql
│   ├── demo_seed.sql
│   ├── drop_demo.sql
│   ├── functions.sql
│   ├── indexes.sql
│   ├── procedures.sql
│   ├── README.md
│   ├── referential_actions.sql
│   ├── roles.sql
│   ├── roles_rollback.sql
│   ├── schema.sql
│   ├── security_functions.sql
│   ├── seed.sql
│   ├── transactions.sql
│   ├── triggers.sql
│   ├── vector_search.sql
│   ├── vector_setup.sql
│   ├── verify.sql
│   ├── verify_roles.sql
│   └── views.sql
├── docs/
│   ├── diagrams/
│   │   ├── architecture.png
│   │   ├── er_diagram.png
│   │   └── relational_schema.png
│   ├── screenshots/
│   │   ├── app/
│   │   │   └── (29 application screenshots, PNG)
│   │   ├── code/
│   │   │   └── (21 VS Code screenshots, PNG)
│   │   ├── campus-summary.png
│   │   ├── home.png
│   │   ├── my-claims.png
│   │   ├── my-reports.png
│   │   ├── potential-matches.png
│   │   ├── report-lost-item.png
│   │   ├── search.png
│   │   └── sign-in.png
│   ├── architecture.drawio
│   ├── DBMS Level 3 Project Requirements.pdf
│   ├── demo_checklist.md
│   ├── lost_found_ER_diagram.drawio
│   ├── lost_found_relational_schema.drawio
│   └── project_report.md
├── lib/
│   ├── admin-db.ts
│   ├── auth.ts
│   ├── db.ts
│   ├── embedding.ts
│   ├── found-report-context.ts
│   ├── next-path.ts
│   ├── password.ts
│   ├── potential-matches.ts
│   ├── reference-data.ts
│   ├── report-input.ts
│   ├── report-writes.ts
│   ├── search.ts
│   ├── semantic-search.ts
│   └── session.ts
├── public/
│   └── .gitkeep
├── scripts/
│   ├── backfill-embeddings.mjs
│   └── provision-account.mjs
├── tests/
│   ├── features.mjs
│   ├── handover.mjs
│   ├── polish-browser.mjs
│   ├── rbac.mjs
│   ├── support.mjs
│   └── vector-index.mjs
├── .env.example
├── .gitignore
├── eslint.config.mjs
├── next.config.ts
├── package-lock.json
├── package.json
├── postcss.config.mjs
├── README.md
└── tsconfig.json
```

## 32. Application screenshots

All screenshots below are native Windows captures of the real Chrome window running this project's production build (`localhost:3000`) against the demonstration database `smart_lost_found_demo`, which contains fictional data. Passwords are masked by the browser. A representative selection is shown; the complete set of captures is kept locally.

![Figure 4. Home page (signed out)](screenshots/app/01-home-public.png)

![Figure 5. Create Account](screenshots/app/02-create-account.png)

![Figure 6. Successful registration leads to Sign In](screenshots/app/04-registration-success.png)

![Figure 7. The newly registered USER account signed in](screenshots/app/06-new-account-user-dashboard.png)

![Figure 8. Search by exact words](screenshots/app/09-search-exact-words.png)

![Figure 9. Search by similar meaning](screenshots/app/10-search-similar-meaning.png)

![Figure 10. Reporting a lost item](screenshots/app/11-report-lost-form.png)

![Figure 11. Deletion rules: a claimed found report is kept](screenshots/app/15-my-reports-found-delete-rules.png)

![Figure 12. Possible matches by cosine similarity](screenshots/app/18-possible-matches.png)

![Figure 13. My Claims with completed claims](screenshots/app/23-my-claims-completed.png)

![Figure 14. ADMIN view of Home](screenshots/app/24-admin-home.png)

![Figure 15. Campus Summary (ADMIN only)](screenshots/app/25-campus-summary.png)

![Figure 16. Daily Activity timeline from the recursive CTE (30 days)](screenshots/app/26-campus-summary-daily-activity.png)

![Figure 17. Location Hotspots and Contested Items (HAVING)](screenshots/app/27-campus-summary-hotspots-contested.png)

![Figure 18. A USER is denied the admin page](screenshots/app/29-user-denied-admin.png)

## 33. Application code screenshots

Native captures of the actual source files opened in Visual Studio Code on the development machine. A representative selection is shown; the remaining captures are kept locally.

![Figure 19. Role memberships and database/schema privileges (db/roles.sql)](screenshots/code/01-roles-memberships-grants.png)

![Figure 20. Row-Level Security policies (db/roles.sql)](screenshots/code/03-roles-rls-policies.png)

![Figure 21. register_user: USER-only registration (db/security_functions.sql)](screenshots/code/05-security-functions-register-user.png)

![Figure 22. Registration Server Action (app/actions/register.ts)](screenshots/code/06-register-server-action.png)

![Figure 23. Argon2id password hashing (lib/password.ts)](screenshots/code/08-password-argon2id.png)

![Figure 24. withdraw_claim procedure (db/procedures.sql)](screenshots/code/09-procedure-withdraw-claim.png)

![Figure 25. Recursive CTE timeline (db/admin_reports.sql)](screenshots/code/12-admin-recursive-cte.png)

![Figure 26. Embedding-invalidation trigger (db/triggers.sql)](screenshots/code/13-trigger-invalidate-embedding.png)

![Figure 27. Semantic search SQL for HNSW (lib/semantic-search.ts)](screenshots/code/16-semantic-search-hnsw-query.png)

![Figure 28. Transaction-local role and identity (lib/db.ts)](screenshots/code/17-db-transaction-local-role.png)

## 34. Testing strategy and verified results

**Isolation.** Tests never touch the real database. `tests/support.mjs` rewrites all three connections (web, admin, owner) to the clone `smart_lost_found_test` and refuses to start unless every connection reaches it and the two application logins are not superusers. Fixtures are inserted and removed through the owner connection, and each suite compares all ten tables with their pre-test contents. Setup scripts accept only the three named databases; `demo_seed.sql` accepts only the demo database. The live database was backed up (`pg_dump -Fc`, `pg_dumpall --globals-only`, outside the repository) and the backup was restored into a scratch database with identical row fingerprints before any change.

| Check | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck`, `npm run build` | Pass, no errors |
| `npm test` → `tests/handover.mjs` | 39 checks pass: claims, evidence, handover (including genuinely overlapping transactions), withdrawal via `CALL`, trigger, edit, constraints, Campus Summary, role-specific navigation, exact table restoration |
| `npm test` → `tests/rbac.mjs` | 9 groups pass: NOINHERIT logins and forbidden `SET ROLE`, anonymous/USER/ADMIN allow-deny matrix, RLS (own rows only, cross-user lock allowed), procedures' SQLSTATEs, `register_user`, pool identity isolation (48 interleaved requests), ADMIN provisioning only via the maintenance connection |
| `npm test` → `tests/features.mjs` | 6 pass: registration (USER-only, forged role ignored, Argon2id, normalised email, duplicates and invalid fields), vector CREATE/READ/UPDATE, semantic search, analytics vs independent SQL, deletion and vector DELETE |
| `npm test` → `tests/vector-index.mjs` | 2 pass + recall report: both HNSW indexes used at 4,000 vectors per table; synthetic rows rolled back |
| `npm run test:browser` (production build, headless Chrome) | 53 pass (39 + 14 browser journeys: registration, login/logout, protected routes, report forms with real embeddings, matches, claim → evidence → handover, withdrawal, deletion, similar-meaning search, admin analytics, layouts at 320–1440 px) |
| `db/verify.sql`, `db/verify_roles.sql` on the fresh demo install | Pass |
| Migration path vs fresh install | 240 catalog entries identical |
| Live migration of `smart_lost_found` | Fresh `pg_dump -Fc` and `pg_dumpall --globals-only` kept outside the repository; restored into a scratch database with identical row fingerprints; the migration scripts ran in order; `db/verify.sql` and `db/verify_roles.sql` passed; all ten table fingerprints were identical before and after (existing accounts, reports, claims, evidence and handovers unchanged); read-only smoke tests as anonymous, USER and ADMIN passed, and the application served requests only as `lf_web` and `lf_admin_web` |
| RBAC rollback test | rollback removes all policies, privileges and owned objects; re-apply restores them; row fingerprints unchanged |

Verification logs, the backup/restore check and the test output are kept locally with the project owner; the table above reports their final results.

## 35. Rubric completion mapping

| # | Criterion (marks) | Evidence in this project |
| --- | --- | --- |
| 1 | ER diagram (2) | Figure 1; `docs/lost_found_ER_diagram.drawio` |
| 2 | Relational schema, keys, relationships, constraints (3) | Figure 2; data dictionary (section 10); `db/verify.sql` |
| 3 | SQL implementation — DDL with constraints (4) | `db/schema.sql`, `constraints.sql`, `referential_actions.sql` (literal ALTER), `drop_demo.sql`; section 11 |
| 4 | NoSQL/Vector database creation (4) | `db/vector_setup.sql` (CREATE EXTENSION), `VECTOR(384)` columns, HNSW indexes; section 23 |
| 5 | Technology justification (1) | Section 7 |
| 6 | DML operations (4) | INSERT/UPDATE/DELETE/SELECT in actions, procedures and pages; section 12 |
| 7 | Nested / correlated / recursive and JOIN queries (4) | Sections 13–17 (joins, nested, correlated, `WITH RECURSIVE`, HAVING) |
| 8 | Advanced SQL — procedure/function, trigger, CTE (6) | Procedures `withdraw_claim`, `delete_own_report` (called with CALL); functions; trigger; ordinary and recursive CTEs; sections 15–21 |
| 9 | NoSQL/Vector feature and CRUD (7) | Vector CREATE/READ/UPDATE/DELETE, potential matches, semantic search, HNSW EXPLAIN; sections 23–26 |
| 10 | Next.js interface (3) | Forms, tables, search and filters, dashboard; Figures 4–18 |
| 11 | Backend/API and database integration (2) | Server Actions, `lib/db.ts`, `lib/admin-db.ts`, environment-based credentials; section 30 |
| 12 | Authentication, two roles, database RBAC (4) | Registration, Argon2id, USER/ADMIN, PostgreSQL roles, GRANT/REVOKE, RLS; sections 27–29 |
| 13 | Documentation and Git/GitHub (2) | This report, README, `db/README.md`, demo checklist, Git history |
| 14 | Originality, individual contribution, modification/viva (4) | Original design; contribution allocation (section 36, `docs/contribution_matrix.md`); demo checklist for the viva |

## 36. Individual contributions

The team agreed the following division of responsibilities. It is recorded in detail, with files, verification duties and a review/acceptance column for each member, in `docs/contribution_matrix.md`.

| Member | Responsibility |
| --- | --- |
| Paras Agarwal (PES1UG24CS316) | **Database design and implementation lead.** Owns and reviews the relational schema and DDL, referential actions and constraints; PostgreSQL roles, grants and RLS; stored procedures, triggers and transactions; recursive CTE, HAVING and administrative SQL; vector storage, indexing and HNSW behaviour; database verification and the live migration. Explains the database architecture and security design in the viva. |
| Rahul Bellary (PES1UG24CS357) | **Application integration, testing and documentation lead.** Owns and reviews the Next.js integration, semantic search UI, registration and login experience, report deletion and user workflows; runs and reviews the automated and browser tests; validates USER and ADMIN journeys; prepares demo data and accounts; organises screenshots; reviews the report, architecture diagram and submission documents. Explains integration, tests and workflows in the viva. |
| Both | Review each other's work, take part in the end-to-end demonstration, understand the whole architecture, and prepare for the viva together. |

This allocation describes responsibility and review. It is independent of Git commit authorship (one member commits the reviewed changes). Parts of the implementation and documentation were prepared with an AI coding assistant under the team's direction; neither member claims to have typed that code by hand. Each member's acceptance is recorded in the contribution matrix after their own review.

## 37. Conclusion and future enhancements

The Smart Lost and Found Management System combines a normalised relational design with semantic vector search in a single PostgreSQL server, and enforces security in the database as well as the application. Reports and their embeddings stay consistent through transactions, a trigger and deliberate referential actions; claims, evidence and handovers are protected as history; anonymous visitors, users and administrators each reach exactly the data their role allows, enforced by PostgreSQL roles, column grants and Row-Level Security. Administrators get analytics built on recursive and grouped SQL. All of this was verified on isolated databases with automated, database-level and browser tests.

**Future enhancements:** login rate limiting and revocable server-side sessions; evidence and photo uploads with access-controlled storage; a claim review and approval workflow with an agreed status vocabulary; notifications when a likely match is reported; storing confirmed matches in `MATCHES` with scores; tuning HNSW (`ef_search`, `m`) as the data grows.
