// Optional real-browser coverage: node tests/handover.mjs --browser
// Requires an existing production server at POLISH_BASE_URL (default :3102)
// and an isolated Chrome debugging endpoint at POLISH_BROWSER_URL (:9224).
// Uses only temporary users/reports owned and cleaned up by handover.mjs.
import assert from 'node:assert/strict';
import { sealData } from 'iron-session';
import { randomBytes } from 'node:crypto';
import { hash, argon2id } from 'argon2';

export async function runBrowserChecks({ users, id, pool }) {
  const base = process.env.POLISH_BASE_URL ?? 'http://127.0.0.1:3102';
  const endpoint = process.env.POLISH_BROWSER_URL ?? 'http://127.0.0.1:9224';
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local test server');
  const version = await (await fetch(`${endpoint}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  let sessionId;
  let targetId;
  const pending = new Map();
  ws.onmessage = (event) => {
    const result = JSON.parse(event.data);
    const request = pending.get(result.id);
    if (!request) return;
    pending.delete(result.id);
    if (result.error) request.reject(new Error(result.error.message));
    else request.resolve(result.result);
  };
  function call(method, params = {}, session = sessionId) {
    const requestId = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      ws.send(JSON.stringify({ id: requestId, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!result.exceptionDetails, 'Browser evaluation must succeed');
    return result.result.value;
  }
  async function until(expression, message, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(message);
  }
  async function visit(route) {
    await call('Page.navigate', { url: `${base}${route}` });
    await until(`location.href === ${JSON.stringify(base + route)} && document.readyState === 'complete'`, `Page did not load: ${route}`);
    // Wait for React's delegated listeners before exercising controlled inputs.
    await until(`Object.keys(document.querySelector('main') ?? {}).some(key => key.startsWith('__reactFiber'))`, 'React did not hydrate');
  }
  async function session(userId) {
    await call('Network.deleteCookies', { name: 'smart_lost_found_session', url: base });
    if (userId !== null) {
      const value = await sealData({ User_ID: userId }, { password: process.env.SESSION_SECRET, ttl: 3600 });
      await call('Network.setCookie', { name: 'smart_lost_found_session', value, url: base, httpOnly: true, sameSite: 'Lax' });
    }
  }
  async function fill(field, value) {
    await evaluate(`(() => {
      const input = document.getElementById(${JSON.stringify(field)});
      const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    })()`);
  }
  async function submit(feedback) {
    await evaluate(`document.querySelector('button[type=submit]').click()`);
    await until(`document.querySelector('[role=status]')?.textContent.includes(${JSON.stringify(feedback)}) && !document.querySelector('button[type=submit]')?.disabled`, `Expected submission feedback: ${feedback}`, 120000);
  }
  const valueOf = (field) => evaluate(`document.getElementById(${JSON.stringify(field)})?.value`);
  const name = (`P${-id}`).padEnd(100, 'x');
  try {
    targetId = (await call('Target.createTarget', { url: 'about:blank' }, null)).targetId;
    sessionId = (await call('Target.attachToTarget', { targetId, flatten: true }, null)).sessionId;
    await call('Page.enable');
    await call('Network.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await session(null);
    await visit('/');
    assert.ok(await evaluate(`!!document.querySelector('a[href="/login"]') && !document.body.textContent.includes('Sign Out')`));
    await visit('/login');
    await fill('email', `absent-${-id}@example.invalid`);
    await fill('password', 'invalid-test-value');
    await submit('Invalid email or password');
    assert.equal(await valueOf('email'), `absent-${-id}@example.invalid`);
    assert.equal(await valueOf('password'), '');

    // Only this run's temporary account receives credentials; finally cleanup
    // in handover.mjs removes it and compares all ten tables exactly.
    const password = randomBytes(24).toString('base64url');
    const email = `polish-${-id}@example.invalid`;
    await pool.query('UPDATE public."USER" SET "Email"=$1, "Password_Hash"=$2 WHERE "User_ID"=$3', [email, await hash(password, { type: argon2id }), users[0]]);
    for (const route of ['/lost-report', '/found-report', '/potential-matches', '/claim', '/claim/evidence', '/claim/handover', '/admin/campus-summary']) {
      await call('Page.navigate', { url: `${base}${route}` });
      await until(`location.pathname === '/login' && document.readyState === 'complete'`, `Protected route allowed anonymous access: ${route}`);
    }
    await visit('/login');
    await fill('email', email);
    await fill('password', password);
    await evaluate(`document.querySelector('button[type=submit]').click()`);
    await until(`location.pathname === '/' && document.body.textContent.includes('Sign Out')`, 'Valid password login must create a working session');
    assert.ok(await evaluate(`document.body.textContent.includes('USER account')`));
    assert.ok(await evaluate(`!document.querySelector('a[href="/admin/campus-summary"]')`));
    await visit('/admin/campus-summary');
    assert.ok(await evaluate(`document.body.textContent.includes('Access denied') && !document.querySelector('dl[aria-label="Campus totals"]')`));
    await visit('/');
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Sign Out').click()`);
    await until(`location.pathname === '/login' && document.readyState === 'complete'`, 'Sign Out must return to Sign In');
    const cookies = (await call('Network.getCookies', { urls: [base] })).cookies;
    assert.ok(!cookies.some(cookie => cookie.name === 'smart_lost_found_session' && cookie.value), 'Sign Out must clear the session');
    await session(users[2]);
    await visit('/');
    assert.ok(await evaluate(`document.body.textContent.includes('ADMIN account')`));
    assert.ok(await evaluate(`!!document.querySelector('a[href="/admin/campus-summary"]')`));
    await visit('/admin/campus-summary');
    const expectedTotals = {};
    for (const [table, label] of [['LOST_REPORT', 'Total lost reports'], ['FOUND_REPORT', 'Total found reports'], ['CLAIM', 'Total claims'], ['HANDOVER', 'Total handovers']]) {
      expectedTotals[label] = (await pool.query(`SELECT COUNT(*)::text AS count FROM public."${table}"`)).rows[0].count;
    }
    assert.deepEqual(await evaluate(`Object.fromEntries([...document.querySelectorAll('dl[aria-label="Campus totals"] > div')].map(card => [card.querySelector('dt').textContent, card.querySelector('dd').textContent.replaceAll(',', '')]))`), expectedTotals);
    for (const [dimension, key, title] of [['CATEGORY', 'Category_ID', 'Reports by Category'], ['LOCATION', 'Location_ID', 'Reports by Location']]) {
      const expected = (await pool.query(`SELECT d."${key}" AS id,
        (SELECT COUNT(*) FROM public."LOST_REPORT" r WHERE r."${key}"=d."${key}")::text AS lost,
        (SELECT COUNT(*) FROM public."FOUND_REPORT" r WHERE r."${key}"=d."${key}")::text AS found
        FROM public."${dimension}" d ORDER BY d."${key}"`)).rows.map(row => ({ ...row, total: String(BigInt(row.lost)+BigInt(row.found)) }));
      const shown = await evaluate(`Array.from(document.querySelector('table[aria-label="${title}"]').tBodies[0].rows).map(row => ({ id: Number(row.dataset.groupId), lost: row.cells[1].textContent.replaceAll(',', ''), found: row.cells[2].textContent.replaceAll(',', ''), total: row.cells[3].textContent.replaceAll(',', '') })).sort((a,b) => a.id-b.id)`);
      assert.deepEqual(shown, expected);
    }
    const expectedActivity = (await pool.query(`SELECT id, type, item, date::text FROM (
      SELECT "Lost_ID" AS id, 'Lost' AS type, "Item_Name" AS item, "Date_Lost" AS date FROM public."LOST_REPORT"
      UNION ALL SELECT "Found_ID", 'Found', "Item_Name", "Date_Found" FROM public."FOUND_REPORT") reports
      ORDER BY date DESC NULLS LAST, id DESC, type ASC LIMIT $1`, [10])).rows;
    assert.deepEqual(await evaluate(`Array.from(document.querySelector('table[aria-label="Recent Campus Activity"]').tBodies[0].rows).map(row => ({ id: Number(row.dataset.reportId), type: row.dataset.reportType, item: row.cells[0].textContent, date: row.cells[4].textContent === 'Date not supplied' ? null : row.cells[4].textContent }))`), expectedActivity.map(row => ({...row, item: row.item ?? 'Unnamed item'})));
    console.log('PASS browser: category/location tables and recent activity agree with independent PostgreSQL queries');
    for (const width of [320, 390, 768, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      assert.ok(await evaluate(`document.documentElement.scrollWidth <= ${width}`), `Campus Summary overflow at ${width}px`);
    }
    console.log('PASS browser: ADMIN-only navigation and live totals, USER denial, and responsive Campus Summary');
    console.log('PASS browser: real Argon2id login, session creation, logout cookie clearing, all protected routes, and server-loaded USER/ADMIN labels');

    const saved = {};
    for (const [kind, userId] of [['lost', users[0]], ['found', users[1]]]) {
      await session(userId);
      await visit(`/${kind}-report`);
      const date = kind === 'lost' ? 'dateLost' : 'dateFound';
      await fill('itemName', '   ');
      await fill('description', 'Blue university notebook with a silver star on the cover.');
      await fill('categoryId', String(id));
      await fill('locationId', String(id));
      await fill(date, '2026-10-01');
      await submit('Please correct the highlighted fields.');
      assert.equal(await valueOf('description'), 'Blue university notebook with a silver star on the cover.');
      assert.equal(await valueOf('categoryId'), String(id));
      assert.equal(await valueOf(date), '2026-10-01');
      assert.equal(await evaluate(`document.querySelector('#itemName').getAttribute('aria-invalid')`), 'true');
      await fill('itemName', name);
      await session(null);
      await submit('Please sign in');
      assert.equal(await valueOf('itemName'), name);
      await session(userId);
      await submit('report submitted successfully.');
      for (const field of ['itemName', 'description', 'categoryId', 'locationId', date]) assert.equal(await valueOf(field), '');
      const key = kind === 'lost' ? 'Lost_ID' : 'Found_ID';
      const rows = (await pool.query(`SELECT "${key}" AS id, public.vector_dims("Embedding") AS dimensions FROM public."${kind.toUpperCase()}_REPORT" WHERE "User_ID"=$1 AND "Item_Name"=$2`, [userId, name])).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].dimensions, 384);
      saved[kind] = rows[0].id;
      if (kind === 'lost') assert.ok(await evaluate(`!!document.querySelector('a[href="/potential-matches?lostId=${saved.lost}"]')`));
      console.log(`PASS browser: ${kind} draft preserved on validation/session failure; success clears fields and saves a real 384-dimensional embedding`);
    }

    await session(users[0]);
    await visit(`/search?type=Found&text=${name}`);
    assert.ok(await evaluate(`!!document.querySelector('a[href="/claim?foundId=${saved.found}#submit-claim"]')`));
    await visit(`/potential-matches?lostId=${saved.lost}`);
    const ranking = (await pool.query('SELECT "Found_ID" FROM public.find_potential_matches($1,10)', [saved.lost])).rows.map((row) => row.Found_ID);
    const displayed = await evaluate(`[...document.querySelectorAll('article')].map(article => Number(article.textContent.match(/Found Report ID: (-?[0-9]+)/)[1]))`);
    assert.deepEqual(displayed, ranking);
    await visit(`/claim?foundId=${saved.found}`);
    assert.equal(await valueOf('foundId'), String(saved.found));
    await submit('Claim submitted successfully.');
    assert.ok(!(await evaluate(`document.querySelector('[role=alert]')?.textContent`)), 'Successful preselected claim must not show an ineligibility warning');
    const claimId = (await pool.query('SELECT "Claim_ID" FROM public."CLAIM" WHERE "User_ID"=$1 AND "Found_ID"=$2', [users[0], saved.found])).rows[0].Claim_ID;
    assert.ok(await evaluate(`!!document.querySelector('#claim-${claimId}')`));
    await visit(`/claim/evidence?claimId=${claimId}`);
    await fill('description', 'Temporary private ownership proof.');
    await session(null);
    await submit('Please sign in');
    assert.equal(await valueOf('description'), 'Temporary private ownership proof.');
    assert.equal(await valueOf('claimId'), String(claimId));
    await session(users[0]);
    await fill('description', '   ');
    await submit('Choose a valid claim');
    assert.equal(await valueOf('description'), '   ');
    await fill('description', 'Temporary private ownership proof.');
    await submit('Claim evidence added successfully.');
    assert.equal(await valueOf('description'), '');
    assert.equal(await valueOf('claimId'), String(claimId));
    await visit(`/claim/evidence?claimId=${claimId}`);
    assert.ok(await evaluate(`document.querySelector('#evidence-${claimId}').textContent.includes('Temporary private ownership proof.')`));
    await visit(`/claim/handover?claimId=${claimId}`);
    await fill('signature', '   ');
    await submit('Choose a valid claim');
    assert.equal(await valueOf('signature'), '   ');
    assert.equal(await valueOf('claimId'), String(claimId));
    await fill('signature', 'Test acknowledgement');
    await submit('Item receipt recorded successfully.');
    assert.equal(await valueOf('signature'), undefined, 'No unusable receipt fields after last eligible handover');
    await visit('/claim');
    assert.ok(await evaluate(`document.querySelector('#claim-${claimId}').textContent.includes('Receipt recorded')`));
    console.log('PASS browser: contextual claims, preserved evidence/handover drafts, successful clearing, live history and receipt refresh, unchanged vector ranking');

    for (const width of [320, 390, 768, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      for (const route of ['/', '/login', '/lost-report', '/found-report', '/search', `/potential-matches?lostId=${saved.lost}`, '/claim', '/claim/evidence', '/claim/handover']) {
        await visit(route);
        assert.ok(await evaluate(`document.documentElement.scrollWidth <= ${width}`), `Horizontal overflow: ${route} at ${width}px`);
      }
    }
    console.log('PASS browser: all nine routes at 320/390/768/1440px including real 100-character unbroken item names');
  } finally {
    if (targetId) await call('Target.closeTarget', { targetId }, null);
    ws.close();
  }
}
