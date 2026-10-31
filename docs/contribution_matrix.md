# Contribution matrix

**Course:** UE24CS351A Database Management System · **Project:** Smart Lost and Found Management System · **Section:** F

| Member | SRN | Role in the project |
| --- | --- | --- |
| Paras Agarwal | PES1UG24CS316 | Database design and database implementation lead |
| Rahul Bellary | PES1UG24CS357 | Application integration, testing and documentation lead |

## How to read this document

This matrix records the **division of responsibilities agreed by the team** and what each member is responsible for reviewing, testing and explaining. It is deliberately separate from two other things:

- **Git commit authorship.** The final changes are committed by one member (Rahul) after both members have reviewed them; commit authorship is not evidence of individual contribution.
- **Who typed the code.** Parts of the implementation, tests and documentation were prepared with an AI coding assistant (Claude Code) under the team's direction. This document does not claim that either member wrote that code by hand. Each member's contribution is their ownership of a part of the system: specifying and reviewing it, running and checking its verification, accepting it, and being able to explain it in the viva.

The status column distinguishes **responsibility allocated** from **review and acceptance**, which each member records after doing it. Nothing below is pre-marked as reviewed.

## Paras Agarwal — database design and implementation lead

| Area | Files and objects | Responsibility | Verification to run and review | Review / acceptance (to be filled by Paras) |
| --- | --- | --- | --- | --- |
| Relational schema and DDL | `db/schema.sql`, `db/constraints.sql`, `db/referential_actions.sql`, `db/vector_setup.sql`, `docs/lost_found_ER_diagram.drawio`, `docs/lost_found_relational_schema.drawio` | Own the design: keys, NOT NULL, UNIQUE/CHECK constraints, ON DELETE policy, defaults | `db/verify.sql`; catalog comparison of migrated vs fresh install | |
| PostgreSQL roles, GRANT/REVOKE, RLS | `db/roles.sql`, `db/security_functions.sql`, `db/verify_roles.sql`, `db/roles_rollback.sql` | Understand and explain every role, grant, policy and SECURITY DEFINER function | `db/verify_roles.sql`; `tests/rbac.mjs`; rollback test | |
| Procedures, triggers, transactions | `db/procedures.sql`, `db/triggers.sql`, `db/transactions.sql`, `db/functions.sql` | Explain lock order, atomicity, SQLSTATE handling, trigger behaviour | `tests/rbac.mjs` (procedures), `tests/handover.mjs` (withdraw/trigger), `db/transactions.sql` | |
| Recursive CTE, HAVING, analytics SQL | `db/admin_reports.sql` | Explain the recursive calendar, the nested-subquery HAVING and the contested-items HAVING | `tests/features.mjs` (independent comparisons) | |
| Vector storage, indexing, HNSW | `db/vector_search.sql`, `lib/semantic-search.ts` (SQL), `tests/vector-index.mjs` | Explain cosine distance, exact vs approximate ranking, why the planner chooses each | `tests/vector-index.mjs`; `docs/evidence/hnsw_explain_plan.txt` | |
| Database verification and migration | `db/verify.sql`, `db/verify_roles.sql`, backups, live migration | Execute and review verification and the live migration with its backup and recovery plan | Fingerprints before/after migration | |

## Rahul Bellary — application integration, testing and documentation lead

| Area | Files and features | Responsibility | Verification to run and review | Review / acceptance (to be filled by Rahul) |
| --- | --- | --- | --- | --- |
| Next.js integration of database access | `lib/db.ts`, `lib/admin-db.ts`, `lib/auth.ts`, page queries | Explain how role and identity reach PostgreSQL per transaction and why identities cannot leak between requests | `tests/rbac.mjs` (pool isolation), `tests/handover.mjs` | |
| Registration and login experience | `app/register/`, `app/actions/register.ts`, `app/login/`, `scripts/provision-account.mjs` | Own the USER-only registration flow and ADMIN provisioning procedure | `tests/features.mjs` (registration), browser registration journey | |
| Semantic search and its UI | `lib/embedding.ts`, `lib/semantic-search.ts`, `app/search/page.tsx` | Explain exact-words vs similar-meaning search and the similarity badge | `tests/features.mjs` (semantic), browser search journey | |
| Report deletion and user workflows | `app/actions/report-delete.ts`, `app/my-reports/`, claim/evidence/handover pages | Own the user journeys, including the delete confirmation and claimed-report rule | Browser journeys, `tests/features.mjs` (deletion) | |
| Automated and browser tests | `tests/` | Run the suites against `smart_lost_found_test` and review failures | `npm run lint`, `typecheck`, `npm test`, `npm run build`, `npm run test:browser` | |
| Demo data and accounts | `db/demo_seed.sql`, `smart_lost_found_demo`, `.local/demo-credentials.txt` (local only) | Prepare and check the demo database and accounts | Demo journeys | |
| Screenshots and documentation | `docs/screenshots/`, `docs/project_report.md`, `docs/architecture.drawio`, README, demo checklist, `docs/submission/` | Organise screenshots; review the report, diagrams and submission files | Read-through against the rubric | |

## Shared responsibilities (both members)

| Shared work | Status |
| --- | --- |
| Review each other's areas (database ↔ application) | |
| Full end-to-end demonstration (USER and ADMIN journeys) | |
| Understand the overall architecture (Next.js → least-privilege logins → RLS → pgvector) | |
| Explain own contributions in the viva | |
| Viva preparation (report, `db/README.md`, demo checklist) | |

## Work completed and verified (shared record)

Verified on this machine (logs kept locally): `npm run lint`, `npm run typecheck` and `npm run build` pass; `npm test` passes 56 checks against `smart_lost_found_test`; the browser run passes 53 checks (39 workflow + 14 real-browser); `db/verify.sql` and `db/verify_roles.sql` pass on the fresh demo install; the migration and fresh-install paths produce identical catalogs; the RBAC rollback was tested and re-applied without changing any rows. These results belong to the project as a whole; the per-member columns above record who reviews and accepts each area.
