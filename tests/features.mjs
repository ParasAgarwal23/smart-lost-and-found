// Feature tests for registration, report deletion (vector DELETE), vector
// CREATE/READ/UPDATE, campus analytics and semantic search, through the
// production Server Actions and pages running as lf_web / lf_admin_web.
// Run with npm test (isolated database smart_lost_found_test only). Fixtures
// are created and removed through the owner connection, and all ten tables
// are compared with their pre-test contents. Uses the real embedding model.
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { assertIsolated, closePools, expectRedirect, loadProduction, pool, renderPage, sessions, watchdog } from './support.mjs';

watchdog(600);
const tables = ['USER', 'CATEGORY', 'LOCATION', 'LOST_REPORT', 'FOUND_REPORT',
  'FOUND_PHOTOS', 'MATCHES', 'CLAIM', 'CLAIM_EVIDENCE', 'HANDOVER'];
const id = -randomInt(100000, 1000000000);
const [A, B, ADMIN] = [id, id - 1, id - 2];
const [phoneFound, ownFound, claimedFound, contestedFound] = [id, id - 1, id - 2, id - 3];
const [phoneLost, bottleLost] = [id, id - 1];
const [claimOnClaimed, claimContestedB, claimContestedAdmin] = [id, id - 1, id - 2];
const registeredEmail = `feature-register${-id}@example.invalid`;
let createdLostId;

const { generateEmbedding } = loadProduction('lib/embedding.ts');
const { register } = loadProduction('app/actions/register.ts');
const { authenticateUser } = loadProduction('lib/auth.ts');
const { deleteReport } = loadProduction('app/actions/report-delete.ts');
const { createLostReport } = loadProduction('app/actions/lost-report.ts');
const { editReport } = loadProduction('app/actions/report-edit.ts');
const { semanticSearch } = loadProduction('lib/semantic-search.ts');
const { searchReports } = loadProduction('lib/search.ts');
const { adminQuery } = loadProduction('lib/admin-db.ts');

async function snapshot() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const contents = {};
    for (const table of tables) contents[table] = (await client.query(`SELECT row_to_json(t)::text AS row FROM public."${table}" t ORDER BY 1`)).rows.map((r) => r.row);
    await client.query('COMMIT');
    return contents;
  } finally { client.release(); }
}

const vector = async (name, description) => JSON.stringify(await generateEmbedding(name, description));
const form = (fields) => { const data = new FormData(); for (const [k, v] of Object.entries(fields)) data.set(k, String(v)); return data; };

