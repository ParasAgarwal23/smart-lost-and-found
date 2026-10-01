# Initial PostgreSQL schema

Source of truth: the two revised Draw.io files in `docs/` and the college requirements PDF. The original diagrams are historical only. The nine non-primary-key foreign keys in LOST_REPORT, FOUND_REPORT, CLAIM, and HANDOVER are NOT NULL as explicitly approved by the user. All primary-key components are implicitly NOT NULL; Password_Hash is explicitly NOT NULL. Other attributes remain nullable.

The scripts create the ten approved relations in PostgreSQL's standard `public` schema. Table and column identifiers are consistently quoted to preserve their exact approved spelling, including `"USER"`.

## Run from the repository root

PostgreSQL 18 and the already-enabled vector extension version 0.8.6 are required. Its VECTOR type must be accessible through the connection's search path. Use your locally configured PostgreSQL role; the example below uses postgres.

```powershell
psql -X -h localhost -U postgres -d smart_lost_found -v ON_ERROR_STOP=1 -f db/schema.sql
psql -X -h localhost -U postgres -d smart_lost_found -v ON_ERROR_STOP=1 -f db/verify.sql
```

Authenticate through PostgreSQL's interactive password prompt or a local password file (`%APPDATA%\postgresql\pgpass.conf` on Windows). Do not put passwords in these scripts or commit credentials.

`schema.sql` is a one-time creation script, not a rerunnable migration. It uses a transaction and plain CREATE TABLE, so existing table names cause an error rather than being overwritten or silently accepted. With ON_ERROR_STOP enabled, a failure aborts execution and disconnecting rolls back the transaction. The script does not create, update, or reinstall the vector extension.

`verify.sql` is read-only and raises an error if the expected tables, column types/nullability, keys, or extension are missing or incorrect. It also lists all primary, foreign, and unique constraints for review. It inserts no sample data and creates no stored functions.

Validated on 2026-10-01 against the local `smart_lost_found` database with PostgreSQL 18.6 and vector 0.8.6. Schema creation committed successfully, and every verification assertion passed: ten tables, 49 columns, ten primary keys, thirteen foreign keys, both VECTOR(384) columns, and the approved nullability and HANDOVER uniqueness.

## Deliberately deferred

IDs use INT with no automatic generation. No business-rule checks, additional uniqueness rules, defaults, cascades, permanent sample data, or embedding generation are included. PostgreSQL supplies the indexes required by primary keys and the HANDOVER Claim_ID unique constraint. Foreign keys use PostgreSQL's default NO ACTION behavior; no cascade policy has been added.

HANDOVER Claim_ID is NOT NULL, UNIQUE, and an FK to CLAIM. Every handover references one claim, and each claim can have at most one handover; claims without a handover remain possible.

## Report detail views

After the schema exists, run:

```powershell
psql -X -h localhost -U postgres -d smart_lost_found -v ON_ERROR_STOP=1 -f db/views.sql
```

`public.v_lost_report_details` and `public.v_found_report_details` expose the report IDs, user/category/location IDs, item name, description, report date, and status, together with Category_Name, Location_Name, and Building. Neither view exposes Embedding or Password_Hash.

The found-report view also returns a BIGINT Photo_Count. Photos are grouped by Found_ID before being left joined, producing one row per found report even with multiple photos; reports without photos return a count of zero. Category and location joins use their primary keys and the reports' required foreign keys, preserving one row per report.

These views demonstrate the college requirements for views (sections 5 and 7), joins, and GROUP BY/COUNT aggregation (section 6). The script uses explicit output columns, runs in a transaction, and can be rerun with CREATE OR REPLACE VIEW. It changes no table definitions or data.

## Claim summary stored function

After the schema exists, run:

```powershell
psql -X -h localhost -U postgres -d smart_lost_found -v ON_ERROR_STOP=1 -f db/functions.sql
```

