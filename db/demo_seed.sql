-- Demonstration data for the separate smart_lost_found_demo database ONLY.
-- Run after the full setup and db/seed.sql, once the demo USER account exists
-- (scripts/provision-account.mjs, see README "Demo database"):
--   psql -X -v ON_ERROR_STOP=1 -d smart_lost_found_demo \
--        -v demo_user_email=<demo USER email> -f db/demo_seed.sql
-- All people, items and places are fictional. Dates are relative to the day
-- the script runs, so the Campus Summary timeline always has recent activity.
-- Embeddings are left NULL; run npm run db:backfill-embeddings afterwards.
-- The data shows: lost and found reports across categories and locations,
-- differently worded matching pairs, open and completed claims, evidence,
-- handovers, an item with two competing claimants, reports with no claims,
-- and a found report that cannot be deleted because it has been claimed.
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

BEGIN;

SELECT "User_ID" AS demo_user FROM public."USER"
WHERE "Email" = lower(:'demo_user_email') AND "Role" = 'USER' \gset

INSERT INTO public."LOCATION" ("Location_ID", "Location_Name", "Building") VALUES
    (7, 'Hostel common room', 'Demo Hostel Block'),
    (8, 'Bus bay shelter', 'Demo Transport Area');

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
    (108, 6, 5, 8, 'Navy sling bag', 'Navy blue sling bag with a broken zip pull, contains a fictional bus pass DEMO-BUS-108.', CURRENT_DATE - 26);

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
    (109, 4, 4, 1, 'Organic chemistry textbook', 'Thick organic chemistry textbook with a torn dust jacket and pencil notes in the margins.', CURRENT_DATE - 9);

INSERT INTO public."FOUND_PHOTOS" ("Found_ID", "Photo_URL") VALUES
    (101, '/demo/photos/found-101-adapter.jpg'),
    (102, '/demo/photos/found-102-umbrella.jpg'),
    (103, '/demo/photos/found-103-case.jpg'),
    (105, '/demo/photos/found-105-bottle.jpg');

INSERT INTO public."MATCHES" ("Lost_ID", "Found_ID", "Match_Date") VALUES
    (102, 102, CURRENT_DATE - 10),
    (104, 104, CURRENT_DATE - 18),
    (106, 108, CURRENT_DATE - 38);

-- Claim dates are explicit here (owner connection) to spread activity over time;
-- the application itself always uses the column DEFAULT CURRENT_DATE.
INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID", "Claim_Date") VALUES
    (101, :demo_user, 102, CURRENT_DATE - 10),   -- demo USER's umbrella: completed
    (102, 2, 103, CURRENT_DATE - 3),             -- earbuds case: two competing claimants
    (103, 3, 103, CURRENT_DATE - 2),
    (104, 3, 104, CURRENT_DATE - 18),            -- library card: completed
    (105, 5, 106, CURRENT_DATE - 14),            -- claim on the demo USER's found calculator
    (106, 5, 108, CURRENT_DATE - 38),            -- spectacles: completed
    (107, 4, 107, CURRENT_DATE - 29);            -- hoodie: open

INSERT INTO public."CLAIM_EVIDENCE" ("Claim_ID", "Evidence_No", "Evidence_Description") VALUES
    (101, 1, 'The handle has a small crack near the base and the strap has a loose stitch.'),
    (101, 2, 'Fictional purchase reference DEMO-UMB-101 from the campus store.'),
    (102, 1, 'The scratch on the lid is shaped like a short diagonal line.'),
    (103, 1, 'Earbuds paired as DEMO-BUDS-103; serial on the hinge ends in 7Q.'),
    (105, 1, 'Calculator has my roll number scratched inside the cover.'),
    (106, 1, 'Prescription card from a fictional optician, DEMO-OPT-106.'),
    (107, 1, 'Paint mark is from a mural project; photo available.');

INSERT INTO public."HANDOVER" ("Handover_ID", "Claim_ID", "Handover_Date", "Signature") VALUES
    (101, 101, CURRENT_DATE - 9, 'Received my umbrella - demo acknowledgement'),
    (102, 104, CURRENT_DATE - 17, 'Demo Kabir Willow - fictional acknowledgement'),
    (103, 106, CURRENT_DATE - 37, 'Demo Rohan Elm - fictional acknowledgement');

COMMIT;

SELECT (SELECT count(*) FROM public."LOST_REPORT") AS lost_reports,
       (SELECT count(*) FROM public."FOUND_REPORT") AS found_reports,
       (SELECT count(*) FROM public."CLAIM") AS claims,
       (SELECT count(*) FROM public."HANDOVER") AS handovers;
