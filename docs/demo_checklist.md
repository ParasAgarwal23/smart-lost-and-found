# DBMS Level 3 demonstration checklist

Use the [college brief](DBMS%20Level%203%20Project%20Requirements.pdf) and [project report](project_report.md) alongside this checklist. Do not put demo passwords on slides or in this repository. Login accounts must be provisioned locally with Argon2id hashes; the portable seed contains unusable password placeholders.

## Before the presentation

- [ ] Fill in real team-member names, IDs, individual database/application contributions, guide details, and submission date in the report or college cover sheet.
- [ ] Confirm PostgreSQL 18, pgvector 0.8.6, `smart_lost_found`, private `.env.local`, dependencies, model cache/network, and local USER/ADMIN logins. Follow the [README](../README.md#local-setup) on a fresh database; do not rerun `seed.sql` on an occupied database.
- [ ] Run `npm run db:backfill-embeddings -- --dry-run`; if it reports rows without embeddings, run it without `--dry-run` so every seeded lost report has potential matches.
- [ ] Have an eligible demo claim available, or create one with a USER account and a different user's found report. A found report with an existing handover cannot be confirmed again. Keep demo credentials private.
- [ ] Open the [ER diagram](lost_found_ER_diagram.drawio), [relational schema](lost_found_relational_schema.drawio), and [SQL scripts](../db/README.md). Check that application screenshots show only fictional demo data.

## Suggested live sequence

1. **Motivation and design:** state the campus lost/found problem, project scope, why PostgreSQL plus pgvector was chosen, and the ten-table ER/relational design. Point out primary/foreign keys and weak `CLAIM_EVIDENCE` numbering.
2. **Database implementation:** show `db/schema.sql`, report-detail views, `get_claim_summary`, embedding-invalidation triggers, relational/HNSW indexes, and the transaction demonstration. Explain that `verify.sql` checks the approved schema; do not rerun creation scripts on the populated demo database.
3. **Public interface:** open Home and Search. Filter Lost/Found, category/location and search text. Show an item card and its claim next action; note that search is public and private contacts are absent.
4. **USER journey:** Signed out, choose **Report an item → I lost something** and show that Sign In explains why it's needed and returns you to the form. Submit a lost report and use **See possible matches**; explain (with the [viva guide](viva_guide.md)) that the percentage is cosine similarity of 384-dimension embeddings and that a match is not proof of ownership. If needed, use another user's eligible found report. Choose **Claim this item**, then follow each claim's **Next step**: add evidence, then **Confirm item received** only when the item has truly been returned. Show the receipt and that another claim for that same found item cannot complete another handover.
5. **ADMIN distinction:** Sign Out, then Sign In with the local ADMIN account. Open **Campus Summary** and show four live counts, category/location breakdowns, and recent reports. Explain that `requireRole("ADMIN")` protects the page server-side. Return to a USER session or signed-out browser and show that the admin page is denied/redirected; ADMIN still has no override for private claim evidence or handover ownership.
6. **UPDATE, DELETE and the trigger live:** open **My Reports**, edit a lost report's description and save. In psql, show the new vector (`SELECT vector_dims("Embedding") FROM "LOST_REPORT" WHERE "Lost_ID" = …`) and explain that the trigger cleared the old vector during the first `UPDATE` and the same transaction stored the new one. Then, on **My Claims**, withdraw a claim that has no handover and show that its `CLAIM_EVIDENCE` rows disappeared with it (children deleted first because the foreign key is `NO ACTION`). Point out that a claim with a handover cannot be withdrawn.
7. **SQL and quality evidence:** run read-only examples from the [report](project_report.md#3-implementation-and-important-database-operations) and show the actual test scripts/results you have. Explain transaction rollback, parent-row locking, claim uniqueness, parameterized queries, and fixture restoration. If asked for `ALTER`/`DROP`/`UPDATE`, use the report's temporary-table example in a local disposable session, never on the permanent design.
8. **Conclude:** summarize the achieved requirements and realistic future work. Explicitly distinguish implemented behavior from optional future enhancements.

## Submission evidence

- [ ] Submit or link the README, project report, ER and relational-schema Draw.io files (with their PNG exports in `docs/diagrams/`), SQL scripts, application screenshots, tests, and GitHub commit history.
- [ ] Add actual team contribution statements and any instructor-required cover/signature pages outside the application code.
- [ ] Keep `.env.local`, plaintext passwords, private database credentials, and real user data out of screenshots and submitted files.
