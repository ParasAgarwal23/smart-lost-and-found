# Smart Lost and Found Management System

A college DBMS Level 3 project that brings lost-item reports, found-item reports, claims, supporting evidence, and receipt confirmations into one application. Description-based matching helps users discover possible matches without treating similarity as proof of ownership.

## Features and workflow

Home (`/`) and Search (`/search`) are public. Login is available at `/login`; reporting, potential matches, claims, evidence, and handover require authentication.

1. **Lost Report** (`/lost-report`): enter an item name, description, category, location, and date lost. An embedding is generated before saving.
2. **Found Report** (`/found-report`): enter the same information with a date found and generate an embedding.
3. **Search** (`/search`): search item names/descriptions, filter by category, location, or Lost/Found/Both, and sort by newest or oldest date.
4. **Potential Matches** (`/potential-matches`): select your own lost report and view up to ten found reports ranked by cosine similarity. Retrieval is read-only and does not create `MATCHES`, claims, or handovers.
5. **Claim** (`/claim`): claim another user's found report if you have not already claimed it and no claim for that report has an existing handover. The claimant comes from the session, the date is database-generated, and `Status` remains NULL. Another user's claim without a handover does not block yours.
6. **Claim Evidence** (`/claim/evidence`): add a trimmed description of 1–255 characters to your own claim and view existing evidence grouped by claim. `File_Path` is saved as NULL and is not displayed.
7. **Handover** (`/claim/handover`): confirm receipt for your own claim with a trimmed text acknowledgement of 1–100 characters. The database supplies the date; each claim can have at most one handover. Evidence is not required, and claim status is not an eligibility condition.

The homepage links to every feature and provides logout. Feature pages include Home navigation; forms show success/error feedback, pending states, and next-action links without automatically redirecting after success.

## Technology stack

- Next.js 16.3.8 App Router, React 19.3.0, TypeScript 6.0.3, and Tailwind CSS 4.3.3.
- PostgreSQL 18 with pgvector 0.8.6; direct SQL through the `pg` connection pool, without an ORM.
- Hugging Face Transformers.js (`@huggingface/transformers`) for embeddings.
- Zod validation, Argon2id password hashing, and `iron-session` encrypted cookie sessions.
- ESLint and npm scripts for linting, type checking, development, and production builds.

## Database architecture

The ten relations live in PostgreSQL's `public` schema. Quoted identifiers preserve the approved spelling. Primary and foreign keys enforce relationships; foreign keys use `NO ACTION`, without cascading deletes. IDs are supplied explicitly; application-created reports, claims, and handovers use positive `crypto.randomInt` IDs with bounded primary-key collision retries.

| Table | Purpose |
| --- | --- |
| `USER` | User identity, role, contact fields, and password hash |
| `CATEGORY` | Report categories |
| `LOCATION` | Locations and buildings |
| `LOST_REPORT` | Lost-item reports and embeddings |
| `FOUND_REPORT` | Found-item reports and embeddings |
| `FOUND_PHOTOS` | Photo references; composite key `(Found_ID, Photo_URL)` |
| `MATCHES` | Stored lost/found associations; composite key `(Lost_ID, Found_ID)` |
| `CLAIM` | Claimant and the found report being claimed |
| `CLAIM_EVIDENCE` | Weak entity with key `(Claim_ID, Evidence_No)`; `Evidence_No` is the partial key |
| `HANDOVER` | Receipt acknowledgement; required, unique `Claim_ID` references `CLAIM` |

The unique handover `Claim_ID` enforces the approved 1:1 relationship: a handover belongs to one claim, and a claim may have zero or one handover. Photo references and stored matches exist in the schema/demo data; the application does not upload photos or automatically persist vector results into `MATCHES`.

### Embeddings and similarity

The application uses `Xenova/all-MiniLM-L6-v2`, the Transformers.js model distribution of all-MiniLM-L6-v2. It encodes the trimmed item name and description separated by a newline, using CPU inference, mean pooling, and normalization. Both report tables store 384-dimensional embeddings as `VECTOR(384)`.

`find_potential_matches(lost_id, limit)` excludes NULL/zero-norm embeddings, calculates cosine similarity as `1 - cosine distance` using pgvector's `<=>` operator, and ranks by increasing distance with `Found_ID` as the tie-breaker. It performs exact ranking with no similarity threshold or status filter. HNSW indexes support direct approximate distance queries; the current materialized exact-ranking function does not use those indexes to accelerate its ranking.

### Advanced DBMS concepts implemented

- **Transactions and locking:** claim, evidence, and handover actions use `BEGIN`/`COMMIT`/`ROLLBACK` on a checked-out client. Parent-row locks serialize competing submissions. Savepoints support claim/handover ID collision retries. Evidence numbering uses `MAX(Evidence_No) + 1` under the claim lock, with an INT overflow guard. `db/transactions.sql` separately demonstrates atomic commit and rollback.
- **Views:** `v_lost_report_details` and `v_found_report_details` join category/location details; the found view aggregates photo counts. Neither exposes password hashes or embeddings.
- **Stored functions:** `get_claim_summary(claim_id)` returns claim/found IDs, evidence count, and optional handover ID. `find_potential_matches` provides vector retrieval. Both are read-only, `STABLE`, and `SECURITY INVOKER`; application authorization remains necessary.
- **Triggers:** changes to `Item_Name` or `Description` invalidate a report's embedding by setting it to NULL. Triggers do not regenerate embeddings.
- **Indexing:** primary-key/unique indexes, B-tree indexes on `CLAIM.Found_ID` and `MATCHES.Found_ID`, and HNSW cosine indexes on both report embeddings.