async function createFixtures() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO public."USER" ("User_ID", "Name", "Role", "Password_Hash") VALUES
      ($1, 'Feature A', 'USER', 'UNUSABLE_REGRESSION_FIXTURE'), ($2, 'Feature B', 'USER', 'UNUSABLE_REGRESSION_FIXTURE'),
      ($3, 'Feature admin', 'ADMIN', 'UNUSABLE_REGRESSION_FIXTURE')`, [A, B, ADMIN]);
    await client.query('INSERT INTO public."CATEGORY" VALUES ($1, $2)', [id, 'Feature category']);
    await client.query('INSERT INTO public."LOCATION" VALUES ($1, $2, $3)', [id, 'Feature location', 'Feature building']);
    const found = [
      [phoneFound, B, 'Black mobile with blue case', 'Mobile phone recovered from a reading table. Dark blue rubber cover with a silver star decal.', 2],
      [ownFound, A, 'Grey umbrella', 'Folding grey umbrella with a wooden handle left at the bus stop.', 3],
      [claimedFound, A, 'Red pencil case', 'Red zip pencil case with three pens and an eraser inside.', 4],
      [contestedFound, A, 'Silver wristwatch', 'Silver analogue wristwatch with a metal strap and a scratched face.', 5],
    ];
    for (const [fid, owner, name, description, daysAgo] of found) {
      await client.query(`INSERT INTO public."FOUND_REPORT" ("Found_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description", "Date_Found", "Embedding")
        VALUES ($1, $2, $3, $3, $4, $5, CURRENT_DATE - $6::int, $7::public.vector(384))`, [fid, owner, id, name, description, daysAgo, await vector(name, description)]);
    }
    const lost = [
      [phoneLost, A, 'Phone in navy cover', 'Black smartphone in a navy silicone case with a small silver star sticker.', 3],
      [bottleLost, B, 'Steel water bottle', 'Stainless steel bottle with a green lid and a compass sticker.', 6],
    ];
    for (const [lid, owner, name, description, daysAgo] of lost) {
      await client.query(`INSERT INTO public."LOST_REPORT" ("Lost_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description", "Date_Lost", "Embedding")
        VALUES ($1, $2, $3, $3, $4, $5, CURRENT_DATE - $6::int, $7::public.vector(384))`, [lid, owner, id, name, description, daysAgo, await vector(name, description)]);
    }
    await client.query('INSERT INTO public."FOUND_PHOTOS" VALUES ($1, $2)', [ownFound, '/feature/umbrella.jpg']);
    await client.query('INSERT INTO public."MATCHES" ("Lost_ID", "Found_ID", "Match_Date") VALUES ($1, $2, CURRENT_DATE), ($3, $4, CURRENT_DATE)', [phoneLost, phoneFound, bottleLost, ownFound]);
    await client.query(`INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID") VALUES ($1, $4, $5), ($2, $4, $6), ($3, $7, $6)`,
      [claimOnClaimed, claimContestedB, claimContestedAdmin, B, claimedFound, contestedFound, ADMIN]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function removeFixtures() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claims = (await client.query('SELECT "Claim_ID" FROM public."CLAIM" WHERE "User_ID" IN ($1, $2, $3)', [A, B, ADMIN])).rows.map((r) => r.Claim_ID);
    await client.query('DELETE FROM public."HANDOVER" WHERE "Claim_ID" = ANY($1::int[])', [claims]);
    await client.query('DELETE FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" = ANY($1::int[])', [claims]);
    await client.query('DELETE FROM public."CLAIM" WHERE "Claim_ID" = ANY($1::int[])', [claims]);
    await client.query('DELETE FROM public."LOST_REPORT" WHERE "User_ID" IN ($1, $2, $3)', [A, B, ADMIN]);
    await client.query('DELETE FROM public."FOUND_REPORT" WHERE "User_ID" IN ($1, $2, $3)', [A, B, ADMIN]);
    await client.query('DELETE FROM public."LOCATION" WHERE "Location_ID" = $1', [id]);
    await client.query('DELETE FROM public."CATEGORY" WHERE "Category_ID" = $1', [id]);
    await client.query('DELETE FROM public."USER" WHERE "User_ID" IN ($1, $2, $3) OR "Email" IN ($4, $5)', [A, B, ADMIN, registeredEmail, `x${registeredEmail}`]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function registrationChecks() {
  const password = `Feature-${-id}-passphrase`;
  const valid = { name: '  Asha Registered  ', email: `  ${registeredEmail.toUpperCase()} `, phone: '+91 98765-43210', password, confirmPassword: password };
  const attempt = (fields) => sessions.run(null, () => register({ error: null }, form(fields)));
  // A forged role field is ignored: there is no role input and the database inserts 'USER'.
  assert.equal(await expectRedirect(attempt({ ...valid, role: 'ADMIN', Role: 'ADMIN' })), '/login?registered=1');
  const row = (await pool.query('SELECT "User_ID", "Name", "Email", "Phone", "Role", "Password_Hash" FROM public."USER" WHERE "Email" = $1', [registeredEmail])).rows[0];
  assert.ok(row, 'The account exists');
  assert.equal(row.Role, 'USER');
  assert.equal(row.Name, 'Asha Registered');
  assert.equal(row.Email, registeredEmail, 'Email stored trimmed and lower-case');
  assert.equal(row.Phone, '+91 98765-43210');
  assert.ok(row.Password_Hash.startsWith('$argon2id$') && !row.Password_Hash.includes(password), 'Only an Argon2id hash is stored');
  // The new account can sign in (any email case); a wrong password cannot.
  const signedIn = await sessions.run(null, () => authenticateUser(` ${registeredEmail.toUpperCase()}`, password));
  assert.deepEqual(signedIn, { User_ID: row.User_ID, Name: null, Role: 'USER' });
  assert.equal(await sessions.run(null, () => authenticateUser(registeredEmail, `${password}x`)), null);
  // Duplicates (any case) and invalid fields are rejected with field messages.
  assert.match((await attempt({ ...valid, email: registeredEmail.replace('feature', 'FEATURE') })).fieldErrors.email, /already exists/);
  const invalid = [
    [{ name: '   ' }, 'name'], [{ email: 'not-an-email' }, 'email'], [{ email: '' }, 'email'],
    [{ phone: '12ab567' }, 'phone'], [{ phone: '12345' }, 'phone'], [{ phone: '' }, 'phone'],
    [{ password: 'short', confirmPassword: 'short' }, 'password'], [{ confirmPassword: `${password}!` }, 'confirmPassword'],
    [{ password: `x${registeredEmail}`, confirmPassword: `x${registeredEmail}` }, 'password'],
  ];
  for (const [change, field] of invalid) {
    const result = await attempt({ ...valid, email: `x${registeredEmail}`, ...change });
    assert.ok(result.fieldErrors?.[field], `${field} must be rejected for ${JSON.stringify(change)}`);
  }
  assert.equal((await pool.query('SELECT 1 FROM public."USER" WHERE "Email" = $1', [`x${registeredEmail}`])).rowCount, 0);
  // The registered USER uses USER features and is denied ADMIN ones.
  assert.ok((await renderPage('app/claim/page.tsx', row.User_ID)).includes('My Claims'));
  assert.ok((await renderPage('app/admin/campus-summary/page.tsx', row.User_ID)).includes('Access denied'));
  // Login and registration pages link to each other; success is announced on Sign In.
  assert.ok((await renderPage('app/login/page.tsx', null, { registered: '1' })).includes('Your account has been created.'));
  assert.ok((await renderPage('app/login/page.tsx', null)).includes('href="/register"'));
  const page = await renderPage('app/register/page.tsx', null);
  assert.ok(page.includes('Create Account') && page.includes('href="/login"') && !/name="role"/i.test(page), 'No role field is offered');
  console.log('PASS registration: USER-only accounts (forged role ignored), Argon2id hash, normalised email, login works, duplicates/invalid fields rejected, USER access only');
}

async function vectorCrudChecks() {
  // CREATE: the action stores a 384-dimension, finite, unit-length vector.
  const created = await sessions.run({ User_ID: A }, () => createLostReport({ error: null, success: null }, form({
    itemName: 'Lost blue phone', description: 'Smartphone in a navy blue protective case, star sticker on the back',
    categoryId: id, locationId: id, dateLost: new Date().toISOString().slice(0, 10),
  })));
  assert.equal(created.error, null);
  createdLostId = created.reportId;
  const stored = (await pool.query(`SELECT vector_dims("Embedding") AS dims, vector_norm("Embedding") AS norm, "Embedding"::text AS v
    FROM public."LOST_REPORT" WHERE "Lost_ID" = $1`, [createdLostId])).rows[0];
  assert.equal(stored.dims, 384);
  assert.ok(Math.abs(stored.norm - 1) < 1e-5, 'Normalised embedding');
  assert.ok(JSON.parse(stored.v).every(Number.isFinite));
  // READ: exact cosine ranking puts the differently worded phone first.
  const { getPotentialMatches } = loadProduction('lib/potential-matches.ts');
  const matches = await sessions.run({ User_ID: A }, () => getPotentialMatches(A, String(createdLostId)));
  assert.equal(matches.error, null);
  assert.equal(matches.matches.filter((m) => [phoneFound, ownFound, claimedFound, contestedFound].includes(m.Found_ID))[0].Found_ID, phoneFound);
  // UPDATE: new text -> trigger clears the old vector -> new vector stored.
  const edited = await sessions.run({ User_ID: A }, () => editReport({ error: null, success: null }, form({
    kind: 'lost', reportId: createdLostId, itemName: 'Lost steel bottle', description: 'Metal water bottle with a green cap',
    categoryId: id, locationId: id, dateLost: new Date().toISOString().slice(0, 10),
  })));
  assert.equal(edited.error, null);
  const after = (await pool.query(`SELECT "Embedding" <=> $2::public.vector(384) AS distance, "Embedding"::text <> $3 AS changed
    FROM public."LOST_REPORT" WHERE "Lost_ID" = $1`, [createdLostId, await vector('Lost steel bottle', 'Metal water bottle with a green cap'), stored.v])).rows[0];
  assert.ok(after.changed && after.distance < 1e-5, 'The stored vector is the fresh embedding of the new text');
  console.log('PASS vectors: CREATE (384 finite unit values), READ (cosine ranking), UPDATE (trigger + re-embedding) through the application');
}

async function deletionChecks() {
  const del = (userId, kind, reportId) => sessions.run({ User_ID: userId }, () => deleteReport({ error: null, success: null }, form({ kind, reportId })));
  const exists = async (table, key, value) => (await pool.query(`SELECT 1 FROM public."${table}" WHERE "${key}" = $1`, [value])).rowCount > 0;
  // My Reports offers Delete only where it is allowed, and explains why not.
  const mine = await renderPage('app/my-reports/page.tsx', A);
  assert.ok(mine.includes('Delete<span class="sr-only"> Grey umbrella</span>'));
  assert.ok(mine.includes(`id="no-delete-${claimedFound}"`) && mine.includes('claimed items can&#x27;t be deleted'));
  // Before: the phone appears in semantic search and potential matches.
  const anonSearch = (text) => sessions.run(null, () => semanticSearch({ text, category: String(id) }));
  assert.ok((await anonSearch('navy phone with a star sticker')).reports.some((r) => r.Report_Type === 'Lost' && r.Report_ID === phoneLost));
  // Non-owners cannot delete; a claimed found report is kept with its claim.
  assert.equal((await del(B, 'lost', phoneLost)).error, 'Report not found or unavailable to your account.');
  assert.ok(await exists('LOST_REPORT', 'Lost_ID', phoneLost));
  assert.match((await del(A, 'found', claimedFound)).error, /claimed this item/);
  assert.ok(await exists('FOUND_REPORT', 'Found_ID', claimedFound) && await exists('CLAIM', 'Claim_ID', claimOnClaimed));
  assert.equal((await del(A, 'found', phoneFound)).error, 'Report not found or unavailable to your account.');
  // Owner deletes a lost report: row, embedding and MATCHES rows are gone.
  assert.equal(await expectRedirect(del(A, 'lost', phoneLost)), '/my-reports?deleted=lost');
  assert.ok(!await exists('LOST_REPORT', 'Lost_ID', phoneLost));
  assert.ok(!await exists('MATCHES', 'Lost_ID', phoneLost), 'MATCHES rows cascade');
  assert.ok(!(await anonSearch('navy phone with a star sticker')).reports.some((r) => r.Report_Type === 'Lost' && r.Report_ID === phoneLost));
  // Owner deletes an unclaimed found report: photos and matches cascade, and it
  // disappears from another user's potential matches.
  const { getPotentialMatches } = loadProduction('lib/potential-matches.ts');
  const beforeMatches = await sessions.run({ User_ID: B }, () => getPotentialMatches(B, String(bottleLost)));
  assert.ok(beforeMatches.matches.some((m) => m.Found_ID === ownFound));
  assert.equal(await expectRedirect(del(A, 'found', ownFound)), '/my-reports?deleted=found');
  assert.ok(!await exists('FOUND_REPORT', 'Found_ID', ownFound));
  assert.ok(!await exists('FOUND_PHOTOS', 'Found_ID', ownFound) && !await exists('MATCHES', 'Found_ID', ownFound));
  const afterMatches = await sessions.run({ User_ID: B }, () => getPotentialMatches(B, String(bottleLost)));
  assert.ok(!afterMatches.matches.some((m) => m.Found_ID === ownFound));
  assert.ok((await renderPage('app/my-reports/page.tsx', A, { deleted: 'found' })).includes('Your found report was deleted'));
  // The report created and edited above is deleted through the same workflow (vector DELETE).
  assert.equal(await expectRedirect(del(A, 'lost', createdLostId)), '/my-reports?deleted=lost');
  assert.ok(!await exists('LOST_REPORT', 'Lost_ID', createdLostId));
  console.log('PASS deletion: owner-only CALL delete_own_report; claimed found reports kept; embedding, MATCHES and FOUND_PHOTOS removed; deleted reports absent from semantic search and potential matches');
}

async function analyticsChecks() {
  const asAdmin = (sql, values) => sessions.run({ User_ID: ADMIN }, () => adminQuery(sql, values));
  // Recursive timeline vs an independent calculation in JavaScript.
  const today = (await pool.query('SELECT CURRENT_DATE::text AS d')).rows[0].d;
  const days = Array.from({ length: 30 }, (_, n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 29 + n); return d.toISOString().slice(0, 10); });
  const counts = async (table, column) => Object.fromEntries((await pool.query(`SELECT "${column}"::text AS d, COUNT(*)::int AS n FROM public."${table}" GROUP BY 1`)).rows.map((r) => [r.d, r.n]));
  const [lost, found, claims, handovers] = await Promise.all([counts('LOST_REPORT', 'Date_Lost'), counts('FOUND_REPORT', 'Date_Found'), counts('CLAIM', 'Claim_Date'), counts('HANDOVER', 'Handover_Date')]);
  const expected = days.map((d) => ({ day: d, lost: lost[d] ?? 0, found: found[d] ?? 0, claims: claims[d] ?? 0, handovers: handovers[d] ?? 0 }));
  const timeline = (await asAdmin(`SELECT day::text AS day, lost_reports::int AS lost, found_reports::int AS found, claims::int AS claims, handovers::int AS handovers
    FROM public.admin_daily_activity($1)`, [30])).rows;
  assert.deepEqual(timeline, expected);
  const quiet = timeline.filter((r) => r.lost + r.found + r.claims + r.handovers === 0).length;
  assert.ok(timeline.length === 30 && timeline.some((r) => r.found > 0), 'Fixture activity appears in the window');
  // Hotspots vs an independent average.
  const perLocation = (await pool.query(`SELECT l."Location_ID" AS id,
      (SELECT COUNT(*) FROM public."LOST_REPORT" r WHERE r."Location_ID" = l."Location_ID")::int
    + (SELECT COUNT(*) FROM public."FOUND_REPORT" r WHERE r."Location_ID" = l."Location_ID")::int AS total
    FROM public."LOCATION" l`)).rows;
  const average = perLocation.reduce((sum, r) => sum + r.total, 0) / perLocation.length;
  const hotspots = (await asAdmin('SELECT id, total::int AS total FROM public.admin_location_hotspots ORDER BY id')).rows;
  assert.deepEqual(hotspots, perLocation.filter((r) => r.total > average).sort((a, b) => a.id - b.id));
  assert.ok(hotspots.length > 0 && hotspots.length < perLocation.length, 'HAVING genuinely filters the groups');
  // Contested items: two distinct claimants -> listed; one claimant -> not.
  const contested = (await asAdmin('SELECT id, claims::int AS claims, claimants::int AS claimants, resolved FROM public.admin_contested_items')).rows;
  assert.deepEqual(contested.find((r) => r.id === contestedFound), { id: contestedFound, claims: 2, claimants: 2, resolved: false });
  assert.ok(!contested.some((r) => r.id === claimedFound));
  const independent = (await pool.query(`SELECT "Found_ID" AS id FROM public."CLAIM" GROUP BY 1 HAVING COUNT(DISTINCT "User_ID") >= 2 ORDER BY 1`)).rows.map((r) => r.id);
  assert.deepEqual(contested.map((r) => r.id).sort((a, b) => a - b), independent);
  const page = await renderPage('app/admin/campus-summary/page.tsx', ADMIN);
  assert.ok(page.includes(`data-contested-id="${contestedFound}"`) && page.includes(`${quiet} quiet`));
  assert.ok((await renderPage('app/admin/campus-summary/page.tsx', ADMIN, { days: '90' })).includes('in the last 90 days'));
  console.log(`PASS analytics: recursive 30-day timeline equals independent counts (${quiet} quiet days shown as zero); hotspots equal the above-average locations; contested items equal an independent HAVING`);
}

