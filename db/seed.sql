-- Fictional PES University campus-style demonstration data.
-- Run once on an empty application database, after the existing schema/features.
-- Explicit IDs are intentional; conflicts must fail rather than overwrite data.
-- Execute with psql -X -v ON_ERROR_STOP=1 -d smart_lost_found -f db/seed.sql
-- All contacts and campus locations below are fictional demo references.
-- Password_Hash values are unusable placeholders, not passwords or login credentials.
-- Photo/evidence paths are illustrative; this script does not create asset files.
-- Status vocabulary and score conventions are not defined by schema.sql:
-- leave those nullable fields NULL rather than invent business rules.
-- Embeddings remain NULL until the approved application model generates them.
-- MATCHES entries are manually curated potential matches, not vector results
-- or proof of ownership. Evidence and handovers are separate demo records.

BEGIN;

INSERT INTO public."USER"
    ("User_ID", "Name", "Email", "Phone", "Role", "Password_Hash")
VALUES
    (1, 'Demo Aarav Maple', 'demo.aarav@example.invalid', '+91-DEMO-0001', 'USER', 'DEMO_HASH_PLACEHOLDER_NOT_FOR_LOGIN'),
    (2, 'Demo Meera Birch', 'demo.meera@example.invalid', '+91-DEMO-0002', 'USER', 'DEMO_HASH_PLACEHOLDER_NOT_FOR_LOGIN'),
    (3, 'Demo Kabir Willow', 'demo.kabir@example.invalid', '+91-DEMO-0003', 'USER', 'DEMO_HASH_PLACEHOLDER_NOT_FOR_LOGIN'),
    (4, 'Demo Nisha Cedar', 'demo.nisha@example.invalid', '+91-DEMO-0004', 'USER', 'DEMO_HASH_PLACEHOLDER_NOT_FOR_LOGIN'),
    (5, 'Demo Rohan Elm', 'demo.rohan@example.invalid', '+91-DEMO-0005', 'USER', 'DEMO_HASH_PLACEHOLDER_NOT_FOR_LOGIN'),
    (6, 'Demo Tara Pine', 'demo.tara@example.invalid', '+91-DEMO-0006', 'ADMIN', 'DEMO_HASH_PLACEHOLDER_NOT_FOR_LOGIN');

INSERT INTO public."CATEGORY" ("Category_ID", "Category_Name")
VALUES
    (1, 'Electronics'), (2, 'Identity Cards'), (3, 'Stationery'),
    (4, 'Books'), (5, 'Bags'), (6, 'Accessories');

INSERT INTO public."LOCATION" ("Location_ID", "Location_Name", "Building")
VALUES
    (1, 'Library reading area', 'Demo Library Block'),
    (2, 'Student cafeteria', 'Demo Student Centre'),
    (3, 'Computing lab corridor', 'Demo Academic Block'),
    (4, 'Seminar hall lobby', 'Demo Academic Block'),
    (5, 'Sports ground seating', 'Demo Sports Area'),
    (6, 'Main entrance help desk', 'Demo Administration Block');

INSERT INTO public."LOST_REPORT"
    ("Lost_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description", "Date_Lost", "Status", "Embedding")
VALUES
    (1, 1, 1, 1, 'Phone in navy cover', 'Black smartphone in a navy silicone case with a small silver star sticker. Left near a library reading desk.', DATE '2026-09-20', NULL, NULL),
    (2, 2, 6, 2, 'Brown wallet', 'Brown folding wallet with red stitching and a worn corner. Contains a fictional campus meal card DEMO-MEAL-002, but no cash.', DATE '2026-09-21', NULL, NULL),
    (3, 3, 2, 3, 'Demo PES student ID', 'Fictional PES University student card DEMO-STU-003 on a purple lanyard. Name printed as Demo Kabir Willow.', DATE '2026-09-23', NULL, NULL),
    (4, 4, 1, 4, 'Scientific calculator', 'Grey scientific calculator with a sliding cover and DEMO-NC written inside the cover. Missing after a seminar.', DATE '2026-09-24', NULL, NULL),
    (5, 5, 6, 5, 'Steel water bottle', 'Stainless steel bottle with a green lid and a compass sticker. Left beside the sports ground seats.', DATE '2026-09-25', NULL, NULL),
    (6, 1, 4, 1, 'Database systems textbook', 'Database management textbook with yellow page tabs and handwritten SQL notes tucked into chapter three.', DATE '2026-09-26', NULL, NULL),
    (7, 2, 5, 2, 'Dark green backpack', 'Dark green backpack with an orange zipper pull and an empty front pocket. Left after lunch.', DATE '2026-09-27', NULL, NULL),
    (8, 3, 3, 3, 'Blue ruled notebook', 'Blue ruled notebook with a hand-drawn rocket on the cover and relational algebra notes inside.', DATE '2026-09-28', NULL, NULL);

INSERT INTO public."FOUND_REPORT"
    ("Found_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description", "Date_Found", "Status", "Embedding")
