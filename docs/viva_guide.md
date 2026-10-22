# Viva study guide — Smart Lost and Found Management System

A revision sheet built from the actual code. Each topic gives the idea in plain English first, then where it lives in this project. Requirement numbers refer to the [college brief](DBMS%20Level%203%20Project%20Requirements.pdf).

## 1. Why PostgreSQL + pgvector (§3, §18)

- **Plain English:** reports, users, claims and handovers are structured records with relationships and rules, which is what a relational database is for. Item descriptions are free text, and "similar meaning" can't be found with `=` or `LIKE`; a vector database compares meanings as numbers.
- **Here:** PostgreSQL 18 holds the ten approved tables; the pgvector 0.8.6 extension adds the `VECTOR(384)` type, the cosine-distance operator `<=>` and HNSW indexes. Using one database keeps transactions, foreign keys and vectors together: a report and its embedding are saved in the same row and the same transaction.

## 2. ER diagram → tables (§4)

| ER concept | Relational result | Where |
| --- | --- | --- |
| Strong entities USER, CATEGORY, LOCATION, LOST_REPORT, FOUND_REPORT, CLAIM, HANDOVER | One table each, with an INT primary key | `db/schema.sql` |
| 1:N (user reports, category/location of a report, claims of a found item) | FK on the N side, `NOT NULL` for total participation | `LOST_REPORT."User_ID"`, `CLAIM."Found_ID"` … |
| M:N MATCHES between lost and found reports | Bridge table with composite PK `(Lost_ID, Found_ID)` plus attributes | `MATCHES` |
| Multivalued attribute Photos | Separate table, PK `(Found_ID, Photo_URL)` | `FOUND_PHOTOS` |
| Weak entity CLAIM_EVIDENCE (partial key `Evidence_No`) | PK `(Claim_ID, Evidence_No)`, FK to owner CLAIM | `CLAIM_EVIDENCE` |
| 1:1 CLAIM–HANDOVER | FK in HANDOVER made `UNIQUE` | `HANDOVER."Claim_ID" UNIQUE` |

`db/verify.sql` proves the live database matches this exactly (10 tables, 49 columns, 10 PKs, 13 FKs, 3 UNIQUE and 4 CHECK constraints).

## 3. Keys, constraints and normalization (§4, §12)

- **Primary key:** uniquely identifies a row. **Foreign key:** a value must exist in the referenced table, so a claim can't point at a found report that doesn't exist.
- **NOT NULL on FKs:** every report must have an owner, category and location.
- **UNIQUE:** `HANDOVER.Claim_ID` means one receipt per claim.
- **Normalization:** category and location names are stored once in lookup tables, not repeated in every report, so renaming a building is one `UPDATE` (no update anomaly). The tables are in 3NF: every non-key attribute depends only on its table's key.
- **Value rules in the database (§12):** six named constraints back up the application's validation: `USER_Role_check` (USER/ADMIN only), `USER_Email_key`, non-blank `Item_Name` checks on both report tables, `CLAIM_EVIDENCE_Evidence_No_check` (≥ 1) and `CLAIM_User_ID_Found_ID_key` (one claim per user per item). The brief asks for database-level validation but does not mandate CHECK constraints — these were chosen because the app genuinely depends on each rule. Rules needing `CURRENT_DATE` or several tables can't be CHECK constraints, so they stay in the application. Demo: `INSERT INTO "USER" ("User_ID", "Role", "Password_Hash") VALUES (-9, 'SUPERUSER', 'x');` fails with `USER_Role_check`.
- **Rule the schema can't express:** "only one handover per *found item*" spans several claims. It's enforced by locking the `FOUND_REPORT` row (`SELECT … FOR UPDATE`) before checking, in `app/actions/handover.ts`.

## 4. Advanced concepts (§7) — what, where, and why

| Concept | Name / file | Problem it solves | How to demonstrate |
| --- | --- | --- | --- |
| **Transactions** | `withTransaction` in `lib/db.ts`; used by claim, evidence, handover, edit, withdraw | All-or-nothing writes: a failed step can't leave half a claim | `psql -f db/transactions.sql` (commit + rollback demo); withdraw a claim and its evidence disappears together |
| **Row locking** | `FOR UPDATE` in `app/actions/handover.ts`, `claim.ts` | Two people confirming the same item at once can't both succeed | `npm test` "overlapping different claims produce exactly one handover" |
| **Views** | `v_lost_report_details`, `v_found_report_details` (`db/views.sql`) | Reusable joins of reports with category/location (and photo count) without exposing embeddings | Home "Recently found", My Reports, Campus Summary all read them |
| **Stored functions** | `get_claim_summary(claim_id)`, `find_potential_matches(lost_id, limit)` | Encapsulate evidence counting and vector ranking in SQL | `SELECT * FROM get_claim_summary(1);` — My Claims uses it via `CROSS JOIN LATERAL` |
| **Trigger** | `invalidate_report_embedding` + two triggers (`db/triggers.sql`) | Stops an old vector being paired with new text | Edit a report in My Reports; the trigger nulls the vector and the same transaction stores the new one |
| **Indexes** | PK/UNIQUE indexes, `idx_claim_found_id`, `idx_matches_found_id`, two HNSW cosine indexes | Fast lookups by FK; approximate nearest-neighbour search | `EXPLAIN` (on ~10 rows the planner correctly prefers sequential scans; use `SET enable_seqscan = off` to see an index chosen) |
| **Vector similarity search** | `find_potential_matches` (`db/vector_search.sql`) | Find found items whose *description means* the same as a lost item | Potential Matches page; "Phone in navy cover" → "Black mobile with blue case" (0.676) |

