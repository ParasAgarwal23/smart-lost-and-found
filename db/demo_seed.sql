-- Demonstration data for the separate smart_lost_found_demo database ONLY.
-- Run after the full setup and db/seed.sql, once the three demo USER accounts
-- exist (scripts/provision-account.mjs, see docs/demo_setup.md):
--   npm run demo -- psql -X -v ON_ERROR_STOP=1 -v demo_user_email=<demo USER email> \
--        -v second_user_email=<second USER email> -v third_user_email=<third USER email> \
--        -f db/demo_seed.sql
--   npm run demo -- npm run db:backfill-embeddings
-- Safe to run more than once: every row has a fixed ID and is inserted with
-- ON CONFLICT DO NOTHING, so existing rows (and anything created through the
-- application) are never changed. Claims are added only for items that have not
-- been handed over, and a handover only if its found item has none yet.
-- All people, items and places are fictional. Dates are relative to the day
-- the script first runs, so the Campus Summary timeline has recent activity.
-- Embeddings are left NULL; npm run db:backfill-embeddings fills them.
-- The data shows: lost and found reports across categories and locations,
-- differently worded matching pairs, reports with no match, claims that are
-- just submitted, have evidence, or are completed, an item with two competing
-- claimants, a found report that cannot be deleted because it has been claimed,
-- and an unclaimed match kept free for the live claim -> evidence -> handover demo.
\set ON_ERROR_STOP on

SELECT current_database() = 'smart_lost_found_demo' AS demo_database \gset
\if :demo_database
\else
    \echo 'STOP: demo_seed.sql runs only in smart_lost_found_demo, never in the real or test database.'
    \quit 1
\endif
\if :{?demo_user_email}
\else
    \echo 'STOP: pass -v demo_user_email=<email of the provisioned demo USER account>.'
    \quit 1
\endif
\if :{?second_user_email}
\else
    \echo 'STOP: pass -v second_user_email=<email of the second provisioned USER account>.'
    \quit 1
\endif
\if :{?third_user_email}
\else
    \echo 'STOP: pass -v third_user_email=<email of the third provisioned USER account>.'
    \quit 1
\endif

SELECT count(*) = 3 AS accounts_ok FROM public."USER"
WHERE "Role" = 'USER'
  AND "Email" IN (lower(:'demo_user_email'), lower(:'second_user_email'), lower(:'third_user_email')) \gset
\if :accounts_ok
\else
    \echo 'STOP: the three emails must belong to three different provisioned USER accounts.'
    \quit 1
\endif

BEGIN;

SELECT (SELECT "User_ID" FROM public."USER" WHERE "Email" = lower(:'demo_user_email')) AS demo_user,
       (SELECT "User_ID" FROM public."USER" WHERE "Email" = lower(:'second_user_email')) AS second_user,
       (SELECT "User_ID" FROM public."USER" WHERE "Email" = lower(:'third_user_email')) AS third_user \gset

INSERT INTO public."LOCATION" ("Location_ID", "Location_Name", "Building") VALUES
    (7, 'Hostel common room', 'Demo Hostel Block'),
    (8, 'Bus bay shelter', 'Demo Transport Area')
ON CONFLICT DO NOTHING;

INSERT INTO public."LOST_REPORT"
    ("Lost_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description", "Date_Lost")
VALUES
    (101, :demo_user, 1, 1, 'Laptop charger', 'Silver 65W USB-C laptop charger. The cable is frayed near the plug and has a strip of blue tape with my initials.', CURRENT_DATE - 2),
    (102, :demo_user, 6, 2, 'Black umbrella', 'Compact black folding umbrella with a curved wooden handle and a loose strap.', CURRENT_DATE - 12),
    (103, 2, 1, 3, 'Wireless earbuds case', 'White charging case for wireless earbuds, small scratch on the lid, no earbuds inside.', CURRENT_DATE - 5),
    (104, 3, 2, 4, 'Library card in blue holder', 'Fictional library card DEMO-LIB-104 in a transparent blue plastic holder.', CURRENT_DATE - 20),
    (105, 4, 6, 7, 'Grey hooded sweatshirt', 'Plain grey hoodie, size M, with a paint mark on the left sleeve.', CURRENT_DATE - 33),
    (106, 5, 6, 3, 'Spectacles in brown case', 'Black-framed reading glasses inside a brown faux-leather case with a magnetic clasp.', CURRENT_DATE - 41),
    (107, 1, 3, 3, 'Formula notebook', 'Small spiral notebook full of calculus formulas, green cover, name written inside the cover.', CURRENT_DATE - 8),
    (108, 6, 5, 8, 'Navy sling bag', 'Navy blue sling bag with a broken zip pull, contains a fictional bus pass DEMO-BUS-108.', CURRENT_DATE - 26),
    -- Recent activity (last two weeks).
    (201, :second_user, 6, 4, 'Silver wristwatch', 'Analog wristwatch with a silver link strap and a small dent on the bezel. The clasp sometimes opens by itself.', CURRENT_DATE - 13),
    (202, :third_user, 1, 1, 'Black over-ear headphones', 'Wireless over-ear headphones in matte black. The left ear cushion is slightly torn and they were folded inside a grey zip pouch.', CURRENT_DATE - 9),
    (203, :demo_user, 3, 3, 'Maroon pencil pouch', 'Maroon fabric pencil pouch with a broken zip tab. It holds a steel compass, two gel pens and a small eraser.', CURRENT_DATE - 6),
    (204, :second_user, 4, 2, 'Engineering mathematics textbook', 'Engineering Mathematics volume 2, paperback, with a name label inside the front cover and several pages folded in the Laplace transform chapter.', CURRENT_DATE - 4),
    (205, :third_user, 6, 8, 'Cycle lock key on a red ring', 'Small silver key for a cycle lock on a red plastic ring with a football-shaped key chain.', CURRENT_DATE - 2)
