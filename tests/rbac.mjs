// Database-level RBAC, RLS, registration-function and provisioning tests.
// Run with npm test (isolated database smart_lost_found_test only; see support.mjs).
// Each permission check runs on the real application logins (lf_web or
// lf_admin_web) with the transaction-local role/identity lib/db.ts uses, and
// is rolled back. Fixtures are inserted and removed through the owner
// connection; all ten tables are compared with their pre-test contents.
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hash, argon2id } from 'argon2';
import { asRole, assertIsolated, closePools, loadProduction, pool, root, sessions, watchdog } from './support.mjs';

watchdog(300);
const run = promisify(execFile);
const tables = ['USER', 'CATEGORY', 'LOCATION', 'LOST_REPORT', 'FOUND_REPORT',
  'FOUND_PHOTOS', 'MATCHES', 'CLAIM', 'CLAIM_EVIDENCE', 'HANDOVER'];
const id = -randomInt(100000, 1000000000);
const [A, B, ADMIN] = [id, id - 1, id - 2];
const [lostA, lostB] = [id, id - 1];
const [foundA, foundB] = [id, id - 1];
const [claimB, claimA] = [id, id - 1];
const fixtureEmails = [`rbac-a${-id}@example.invalid`, `rbac-b${-id}@example.invalid`, `rbac-admin${-id}@example.invalid`];
const createdEmails = [`rbac-register${-id}@example.invalid`, `rbac-provisioned${-id}@example.invalid`];

async function snapshot() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const contents = {};
    for (const table of tables) {
      contents[table] = (await client.query(`SELECT row_to_json(t)::text AS row FROM public."${table}" t ORDER BY 1`)).rows.map((r) => r.row);
    }
    await client.query('COMMIT');
    return contents;
  } finally { client.release(); }
}

// Expects the statement to fail with the given SQLSTATE.
async function denied(label, code, role, userId, statement, values, options) {
  await assert.rejects(asRole(role, userId, statement, values, options), (error) => {
    assert.equal(error.code, code, `${label}: expected SQLSTATE ${code}, got ${error.code} (${error.message})`);
    return true;
  }, label);
}
const allowed = (role, userId, statement, values, options) => asRole(role, userId, statement, values, options);

