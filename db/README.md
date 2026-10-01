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

IDs use INT with no automatic generation. No business-rule checks, additional uniqueness rules, defaults, cascades, explicit extra indexes, sample data, triggers, views, stored functions, or vector search logic are included. PostgreSQL supplies the indexes required by primary keys and the HANDOVER Claim_ID unique constraint. Foreign keys use PostgreSQL's default NO ACTION behavior; no cascade policy has been added.

HANDOVER Claim_ID is NOT NULL, UNIQUE, and an FK to CLAIM. Every handover references one claim, and each claim can have at most one handover; claims without a handover remain possible.