ON CONFLICT DO NOTHING;

INSERT INTO public."FOUND_REPORT"
    ("Found_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description", "Date_Found")
VALUES
    (101, 4, 1, 1, 'USB-C power adapter', 'Laptop power brick with a type-C lead left on a library desk. The lead is damaged close to the connector and has blue tape wrapped round it.', CURRENT_DATE - 1),
    (102, 5, 6, 2, 'Folding umbrella', 'Small black umbrella that folds up, wooden crook handle, strap hanging loose. Picked up near the cafeteria door.', CURRENT_DATE - 11),
    (103, 6, 1, 3, 'Earphone charging case', 'White pocket-sized case for earphones with a scratched lid. Empty. Found on a bench in the lab corridor.', CURRENT_DATE - 4),
    (104, 1, 2, 4, 'Card in blue sleeve', 'Library card DEMO-LIB-104 in a clear blue sleeve, handed in at the seminar hall lobby.', CURRENT_DATE - 19),
    (105, :demo_user, 6, 5, 'Steel bottle with stickers', 'Insulated steel water bottle covered in travel stickers, found under the sports ground seating.', CURRENT_DATE - 6),
    (106, :demo_user, 1, 4, 'Scientific calculator', 'Black scientific calculator with a slide-on cover, left in the seminar hall lobby after a lecture.', CURRENT_DATE - 15),
    (107, 2, 6, 7, 'Grey hoodie with paint mark', 'Grey sweatshirt with a hood, medium size, a dried paint stain on one sleeve. Left in the hostel common room.', CURRENT_DATE - 30),
    (108, 3, 6, 3, 'Reading glasses in a pouch', 'Glasses with dark frames in a brown case that snaps shut with a magnet, found near the computing labs.', CURRENT_DATE - 40),
    (109, 4, 4, 1, 'Organic chemistry textbook', 'Thick organic chemistry textbook with a torn dust jacket and pencil notes in the margins.', CURRENT_DATE - 9),
    -- Recent activity. 203 matches the demo USER's lost pencil pouch and is left
    -- unclaimed for the live demonstration; 205 and 206 match no lost report.
    (201, :third_user, 6, 4, 'Watch with metal strap', 'Silver-coloured analog watch with a link bracelet, found on a chair in the seminar hall lobby. The rim has a small dent.', CURRENT_DATE - 12),
    (202, :demo_user, 1, 1, 'Headphones in grey pouch', 'Black over-ear Bluetooth headphones folded in a grey zipped pouch; one ear pad is coming apart. Left on a library reading table.', CURRENT_DATE - 8),
    (203, :second_user, 3, 3, 'Pencil case with compass', 'Dark red cloth pencil case with the zip pull missing. Inside are a compass and some pens. Found on a bench in the lab corridor.', CURRENT_DATE - 5),
    (204, :third_user, 4, 2, 'Maths textbook with folded pages', 'Second volume of an engineering mathematics book found on a cafeteria table. Several page corners are folded in the middle chapters.', CURRENT_DATE - 3),
    (205, :second_user, 5, 5, 'Drawstring bag with running shoes', 'Black drawstring bag holding a pair of white running shoes and a small towel, left on the sports ground seating.', CURRENT_DATE - 1),
    (206, :demo_user, 2, 6, 'Metro travel card in green sleeve', 'Fictional metro travel card DEMO-METRO-206 in a green plastic sleeve, handed in at the main entrance help desk.', CURRENT_DATE - 10)
ON CONFLICT DO NOTHING;

INSERT INTO public."FOUND_PHOTOS" ("Found_ID", "Photo_URL") VALUES
    (101, '/demo/photos/found-101-adapter.jpg'),
    (102, '/demo/photos/found-102-umbrella.jpg'),
    (103, '/demo/photos/found-103-case.jpg'),
    (105, '/demo/photos/found-105-bottle.jpg')
ON CONFLICT DO NOTHING;

INSERT INTO public."MATCHES" ("Lost_ID", "Found_ID", "Match_Date") VALUES
    (102, 102, CURRENT_DATE - 10),
    (104, 104, CURRENT_DATE - 18),
    (106, 108, CURRENT_DATE - 38)