async function createFixtures() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hashA = await hash(`rbac-${id}-password`, { type: argon2id });
    await client.query(`INSERT INTO public."USER" ("User_ID", "Name", "Email", "Phone", "Role", "Password_Hash") VALUES
      ($1, 'RBAC user A', $4, '+91 90000 00001', 'USER', $7), ($2, 'RBAC user B', $5, '+91 90000 00002', 'USER', 'UNUSABLE_REGRESSION_FIXTURE'),
      ($3, 'RBAC admin', $6, NULL, 'ADMIN', 'UNUSABLE_REGRESSION_FIXTURE')`, [A, B, ADMIN, ...fixtureEmails, hashA]);
    await client.query('INSERT INTO public."CATEGORY" VALUES ($1, $2)', [id, 'RBAC category']);
    await client.query('INSERT INTO public."LOCATION" VALUES ($1, $2, $3)', [id, 'RBAC location', 'RBAC building']);
    await client.query(`INSERT INTO public."LOST_REPORT" ("Lost_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description")
      VALUES ($1, $3, $5, $5, 'RBAC lost A', 'x'), ($2, $4, $5, $5, 'RBAC lost B', 'x')`, [lostA, lostB, A, B, id]);
    await client.query(`INSERT INTO public."FOUND_REPORT" ("Found_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description")
      VALUES ($1, $3, $5, $5, 'RBAC found A', 'x'), ($2, $4, $5, $5, 'RBAC found B', 'x')`, [foundA, foundB, A, B, id]);
    // B claims A's found item (with evidence and a receipt); A claims B's item.
    await client.query(`INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID") VALUES ($1, $3, $5), ($2, $4, $6)`, [claimB, claimA, B, A, foundA, foundB]);
    await client.query(`INSERT INTO public."CLAIM_EVIDENCE" VALUES ($1, 1, 'B private evidence', NULL)`, [claimB]);
    await client.query(`INSERT INTO public."HANDOVER" ("Handover_ID", "Claim_ID", "Signature") VALUES ($1, $2, 'B private signature')`, [id, claimB]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function removeFixtures() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM public."HANDOVER" WHERE "Claim_ID" IN ($1, $2)', [claimB, claimA]);
    await client.query('DELETE FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" IN ($1, $2)', [claimB, claimA]);
    await client.query('DELETE FROM public."CLAIM" WHERE "Claim_ID" IN ($1, $2)', [claimB, claimA]);
    await client.query('DELETE FROM public."LOST_REPORT" WHERE "User_ID" IN ($1, $2, $3)', [A, B, ADMIN]);
    await client.query('DELETE FROM public."FOUND_REPORT" WHERE "User_ID" IN ($1, $2, $3)', [A, B, ADMIN]);
    await client.query('DELETE FROM public."LOCATION" WHERE "Location_ID" = $1', [id]);
    await client.query('DELETE FROM public."CATEGORY" WHERE "Category_ID" = $1', [id]);
    await client.query('DELETE FROM public."USER" WHERE "User_ID" IN ($1, $2, $3) OR "Email" = ANY($4::text[])', [A, B, ADMIN, createdEmails]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function loginChecks() {
  // NOINHERIT logins have no privileges until a role is set for the transaction.
  await denied('lf_web without a role', '42501', null, null, 'SELECT 1 FROM public."CATEGORY" LIMIT 1');
  await denied('lf_admin_web without a role', '42501', null, null, 'SELECT * FROM public.admin_campus_totals', [], { login: 'ADMIN_DATABASE_URL' });
  // The web login can never become lf_admin, the superuser, or an owner role.
  for (const target of ['lf_admin', 'postgres', 'lf_auth', 'lf_reporting']) {
    await denied(`lf_web SET ROLE ${target}`, '42501', null, null, `SET ROLE ${target}`);
  }
  await denied('lf_admin_web SET ROLE lf_user', '42501', null, null, 'SET ROLE lf_user', [], { login: 'ADMIN_DATABASE_URL' });
  const logins = (await pool.query(`SELECT rolname, rolsuper, rolinherit, rolbypassrls, rolcreaterole, rolcreatedb
    FROM pg_roles WHERE rolname IN ('lf_web', 'lf_admin_web') ORDER BY 1`)).rows;
  assert.deepEqual(logins.map((r) => [r.rolname, r.rolsuper, r.rolinherit, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb]),
    [['lf_admin_web', false, false, false, false, false], ['lf_web', false, false, false, false, false]]);
  assert.equal((await pool.query("SELECT pg_has_role('lf_web', 'lf_admin', 'MEMBER') AS member")).rows[0].member, false);
  console.log('PASS logins: non-superuser NOINHERIT logins; no privileges before SET ROLE; lf_web cannot become lf_admin, postgres or owner roles');
}

async function anonymousChecks() {
  assert.ok((await allowed('lf_anon', null, 'SELECT "Item_Name" FROM public."FOUND_REPORT" WHERE "Found_ID" = $1', [foundA])).rows.length === 1);
  await denied('anon reads report owner IDs', '42501', 'lf_anon', null, 'SELECT "User_ID" FROM public."FOUND_REPORT" LIMIT 1');
  await denied('anon reads owner IDs through the view', '42501', 'lf_anon', null, 'SELECT "User_ID" FROM public.v_found_report_details LIMIT 1');
  await denied('anon reads USER', '42501', 'lf_anon', null, 'SELECT "Email", "Phone" FROM public."USER" LIMIT 1');
  await denied('anon reads password hashes', '42501', 'lf_anon', null, 'SELECT "Password_Hash" FROM public."USER" LIMIT 1');
  await denied('anon reads claims', '42501', 'lf_anon', null, 'SELECT * FROM public."CLAIM" LIMIT 1');
  await denied('anon reads handover signatures', '42501', 'lf_anon', null, 'SELECT "Signature" FROM public."HANDOVER" LIMIT 1');
  await denied('anon creates a report', '42501', 'lf_anon', null,
    `INSERT INTO public."LOST_REPORT" ("Lost_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name") VALUES ($1, $2, $3, $3, 'x')`, [id - 50, A, id]);
  await denied('anon runs get_claim_summary', '42501', 'lf_anon', null, 'SELECT * FROM public.get_claim_summary($1)', [claimB]);
  await denied('anon CALLs withdraw_claim', '42501', 'lf_anon', null, 'CALL public.withdraw_claim($1, NULL)', [claimB]);
  await denied('anon reads admin views', '42501', 'lf_anon', null, 'SELECT * FROM public.admin_campus_totals');
  // Credentials: one exact email at a time, ID/role/hash only.
  const creds = await allowed('lf_anon', null, 'SELECT * FROM public.auth_credentials($1)', [fixtureEmails[0].toUpperCase()]);
  assert.deepEqual(Object.keys(creds.rows[0]).sort(), ['Password_Hash', 'Role', 'User_ID']);
  assert.equal(creds.rows[0].User_ID, A);
  // Session lookup takes no argument: it returns only the app.user_id row, without email/phone.
  const own = await allowed('lf_anon', A, 'SELECT * FROM public.auth_session_user()');
  assert.deepEqual(own.rows, [{ User_ID: A, Name: 'RBAC user A', Role: 'USER' }]);
  assert.equal((await allowed('lf_anon', null, 'SELECT * FROM public.auth_session_user()')).rows.length, 0);
  assert.equal((await allowed('lf_anon', null, 'SELECT public.found_report_has_handover($1) AS h', [foundA])).rows[0].h, true);
  console.log('PASS anonymous: public report columns only; no owner IDs, USER rows, hashes, claims, signatures, writes, procedures or admin views; auth helpers return minimal data');
}

async function userChecks() {
  // Reports: create/update/delete only one's own; any user may lock a found report.
  const ownInsert = await allowed('lf_user', A, `INSERT INTO public."LOST_REPORT" ("Lost_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name") VALUES ($1, $2, $3, $3, 'own')`, [id - 60, A, id]);
  assert.equal(ownInsert.rowCount, 1, 'A USER can create their own report');
  await denied('USER inserts a report as another user', '42501', 'lf_user', A,
    `INSERT INTO public."LOST_REPORT" ("Lost_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name") VALUES ($1, $2, $3, $3, 'x')`, [id - 61, B, id]);
  assert.equal((await allowed('lf_user', A, `UPDATE public."LOST_REPORT" SET "Item_Name" = 'hijack' WHERE "Lost_ID" = $1`, [lostB])).rowCount, 0);
  await denied('USER updates another user\'s found report', '42501', 'lf_user', A, `UPDATE public."FOUND_REPORT" SET "Item_Name" = 'hijack' WHERE "Found_ID" = $1`, [foundB]);
  assert.equal((await allowed('lf_user', A, 'DELETE FROM public."LOST_REPORT" WHERE "Lost_ID" = $1', [lostB])).rowCount, 0);
  assert.equal((await allowed('lf_user', A, 'DELETE FROM public."FOUND_REPORT" WHERE "Found_ID" = $1', [foundB])).rowCount, 0);
  assert.equal((await allowed('lf_user', A, 'SELECT 1 FROM public."FOUND_REPORT" WHERE "Found_ID" = $1 FOR UPDATE', [foundB])).rowCount, 1,
    'A claimant must be able to lock another user\'s found report (claim/handover serialisation)');
  await denied('USER changes a report owner', '42501', 'lf_user', A, `UPDATE public."LOST_REPORT" SET "User_ID" = $2 WHERE "Lost_ID" = $1`, [lostA, B]);
  // Claims, evidence and receipts are private to the claimant.
  const visibleClaims = (await allowed('lf_user', A, 'SELECT "Claim_ID" FROM public."CLAIM" WHERE "Claim_ID" IN ($1, $2)', [claimA, claimB])).rows;
  assert.deepEqual(visibleClaims, [{ Claim_ID: claimA }], 'Only one\'s own claims are visible');
  assert.equal((await allowed('lf_user', A, 'SELECT 1 FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" = $1', [claimB])).rowCount, 0);
  assert.equal((await allowed('lf_user', A, 'SELECT 1 FROM public."HANDOVER" WHERE "Claim_ID" = $1', [claimB])).rowCount, 0);
  assert.equal((await allowed('lf_user', B, 'SELECT "Evidence_Description" FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" = $1', [claimB])).rows[0].Evidence_Description, 'B private evidence');
  await denied('USER adds evidence to another user\'s claim', '42501', 'lf_user', A, `INSERT INTO public."CLAIM_EVIDENCE" VALUES ($1, 9, 'forged', NULL)`, [claimB]);
  await denied('USER records a receipt for another user\'s claim', '42501', 'lf_user', A, `INSERT INTO public."HANDOVER" ("Handover_ID", "Claim_ID", "Signature") VALUES ($1, $2, 'forged')`, [id - 70, claimB]);
  await denied('USER claims as another user', '42501', 'lf_user', A, 'INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID") VALUES ($1, $2, $3)', [id - 71, B, foundB]);
  await denied('USER backdates a claim', '42501', 'lf_user', A, `INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID", "Claim_Date") VALUES ($1, $2, $3, DATE '2000-01-01')`, [id - 72, A, foundB]);
  // History, schema and administration are out of reach.
  await denied('USER deletes handover history', '42501', 'lf_user', B, 'DELETE FROM public."HANDOVER" WHERE "Claim_ID" = $1', [claimB]);
  await denied('USER edits handover history', '42501', 'lf_user', B, `UPDATE public."HANDOVER" SET "Signature" = 'edited' WHERE "Claim_ID" = $1`, [claimB]);
  for (const table of ['CLAIM', 'LOST_REPORT', 'HANDOVER']) await denied(`USER truncates ${table}`, '42501', 'lf_user', A, `TRUNCATE public."${table}"`);
  await denied('USER runs DDL', '42501', 'lf_user', A, 'CREATE TABLE public.rbac_probe (x int)');
  await denied('USER reads password hashes', '42501', 'lf_user', A, 'SELECT "Password_Hash" FROM public."USER"');
  await denied('USER writes USER directly', '42501', 'lf_user', A, `INSERT INTO public."USER" ("User_ID", "Role", "Password_Hash") VALUES ($1, 'ADMIN', 'x')`, [id - 80]);
  await denied('USER promotes themselves', '42501', 'lf_user', A, `UPDATE public."USER" SET "Role" = 'ADMIN' WHERE "User_ID" = $1`, [A]);
  await denied('USER reads admin analytics', '42501', 'lf_user', A, 'SELECT * FROM public.admin_location_hotspots');
  await denied('USER runs the admin timeline', '42501', 'lf_user', A, 'SELECT * FROM public.admin_daily_activity(30)');
  await denied('USER writes MATCHES directly', '42501', 'lf_user', A, 'DELETE FROM public."MATCHES"');
  // Owner-only helper: claim counts are answered only for one's own found report.
  assert.equal((await allowed('lf_user', A, 'SELECT public.found_report_claim_count($1) AS n', [foundA])).rows[0].n, '1');
  assert.equal((await allowed('lf_user', A, 'SELECT public.found_report_claim_count($1) AS n', [foundB])).rows[0].n, null);
  console.log('PASS USER/RLS: own reports only (cross-user lock allowed), private claims/evidence/receipts, no backdating, no history changes, TRUNCATE, DDL, USER access or admin analytics');
}

async function procedureChecks() {
  await denied('withdraw another user\'s claim', 'LF404', 'lf_user', A, 'CALL public.withdraw_claim($1, NULL)', [claimB]);
  await denied('withdraw after handover', 'LF409', 'lf_user', B, 'CALL public.withdraw_claim($1, NULL)', [claimB]);
  await denied('delete another user\'s report', 'LF404', 'lf_user', B, "CALL public.delete_own_report('lost', $1)", [lostA]);
  await denied('delete a claimed found report', 'LF409', 'lf_user', A, "CALL public.delete_own_report('found', $1)", [foundA]);
  await denied('delete with an invalid type', '22023', 'lf_user', A, "CALL public.delete_own_report('other', $1)", [lostA]);
  const removed = await allowed('lf_user', A, 'CALL public.withdraw_claim($1, NULL)', [claimA]);
  assert.deepEqual(removed.rows, [{ p_removed_evidence: 0 }], 'Owner withdrawal succeeds (rolled back)');
  const kinds = (await pool.query(`SELECT proname, prokind, prosecdef FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname IN ('withdraw_claim', 'delete_own_report') ORDER BY 1`)).rows;
  assert.deepEqual(kinds, [{ proname: 'delete_own_report', prokind: 'p', prosecdef: false }, { proname: 'withdraw_claim', prokind: 'p', prosecdef: false }]);
  console.log('PASS procedures: CALL as lf_user; LF404 for foreign records, LF409 after handover/with claims, 22023 for bad input; SECURITY INVOKER procedures');
}

async function adminChecks() {
  const options = { login: 'ADMIN_DATABASE_URL' };
  for (const view of ['admin_campus_totals', 'admin_reports_by_category', 'admin_reports_by_location', 'admin_location_hotspots', 'admin_contested_items']) {
    await allowed('lf_admin', null, `SELECT * FROM public.${view}`, [], options);
  }
  assert.equal((await allowed('lf_admin', null, 'SELECT * FROM public.admin_daily_activity(30)', [], options)).rows.length, 30);
  await denied('ADMIN reads raw claims', '42501', 'lf_admin', null, 'SELECT * FROM public."CLAIM"', [], options);
  await denied('ADMIN reads evidence', '42501', 'lf_admin', null, 'SELECT * FROM public."CLAIM_EVIDENCE"', [], options);
  await denied('ADMIN reads USER', '42501', 'lf_admin', null, 'SELECT * FROM public."USER"', [], options);
  await denied('ADMIN reads owner IDs', '42501', 'lf_admin', null, 'SELECT "User_ID" FROM public.v_lost_report_details', [], options);
  // default_transaction_read_only = on for the admin login.
  await denied('ADMIN login writes', '25006', 'lf_admin', null, 'CREATE TEMP TABLE probe (x int)', [], options);
  await denied('ADMIN timeline bounds', '22023', 'lf_admin', null, 'SELECT * FROM public.admin_daily_activity(400)', [], options);
  console.log('PASS ADMIN: admin_* views and timeline only; no raw claims, evidence, USER rows or owner IDs; read-only login; bounds enforced');
}

async function registrationFunctionChecks() {
  const plainHash = await hash('registration-function-pass', { type: argon2id });
  // Committed through the real anonymous path (lf_web as lf_anon); removed in cleanup.
  const { withPrincipal } = loadProduction('lib/db.ts');
  const created = await withPrincipal({ role: 'lf_anon', userId: null }, (client) =>
    client.query('SELECT * FROM public.register_user($1, $2, $3, $4)', ['  Registered Person  ', `  ${createdEmails[0].toUpperCase()} `, '+91 90000 00003', plainHash]));
  assert.equal(created.rows[0].Name, 'Registered Person');
  const stored = (await pool.query('SELECT "User_ID", "Email", "Role", "Password_Hash" FROM public."USER" WHERE "User_ID" = $1', [created.rows[0].User_ID])).rows[0];
  assert.equal(stored.Email, createdEmails[0], 'Email is stored trimmed and lower-case');
  assert.equal(stored.Role, 'USER');
  assert.equal(stored.Password_Hash, plainHash);
  await denied('registration stores a plaintext password', '22023', 'lf_anon', null, 'SELECT * FROM public.register_user($1, $2, $3, $4)', ['P', createdEmails[0], null, 'plaintext-password']);
  await denied('registration duplicates an email (case-insensitive)', '23505', 'lf_anon', null, 'SELECT * FROM public.register_user($1, $2, $3, $4)', ['P', fixtureEmails[0].toUpperCase(), null, plainHash]);
  await denied('registration with a malformed email', '23514', 'lf_anon', null, 'SELECT * FROM public.register_user($1, $2, $3, $4)', ['P', 'not-an-email', null, plainHash]);
  // There is no role parameter: a fifth argument does not resolve to any function.
  await denied('registration with a role argument', '42883', 'lf_anon', null, "SELECT * FROM public.register_user($1, $2, $3, $4, 'ADMIN')", ['P', createdEmails[0], null, plainHash]);
  const signature = (await pool.query(`SELECT pg_get_function_identity_arguments('public.register_user'::regproc) AS args,
    prosecdef, pg_get_userbyid(proowner) AS owner, proconfig FROM pg_proc WHERE oid = 'public.register_user'::regproc`)).rows[0];
  assert.equal(signature.args, 'p_name character varying, p_email character varying, p_phone character varying, p_password_hash character varying');
  assert.equal(signature.prosecdef, true);
  assert.equal(signature.owner, 'lf_auth');
  assert.deepEqual(signature.proconfig, ['search_path=pg_catalog, pg_temp']);
  console.log('PASS register_user: anonymous INSERT path only; constant USER role (no role parameter); Argon2id-only; normalised, unique, well-formed emails; owned by lf_auth with a fixed search_path');
}

async function poolIsolationChecks() {
  // Interleave many requests for different identities on the production pool:
  // each must see only its own role and app.user_id, and an idle pooled
  // connection must carry neither afterwards.
  const { query } = loadProduction('lib/db.ts');
  const identities = [A, B, null, A, null, B, ADMIN, null];
  const results = await Promise.all(Array.from({ length: 48 }, (_, n) => {
    const userId = identities[n % identities.length];
    return sessions.run(userId === null ? null : { User_ID: userId }, () =>
      query("SELECT current_user AS role, current_setting('app.user_id', true) AS uid")).then((r) => ({ userId, row: r.rows[0] }));
  }));
  for (const { userId, row } of results) {
    assert.equal(row.role, userId === null ? 'lf_anon' : 'lf_user');
    assert.equal(row.uid, userId === null ? '' : String(userId));
  }
  const idle = await globalThis.postgresPools.web.connect();
  try {
    const { rows: [state] } = await idle.query("SELECT current_user AS role, coalesce(current_setting('app.user_id', true), '') AS uid");
    assert.deepEqual(state, { role: 'lf_web', uid: '' });
  } finally { idle.release(); }
  console.log('PASS pool: 48 interleaved requests kept their own role/identity; idle pooled connections reset to lf_web with no identity');
}

async function provisioningChecks() {
  const script = path.join(root, 'scripts/provision-account.mjs');
  const credentials = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lf-provision-')), 'credentials.txt');
  const args = ['--role', 'ADMIN', '--name', 'Provisioned Admin', '--email', createdEmails[1], '--generate-password', '--credentials-file', credentials];
  try {
    const { stdout } = await run(process.execPath, [script, ...args], { env: process.env, timeout: 60000 });
    assert.ok(stdout.includes('Created ADMIN account') && !/password=/.test(stdout), 'The generated password must not be printed');
    const row = (await pool.query('SELECT "Role", "Password_Hash" FROM public."USER" WHERE "Email" = $1', [createdEmails[1]])).rows[0];
    assert.equal(row.Role, 'ADMIN');
    assert.ok(row.Password_Hash.startsWith('$argon2id$'));
    assert.ok(fs.readFileSync(credentials, 'utf8').includes(`email=${createdEmails[1]}`));
    // Existing accounts are never replaced.
    const before = row.Password_Hash;
    await assert.rejects(run(process.execPath, [script, ...args], { env: process.env, timeout: 60000 }), /already exists/);
    assert.equal((await pool.query('SELECT "Password_Hash" FROM public."USER" WHERE "Email" = $1', [createdEmails[1]])).rows[0].Password_Hash, before);
    // The web application login cannot provision.
    await assert.rejects(run(process.execPath, [script, ...args.map((a) => a === createdEmails[1] ? `x${createdEmails[1]}` : a)],
      { env: { ...process.env, MAINTENANCE_DATABASE_URL: process.env.DATABASE_URL }, timeout: 60000 }), /cannot write "USER"|permission denied/);
    assert.equal((await pool.query('SELECT 1 FROM public."USER" WHERE "Email" = $1', [`x${createdEmails[1]}`])).rowCount, 0);
  } finally {
    fs.rmSync(path.dirname(credentials), { recursive: true, force: true });
  }
  console.log('PASS provisioning: ADMIN only via the maintenance connection; password generated to the credentials file, never printed; duplicates refused without changes; the web login cannot provision');
}

async function main() {
  await assertIsolated();
  const before = await snapshot();
  let created = false;
  try {
    await createFixtures();
    created = true;
    await loginChecks();
    await anonymousChecks();
    await userChecks();
    await procedureChecks();
    await adminChecks();
    await registrationFunctionChecks();
    await poolIsolationChecks();
    await provisioningChecks();
  } finally {
    if (created) await removeFixtures();
    const after = await snapshot();
    for (const table of tables) assert.ok(JSON.stringify(after[table]) === JSON.stringify(before[table]), `${table} differs after cleanup`);
    console.log('PASS cleanup: all ten tables exactly match their pre-test contents');
  }
}

main().catch((error) => {
  const where = error.stack?.split('\n').find((line) => /[\\/]tests[\\/]/.test(line)) ?? '';
  console.error(`FAIL: ${error.message}${where}`);
  process.exitCode = 1;
}).finally(closePools);
