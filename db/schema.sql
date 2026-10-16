-- Initial approved schema. Execute once against smart_lost_found with:
-- psql -X -v ON_ERROR_STOP=1 -d smart_lost_found -f db/schema.sql
-- IDs are supplied explicitly; no identity columns or defaults are approved.
-- Revision 2026-10-16: named CHECK/UNIQUE integrity constraints were added
-- (see "Integrity constraints" in db/README.md). Existing databases receive
-- them through db/constraints.sql.

BEGIN;

DO $$
BEGIN
    IF current_database() <> 'smart_lost_found' THEN
        RAISE EXCEPTION 'Connect to smart_lost_found before running this script';
    END IF;
    IF current_setting('server_version_num')::integer / 10000 <> 18 THEN
        RAISE EXCEPTION 'PostgreSQL 18 is required';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_extension
        WHERE extname = 'vector' AND extversion = '0.8.6'
    ) THEN
        RAISE EXCEPTION 'The vector extension version 0.8.6 must already be enabled';
    END IF;
END
$$;

CREATE TABLE public."USER" (
    "User_ID" INT PRIMARY KEY,
    "Name" VARCHAR(100),
    "Email" VARCHAR(100),
    "Phone" VARCHAR(15),
    "Role" VARCHAR(20),
    "Password_Hash" VARCHAR(255) NOT NULL,
    CONSTRAINT "USER_Role_check" CHECK ("Role" IN ('USER', 'ADMIN')),
    CONSTRAINT "USER_Email_key" UNIQUE ("Email")
);

CREATE TABLE public."CATEGORY" (
    "Category_ID" INT PRIMARY KEY,
    "Category_Name" VARCHAR(50)
);

CREATE TABLE public."LOCATION" (
    "Location_ID" INT PRIMARY KEY,
    "Location_Name" VARCHAR(50),
    "Building" VARCHAR(50)
);

CREATE TABLE public."LOST_REPORT" (
    "Lost_ID" INT PRIMARY KEY,
    "User_ID" INT NOT NULL REFERENCES public."USER" ("User_ID"),
    "Category_ID" INT NOT NULL REFERENCES public."CATEGORY" ("Category_ID"),
    "Location_ID" INT NOT NULL REFERENCES public."LOCATION" ("Location_ID"),
    "Item_Name" VARCHAR(100),
    "Description" TEXT,
    "Date_Lost" DATE,
    "Status" VARCHAR(20),
    "Embedding" VECTOR(384),
    CONSTRAINT "LOST_REPORT_Item_Name_check" CHECK (btrim("Item_Name") <> '')
);

CREATE TABLE public."FOUND_REPORT" (
    "Found_ID" INT PRIMARY KEY,
    "User_ID" INT NOT NULL REFERENCES public."USER" ("User_ID"),
    "Category_ID" INT NOT NULL REFERENCES public."CATEGORY" ("Category_ID"),
    "Location_ID" INT NOT NULL REFERENCES public."LOCATION" ("Location_ID"),
    "Item_Name" VARCHAR(100),
    "Description" TEXT,
    "Date_Found" DATE,
    "Status" VARCHAR(20),
    "Embedding" VECTOR(384),
    CONSTRAINT "FOUND_REPORT_Item_Name_check" CHECK (btrim("Item_Name") <> '')
);

CREATE TABLE public."FOUND_PHOTOS" (
    "Found_ID" INT REFERENCES public."FOUND_REPORT" ("Found_ID"),
    "Photo_URL" VARCHAR(255),
    PRIMARY KEY ("Found_ID", "Photo_URL")
);

CREATE TABLE public."MATCHES" (
    "Lost_ID" INT REFERENCES public."LOST_REPORT" ("Lost_ID"),
    "Found_ID" INT REFERENCES public."FOUND_REPORT" ("Found_ID"),
    "Match_Score" DECIMAL(5,2),
    "Match_Status" VARCHAR(20),
    "Match_Date" DATE,
    PRIMARY KEY ("Lost_ID", "Found_ID")
);

CREATE TABLE public."CLAIM" (
    "Claim_ID" INT PRIMARY KEY,
    "User_ID" INT NOT NULL REFERENCES public."USER" ("User_ID"),
    "Found_ID" INT NOT NULL REFERENCES public."FOUND_REPORT" ("Found_ID"),
    "Claim_Date" DATE,
    "Status" VARCHAR(20),
    CONSTRAINT "CLAIM_User_ID_Found_ID_key" UNIQUE ("User_ID", "Found_ID")
);

CREATE TABLE public."HANDOVER" (
    "Handover_ID" INT PRIMARY KEY,
    "Claim_ID" INT NOT NULL UNIQUE REFERENCES public."CLAIM" ("Claim_ID"),
    "Handover_Date" DATE,
    "Signature" VARCHAR(100)
);

CREATE TABLE public."CLAIM_EVIDENCE" (
    "Claim_ID" INT REFERENCES public."CLAIM" ("Claim_ID"),
    "Evidence_No" INT,
    "Evidence_Description" VARCHAR(255),
    "File_Path" VARCHAR(255),
    PRIMARY KEY ("Claim_ID", "Evidence_No"),
    CONSTRAINT "CLAIM_EVIDENCE_Evidence_No_check" CHECK ("Evidence_No" >= 1)
);

COMMIT;