`public.get_claim_summary(p_claim_id INTEGER)` is a read-only SQL function declared STABLE and SECURITY INVOKER. It returns exactly Claim_ID, Found_ID, Evidence_Count (BIGINT), and Handover_ID using CLAIM, CLAIM_EVIDENCE, and HANDOVER. An existing claim without evidence returns a count of zero; a claim without handover returns a NULL Handover_ID. An unknown claim returns no row. Evidence is counted in a correlated aggregate, so multiple evidence rows do not duplicate the result. The existing unique HANDOVER Claim_ID ensures at most one handover row per claim.

Example (replace 1 with an existing claim ID):

```sql
SELECT "Claim_ID", "Found_ID", "Evidence_Count", "Handover_ID"
FROM public.get_claim_summary(1);
```

This demonstrates stored functions under college requirement section 7, with a reusable parameterized query, a LEFT JOIN, a subquery, and COUNT aggregation under section 6. It does not change data or determine claim approval or ownership. SECURITY INVOKER uses the caller's permissions rather than the function owner's. The creation script uses a transaction and CREATE OR REPLACE FUNCTION for repeat execution with the same signature.

## Transaction demonstration

Run `db/transactions.sql` with psql against the empty local demonstration database, after the schema exists and without concurrent application writes:

```powershell
psql -X -h localhost -U postgres -d smart_lost_found -f db/transactions.sql
```

The script checks the database name and refuses to run if any application table already contains data. It creates the minimal USER, CATEGORY, LOCATION, and FOUND_REPORT prerequisites using test IDs, then demonstrates two explicit CLAIM + CLAIM_EVIDENCE transactions. No status values are supplied.

The successful BEGIN/INSERT/COMMIT sequence persists one claim and two evidence rows together, which are checked after COMMIT. The failure example inserts another claim and valid evidence before deliberately duplicating the evidence composite primary key. The expected unique_violation (SQLSTATE 23505) aborts that entire transaction; explicit ROLLBACK removes both the claim and its evidence. The script briefly disables psql ON_ERROR_STOP only for the deliberate failing insertion so it can reach ROLLBACK, then restores error stopping.

Atomicity prevents a failed claim submission from leaving a partial claim/evidence record. This demonstrates transactions under college requirement section 7, INSERT/DELETE operations under section 6, and consistency/integrity under section 12. It uses no stored procedure and changes no database objects.

Finally, the script deletes only its test-ID rows in dependency order and verifies all ten application tables are empty again. It prints three verification booleans and exits unsuccessfully if a check fails. The duplicate-key error is expected; a completed successful run ends with `PASS: commit, atomic rollback, and cleanup verified.` Run the file to completion: prerequisites and the success example are committed temporarily and are removed by the final cleanup transaction.

## Embedding-invalidation triggers

After the schema exists, run:

```powershell
psql -X -h localhost -U postgres -d smart_lost_found -v ON_ERROR_STOP=1 -f db/triggers.sql
```

`public.invalidate_report_embedding()` is a reusable PL/pgSQL trigger function attached through `trg_lost_report_invalidate_embedding` and `trg_found_report_invalidate_embedding`. Both are row-level BEFORE UPDATE OF Item_Name, Description triggers. If either text value actually changes, the function sets only NEW.Embedding to NULL. IS DISTINCT FROM handles changes to or from NULL correctly. Assigning the same text values preserves the embedding; unrelated-column updates and INSERT operations are unaffected.

A stale vector represents an older item description and can produce misleading similarity results. Clearing it makes the missing embedding explicit until the approved all-MiniLM-L6-v2 model recomputes it in a later implementation step. The trigger does not run that model, generate vectors, create matches, or approve/reject claims. If changed text and an embedding are supplied in the same update, that embedding is cleared too; recomputed embeddings should be saved in a separate update.

This demonstrates the college trigger requirement (section 7) and data consistency/integrity (section 12), while supporting the documented vector design (section 8). The creation script is transactional and repeatable and does not change columns, constraints, views, existing functions, or indexes. Verification uses temporary report rows inside a transaction followed by ROLLBACK.

## Relational B-tree indexes