## Authentication and security

Passwords are hashed and verified with Argon2id. Encrypted sessions contain only `User_ID`; authenticated requests reload the user and role from PostgreSQL. Cookies are HTTP-only, SameSite=Lax, valid for eight hours, and Secure in production.

Database/session helpers are server-only. Queries use parameters, inputs are validated on the server, and actions obtain identity from the authenticated session rather than browser fields. Only claim owners can add evidence or record receipt, including ADMIN users; there is no admin override. Missing and foreign claims receive the same safe error. Public search selects report information without user contact fields, password hashes, or embeddings.

## Project structure

```text
app/
  actions/             # Auth, reports, search, claims, evidence, handover
  login/               # Login page/form
  lost-report/         # Lost report page/form
  found-report/        # Found report page/form
  search/              # Public search
  potential-matches/   # Owned lost-report similarity results
  claim/               # Claim page/form, evidence/, handover/
  page.tsx             # Homepage/navigation
lib/                   # Database, auth, session, password, embedding, matching
db/                    # Schema, seed, verification, views, functions, triggers, indexes
docs/                  # College requirements and Draw.io database designs
.env.example           # Empty environment-variable template
```

## Prerequisites

- Node.js **22.13.0 or newer** and npm, matching `package.json`.
- PostgreSQL **18**, the `psql`/`createdb` tools, and pgvector **0.8.6** installed on the database server. Schema/verification scripts enforce these versions and the database name `smart_lost_found`.
- A PostgreSQL role authorized to create the local database/objects and enable the extension.
- Network access for the embedding model's initial download; later runs can reuse its local cache.

## Local setup

Run commands from the repository root. Install the locked dependencies:

```sh
npm ci
```

### 1. Create and initialize the database

This PowerShell example uses the local `postgres` role. PostgreSQL can prompt for its password; keep credentials out of commands and tracked files. Run against a **new database**, not an existing database containing application data.

```powershell
createdb -h localhost -U postgres smart_lost_found
psql -X -h localhost -U postgres -d smart_lost_found -v ON_ERROR_STOP=1 -c "CREATE EXTENSION vector WITH SCHEMA public VERSION '0.8.6';"

$scripts = @('schema.sql', 'views.sql', 'functions.sql', 'triggers.sql', 'indexes.sql', 'vector_search.sql', 'verify.sql', 'seed.sql')
foreach ($script in $scripts) {
    psql -X -h localhost -U postgres -d smart_lost_found -v ON_ERROR_STOP=1 -f "db/$script"
    if ($LASTEXITCODE -ne 0) { throw "Database setup failed: $script" }
}
```

`schema.sql`, relational/vector index creation, and `seed.sql` are one-time operations and must not be blindly rerun. Seed data contains fictional users, categories, locations, reports, matches, evidence, and handovers. `verify.sql` is read-only and checks tables, columns, nullability, keys, and the vector extension. See [database documentation](db/README.md) for script details.

`db/transactions.sql` is an optional demonstration, **not part of normal setup**. It requires an empty `smart_lost_found` database, temporarily commits fixtures, demonstrates rollback, and cleans up. Run it to completion before seeding, without concurrent application writes.

### 2. Configure the application

If `.env.local` does not already exist, copy the empty template and fill it privately:

```powershell
Copy-Item .env.example .env.local
```

| Variable | Required value |
| --- | --- |
| `DATABASE_URL` | `postgresql://<username>:<URL-encoded-password>@<host>:<port>/smart_lost_found` |
| `SESSION_SECRET` | Independently generated random secret of at least 32 characters |

Do not overwrite an existing configured `.env.local`. Never commit it or prefix these variables with `NEXT_PUBLIC_`. Production requires HTTPS for Secure session cookies.

### 3. Provision a login account

Seed users have **unusable password-hash placeholders**, not demo login credentials. Before signing in, a local database administrator must provision an existing `USER` with a valid Argon2id hash and a supported `USER` or `ADMIN` role. The password helper is implemented in `lib/password.ts`; no registration page or account-provisioning command is provided. No real login credentials are documented here.

### 4. Start the application

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Stop the server with Ctrl+C.

## Validation and production

```sh
npm run typecheck
npm run lint
npm run build
npm start
```

`npm start` serves the completed production build. These are the repository's available validation scripts; there is no dedicated automated-test npm script.

## Current limitations

- Seeded reports have NULL embeddings. New reports generate embeddings, but there is no seed backfill command or automatic regeneration after trigger invalidation.
- Similarity suggests potential matches only; it never proves ownership, approves claims, or automatically marks an item returned. Claim/report status values remain NULL in new submissions; no status workflow is implemented.
- Evidence is description-only; file/photo uploads, digital signatures, admin dashboards, and approval workflows are not implemented. Handover records a simple claimant acknowledgement.
- Login rate limiting is not implemented. Logout deletes the browser cookie; a previously copied stateless session cookie cannot be revoked before expiry.

## Project references and team

- [College requirements](docs/DBMS%20Level%203%20Project%20Requirements.pdf)
- [Approved ER diagram](docs/lost_found_ER_diagram_revised.drawio)
- [Approved relational schema](docs/lost_found_relational_schema_revised.drawio)

The original Draw.io diagrams are retained for historical reference. **Team details: [Add team member names, student IDs, and guide details here.]** No verified team roster is recorded in the repository.
