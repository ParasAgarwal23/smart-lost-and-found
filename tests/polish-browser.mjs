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
    assert.ok(!result.exceptionDetails, `Browser evaluation must succeed: ${result.exceptionDetails?.exception?.description?.split('\n')[0]} in ${expression.trim().slice(0, 140)}`);
    return result.result.value;
  }
  async function until(expression, message, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      // Mid-navigation the old document can disappear (e.g. document.body is
      // briefly null), so a failed evaluation means "not yet", not a failure.
      if (await evaluate(expression).catch(() => false)) return;
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
  let lastField = null;
  async function fill(field, value) {
    lastField = field;
    await evaluate(`(() => {
      const input = document.getElementById(${JSON.stringify(field)});
      const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    })()`);
  }
  const formOf = (field) => `document.getElementById(${JSON.stringify(field)})?.form`;
  async function submit(feedback, field = lastField) {
    await evaluate(`${formOf(field)}.querySelector('button[type=submit]').click()`);
    // The form may unmount its field after success, so keep a handle to it.
    await evaluate(`(window.__activeForm = ${formOf(field)}, true)`);
    await until(`window.__activeForm?.querySelector('[role=status]')?.textContent.includes(${JSON.stringify(feedback)}) && !window.__activeForm?.querySelector('button[type=submit]')?.disabled`, `Expected submission feedback: ${feedback}`, 120000);
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
    const recentLinks = await evaluate(`[...document.querySelectorAll('section[aria-labelledby="recent-heading"] li > a')].map(a => a.getAttribute('href'))`);
    assert.ok(recentLinks.length > 0 && recentLinks.every((href) => href.startsWith('/search?type=Found')), 'Every recently found item must open the found-item search');
    for (const width of [1024, 1280, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      // The subtitle's last word must share a line with the word before it.
      assert.ok(await evaluate(`(() => {
        const text = [...document.querySelectorAll('main p')].find(p => p.textContent.startsWith('Search everything')).firstChild;
        const at = (word) => { const range = document.createRange(); const start = text.data.lastIndexOf(word); range.setStart(text, start); range.setEnd(text, start + word.length); return range.getBoundingClientRect().top; };
        return Math.abs(at('found.') - at(' or ')) < 2;
      })()`), `Home subtitle leaves its last word alone at ${width}px`);
    }
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
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
    for (const route of ['/lost-report', '/found-report', '/my-reports', '/my-reports/edit?type=lost&id=1', '/potential-matches', '/claim', '/claim/evidence', '/claim/handover', '/admin/campus-summary']) {
      await call('Page.navigate', { url: `${base}${route}` });
      await until(`location.pathname === '/login' && document.readyState === 'complete'`, `Protected route allowed anonymous access: ${route}`);
      if (!route.includes('?')) assert.equal(await evaluate('location.search'), `?next=${encodeURIComponent(route)}`, `Sign-in must remember ${route}`);
    }
    await call('Page.navigate', { url: `${base}/lost-report` });
    await until(`location.pathname === '/login' && document.body.textContent.includes('Sign in to report a lost item.')`, 'Sign-in must explain why it is needed');
    await visit('/login');
    await fill('email', email);
    await fill('password', password);
    await evaluate(`${formOf('password')}.querySelector('button[type=submit]').click()`);
    // The header updates before the streamed page body; wait for the signed-in workspace too.
    await until(`location.pathname === '/' && document.body.textContent.includes('Sign Out') && !!document.querySelector('main .account-label')`, 'Valid password login must create a working session');
    assert.ok(await evaluate(`document.body.textContent.includes('USER account')`));
    assert.ok(await evaluate(`!document.querySelector('a[href="/admin/campus-summary"]')`));
    await visit('/admin/campus-summary');
    assert.ok(await evaluate(`document.body.textContent.includes('Access denied') && !document.querySelector('dl[aria-label="Campus totals"]')`));
    await visit('/');
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Sign Out').click()`);
    await until(`location.pathname === '/login' && document.readyState === 'complete'`, 'Sign Out must return to Sign In');
    const cookies = (await call('Network.getCookies', { urls: [base] })).cookies;
    assert.ok(!cookies.some(cookie => cookie.name === 'smart_lost_found_session' && cookie.value), 'Sign Out must clear the session');
    await visit('/login?next=%2Fmy-reports');
    await fill('email', email);
    await fill('password', password);
    await evaluate(`${formOf('password')}.querySelector('button[type=submit]').click()`);
    await until(`location.pathname === '/my-reports' && document.readyState === 'complete'`, 'Login must return to the page that required it');
    await session(null);
    await visit('/login?next=https%3A%2F%2Fexample.com');
    await fill('email', email);
    await fill('password', password);
    await evaluate(`${formOf('password')}.querySelector('button[type=submit]').click()`);
    await until(`location.origin === ${JSON.stringify(base)} && location.pathname === '/'`, 'An external next value must be ignored');
    console.log('PASS browser: sign-in explains why it is needed, returns to the requested page, and ignores external redirects');
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
    assert.deepEqual(await evaluate(`Array.from(document.querySelector('table[aria-label="Recent Campus Activity"]').tBodies[0].rows).map(row => ({ id: Number(row.dataset.reportId), type: row.dataset.reportType, item: row.cells[0].textContent, date: row.cells[4].querySelector('time')?.dateTime ?? null }))`), expectedActivity.map(row => ({...row, item: row.item ?? 'Unnamed item'})));
    console.log('PASS browser: category/location tables and recent activity agree with independent PostgreSQL queries');
    // Desktop widths, plus 320px = a 1280px window at 400% zoom (WCAG 1.4.10 reflow).
    for (const width of [320, 1024, 1280, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
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
    // Filters apply on change: switching Lost/Found reloads results without pressing Search.
    // Re-dispatching while the request is in flight also exercises the duplicate-request guard.
    await until(`location.search.includes('type=Lost') || (document.querySelector('input[name=type][value=Lost]').click(), false)`, 'Changing the Lost/Found switch must apply the filter');
    await until(`document.readyState === 'complete' && !!document.querySelector('input[name=type][value=Lost]')?.checked && !document.querySelector('a[href="/claim?foundId=${saved.found}#submit-claim"]')`, 'Filtered results must replace the previous results');
    assert.ok(await evaluate(`new URLSearchParams(location.search).get('text') === ${JSON.stringify(name)}`), 'Keywords must be kept when a filter changes');

    // Long descriptions are clamped with a Show more / Show less toggle; short ones have none.
    const longFound = id - 7;
    const longText = `Expandable ${-id}. ` + 'A detailed description that keeps going so it cannot fit in three lines. '.repeat(12) + 'Final detail: initials under the lid.';
    await pool.query('INSERT INTO public."FOUND_REPORT" ("Found_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description") VALUES ($1, $2, $3, $3, $4, $5)', [longFound, users[1], id, 'Browser long description item', longText]);
    await visit(`/search?type=Found&text=Expandable%20${-id}`);
    await until(`[...document.querySelectorAll('main article button')].some(b => b.textContent === 'Show more')`, 'A clamped description must offer Show more');
    await evaluate(`[...document.querySelectorAll('main article button')].find(b => b.textContent === 'Show more').click()`);
    await until(`(() => { const b = [...document.querySelectorAll('main article button')].find(b => b.textContent === 'Show less'); const p = b?.parentElement.querySelector('p'); return b?.getAttribute('aria-expanded') === 'true' && p.textContent.endsWith('initials under the lid.') && p.scrollHeight <= p.clientHeight + 1; })()`, 'Show more must reveal the whole description');
    await visit(`/search?type=Found&text=${name}`);
    assert.ok(await evaluate(`![...document.querySelectorAll('main article button')].some(b => b.textContent === 'Show more')`), 'Short descriptions must not show a toggle');

    await visit(`/potential-matches?lostId=${saved.lost}`);
    const ranking = (await pool.query('SELECT "Found_ID", "Cosine_Similarity" FROM public.find_potential_matches($1,10)', [saved.lost])).rows;
    const displayed = await evaluate(`[...document.querySelectorAll('article[data-found-id]')].map(article => Number(article.dataset.foundId))`);
    assert.deepEqual(displayed, ranking.map((row) => row.Found_ID));
    const best = ranking.reduce((top, row) => (!top || row.Cosine_Similarity > top.Cosine_Similarity ? row : top), undefined);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('article[data-found-id]')].filter(article => article.textContent.includes('Best match')).map(article => Number(article.dataset.foundId))`), best ? [best.Found_ID] : [], 'Exactly the highest-similarity result is labelled Best match');
    assert.ok(await evaluate(`![...document.querySelectorAll('main button')].some(button => button.textContent === 'Show matches')`), 'Choosing a report replaces the Show matches button');
    await visit('/potential-matches');
    await until(`location.search === '?lostId=${saved.lost}' || (() => { const select = document.getElementById('lostId'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '${saved.lost}'); select.dispatchEvent(new Event('change', { bubbles: true })); return false; })()`, 'Choosing a lost report must load its matches');
    await until(`document.readyState === 'complete' && document.querySelectorAll('article[data-found-id]').length === ${ranking.length}`, 'Matches must load for the chosen report');
    console.log('PASS browser: filters and lost-report choice apply on change, full descriptions expand, and Best match marks the top score');
    await visit(`/claim?foundId=${saved.found}`);
    assert.equal(await valueOf('foundId'), String(saved.found));
    await submit('Claim submitted successfully.', 'foundId');
    assert.ok(!(await evaluate(`document.querySelector('[role=alert]')?.textContent`)), 'Successful preselected claim must not show an ineligibility warning');
    const claimId = (await pool.query('SELECT "Claim_ID" FROM public."CLAIM" WHERE "User_ID"=$1 AND "Found_ID"=$2', [users[0], saved.found])).rows[0].Claim_ID;
    assert.ok(await evaluate(`!!document.querySelector('#claim-${claimId}')`));
    await visit(`/claim/evidence?claimId=${claimId}`);
    assert.ok(await evaluate(`document.getElementById('claimId')?.type === 'hidden' && document.querySelector('[aria-labelledby="claimId-label"]').textContent.includes('claimed')`), 'A claim chosen on the previous page is shown, not asked for again');
    assert.ok(await evaluate(`!/[(]claim -?[0-9]+[)]/.test(document.querySelector('main').textContent)`), 'No internal claim IDs in labels');
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
    assert.ok(await evaluate(`(() => { const text = document.querySelector('main').textContent; return !text.includes('You have no claims waiting') && !text.includes('Before you confirm') && [...document.querySelectorAll('main a')].some(a => a.textContent === 'Back to My Claims' && a.classList.contains('btn')); })()`), 'Handover success must show only the success message and the way back');
    await visit('/claim');
    assert.ok(await evaluate(`document.querySelector('#claim-${claimId}').textContent.includes('Receipt recorded')`));
    console.log('PASS browser: contextual claims, preserved evidence/handover drafts, successful clearing, live history and receipt refresh, unchanged vector ranking');

    // Withdraw through the UI. The fixture report belongs to this run's user,
    // so handover.mjs cleanup discovers and removes it and any claim on it.
    const withdrawFound = id - 6;
    await pool.query('INSERT INTO public."FOUND_REPORT" ("Found_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name") VALUES ($1, $2, $3, $3, $4)', [withdrawFound, users[1], id, 'Browser withdrawal item']);
    await visit(`/claim?foundId=${withdrawFound}`);
    await submit('Claim submitted successfully.', 'foundId');
    const withdrawClaimId = (await pool.query('SELECT "Claim_ID" FROM public."CLAIM" WHERE "Found_ID" = $1', [withdrawFound])).rows[0].Claim_ID;
    await evaluate(`[...document.querySelectorAll('#claim-${withdrawClaimId} button')].find((button) => button.textContent === 'Withdraw claim').click()`);
    await until(`!!document.querySelector('#claim-${withdrawClaimId} input[name=claimId]')`, 'Withdraw must ask for confirmation first');
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM public."CLAIM" WHERE "Claim_ID" = $1', [withdrawClaimId])).rows[0].count, 1, 'Opening the confirmation must not delete anything');
    await evaluate(`document.querySelector('#claim-${withdrawClaimId} button[type=submit]').click()`);
    await until(`!document.querySelector('#claim-${withdrawClaimId}') && [...document.querySelectorAll('main [role=status]')].some((region) => region.textContent.includes('Claim withdrawn.'))`, 'Withdrawn claim must disappear with a visible confirmation');
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM public."CLAIM" WHERE "Claim_ID" = $1', [withdrawClaimId])).rows[0].count, 0);
    console.log('PASS browser: withdrawal needs confirmation, deletes the claim, removes its card and announces the result');

    // Desktop widths, plus 320px = a 1280px window at 400% zoom (WCAG 1.4.10 reflow).
    for (const width of [320, 1024, 1280, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      for (const route of ['/', '/login', '/lost-report', '/found-report', '/search', `/potential-matches?lostId=${saved.lost}`, '/claim', '/claim/evidence', '/claim/handover', '/my-reports', `/my-reports/edit?type=lost&id=${saved.lost}`, '/missing-page']) {
        await visit(route);
        assert.ok(await evaluate(`document.documentElement.scrollWidth <= ${width}`), `Horizontal overflow: ${route} at ${width}px`);
      }
    }
    console.log('PASS browser: all twelve routes (including My Reports, Edit and 404) at 1024/1280/1440px and 400% zoom (320px) including real 100-character unbroken item names');
  } finally {
    if (targetId) await call('Target.closeTarget', { targetId }, null);
    ws.close();
  }
}