After the schema exists, run this one-time creation script:

```powershell
psql -X -h localhost -U postgres -d smart_lost_found -v ON_ERROR_STOP=1 -f db/indexes.sql
```

`idx_claim_found_id` indexes CLAIM(Found_ID), supporting retrieval of claims for a found item. `idx_matches_found_id` indexes MATCHES(Found_ID), supporting retrieval of recorded potential matches from the found-report side. MATCHES already has a composite primary-key index on (Lost_ID, Found_ID); the separate Found_ID-leading index directly supports searches that do not specify Lost_ID.

PostgreSQL automatically creates indexes for primary keys and UNIQUE constraints, but not for referencing foreign-key columns: the appropriate index depends on the workload. These two non-unique B-tree indexes supplement the existing constraint indexes without duplicating them or changing referential integrity. They demonstrate indexing under college requirements sections 5 and 7. No vector indexes are included.

Representative read-query plans can be inspected without adding data:

```sql
EXPLAIN SELECT "Claim_ID", "User_ID", "Found_ID"
FROM public."CLAIM" WHERE "Found_ID" = 1;

EXPLAIN SELECT "Lost_ID", "Found_ID", "Match_Score"
FROM public."MATCHES" WHERE "Found_ID" = 1;
```

The optimizer may choose sequential scans on empty or small tables; that is acceptable and does not imply the indexes are invalid. The creation script runs in one transaction and intentionally fails if either index name already exists, rather than silently accepting a potentially incorrect existing definition.

## Semantic similarity search

After the schema exists, run:

```powershell
psql -X -h localhost -U postgres -d smart_lost_found -v ON_ERROR_STOP=1 -f db/vector_search.sql
```

The approved embedding input is Item_Name + Description, encoded separately by Sentence-Transformers all-MiniLM-L6-v2 into 384 dimensions. LOST_REPORT and FOUND_REPORT store the vectors in their existing VECTOR(384) columns. Dimensionality validates vector shape, not the model that produced it; consistent model provenance must be maintained by the later embedding-generation implementation. This task generates no embeddings.

`public.find_potential_matches(p_lost_id INTEGER, p_limit INTEGER)` is a STABLE, SECURITY INVOKER, read-only function returning Found_ID, Item_Name, Description, and DOUBLE PRECISION Cosine_Similarity. It retrieves the lost report's existing vector, returns no candidates for an unknown report or a NULL/zero-norm query vector, and excludes NULL/zero-norm found vectors. It computes cosine distance with pgvector's `<=>` operator and returns similarity as `1 - distance`. All eligible distances are materialized before sorting in ascending distance order, with Found_ID breaking ties, and applying the supplied limit. This keeps the function exact even when approximate indexes exist.

Example (replace 1 with a report ID whose embedding has been populated):

```sql
SELECT "Found_ID", "Item_Name", "Description", "Cosine_Similarity"
FROM public.find_potential_matches(1, 10);
```

`p_limit = 0` returns no rows. A NULL or negative limit raises invalid_parameter_value (SQLSTATE 22023); no fixed maximum, similarity threshold, or status filter is imposed. Similarity is returned at floating-point precision and is not saved into MATCHES.Match_Score.

The file's second transaction creates only `idx_lost_report_embedding_hnsw` and `idx_found_report_embedding_hnsw`, using HNSW with vector_cosine_ops. These optional approximate indexes support direct queries ordered by the cosine-distance operator with a LIMIT; they do not accelerate the materialized exact-ranking function. The found index supports lost-to-found retrieval, while the lost index supports the reverse direction in a later query. HNSW trades recall for speed; the exact function remains the baseline for comparisons. Existing relational indexes are preserved. Index creation is one-time and fails if an index name already exists.

Results are potential matches only: similar descriptions cannot prove ownership or approve a claim. The function performs no writes, creates no MATCHES rows, and does not change reports, claim decisions, or handover records. This demonstrates vector similarity search and retrieval documentation under college requirements sections 7 and 8, plus indexing under sections 5 and 7.