VALUES
    (1, 4, 1, 1, 'Black mobile with blue case', 'Mobile phone recovered from a reading table. Its dark blue rubber cover has a silver star decal on the back.', DATE '2026-09-21', NULL, NULL),
    (2, 5, 6, 2, 'Stitched leather wallet', 'Fold-over brown wallet picked up near the cafeteria benches. Red thread around the edges, scuffed corner, and demo meal card DEMO-MEAL-002 inside.', DATE '2026-09-22', NULL, NULL),
    (3, 4, 2, 3, 'Student card with purple strap', 'PES-style fictional ID bearing Demo Kabir Willow and DEMO-STU-003, attached to a violet neck strap. Found outside a computing lab.', DATE '2026-09-24', NULL, NULL),
    (4, 2, 1, 4, 'Grey calculator with cover', 'Scientific calculator collected from the seminar lobby. Slide-on protective lid has the marking DEMO-NC on its inner surface.', DATE '2026-09-25', NULL, NULL),
    (5, 3, 6, 5, 'Metal bottle with green cap', 'Reusable silver bottle retrieved by the playing field seating. Green screw top and a sticker showing a compass.', DATE '2026-09-26', NULL, NULL),
    (6, 5, 4, 1, 'DBMS book with page markers', 'Database systems course book found in the library. Yellow sticky markers and a loose sheet of SQL examples at the third chapter.', DATE '2026-09-27', NULL, NULL),
    (7, 4, 5, 2, 'Green bag with orange pull', 'Backpack collected from a cafeteria chair. Deep green fabric, bright orange zip tab, and nothing in the small front compartment.', DATE '2026-09-28', NULL, NULL),
    (8, 6, 3, 3, 'Rocket-cover exercise book', 'Blue lined exercise book recovered near the lab corridor. Rocket sketch on the front and database algebra exercises on the pages.', DATE '2026-09-29', NULL, NULL);

INSERT INTO public."FOUND_PHOTOS" ("Found_ID", "Photo_URL")
VALUES
    (1, '/demo/photos/found-1-front.jpg'), (1, '/demo/photos/found-1-case.jpg'),
    (2, '/demo/photos/found-2-exterior.jpg'), (2, '/demo/photos/found-2-stitching.jpg'),
    (3, '/demo/photos/found-3-lanyard.jpg'),
    (4, '/demo/photos/found-4-cover.jpg'),
    (5, '/demo/photos/found-5-bottle.jpg'),
    (6, '/demo/photos/found-6-tabs.jpg'),
    (7, '/demo/photos/found-7-front.jpg'),
    (8, '/demo/photos/found-8-cover.jpg');

INSERT INTO public."MATCHES"
    ("Lost_ID", "Found_ID", "Match_Score", "Match_Status", "Match_Date")
VALUES
    (1, 1, NULL, NULL, DATE '2026-09-22'),
    (2, 2, NULL, NULL, DATE '2026-09-23'),
    (3, 3, NULL, NULL, DATE '2026-09-25'),
    (4, 4, NULL, NULL, DATE '2026-09-26'),
    (6, 6, NULL, NULL, DATE '2026-09-28'),
    (7, 7, NULL, NULL, DATE '2026-09-29');

INSERT INTO public."CLAIM"
    ("Claim_ID", "User_ID", "Found_ID", "Claim_Date", "Status")
VALUES
    (1, 1, 1, DATE '2026-09-23', NULL),
    (2, 2, 2, DATE '2026-09-24', NULL),
    (3, 3, 3, DATE '2026-09-26', NULL);

INSERT INTO public."CLAIM_EVIDENCE"
    ("Claim_ID", "Evidence_No", "Evidence_Description", "File_Path")
VALUES
    (1, 1, 'Fictional purchase receipt DEMO-PHONE-001 identifying the black phone.', '/demo/evidence/claim-1-receipt.pdf'),
    (1, 2, 'Earlier fictional photograph showing the navy cover and silver star sticker.', '/demo/evidence/claim-1-case.jpg'),
    (2, 1, 'Earlier fictional photograph showing the red wallet stitching and worn corner.', '/demo/evidence/claim-2-wallet.jpg'),
    (2, 2, 'Fictional meal-card reference DEMO-MEAL-002 supplied by the claimant.', '/demo/evidence/claim-2-meal-card.pdf'),
    (3, 1, 'Fictional campus record linking Demo Kabir Willow to DEMO-STU-003.', '/demo/evidence/claim-3-campus-record.pdf'),
    (3, 2, 'Earlier fictional photograph of the student card on its purple lanyard.', '/demo/evidence/claim-3-lanyard.jpg');

INSERT INTO public."HANDOVER"
    ("Handover_ID", "Claim_ID", "Handover_Date", "Signature")
VALUES
    (1, 1, DATE '2026-09-24', 'Demo Aarav Maple - fictional acknowledgement'),
    (2, 2, DATE '2026-09-25', 'Demo Meera Birch - fictional acknowledgement');

COMMIT;
