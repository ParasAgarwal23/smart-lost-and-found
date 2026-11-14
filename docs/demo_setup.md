# Demonstration setup

The live demonstration runs against **`smart_lost_found_demo`**, a separate database on the same PostgreSQL server with the same schema, roles and policies as `smart_lost_found`. All of its people, items and places are fictional. `smart_lost_found` (the normal application database) is not used for the demonstration and is never written by the demo scripts.

## Pointing the application at the demo database

`.env.local` stays unchanged and keeps pointing at `smart_lost_found`. The wrapper `scripts/demo-db.mjs` runs one command with the database name in all three connection URLs swapped to `smart_lost_found_demo` (and gives `psql` the owner connection through `PG*` variables):

| Purpose | Command |
| --- | --- |
| Check which database the wrapper reaches (must print `smart_lost_found_demo`) | `npm run demo -- psql -X -At -c "SELECT current_database()"` |
| Start the production build against the demo database | `npm run build`, then `npm run start:demo` (<http://localhost:3000>) |
| Any other command against the demo database | `npm run demo -- <command>`, e.g. `npm run demo -- psql` |
| Normal use (unchanged) | `npm run dev` / `npm start` → `smart_lost_found` |

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

A live demonstration adds real rows (a claim, evidence, a receipt, a new account), and the receipt closes the pencil-case item for further claims. To get back to the prepared state, restore the backup taken before the demonstration (`pg_dump -Fc` of `smart_lost_found_demo`, kept outside the repository) into a freshly created `smart_lost_found_demo` and grant `CONNECT` again as in step 1. This is a manual, deliberate step; no script deletes demo data. To rehearse without touching the demo data, copy it first (`createdb -T smart_lost_found_demo <copy>` while nothing is connected) and run the application against the copy.

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
