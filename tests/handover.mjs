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
import { renderToStaticMarkup } from 'react-dom/server';

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
const invalidatedPaths = [];

function loadProduction(relative) {
  if (modules.has(relative)) return modules.get(relative).exports;
  const filename = path.join(root, relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loadedModule = { exports: {} };
  modules.set(relative, loadedModule);
  const localRequire = (name) => {
    if (name === 'server-only') return {};
    // Revalidation requires Next's request runtime; record calls in this runner.
    if (name === 'next/cache') return { revalidatePath: (pathname) => invalidatedPaths.push(pathname) };
    if (name === '@/lib/session') return { readSession: async () => sessions.getStore() ?? null };
    if (name.startsWith('@/')) return loadProduction(`${name.slice(2)}.ts`);
    if (name.startsWith('.')) return loadProduction(path.join(path.dirname(relative), `${name}.tsx`));
    return requireDependency(name);
  };
  vm.runInThisContext(`(function(require, module, exports) {\n${compiled}\n})`, { filename })(
    localRequire, loadedModule, loadedModule.exports,
  );
  return loadedModule.exports;
}

const { createHandover } = loadProduction('app/actions/handover.ts');
const { createClaim } = loadProduction('app/actions/claim.ts');
const { addClaimEvidence } = loadProduction('app/actions/claim-evidence.ts');
const tables = ['USER', 'CATEGORY', 'LOCATION', 'LOST_REPORT', 'FOUND_REPORT',
  'FOUND_PHOTOS', 'MATCHES', 'CLAIM', 'CLAIM_EVIDENCE', 'HANDOVER'];
const id = -randomInt(100000, 1000000000);
const users = [id, id - 1, id - 2];
const reports = [id, id - 1, id - 2, id - 3];
const claims = [id, id - 1, id - 2, id - 3, id - 4];
const cleanupClaimIds = new Set(claims);
let fixturesCreated = false;

async function trackFixtureClaims(client = pool) {
  // Discover all claims attached to reports this run inserted successfully,
  // including committed actions whose expected-result assertion fails.
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

async function renderPage(relative, userId, params = {}, inspect = () => {}) {
  const page = loadProduction(relative).default;
  const element = await sessions.run({ User_ID: userId }, () => page({ searchParams: Promise.resolve(params) }));
  inspect(element);
  return renderToStaticMarkup(element);
}

function formKey(element, formName) {
  if (!element || typeof element !== 'object') return undefined;
  if (element.type?.name === formName) return element.key;
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const key = formKey(child, formName);
    if (key !== undefined) return key;
  }
  return undefined;
}

function historyIds(html) {
  return [...html.matchAll(/<article id="claim-(-?\d+)"/g)].map((match) => Number(match[1]));
}

function claimCard(html, claimId) {
  const match = html.match(new RegExp(`<article id="claim-${claimId}"[\\s\\S]*?</article>`));
  assert.ok(match, 'Owned claim card must exist');
  return match[0];
}

function selectedClaim(html) {
  const select = html.match(/<select[^>]*id="claimId"[\s\S]*?<\/select>/);
  if (!select) return undefined;
  const option = select[0].match(/<option\b(?=[^>]*value="(-?\d+)")(?=[^>]*selected)[^>]*>/);
  return option ? Number(option[1]) : undefined;
}

async function overlapping(reportId, operations) {
  const blocker = await pool.connect();
  let attempts;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT "Found_ID" FROM public."FOUND_REPORT" WHERE "Found_ID" = $1 FOR UPDATE', [reportId]);
    attempts = Promise.all(operations.map((operation) => operation()));
    let waiting = false;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const result = await pool.query("SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()", [applicationName]);
      if (result.rows[0].count >= operations.length) { waiting = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(waiting, 'Both action transactions must contend on the parent lock');
    await blocker.query('COMMIT');
    return await attempts;
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    if (attempts) await attempts;
  }
}

async function workflowBeforeHandover() {
  const history = await renderPage('app/claim/page.tsx', users[0], { User_ID: String(users[1]) });
  assert.ok(history.includes('My Claims'));
  assert.ok(history.includes('Submit a Claim'));
  assert.deepEqual(historyIds(history), [claims[0], claims[2], claims[4]]);
  assert.ok(history.includes('Regression category'));
  assert.ok(history.includes('Regression location (Regression building)'));
  assert.ok(!history.includes('UNUSABLE_REGRESSION_FIXTURE'));
  const foreignHistory = await renderPage('app/claim/page.tsx', users[1]);
  assert.deepEqual(historyIds(foreignHistory), [claims[1], claims[3]]);
  const adminHistory = await renderPage('app/claim/page.tsx', users[2], { User_ID: String(users[0]) });
  assert.deepEqual(historyIds(adminHistory), []);
  assert.ok(adminHistory.includes('submitted any claims yet.'));
  await assert.rejects(renderPage('app/claim/page.tsx', null), (error) => error.digest?.includes('/login'));
  console.log('PASS Batch 2 A/B/C/Q: session-owned history, order, details, ADMIN isolation, empty state, and authentication');

  const data = new FormData();
  data.set('foundId', String(reports[3]));
  data.set('User_ID', String(users[1]));
  data.set('Claim_Date', '1900-01-01');
  const submitClaim = () => sessions.run({ User_ID: users[0] }, () => createClaim({ error: null, success: null }, data));
  const offset = invalidatedPaths.length;
  const outcomes = await overlapping(reports[3], [submitClaim, submitClaim]);
  await trackFixtureClaims();
  const success = outcomes.filter((result) => result.success && !result.error);
  assert.equal(success.length, 1);
  assert.equal(outcomes.filter((result) => result.error === 'You have already claimed this found report.').length, 1);
  const createdClaimId = success[0].claimId;
  assert.ok(Number.isInteger(createdClaimId));
  const saved = await pool.query('SELECT "Claim_ID", "User_ID", "Claim_Date"::text AS date, CURRENT_DATE::text AS today, "Status" FROM public."CLAIM" WHERE "Found_ID" = $1', [reports[3]]);
  assert.equal(saved.rows.length, 1);
  assert.equal(saved.rows[0].Claim_ID, createdClaimId);
  assert.equal(saved.rows[0].User_ID, users[0]);
  assert.equal(saved.rows[0].date, saved.rows[0].today);
  assert.equal(saved.rows[0].Status, null);
  assert.deepEqual(invalidatedPaths.slice(offset), ['/claim', '/claim/evidence', '/claim/handover']);
  const refreshed = await renderPage('app/claim/page.tsx', users[0]);
  assert.equal(historyIds(refreshed)[0], createdClaimId);
  const card = claimCard(refreshed, createdClaimId);
  assert.ok(card.includes(`/claim/evidence?claimId=${createdClaimId}#evidence-${createdClaimId}`));
  assert.ok(card.includes('Add Evidence'));
  assert.ok(card.includes(`/claim/handover?claimId=${createdClaimId}`));
  console.log('PASS Batch 2 D/E/P/T: committed ID returned, refreshed history, real overlapping duplicate prevention, no mutation redirect');

  const evidencePage = 'app/claim/evidence/page.tsx';
  const handoverPage = 'app/claim/handover/page.tsx';
  const eligibleHtml = await renderPage(handoverPage, users[0]);
  const selector = eligibleHtml.match(/<select[^>]*id="claimId"[\s\S]*?<\/select>/)?.[0];
  assert.ok(selector, 'Eligible owned claims must have a usable selector');
  assert.ok(!selector.match(/^<select[^>]*\bdisabled/));
  assert.deepEqual([...selector.matchAll(/<option[^>]*value="(-?\d+)"/g)].map((match) => Number(match[1])),
    [createdClaimId, claims[0], claims[2], claims[4]]);
  for (const page of [evidencePage, handoverPage]) {
    const formName = page === evidencePage ? 'EvidenceForm' : 'HandoverForm';
    let selectedKey;
    const selected = await renderPage(page, users[0], { claimId: String(createdClaimId) }, (tree) => { selectedKey = formKey(tree, formName); });
    assert.equal(selectedClaim(selected), createdClaimId);
    assert.ok(selected.includes('Back to My Claims'));
    assert.equal(selectedKey, JSON.stringify(String(createdClaimId)));
    let nextKey;
    await renderPage(page, users[0], { claimId: String(claims[4]) }, (tree) => { nextKey = formKey(tree, formName); });
    assert.notEqual(nextKey, selectedKey, 'Changing requested claim must reset prior form action state');
    await renderPage(page, users[0], { claimId: String(createdClaimId) }, (tree) => {
      assert.equal(formKey(tree, formName), selectedKey, 'Same-route revalidation must retain form action state');
    });
    assert.equal(selectedClaim(await renderPage(page, users[0])), undefined);
    for (const invalid of ['bad-id', '', '2147483648', "1 OR 1=1", [String(createdClaimId)], String(claims[1])]) {
      const rejected = await renderPage(page, users[0], { claimId: invalid, User_ID: String(users[1]) });
      assert.equal(selectedClaim(rejected), undefined);
      assert.ok(rejected.includes('Claim not found or unavailable to your account.'));
    }
  }
  const evidenceOwned = await renderPage(evidencePage, users[0]);
  assert.ok(!evidenceOwned.includes(`id="evidence-${claims[1]}"`));
  const adminEvidence = await renderPage(evidencePage, users[2], { claimId: String(createdClaimId) });
  assert.ok(!adminEvidence.includes(`id="evidence-${createdClaimId}"`));
  console.log('PASS Batch 2 F/G/H/M/N/S: specific selections, generic visits, invalid/foreign IDs, private evidence, and back links');

  const evidenceOffset = invalidatedPaths.length;
  for (const description of ['Private regression ownership detail', 'Second regression ownership detail']) {
    const evidence = new FormData();
    evidence.set('claimId', String(createdClaimId));
    evidence.set('description', description);
    const result = await sessions.run({ User_ID: users[0] }, () => addClaimEvidence({ error: null, success: null }, evidence));
    assert.equal(result.error, null);
    assert.ok(result.success);
    assert.equal(result.claimId, createdClaimId);
  }
  assert.deepEqual(invalidatedPaths.slice(evidenceOffset), ['/claim', '/claim/evidence', '/claim', '/claim/evidence']);
  const afterEvidence = await renderPage('app/claim/page.tsx', users[0]);
  const evidenceCard = claimCard(afterEvidence, createdClaimId);
  assert.ok(evidenceCard.includes('Evidence count: </dt><dd class="inline">2</dd>'));
  assert.ok(evidenceCard.includes('View / Add Evidence'));
  assert.ok(!afterEvidence.includes('Private regression ownership detail'));
  const reloadedEvidence = await renderPage(evidencePage, users[0], { claimId: String(createdClaimId) });
  assert.ok(reloadedEvidence.includes(`id="evidence-${createdClaimId}"`));
  assert.ok(reloadedEvidence.includes('Private regression ownership detail'));
  assert.ok(reloadedEvidence.includes('Second regression ownership detail'));
  const numbered = await pool.query('SELECT "Evidence_No" FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" = $1 ORDER BY "Evidence_No"', [createdClaimId]);
  assert.deepEqual(numbered.rows.map((row) => row.Evidence_No), [1, 2]);
  const illegalEvidence = new FormData();
  illegalEvidence.set('claimId', String(createdClaimId));
  illegalEvidence.set('description', 'Unauthorized evidence');
  for (const user of [users[1], users[2]]) {
    const result = await sessions.run({ User_ID: user }, () => addClaimEvidence({ error: null, success: null }, illegalEvidence));
    assert.ok(result.error);
  }
  console.log('PASS Batch 2 I/R: evidence counts, numbering, repeat submissions, reloaded display, and owner-only mutation');
  return createdClaimId;
}

async function workflowAfterHandover(createdClaimId) {
  const own = await renderPage('app/claim/page.tsx', users[0]);
  const ownReceipt = claimCard(own, claims[0]);
  assert.ok(ownReceipt.includes('Receipt recorded'));
  assert.ok(!ownReceipt.includes('/claim/handover?'));
  assert.ok(!own.includes('Test receipt'));
  const other = await renderPage('app/claim/page.tsx', users[1]);
  const otherReceipt = claimCard(other, claims[1]);
  assert.ok(otherReceipt.includes('This item has already been handed over.'));
  assert.ok(!otherReceipt.includes('/claim/handover?'));
  for (const [user, claimId] of [[users[0], claims[0]], [users[1], claims[1]]]) {
    const ineligible = await renderPage('app/claim/handover/page.tsx', user, { claimId: String(claimId) }, (tree) => {
      assert.equal(formKey(tree, 'HandoverForm'), JSON.stringify(String(claimId)), 'Receipt revalidation must keep the raw route key even after eligibility changes');
    });
    assert.equal(selectedClaim(ineligible), undefined);
    assert.ok(ineligible.includes('Claim not found or unavailable to your account.'));
  }
  const available = claimCard(own, createdClaimId);
  assert.ok(available.includes(`/claim/handover?claimId=${createdClaimId}`));
  const offset = invalidatedPaths.length;
  const receipt = await submit(users[0], createdClaimId);
  assert.equal(receipt.error, null);
  assert.ok(receipt.success);
  assert.deepEqual(invalidatedPaths.slice(offset), ['/claim', '/claim/handover']);
  const final = await renderPage('app/claim/page.tsx', users[0]);
  const finalCard = claimCard(final, createdClaimId);
  assert.ok(finalCard.includes('Receipt recorded'));
  const receiptDate = await pool.query('SELECT "Handover_Date"::text AS date FROM public."HANDOVER" WHERE "Claim_ID" = $1', [createdClaimId]);
  assert.ok(finalCard.includes(receiptDate.rows[0].date));
  assert.ok(!finalCard.includes('/claim/handover?'));
  const empty = await renderPage('app/claim/handover/page.tsx', users[0]);
  assert.ok(historyIds(final).length > 0, 'Completed claims remain visible in My Claims');
  assert.ok(!empty.includes('id="claimId"'), 'No empty disabled claim dropdown when every item is handed over');
  assert.ok(!empty.includes('id="signature"'));
  assert.ok(!empty.includes('type="submit"'));
  assert.ok(empty.includes('Only claims for items that have not already been handed over can be confirmed.'));
  assert.ok(empty.includes('Back to My Claims'));
  console.log('PASS eligible selector: owned options, preselection, and completed-history empty state');
  console.log('PASS Batch 2 J/K/L: availability, own receipt/date, competing-claim receipt, and handover revalidation');
}

async function run() {
  const before = await snapshot();
  try {
    await transaction(async (client) => {
      for (const user of users) await client.query('INSERT INTO public."USER" ("User_ID", "Role", "Password_Hash") VALUES ($1, $2, $3)', [user, user === users[2] ? 'ADMIN' : 'USER', 'UNUSABLE_REGRESSION_FIXTURE']);
      await client.query('INSERT INTO public."CATEGORY" ("Category_ID", "Category_Name") VALUES ($1, $2)', [id, 'Regression category']);
      await client.query('INSERT INTO public."LOCATION" ("Location_ID", "Location_Name", "Building") VALUES ($1, $2, $3)', [id, 'Regression location', 'Regression building']);
      for (const report of reports) await client.query('INSERT INTO public."FOUND_REPORT" ("Found_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name") VALUES ($1, $2, $3, $3, $4)', [report, users[2], id, `Regression item ${report}`]);
      for (let i = 0; i < claims.length; i++) await client.query('INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID", "Claim_Date") VALUES ($1, $2, $3, CURRENT_DATE)', [claims[i], users[i % 2], reports[Math.floor(i / 2)]]);
    });
    fixturesCreated = true;

    const createdClaimId = await workflowBeforeHandover();

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
    const results = await overlapping(reports[1], [() => submit(users[0], claims[2]), () => submit(users[1], claims[3])]);
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
    await workflowAfterHandover(createdClaimId);
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