ON CONFLICT DO NOTHING;

-- Claim dates are explicit here (owner connection) to spread activity over time;
-- the application itself always uses the column DEFAULT CURRENT_DATE.
-- A claim is skipped if its found item has already been handed over to anyone.
INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID", "Claim_Date")
SELECT claim.id, claim.user_id, claim.found_id, claim.claim_date
FROM (VALUES
    (101, :demo_user, 102, CURRENT_DATE - 10),   -- demo USER's umbrella: completed
    (102, 2, 103, CURRENT_DATE - 3),             -- earbuds case: two competing claimants
    (103, 3, 103, CURRENT_DATE - 2),
    (104, 3, 104, CURRENT_DATE - 18),            -- library card: completed
    (105, 5, 106, CURRENT_DATE - 14),            -- claim on the demo USER's found calculator
    (106, 5, 108, CURRENT_DATE - 38),            -- spectacles: completed
    (107, 4, 107, CURRENT_DATE - 29),            -- hoodie: open
    (201, :second_user, 201, CURRENT_DATE - 11), -- wristwatch: completed
    (202, :third_user, 202, CURRENT_DATE - 7),   -- headphones: evidence added, not yet received
    (203, :second_user, 204, CURRENT_DATE - 2)   -- maths textbook: just submitted, no evidence yet
) AS claim (id, user_id, found_id, claim_date)
WHERE NOT EXISTS (
    SELECT 1 FROM public."HANDOVER" AS h
    JOIN public."CLAIM" AS c ON c."Claim_ID" = h."Claim_ID"
    WHERE c."Found_ID" = claim.found_id
)
ON CONFLICT DO NOTHING;

INSERT INTO public."CLAIM_EVIDENCE" ("Claim_ID", "Evidence_No", "Evidence_Description")
SELECT evidence.claim_id, evidence.evidence_no, evidence.description
FROM (VALUES
    (101, 1, 'The handle has a small crack near the base and the strap has a loose stitch.'),
    (101, 2, 'Fictional purchase reference DEMO-UMB-101 from the campus store.'),
    (102, 1, 'The scratch on the lid is shaped like a short diagonal line.'),
    (103, 1, 'Earbuds paired as DEMO-BUDS-103; serial on the hinge ends in 7Q.'),
    (104, 1, 'The card number DEMO-LIB-104 matches the student ID shown at the library desk.'),
    (105, 1, 'Calculator has my roll number scratched inside the cover.'),
    (106, 1, 'Prescription card from a fictional optician, DEMO-OPT-106.'),
    (107, 1, 'Paint mark is from a mural project; photo available.'),
    (201, 1, 'The back of the watch is engraved with the initials I.K.'),
    (201, 2, 'Fictional service card DEMO-WATCH-201 from the shop that resized the strap.'),
    (202, 1, 'The headphones are paired to a phone named DEMO-ARJUN and the pouch has a torn inner label.')
) AS evidence (claim_id, evidence_no, description)
WHERE EXISTS (SELECT 1 FROM public."CLAIM" AS c WHERE c."Claim_ID" = evidence.claim_id)
ON CONFLICT DO NOTHING;

-- One handover per found item: skipped if the item already has one.
INSERT INTO public."HANDOVER" ("Handover_ID", "Claim_ID", "Handover_Date", "Signature")
SELECT handover.id, handover.claim_id, handover.handover_date, handover.signature
FROM (VALUES
    (101, 101, CURRENT_DATE - 9, 'Received my umbrella - demo acknowledgement'),
    (102, 104, CURRENT_DATE - 17, 'Demo Kabir Willow - fictional acknowledgement'),
    (103, 106, CURRENT_DATE - 37, 'Demo Rohan Elm - fictional acknowledgement'),
    (201, 201, CURRENT_DATE - 10, 'Isha Kulkarni - received the watch')
) AS handover (id, claim_id, handover_date, signature)
JOIN public."CLAIM" AS claim ON claim."Claim_ID" = handover.claim_id
WHERE NOT EXISTS (
    SELECT 1 FROM public."HANDOVER" AS h
    JOIN public."CLAIM" AS c ON c."Claim_ID" = h."Claim_ID"
    WHERE c."Found_ID" = claim."Found_ID"
)
ON CONFLICT DO NOTHING;

COMMIT;

SELECT (SELECT count(*) FROM public."LOST_REPORT") AS lost_reports,
       (SELECT count(*) FROM public."FOUND_REPORT") AS found_reports,
       (SELECT count(*) FROM public."CLAIM") AS claims,
       (SELECT count(*) FROM public."HANDOVER") AS handovers,
       (SELECT count(*) FROM public."LOST_REPORT" WHERE "Embedding" IS NULL)
     + (SELECT count(*) FROM public."FOUND_REPORT" WHERE "Embedding" IS NULL) AS reports_without_embedding;