async function semanticChecks() {
  const anon = (input) => sessions.run(null, () => semanticSearch(input));
  const phone = await anon({ text: 'blue phone', category: String(id) });
  assert.equal(phone.error, null);
  assert.equal(phone.reports[0].Report_ID, phoneFound, 'Differently worded phone ranks first');
  assert.ok(phone.reports.every((r, n) => n === 0 || r.Similarity <= phone.reports[n - 1].Similarity), 'Ordered by similarity');
  assert.ok((await anon({ text: 'blue phone', category: String(id), type: 'Lost' })).reports.every((r) => r.Report_Type === 'Lost'));
  assert.ok((await anon({ text: 'blue phone', location: String(id), type: 'Found' })).reports.every((r) => r.Report_Type === 'Found'));
  assert.match((await anon({ text: 'ab' })).error, /3 to 200 characters/);
  assert.match((await anon({ text: 'x'.repeat(201) })).error, /3 to 200 characters/);
  // Exact words is unchanged: a literal substring match, so the paraphrase is not found.
  const exact = await sessions.run(null, () => searchReports({ text: 'blue phone', category: String(id) }));
  assert.equal(exact.reports.length, 0);
  const meaningPage = await renderPage('app/search/page.tsx', null, { text: 'blue phone', mode: 'meaning', category: String(id) });
  assert.ok(meaningPage.includes('% similar') && meaningPage.includes('not proof'));
  assert.ok((await renderPage('app/search/page.tsx', null, { mode: 'meaning' })).includes('Describe the item to search by meaning.'));
  assert.ok(!(await renderPage('app/search/page.tsx', null, { text: 'blue phone', category: String(id) })).includes('% similar'));
  console.log('PASS semantic search: real embeddings rank the paraphrased phone first, filters respected, 3-200 character validation, exact-words mode unchanged');
}

async function main() {
  await assertIsolated();
  const before = await snapshot();
  let created = false;
  try {
    await createFixtures();
    created = true;
    await registrationChecks();
    await vectorCrudChecks();
    await semanticChecks();
    await analyticsChecks();
    await deletionChecks();
  } catch (error) {
    // Report the real failure even if cleanup verification also fails.
    console.error(`FAIL: ${error.message}${error.stack?.split('\n').find((line) => /[\\/]tests[\\/]/.test(line)) ?? ''}`);
    process.exitCode = 1;
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