## 5. Embeddings and cosine similarity (§8)

1. **What is embedded:** `Item_Name + "\n" + Description` (`lib/embedding.ts`).
2. **Model:** `all-MiniLM-L6-v2` via Transformers.js, run on the server CPU; mean pooling, normalized → 384 numbers.
3. **Storage:** the `Embedding VECTOR(384)` column of `LOST_REPORT` / `FOUND_REPORT`, written in the same `INSERT` as the report.
4. **Metric:** cosine distance `a <=> b`; similarity = `1 − distance` (1 = same direction/meaning, 0 = unrelated).
5. **Retrieval:** `find_potential_matches` takes the lost report's vector, scores every found report with a vector, sorts by distance (ties by `Found_ID`) and returns the top N. It deliberately ranks **exactly** (materialized CTE) instead of using the approximate HNSW index, which is the right trade-off at this scale.
6. **Limit:** similarity suggests, it never proves ownership. That's why claims need evidence and a handover.

Seed rows start with NULL vectors; `npm run db:backfill-embeddings` fills them in one transaction.

## 6. Which work happens where

| In SQL / PostgreSQL | In the application (Next.js server) |
| --- | --- |
| Keys, FKs, NOT NULL, UNIQUE; trigger; views; functions; ranking by `<=>`; aggregation | Authentication (Argon2id, encrypted session cookie holding only `User_ID`), role checks (`requireRole`), Zod validation, ownership checks in every `WHERE`, running the embedding model, transaction orchestration |

Every query uses `$1` parameters (no string concatenation), which prevents SQL injection. Authorization is always re-checked on the server; hiding a link is never the guard.

## 7. Queries worth showing (§6)

- **JOIN + view:** My Claims joins `CLAIM` with `v_found_report_details` and `HANDOVER` (`app/claim/page.tsx`).
- **LEFT JOIN + GROUP BY + aggregates:** My Reports counts claims per found report with `COUNT(c."Claim_ID")` and `BOOL_OR(h."Handover_ID" IS NOT NULL)` (`app/my-reports/page.tsx`).
- **UNION ALL + GROUP BY + COUNT … FILTER:** Campus Summary per-category lost/found totals without multiplying rows (`app/admin/campus-summary/page.tsx`).
- **Correlated subqueries / EXISTS:** claim eligibility ("not my report, not already claimed, not handed over") in `app/claim/page.tsx`.
- **HAVING:** `SELECT "Category_ID", COUNT(*) FROM "FOUND_REPORT" GROUP BY 1 HAVING COUNT(*) > 1;`
- **UPDATE:** edit report (`lib/report-writes.ts`). **DELETE:** withdraw claim (`withdrawClaim` in `app/actions/claim.ts`).

## 8. Walkthroughs to narrate

- **Report → match:** form → Zod validation → category/location existence check → embedding → `INSERT … $8::vector(384)` → Potential Matches calls `find_potential_matches`.
- **Claim → evidence → handover:** `INSERT CLAIM` under a FOUND_REPORT lock → evidence locks FOUND_REPORT then CLAIM (refused once the item has been handed over) and is numbered `MAX(Evidence_No)+1` under the CLAIM lock (weak-entity partial key) → handover locks FOUND_REPORT, checks no other claim was handed over, `INSERT HANDOVER` (UNIQUE backs it up).
- **Withdraw:** locks FOUND_REPORT then CLAIM (same order as handover, so no deadlock), refuses if a handover exists, deletes evidence then the claim in one transaction.

## 9. Likely questions

- *Why random INT IDs, not SERIAL?* The approved schema has no defaults/identity columns; the app uses `crypto.randomInt` and retries on a primary-key collision inside a savepoint.
- *Why is `Status` always NULL?* No status vocabulary was approved; progress is **derived** from evidence/handover rows instead of being stored, which avoids inconsistent duplicate state.
- *Why isn't the HNSW index used?* Exact ranking is cheap for a campus-sized table and gives deterministic results; HNSW is ready for direct `ORDER BY "Embedding" <=> $1 LIMIT k` queries at larger scale.
- *What if two users claim at the same time?* The FOUND_REPORT row lock serializes them; the test suite proves it with genuinely overlapping transactions.
- *Limitations / future work:* login rate limiting, revocable sessions, file uploads for evidence.
