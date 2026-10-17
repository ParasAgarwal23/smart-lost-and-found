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
    if (name.startsWith('@/')) {
      const target = name.slice(2);
      return loadProduction(`${target}.${fs.existsSync(path.join(root, `${target}.ts`)) ? 'ts' : 'tsx'}`);
    }
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
const { withdrawClaim } = loadProduction('app/actions/claim.ts');
const { editReport } = loadProduction('app/actions/report-edit.ts');
const tables = ['USER', 'CATEGORY', 'LOCATION', 'LOST_REPORT', 'FOUND_REPORT',
  'FOUND_PHOTOS', 'MATCHES', 'CLAIM', 'CLAIM_EVIDENCE', 'HANDOVER'];
const id = -randomInt(100000, 1000000000);
const users = [id, id - 1, id - 2];
const reports = [id, id - 1, id - 2, id - 3];
const claims = [id, id - 1, id - 2, id - 3, id - 4];
const cleanupClaimIds = new Set(claims);
let fixturesCreated = false;

async function trackFixtureClaims(client = pool) {
  // Browser-created found reports belong only to the users inserted by this run.
  const createdReports = await client.query('SELECT "Found_ID" FROM public."FOUND_REPORT" WHERE "User_ID" = ANY($1::int[])', [users]);
  for (const report of createdReports.rows) if (!reports.includes(report.Found_ID)) reports.push(report.Found_ID);
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
  // A claim named by the previous page is shown as a fixed summary with a hidden input.
  const fixed = html.match(/<input[^>]*type="hidden"[^>]*id="claimId"[^>]*value="(-?\d+)"/);
  if (fixed) return Number(fixed[1]);
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

async function campusSummaryChecks() {
  const database = loadProduction('lib/db.ts');
  const originalQuery = database.query;
  let aggregateCalls = 0;
  const insightReads = [];
  let adminReads = 0;
  try {
    database.query = async (sql, values) => {
      if (sql.startsWith('SELECT COUNT(*)::text AS count')) aggregateCalls++;
      if (!sql.includes('FROM public."USER"')) adminReads++;
      const result = await originalQuery(sql, values);
      if (sql.startsWith('WITH reports AS')) insightReads.push({ sql, values, rows: result.rows });
      return result;
    };
    await assert.rejects(renderPage('app/admin/campus-summary/page.tsx', null), error => error.digest?.includes('/login'));
    const denied = await renderPage('app/admin/campus-summary/page.tsx', users[0], { Role: 'ADMIN', User_ID: users[2] });
    assert.ok(denied.includes('Access denied'));
    assert.ok(!denied.includes('Campus totals'));
    assert.equal(aggregateCalls, 0, 'Unauthorized requests must not run aggregate queries');
    assert.equal(adminReads, 0, 'Authorization must precede all campus data reads');
    const admin = await renderPage('app/admin/campus-summary/page.tsx', users[2]);
    assert.equal(aggregateCalls, 4);
    for (const [table, label] of [['LOST_REPORT', 'Total lost reports'], ['FOUND_REPORT', 'Total found reports'], ['CLAIM', 'Total claims'], ['HANDOVER', 'Total handovers']]) {
      const { rows } = await pool.query(`SELECT COUNT(*)::text AS count FROM public."${table}"`);
      assert.ok(admin.includes(label));
      assert.ok(admin.includes(`>${BigInt(rows[0].count).toLocaleString('en-US')}</dd>`));
    }
    assert.equal(insightReads.length, 3);
    for (const [table, key, name] of [['CATEGORY', 'Category_ID', 'Category_Name'], ['LOCATION', 'Location_ID', 'Location_Name']]) {
      // Independent correlated counts catch lost/found join multiplication.
      const direct = (await pool.query(`SELECT d."${key}" AS id, d."${name}" AS label,
        ${table === 'LOCATION' ? 'd."Building"' : 'NULL::text'} AS building,
        (SELECT COUNT(*) FROM public."LOST_REPORT" r WHERE r."${key}"=d."${key}")::text AS lost,
        (SELECT COUNT(*) FROM public."FOUND_REPORT" r WHERE r."${key}"=d."${key}")::text AS found
        FROM public."${table}" d ORDER BY d."${key}"`)).rows;
      const captured = insightReads.find(read => read.sql.includes(`FROM public."${table}"`)).rows;
      const expected = direct.map(row => ({ ...row, total: String(BigInt(row.lost) + BigInt(row.found)) }));
      assert.deepEqual([...captured].sort((a,b) => a.id-b.id), expected);
      for (let n=1;n<captured.length;n++) assert.ok(BigInt(captured[n-1].total) >= BigInt(captured[n].total));
    }
    const activity = insightReads.find(read => read.sql.includes('LIMIT $1'));
    assert.deepEqual(activity.values, [10]);
    const expectedRecent = (await pool.query(`SELECT r.id, r.type, r.item, c."Category_Name" AS category,
      l."Location_Name" AS location, l."Building" AS building, r.date::text AS date
      FROM (SELECT "Lost_ID" AS id, 'Lost' AS type, "Item_Name" AS item, "Category_ID", "Location_ID", "Date_Lost" AS date FROM public."LOST_REPORT"
        UNION ALL SELECT "Found_ID", 'Found', "Item_Name", "Category_ID", "Location_ID", "Date_Found" FROM public."FOUND_REPORT") r
      JOIN public."CATEGORY" c ON c."Category_ID"=r."Category_ID"
      JOIN public."LOCATION" l ON l."Location_ID"=r."Location_ID"
      ORDER BY r.date DESC NULLS LAST, r.id DESC, r.type ASC LIMIT $1`, [10])).rows;
    assert.deepEqual(activity.rows, expectedRecent);
    assert.ok(admin.includes('Reports by Category') && admin.includes('Reports by Location') && admin.includes('Recent Campus Activity'));
    // Exercise empty and failed reads without altering genuine database records.
    database.query = async (sql, values) => sql.startsWith('SELECT COUNT(*)::text AS count') ? { rows: [{ count: '0' }] } : sql.startsWith('WITH reports AS') ? { rows: [] } : originalQuery(sql, values);
    const empty = await renderPage('app/admin/campus-summary/page.tsx', users[2]);
    assert.equal((empty.match(/>0<\/dd>/g) ?? []).length, 4);
    assert.ok(empty.includes('No category records') && empty.includes('No location records') && empty.includes('No lost or found reports'));
    database.query = async (sql, values) => {
      if (sql.startsWith('SELECT COUNT(*)::text AS count')) throw Error('Private database diagnostic');
      return originalQuery(sql, values);
    };
    const failed = await renderPage('app/admin/campus-summary/page.tsx', users[2]);
    assert.ok(failed.includes('Unable to load campus totals.'));
    assert.ok(failed.includes('Try again'));
    assert.ok(!failed.includes('Private database diagnostic'));
    assert.ok(!failed.includes('Campus totals'));
    database.query = async (sql, values) => {
      if (sql.startsWith('WITH reports AS')) throw Error('Private insight diagnostic');
      return originalQuery(sql, values);
    };
    const partial = await renderPage('app/admin/campus-summary/page.tsx', users[2]);
    assert.ok(partial.includes('Campus totals'));
    assert.ok(partial.includes('Unable to load campus insights and recent activity.'));
    assert.ok(!partial.includes('Private insight diagnostic'));
    assert.ok(!partial.includes('aria-label="Recent Campus Activity"'));
  } finally { database.query = originalQuery; }
  for (const user of [null, users[0], users[2]]) {
    const home = await renderPage('app/page.tsx', user);
    assert.equal(home.includes('href="/admin/campus-summary"'), user === users[2]);
  }
  console.log('PASS Campus Summary: ADMIN guard before all seven queries, independent category/location totals, recent records and ordering, live counts, empty/error states, and role-specific navigation');
}

async function workflowBeforeHandover() {
  await campusSummaryChecks();
  const visitorHome = await renderPage('app/page.tsx', null);
  assert.ok(visitorHome.includes('Sign In'));
  assert.ok(visitorHome.includes('action="/search"'));
  assert.ok(visitorHome.includes('href="/lost-report"') && visitorHome.includes('href="/found-report"'));
  assert.ok(!visitorHome.includes('Sign Out'));
  assert.ok(!visitorHome.includes('href="/claim"'));
  for (const user of [users[0], users[2]]) {
    const home = await renderPage('app/page.tsx', user);
    assert.ok(home.includes('My Claims'));
    assert.ok(home.includes(user === users[2] ? 'ADMIN account' : 'USER account'));
  }
  // The shared header carries role-aware navigation and Sign In / Sign Out.
  const SiteHeader = loadProduction('components/site-header.tsx').default;
  const header = async (user) => renderToStaticMarkup(await sessions.run(user === null ? null : { User_ID: user }, () => SiteHeader()));
  const visitorHeader = await header(null);
  assert.ok(visitorHeader.includes('Sign In') && !visitorHeader.includes('Sign Out'));
  assert.ok(visitorHeader.includes('Report an item') && !visitorHeader.includes('href="/claim"'));
  for (const user of [users[0], users[2]]) {
    const signedIn = await header(user);
    assert.ok(signedIn.includes('Sign Out') && signedIn.includes('href="/claim"') && signedIn.includes('href="/my-reports"'));
    assert.equal(signedIn.includes('href="/admin/campus-summary"'), user === users[2]);
  }
  // Sign-in return paths accept only known in-app pages (no open redirect).
  const { safeNextPath, loginPath } = loadProduction('lib/next-path.ts');
  for (const good of ['/lost-report', '/claim?foundId=-5', '/my-reports/edit?type=lost&id=3', '/admin/campus-summary']) assert.equal(safeNextPath(good), good);
  for (const bad of ['https://example.com', '//example.com', '/\\example.com', '/login', '/', '/lost-report/../admin', 'javascript:alert(1)', ['/claim'], '/claim?x=<script>']) assert.equal(safeNextPath(bad), null);
  assert.equal(loginPath('/lost-report'), '/login?next=%2Flost-report');
  assert.equal(loginPath('https://example.com'), '/login');
  // The item chosen in Search is named in the heading and submitted directly, without a second picker.
  const selected = await renderPage('app/claim/page.tsx', users[0], { foundId: String(reports[3]) });
  assert.ok(selected.match(new RegExp(`<input[^>]*type="hidden"[^>]*id="foundId"[^>]*value="${reports[3]}"`)));
  assert.ok(!selected.includes('<select') && selected.includes(`Claim “Regression item ${reports[3]}”`));
  // Signing in from a protected link returns to the same record, with a specific reason.
  const { nextPurpose } = loadProduction('lib/next-path.ts');
  for (const [page, params, next] of [['app/claim/page.tsx', { foundId: '-5' }, '/claim?foundId=-5'], ['app/claim/evidence/page.tsx', { claimId: '7' }, '/claim/evidence?claimId=7'],
    ['app/claim/handover/page.tsx', { claimId: 'x' }, '/claim/handover'], ['app/potential-matches/page.tsx', { lostId: '9' }, '/potential-matches?lostId=9'],
    ['app/my-reports/edit/page.tsx', { type: 'found', id: '3' }, '/my-reports/edit?type=found&id=3']]) {
    await assert.rejects(renderPage(page, null, params), (error) => error.digest?.includes(`/login?next=${encodeURIComponent(next)};`));
  }
  assert.equal(nextPurpose('/claim?foundId=-5'), 'Sign in to claim this item.');
  const visitorSearch = await renderPage('app/search/page.tsx', null, { category: String(id), type: 'Found' });
  assert.ok(visitorSearch.includes(`href="/login?next=${encodeURIComponent(`/claim?foundId=${reports[3]}`)}"`), 'Visitors return to the claim form after signing in');
  for (const foundId of ['invalid', '2147483648', [String(reports[3])], String(reports[0])]) {
    const rejected = await renderPage('app/claim/page.tsx', users[0], { foundId });
    assert.ok(rejected.includes('This found report is unavailable to claim.'));
  }
  assert.ok((await renderPage('app/claim/page.tsx', users[2], { foundId: String(reports[3]) })).includes('This found report is unavailable to claim.'));
  // An unavailable item gets one specific explanation and one next step, with no picker or second message.
  const alreadyClaimed = await renderPage('app/claim/page.tsx', users[0], { foundId: String(reports[0]) });
  assert.ok(alreadyClaimed.includes('You have already claimed this item.') && alreadyClaimed.includes(`href="#claim-${claims[0]}"`));
  assert.ok(!alreadyClaimed.includes('id="foundId"') && !alreadyClaimed.includes('There are no found items you can claim right now'));
  const ownFound = await renderPage('app/claim/page.tsx', users[2], { foundId: String(reports[3]) });
  assert.ok(ownFound.includes('You reported this item yourself.') && ownFound.includes('href="/my-reports"'));
  assert.ok((await renderPage('app/claim/page.tsx', users[0], { foundId: 'invalid' })).includes('href="/search?type=Found"'));
  assert.ok(!/Claim #-?\d/.test(await renderPage('app/claim/page.tsx', users[0])), 'Claim cards must not show internal claim numbers');
  const { getFoundReportContext } = loadProduction('lib/found-report-context.ts');
  const context = await getFoundReportContext(reports, users[0]);
  assert.equal(context.find((row) => row.Found_ID === reports[0]).Own_Claim_ID, claims[0]);
  assert.equal(context.find((row) => row.Found_ID === reports[3]).Own_Claim_ID, null);
  assert.equal((await getFoundReportContext([reports[3]], users[2]))[0].Is_Own_Report, true);
  assert.ok((await getFoundReportContext(reports, null)).every((row) => row.Own_Claim_ID === null));
  const search = await renderPage('app/search/page.tsx', users[0], { category: String(id), type: 'Found' });
  assert.ok(search.includes(`/claim?foundId=${reports[3]}#submit-claim`));
  assert.ok(search.includes('You have already claimed this item.'));
  assert.ok(!search.includes(`#claim-${claims[1]}`));
  const emptySearch = await renderPage('app/search/page.tsx', null, { text: `absent-regression-${id}` });
  assert.ok(emptySearch.includes('No reports match your search.'));
  assert.ok(emptySearch.includes('Clear filters'));
  const invalidSearch = await renderPage('app/search/page.tsx', null, { type: 'invalid' });
  assert.ok(invalidSearch.includes('Choose valid search filters.'));
  assert.ok(!invalidSearch.includes('No reports match your search.'));
  console.log('PASS polish: session navigation, found-report preselection, eligibility, public privacy, and search states');
  const database = loadProduction('lib/db.ts');
  const originalQuery = database.query;
  try {
    // Inject read failures only; never interrupt the real PostgreSQL service.
    database.query = async (sql, values) => {
      if (sql.includes('FROM public."CATEGORY"') || sql.includes('WITH reports AS')) throw new Error('Simulated private database error');
      return originalQuery(sql, values);
    };
    for (const page of ['app/lost-report/page.tsx', 'app/found-report/page.tsx']) {
      const failed = await renderPage(page, users[0]);
      assert.ok(failed.includes('Unable to load categories and locations.'));
      assert.ok(failed.includes('Reload page'));
      assert.ok(!failed.includes('Simulated private database error'));
      assert.ok(!failed.includes('id="itemName"'));
    }
    const failedSearch = await renderPage('app/search/page.tsx', null);
    assert.ok(failedSearch.includes('Unable to load filter options.'));
    assert.ok(!failedSearch.includes('No reports match your search.'));
    assert.ok(!failedSearch.includes('Simulated private database error'));
  } finally { database.query = originalQuery; }
  console.log('PASS polish: safe report/search query failures and recovery links');
  const history = await renderPage('app/claim/page.tsx', users[0], { User_ID: String(users[1]) });
  assert.ok(history.includes('My Claims'));
  assert.ok(history.includes('Claim another found item'));
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
  assert.ok(card.includes('Add evidence'));
  assert.ok(/data-done="true">Claim submitted/.test(card) && /data-done="false">Add proof/.test(card) && /data-done="false">Confirm receipt/.test(card), 'A new claim has only its first step done');
  assert.ok(/data-state="current" data-done="false">Add proof<span class="sr-only"> \(next step\)/.test(card) && /data-state="upcoming" data-done="false">Confirm receipt/.test(card), 'Adding proof is marked as the next step');
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
  assert.ok(!/\(claim -?\d+\)/.test(selector) && selector.includes('— claimed '), 'Claim options are labelled by item and claim date, not internal IDs');
  for (const page of [evidencePage, handoverPage]) {
    const formName = page === evidencePage ? 'EvidenceForm' : 'HandoverForm';
    let selectedKey;
    const selected = await renderPage(page, users[0], { claimId: String(createdClaimId) }, (tree) => { selectedKey = formKey(tree, formName); });
    assert.equal(selectedClaim(selected), createdClaimId);
    assert.ok(selected.includes('Back to My Claims'));
    assert.ok(!selected.includes('<select') && selected.includes('Choose a different claim'), 'A known claim is shown, not asked for again');
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
  assert.ok(evidenceCard.includes('data-evidence-count="2"'));
  assert.ok(/data-done="true">Proof added \(2\)/.test(evidenceCard) && /data-done="false">Confirm receipt/.test(evidenceCard), 'Progress shows only the steps that really happened');
  assert.ok(/data-state="current" data-done="false">Confirm receipt/.test(evidenceCard), 'With proof added, confirming receipt becomes the current step');
  assert.ok(evidenceCard.includes('View or add evidence'));
  assert.ok(evidenceCard.includes('Confirm item received'), 'With evidence added, confirming receipt becomes the next step');
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
  assert.ok(/data-done="true">Item received/.test(ownReceipt));
  assert.ok(/data-state="skipped" data-done="false">No proof added<span class="sr-only"> \(skipped\)/.test(ownReceipt), 'Proof that was never added is shown as skipped, not pending');
  assert.ok(!ownReceipt.includes('/claim/handover?'));
  assert.ok(!ownReceipt.includes('card-actions'), 'A completed claim with no evidence has no empty action bar');
  assert.ok(!own.includes('Test receipt'));
  const other = await renderPage('app/claim/page.tsx', users[1]);
  const otherReceipt = claimCard(other, claims[1]);
  assert.ok(otherReceipt.includes('This item has already been handed over.'));
  assert.ok(/data-done="false">Returned to someone else/.test(otherReceipt) && !otherReceipt.includes('Item received'), 'A competing receipt is never shown as this claimant receiving the item');
  assert.ok(/data-state="closed" data-done="false">Returned to someone else<span class="sr-only"> \(closed\)/.test(otherReceipt));
  assert.ok(!otherReceipt.includes('/claim/handover?'));
  // Evidence for a finished claim is read-only, and the evidence picker offers only open claims.
  for (const [user, claimId] of [[users[0], claims[0]], [users[1], claims[1]]]) {
    const closedEvidence = await renderPage('app/claim/evidence/page.tsx', user, { claimId: String(claimId) });
    assert.ok(closedEvidence.includes('this claim is closed') && closedEvidence.includes(`id="evidence-${claimId}"`));
    assert.ok(!closedEvidence.includes('id="description"') && !closedEvidence.includes('type="submit"'));
  }
  const evidencePicker = (await renderPage('app/claim/evidence/page.tsx', users[0])).match(/<select[^>]*id="claimId"[\s\S]*?<\/select>/)?.[0] ?? '';
  assert.ok(evidencePicker.includes(`value="${createdClaimId}"`) && !evidencePicker.includes(`value="${claims[0]}"`), 'Handed-over claims are not offered for new evidence');
  // The owner's own finished claims are explained accurately, never reported as "not found".
  for (const [user, claimId, message] of [[users[0], claims[0], 'You have already confirmed that you received this item.'], [users[1], claims[1], 'This item has already been handed over to someone else']]) {
    const ineligible = await renderPage('app/claim/handover/page.tsx', user, { claimId: String(claimId) }, (tree) => {
      assert.equal(formKey(tree, 'HandoverForm'), JSON.stringify(String(claimId)), 'Receipt revalidation must keep the raw route key even after eligibility changes');
    });
    assert.equal(selectedClaim(ineligible), undefined);
    assert.ok(ineligible.includes(message) && !ineligible.includes('Claim not found'));
  }
  assert.ok((await renderPage('app/claim/handover/page.tsx', users[0], { claimId: String(claims[1]) })).includes('Claim not found or unavailable to your account.'), 'Another user\'s claim stays indistinguishable from a missing one');
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

function withdraw(userId, claimId) {
  const data = new FormData();
  data.set('claimId', String(claimId));
  data.set('User_ID', String(users[1]));
  return sessions.run(userId === null ? null : { User_ID: userId }, () => withdrawClaim({ error: null, success: null }, data));
}

async function claimAs(userId, foundId) {
  const data = new FormData();
  data.set('foundId', String(foundId));
  const result = await sessions.run({ User_ID: userId }, () => createClaim({ error: null, success: null }, data));
  await trackFixtureClaims();
  assert.equal(result.error, null);
  return result.claimId;
}

async function claimRows(claimId) {
  return (await pool.query(`SELECT (SELECT COUNT(*) FROM public."CLAIM" WHERE "Claim_ID" = $1)::int AS claims,
    (SELECT COUNT(*) FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" = $1)::int AS evidence,
    (SELECT COUNT(*) FROM public."HANDOVER" WHERE "Claim_ID" = $1)::int AS handovers`, [claimId])).rows[0];
}

// DELETE workflow: owner-only, atomic with evidence, blocked after handover,
// and safe when racing a handover on the same found report.
async function withdrawChecks() {
  const open = id - 4;
  const racing = id - 5;
  reports.push(open, racing);
  await pool.query('INSERT INTO public."FOUND_REPORT" ("Found_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name") VALUES ($1, $3, $4, $4, $5), ($2, $3, $4, $4, $5)', [open, racing, users[2], id, 'Regression withdraw item']);

  const claimId = await claimAs(users[0], open);
  for (const description of ['First withdrawal detail', 'Second withdrawal detail']) {
    const evidence = new FormData();
    evidence.set('claimId', String(claimId));
    evidence.set('description', description);
    assert.equal((await sessions.run({ User_ID: users[0] }, () => addClaimEvidence({ error: null, success: null }, evidence))).error, null);
  }
  for (const user of [users[1], users[2]]) {
    assert.equal((await withdraw(user, claimId)).error, 'Claim not found or unavailable to your account.');
  }
  assert.equal((await withdraw(null, claimId)).error, 'Please sign in to withdraw a claim.');
  assert.ok((await withdraw(users[0], 'not-an-id')).error);
  assert.deepEqual(await claimRows(claimId), { claims: 1, evidence: 2, handovers: 0 });

  const withdrawn = await withdraw(users[0], claimId);
  assert.equal(withdrawn.error, null);
  assert.equal(withdrawn.success, 'Claim withdrawn. 2 evidence entries were removed with it.');
  assert.deepEqual(await claimRows(claimId), { claims: 0, evidence: 0, handovers: 0 });
  console.log('PASS withdraw: owner-only DELETE removes the claim and its evidence atomically');

  const handedClaim = await claimAs(users[0], open);
  assert.equal((await submit(users[0], handedClaim)).error, null);
  assert.equal((await withdraw(users[0], handedClaim)).error, 'This claim has a recorded handover and cannot be withdrawn.');
  assert.deepEqual(await claimRows(handedClaim), { claims: 1, evidence: 0, handovers: 1 });
  console.log('PASS withdraw: a claim with a recorded handover cannot be withdrawn');

  // Both transactions wait on the same FOUND_REPORT lock; exactly one wins and no deadlock occurs.
  const raceClaim = await claimAs(users[0], racing);
  const outcomes = await overlapping(racing, [() => withdraw(users[0], raceClaim), () => submit(users[0], raceClaim)]);
  assert.equal(outcomes.filter((result) => result.success && !result.error).length, 1);
  const state = await claimRows(raceClaim);
  assert.ok((state.claims === 0 && state.handovers === 0) || (state.claims === 1 && state.handovers === 1), 'Withdrawal and handover must not both apply');
  console.log('PASS withdraw: overlapping withdrawal and handover serialize on the found-report lock');
}

function editForm(fields) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, String(value));
  return data;
}

// UPDATE workflow and the invalidate_report_embedding trigger.
async function editReportChecks() {
  const lostId = id;
  const vector = `[${Array(384).fill(0.05).join(',')}]`;
  await pool.query(`INSERT INTO public."LOST_REPORT" ("Lost_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description", "Date_Lost", "Embedding")
    VALUES ($1, $2, $3, $3, 'Regression umbrella', 'Black folding umbrella', DATE '2026-09-01', $4::public.vector(384))`, [lostId, users[0], id, vector]);
  const row = async () => (await pool.query(`SELECT "Item_Name", "Description", "Date_Lost"::text AS date,
    "Embedding"::text AS embedding, public.vector_dims("Embedding") AS dims
    FROM public."LOST_REPORT" WHERE "Lost_ID" = $1`, [lostId])).rows[0];
  const original = await row();
  // In Search, the owner's own lost report leads to its possible matches instead of "Found this?".
  const ownSearch = await renderPage('app/search/page.tsx', users[0], { category: String(id), type: 'Lost' });
  assert.ok(ownSearch.includes(`href="/potential-matches?lostId=${lostId}"`) && !ownSearch.includes('Found this? Report it'));
  assert.ok((await renderPage('app/search/page.tsx', users[1], { category: String(id), type: 'Lost' })).includes('Found this? Report it'));

  // The trigger itself: changing the description clears the stored vector,
  // while a date-only change does not. Rolled back so nothing persists.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE public."LOST_REPORT" SET "Date_Lost" = $2::date WHERE "Lost_ID" = $1', [lostId, '2026-09-02']);
    assert.notEqual((await client.query('SELECT "Embedding" FROM public."LOST_REPORT" WHERE "Lost_ID" = $1', [lostId])).rows[0].Embedding, null);
    await client.query('UPDATE public."LOST_REPORT" SET "Description" = $2 WHERE "Lost_ID" = $1', [lostId, 'Changed text']);
    assert.equal((await client.query('SELECT "Embedding" FROM public."LOST_REPORT" WHERE "Lost_ID" = $1', [lostId])).rows[0].Embedding, null);
    await client.query('ROLLBACK');
  } finally { client.release(); }
  assert.deepEqual(await row(), original);
  console.log('PASS trigger: a description UPDATE sets Embedding to NULL; a date-only UPDATE keeps it (rolled back)');

  const base = { kind: 'lost', reportId: lostId, itemName: 'Regression umbrella', description: 'Black folding umbrella', categoryId: id, locationId: id, dateLost: '2026-09-03' };
  const asUser = (userId, fields) => sessions.run({ User_ID: userId }, () => editReport({ error: null, success: null }, editForm(fields)));
  assert.equal((await asUser(users[1], base)).error, 'Report not found or unavailable to your account.');
  assert.equal((await asUser(users[0], { ...base, dateLost: '2999-01-01' })).fieldErrors.dateLost, 'The date cannot be in the future.');
  assert.equal((await asUser(users[0], { ...base, kind: 'other' })).error, 'Choose a valid report.');
  assert.deepEqual(await row(), original);

  assert.equal((await asUser(users[0], base)).error, null);
  const afterDate = await row();
  assert.equal(afterDate.date, '2026-09-03');
  assert.equal(afterDate.embedding, original.embedding, 'Unchanged text keeps the existing vector');

  const retexted = await asUser(users[0], { ...base, description: '  Navy blue folding umbrella with a wooden handle  ' });
  assert.equal(retexted.error, null);
  const afterText = await row();
  assert.equal(afterText.Description, 'Navy blue folding umbrella with a wooden handle');
  assert.equal(afterText.dims, 384);
  assert.notEqual(afterText.embedding, original.embedding, 'Changed text stores a fresh vector in the same transaction');
  console.log('PASS edit: owner-only UPDATE, future-date rejection, vector kept for unchanged text and regenerated for new text');

  const closed = await asUser(users[2], { kind: 'found', reportId: reports[0], itemName: 'Renamed', description: 'Renamed', categoryId: id, locationId: id, dateFound: '2026-09-01' });
  assert.equal(closed.error, 'This item has already been handed over, so its report can no longer be edited.');
  console.log('PASS edit: found reports with a recorded handover are closed for edits');
}

// Database-level integrity constraints (db/constraints.sql). Everything runs in
// one transaction that is rolled back, so no rows persist.
async function constraintChecks() {
  const client = await pool.connect();
  const u = id - 500;
  const attempt = async (label, sql, values, expected) => {
    await client.query('SAVEPOINT attempt');
    try {
      await client.query(sql, values);
      await client.query('RELEASE SAVEPOINT attempt');
      assert.equal(expected, null, `${label}: expected ${expected?.constraint} to reject the row`);
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      if (expected === null) throw error;
      assert.equal(error.code, expected.code, `${label}: SQLSTATE`);
      assert.equal(error.constraint, expected.constraint, `${label}: constraint name`);
    }
  };
  const check = (constraint) => ({ code: '23514', constraint });
  const unique = (constraint) => ({ code: '23505', constraint });
  try {
    await client.query('BEGIN');
    const user = 'INSERT INTO public."USER" ("User_ID", "Email", "Role", "Password_Hash") VALUES ($1, $2, $3, \'UNUSABLE_REGRESSION_FIXTURE\')';
    await attempt('valid USER role', user, [u, `c-${-u}@example.invalid`, 'USER'], null);
    await attempt('NULL role allowed (approved nullability)', user, [u - 1, null, null], null);
    await attempt('second NULL email allowed', user, [u - 2, null, 'ADMIN'], null);
    await attempt('unknown role', user, [u - 3, null, 'SUPERUSER'], check('USER_Role_check'));
    await attempt('lower-case role', user, [u - 3, null, 'admin'], check('USER_Role_check'));
    await attempt('duplicate email', user, [u - 3, `c-${-u}@example.invalid`, 'USER'], unique('USER_Email_key'));

    const report = (table, key) => `INSERT INTO public."${table}" ("${key}", "User_ID", "Category_ID", "Location_ID", "Item_Name") VALUES ($1, $2, $3, $3, $4)`;
    for (const [table, key] of [['LOST_REPORT', 'Lost_ID'], ['FOUND_REPORT', 'Found_ID']]) {
      await attempt(`${table} valid name`, report(table, key), [u, u, id, 'Umbrella'], null);
      await attempt(`${table} NULL name allowed`, report(table, key), [u - 1, u, id, null], null);
      for (const blank of ['', '   ']) {
        await attempt(`${table} blank name`, report(table, key), [u - 2, u, id, blank], check(`${table}_Item_Name_check`));
      }
    }

    const claim = 'INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID") VALUES ($1, $2, $3)';
    await attempt('first claim', claim, [u, u - 2, u], null);
    await attempt('same user claims same item twice', claim, [u - 1, u - 2, u], unique('CLAIM_User_ID_Found_ID_key'));
    await attempt('another user may claim the same item', claim, [u - 1, u - 1, u], null);

    const evidence = 'INSERT INTO public."CLAIM_EVIDENCE" ("Claim_ID", "Evidence_No") VALUES ($1, $2)';
    await attempt('evidence number 1', evidence, [u, 1], null);
    for (const bad of [0, -1]) await attempt(`evidence number ${bad}`, evidence, [u, bad], check('CLAIM_EVIDENCE_Evidence_No_check'));
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  console.log('PASS constraints: role, email, item-name, evidence-number and one-claim-per-user rules reject invalid rows and accept valid ones (rolled back)');
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
    await constraintChecks();

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
    const { getFoundReportContext } = loadProduction('lib/found-report-context.ts');
    assert.ok((await getFoundReportContext(reports, users[0])).every((row) => row.Has_Handover));
    await withdrawChecks();
    await editReportChecks();
    if (process.argv.includes('--browser')) {
      const { runBrowserChecks } = await import('./polish-browser.mjs');
      await runBrowserChecks({ users, reports, id, pool });
    }
  } finally {
    if (fixturesCreated) await transaction(async (client) => {
      // Rediscover in finally as well: an action/assertion may fail before the
      // normal tracking call. Delete dependents before all tracked claims.
      await trackFixtureClaims(client);
      const claimIds = [...cleanupClaimIds];
      await client.query('DELETE FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" = ANY($1::int[])', [claimIds]);
      await client.query('DELETE FROM public."HANDOVER" WHERE "Claim_ID" = ANY($1::int[])', [claimIds]);
      await client.query('DELETE FROM public."CLAIM" WHERE "Claim_ID" = ANY($1::int[])', [claimIds]);
      await client.query('DELETE FROM public."LOST_REPORT" WHERE "User_ID" = ANY($1::int[])', [users]);
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
  // Report the failing test line (not data) to make failures actionable.
  const where = error.stack?.split('\n').find((line) => /[\\/]tests[\\/]/.test(line)) ?? '';
  console.error(`FAIL: ${error.message}${where}`);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
  if (globalThis.postgresPool) await globalThis.postgresPool.end();
});
