# Demonstration setup

The application and the demonstration use one database: **`smart_lost_found_demo`**. All of its people, items and places are fictional. `.env.local` points all three connection URLs (`DATABASE_URL`, `ADMIN_DATABASE_URL`, `MAINTENANCE_DATABASE_URL`) at it. The project's original database, `smart_lost_found`, was retired on 14 Nov 2026; it exists only as a backup archive outside the repository and is not an application option.

## Starting the application and checking its database

`npm run dev` and `npm start` read `.env.local`. The wrapper `scripts/demo-db.mjs` (`npm run demo -- <command>`, `npm run start:demo`) sets the database name to `smart_lost_found_demo` for one command whatever `.env.local` says, and gives `psql` the owner connection through `PG*` variables.

| Purpose | Command |
| --- | --- |
| Check the database named in `.env.local` (must print `/smart_lost_found_demo`) | `node -e "require('@next/env').loadEnvConfig('.'); console.log(new URL(process.env.DATABASE_URL).pathname)"` |
| Check the database PostgreSQL connects to (must print `smart_lost_found_demo`) | `npm run demo -- psql -X -At -c "SELECT current_database()"` |
| Start the production build | `npm run build`, then `npm start` (or `npm run start:demo`), <http://localhost:3000> |
| Development server | `npm run dev` |
| Any other command with the owner connection | `npm run demo -- <command>`, e.g. `npm run demo -- psql` |

## Demo accounts

| Account | Role | Used for |
| --- | --- | --- |
| Campus Lost and Found Desk | ADMIN | Campus Summary (totals, Daily Activity, Location Hotspots, Contested Items) |
| Ananya Rao | USER | Main USER journey: lost pencil pouch → Possible matches → claim → evidence → receipt |
| Isha Kulkarni | USER | Completed claim (wristwatch); claim waiting for evidence (maths textbook) |
| Arjun Nair | USER | Claim with evidence waiting for receipt (headphones) |
| Rohan Mehta | USER | Account created through the Create Account page |

Emails and generated passwords are only in the git-ignored `.local/demo-credentials.txt`. Never put them in the repository, on slides or in screenshots. New accounts are created with `npm run demo -- node scripts/provision-account.mjs --role USER --name "…" --email … --phone "…" --generate-password --credentials-file .local/demo-credentials.txt` (Argon2id; ADMIN accounts with `--role ADMIN`).

## Creating or refreshing the demo data

1. **First time only:** create the database with the fresh-installation order in [db/README.md](../db/README.md) (database name `smart_lost_found_demo`), including `db/seed.sql`, set the two login passwords, then provision the ADMIN and the USER accounts above with `--generate-password --credentials-file .local/demo-credentials.txt`. The application logins need `CONNECT` on this database (`db/roles.sql` grants it on the database it runs in); if Search shows "Unable to load filter options", run `npm run demo -- psql -X -c "GRANT CONNECT ON DATABASE smart_lost_found_demo TO lf_web, lf_admin_web"`.
2. **Seed** (safe to repeat: fixed IDs and `ON CONFLICT DO NOTHING`, so existing rows and anything created during a demo are left as they are):

   ```sh
   npm run demo -- psql -X -v ON_ERROR_STOP=1 -v demo_user_email=<Ananya's email> -v second_user_email=<Isha's email> -v third_user_email=<Arjun's email> -f db/demo_seed.sql
   npm run demo -- npm run db:backfill-embeddings
   ```

   The script stops unless it is connected to `smart_lost_found_demo` and the three emails belong to three different USER accounts. Dates are relative to the day a row is first inserted, so the last-30-days timeline has activity. Running it again re-inserts a seed row only if that row was deleted (for example a report removed while demonstrating deletion); it never changes or removes existing rows. The backfill embeds only reports whose `Embedding` is NULL, with the application's model (`Xenova/all-MiniLM-L6-v2`, 384 dimensions).
3. **Check:** `npm run demo -- npm run db:backfill-embeddings -- --dry-run` reports nothing to do, and `npm run demo -- psql -X -f db/verify.sql` and `npm run demo -- psql -X -f db/verify_roles.sql` pass.

A live demonstration adds real rows (a claim, evidence, a receipt, a new account), and the receipt closes the pencil-case item for further claims. To return to the prepared state, restore the final backup (below). To rehearse without touching the demo data, copy it first (`createdb -T smart_lost_found_demo <copy>` while nothing is connected) and run the application against the copy.

## Backups and restoring the prepared state

Verified backups are kept outside the repository, in `..\smart-lost-and-found-backups\` (next to the project folder). They contain password hashes and must never be committed:

| File | Contents |
| --- | --- |
| `smart_lost_found_demo_final.dump` | `smart_lost_found_demo` as prepared for the demonstration |
| `smart_lost_found_original_archive.dump` | the retired original database (archive only; never point the application at it) |

To restore the prepared state, stop the application, then run as the owner (this deliberately replaces the current demo data; the `lf_*` roles are server-wide and must already exist):

```powershell
dropdb -h localhost -U postgres smart_lost_found_demo
createdb -h localhost -U postgres smart_lost_found_demo
pg_restore -h localhost -U postgres -d smart_lost_found_demo --exit-on-error ..\smart-lost-and-found-backups\smart_lost_found_demo_final.dump
psql -X -h localhost -U postgres -d smart_lost_found_demo -c "REVOKE ALL ON DATABASE smart_lost_found_demo FROM PUBLIC" -c "GRANT CONNECT ON DATABASE smart_lost_found_demo TO lf_web, lf_admin_web"
```

## Suggested demonstration path

1. **Visitor:** Home → Search *Exact words* and *Similar meaning*. Create Account (shows validation, then Sign In).
2. **Ananya (USER):** My Reports → *Maroon pencil pouch* → Possible matches (the found *Pencil case with compass*, reported by Isha, ranks first) → Claim this item → add evidence → confirm receipt → My Claims shows the completed claim. Afterwards the item is no longer offered to other users. Report a new lost or found item.
3. **Isha / Arjun (USER):** My Claims shows the claim stages: Isha's wristwatch is completed and her maths textbook claim has no evidence yet; Arjun's headphones claim has evidence and is waiting for the receipt.
4. **ADMIN:** Campus Summary: totals, Daily Activity (30 and 90 days, recursive CTE), Location Hotspots and Contested Items (HAVING). A USER opening the same page is denied.
5. **Database:** `npm run demo -- psql -X -f db/verify_roles.sql` and the queries in [demo_checklist.md](demo_checklist.md).

## Limitations

- Photos and evidence files are not uploaded or displayed. `FOUND_PHOTOS` and `CLAIM_EVIDENCE.File_Path` contain fictional paths only; the interface shows a photo count and text evidence.
- There is no ADMIN claim-review or approval step, and no ADMIN user, report or claim management: ADMIN pages are read-only analytics. Claimants record the receipt themselves; `Status` columns stay NULL and claim progress is derived from evidence and handover rows.
- `MATCHES` is not shown in the interface: possible matches are computed live from the embeddings.
