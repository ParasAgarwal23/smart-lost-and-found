// Run against the configured local database: node tests/handover.mjs
// Uses production action/auth/transaction code with only the request session
// supplied by AsyncLocalStorage (no Next.js HTTP/cookie runtime in this runner).
// Temporary fixtures are committed for cross-connection concurrency testing;
// finally deletes only those fixtures and compares all ten tables exactly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import pg from 'pg';
import nextEnv from '@next/env';

const requireDependency = createRequire(import.meta.url);
const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root);
process.env.NODE_ENV = 'development';
const connection = new URL(process.env.DATABASE_URL);
const applicationName = `handover-regression-${process.pid}`;
connection.searchParams.set('application_name', applicationName);
process.env.DATABASE_URL = connection.toString();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sessions = new AsyncLocalStorage();
const modules = new Map();

function loadProduction(relative) {
  if (modules.has(relative)) return modules.get(relative).exports;
  const filename = path.join(root, relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loadedModule = { exports: {} };
  modules.set(relative, loadedModule);
  const localRequire = (name) => {
    if (name === 'server-only') return {};
    if (name === '@/lib/session') return { readSession: async () => sessions.getStore() ?? null };
    if (name.startsWith('@/')) return loadProduction(`${name.slice(2)}.ts`);
    return requireDependency(name);
  };
  vm.runInThisContext(`(function(require, module, exports) {\n${compiled}\n})`, { filename })(
    localRequire, loadedModule, loadedModule.exports,
  );
  return loadedModule.exports;
}

const { createHandover } = loadProduction('app/actions/handover.ts');
const { createClaim } = loadProduction('app/actions/claim.ts');
const tables = ['USER', 'CATEGORY', 'LOCATION', 'LOST_REPORT', 'FOUND_REPORT',
  'FOUND_PHOTOS', 'MATCHES', 'CLAIM', 'CLAIM_EVIDENCE', 'HANDOVER'];
const id = -randomInt(100000, 1000000000);
const users = [id, id - 1, id - 2];
const reports = [id, id - 1, id - 2, id - 3];
const claims = [id, id - 1, id - 2, id - 3, id - 4];
const cleanupClaimIds = new Set(claims);
let fixturesCreated = false;

async function trackFixtureClaims(client = pool) {
  // Action-generated IDs are not returned by createClaim. Discover only claims
  // attached to reports this run inserted successfully, never seed/demo reports.
  const result = await client.query('SELECT "Claim_ID" FROM public."CLAIM" WHERE "Found_ID" = ANY($1::int[])', [reports]);
  for (const claim of result.rows) cleanupClaimIds.add(claim.Claim_ID);
}

async function snapshot() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const contents = {};
    for (const table of tables) {
      const result = await client.query(`SELECT row_to_json(t)::text AS row FROM public."${table}" t ORDER BY row_to_json(t)::text`);
      contents[table] = result.rows.map((entry) => entry.row);
    }
    await client.query('COMMIT');
    return contents;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function transaction(operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await operation(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

function submit(userId, claimId, signature = '  Test receipt  ', extra = {}) {
  const data = new FormData();
  data.set('claimId', String(claimId));
  data.set('signature', signature);
  for (const [name, value] of Object.entries(extra)) data.set(name, value);
  return sessions.run(userId === null ? null : { User_ID: userId },
    () => createHandover({ error: null, success: null }, data));
}

async function handovers() {
  return (await pool.query('SELECT "Claim_ID", "Signature", "Handover_Date"::text AS date, CURRENT_DATE::text AS today FROM public."HANDOVER" WHERE "Claim_ID" = ANY($1::int[]) ORDER BY "Claim_ID"', [claims])).rows;
}

async function run() {
  const before = await snapshot();
  try {
    await transaction(async (client) => {
      for (const user of users) await client.query('INSERT INTO public."USER" ("User_ID", "Role", "Password_Hash") VALUES ($1, $2, $3)', [user, user === users[2] ? 'ADMIN' : 'USER', 'UNUSABLE_REGRESSION_FIXTURE']);
      await client.query('INSERT INTO public."CATEGORY" ("Category_ID") VALUES ($1)', [id]);
      await client.query('INSERT INTO public."LOCATION" ("Location_ID") VALUES ($1)', [id]);
      for (const report of reports) await client.query('INSERT INTO public."FOUND_REPORT" ("Found_ID", "User_ID", "Category_ID", "Location_ID") VALUES ($1, $2, $3, $3)', [report, users[2], id]);
      for (let i = 0; i < claims.length; i++) await client.query('INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID") VALUES ($1, $2, $3)', [claims[i], users[i % 2], reports[Math.floor(i / 2)]]);
    });
    fixturesCreated = true;

    const valid = await submit(users[0], claims[0]);
    assert.equal(valid.error, null);
    assert.ok(valid.success);
    assert.equal((await handovers()).length, 1);
    console.log('PASS A: valid owner handover succeeds');

    const duplicate = await submit(users[0], claims[0]);
    assert.equal(duplicate.error, 'A handover has already been recorded for this claim.');
    assert.equal(duplicate.success, null);
    console.log('PASS B: same-claim duplicate rejected');

    const other = await submit(users[1], claims[1]);
    assert.equal(other.error, 'This item has already been handed over.', 'Different claim for the same found report must be rejected');
    assert.equal(other.success, null);
    assert.equal((await handovers()).length, 1);
    console.log('PASS C: different-claim duplicate rejected');
    if (process.argv.includes('--reproduce')) return;

    // Hold the shared parent row until BOTH action transactions are waiting.
    // This tests real overlap rather than relying on Promise timing alone.
    const blocker = await pool.connect();
    let attempts;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT "Found_ID" FROM public."FOUND_REPORT" WHERE "Found_ID" = $1 FOR UPDATE', [reports[1]]);
      attempts = Promise.all([submit(users[0], claims[2]), submit(users[1], claims[3])]);
      let waiting = false;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const result = await pool.query("SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()", [applicationName]);
        if (result.rows[0].count >= 2) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(waiting, 'Both handover transactions must contend on the parent lock');
      await blocker.query('COMMIT');
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      if (attempts) await attempts;
    }
    const results = await attempts;
    assert.equal(results.filter((result) => result.success && !result.error).length, 1);
    assert.equal(results.filter((result) => result.error === 'This item has already been handed over.').length, 1);
    assert.equal((await handovers()).filter((row) => claims.slice(2, 4).includes(row.Claim_ID)).length, 1);
    console.log('PASS D: overlapping different claims produce exactly one handover');

    const priorFailures = await handovers();
    for (const user of [users[1], users[2], null]) {
      const unauthorized = await submit(user, claims[4], 'Test receipt', { User_ID: String(users[0]), userId: String(users[0]) });
      assert.ok(unauthorized.error);
      assert.equal(unauthorized.success, null);
    }
    const missing = await submit(users[0], id - 100);
    assert.equal(missing.error, 'Claim not found or unavailable to your account.');
    assert.deepEqual(await handovers(), priorFailures);
    console.log('PASS E: foreign owner, ADMIN, absent session, and missing claim rejected');

    for (const signature of ['   ', 'x'.repeat(101)]) {
      const invalid = await submit(users[0], claims[4], signature, { Signature: 'Forged acknowledgement' });
      assert.ok(invalid.error);
      assert.equal(invalid.success, null);
    }
    const invalidId = await submit(users[0], 'not-an-id');
    assert.ok(invalidId.error);
    assert.deepEqual(await handovers(), priorFailures);
    console.log('PASS G: rejected attempts leave handover contents unchanged');

    const forged = await submit(users[0], claims[4], '  Real acknowledgement  ', {
      User_ID: String(users[1]), userId: String(users[1]),
      Handover_Date: '1900-01-01', handoverDate: '1900-01-01',
      Signature: 'Forged acknowledgement', Handover_ID: '1',
    });
    assert.equal(forged.error, null);
    const saved = (await handovers()).find((row) => row.Claim_ID === claims[4]);
    assert.equal(saved.Signature, 'Real acknowledgement');
    assert.equal(saved.date, saved.today);
    console.log('PASS F: identity/date/uppercase signature fields ignored; real signature trimmed and validated');

    const claimData = new FormData();
    claimData.set('foundId', String(reports[0]));
    const newClaim = await sessions.run({ User_ID: users[0] }, () => createClaim({ error: null, success: null }, claimData));
    await trackFixtureClaims();
    assert.equal(newClaim.error, 'This found report already has a handover and cannot be claimed.');
    console.log('PASS: existing claim rejection still applies after handover');

    // Execute the actual handover page selector against the temporary records.
    const page = fs.readFileSync(path.join(root, 'app/claim/handover/page.tsx'), 'utf8');
    const selector = page.match(/`(SELECT c\."Claim_ID", f\."Item_Name"[\s\S]*?)`/)[1];
    for (const user of users.slice(0, 2)) {
      const eligible = await pool.query(selector, [user]);
      assert.equal(eligible.rows.filter((row) => claims.includes(row.Claim_ID)).length, 0);
    }
    console.log('PASS: selector excludes all claims for handed-over items');

    const constraint = await pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'public.\"HANDOVER\"'::regclass AND conname = 'HANDOVER_Claim_ID_key'");
    assert.equal(constraint.rows[0].definition, 'UNIQUE ("Claim_ID")');
    console.log('PASS: existing HANDOVER Claim_ID UNIQUE constraint preserved');
  } finally {
    if (fixturesCreated) await transaction(async (client) => {
      // Rediscover in finally as well: an action/assertion may fail before the
      // normal tracking call. Delete dependents before all tracked claims.
      await trackFixtureClaims(client);
      const claimIds = [...cleanupClaimIds];
      await client.query('DELETE FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" = ANY($1::int[])', [claimIds]);
      await client.query('DELETE FROM public."HANDOVER" WHERE "Claim_ID" = ANY($1::int[])', [claimIds]);
      await client.query('DELETE FROM public."CLAIM" WHERE "Claim_ID" = ANY($1::int[])', [claimIds]);
      await client.query('DELETE FROM public."FOUND_REPORT" WHERE "Found_ID" = ANY($1::int[])', [reports]);
      await client.query('DELETE FROM public."LOCATION" WHERE "Location_ID" = $1', [id]);
      await client.query('DELETE FROM public."CATEGORY" WHERE "Category_ID" = $1', [id]);
      await client.query('DELETE FROM public."USER" WHERE "User_ID" = ANY($1::int[])', [users]);
    });
    const after = await snapshot();
    for (const table of tables) {
      // Avoid printing table contents (including password hashes) on failure.
      assert.ok(JSON.stringify(after[table]) === JSON.stringify(before[table]), `${table} differs after cleanup`);
      console.log(`PASS H: ${table} exactly matches pre-test contents (${before[table].length} rows)`);
    }
  }
}

run().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
  if (globalThis.postgresPool) await globalThis.postgresPool.end();
});
