// HNSW verification for the semantic-search query (lib/semantic-search.ts).
// Run with npm test (isolated database smart_lost_found_test only).
//
// The live data set (tens of reports) is far too small for the planner to
// prefer an index over a sequential scan, which is the correct choice there.
// This test inserts synthetic, random unit vectors INSIDE ONE TRANSACTION THAT
// IS ROLLED BACK, runs ANALYZE, and checks with EXPLAIN (ANALYZE, BUFFERS) that
// the exact exported SQL, executed as the anonymous application role, uses the
// HNSW index on each report table. It then compares the approximate top-10
// with an exact top-10 (recall). Nothing is committed.
//   node tests/vector-index.mjs [--rows 4000] [--save-plan path]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertIsolated, closePools, loadProduction, pool, watchdog } from './support.mjs';

watchdog(300);
const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const ROWS = Number(option('rows', 4000));
const savePlan = option('save-plan');
const { SEMANTIC_SEARCH_SQL, SEMANTIC_RESULT_LIMIT } = loadProduction('lib/semantic-search.ts');

// Deterministic pseudo-random unit vectors (no Math.random, so runs are comparable).
let seed = 20261031;
const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
function unitVector() {
  const v = Array.from({ length: 384 }, random);
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

async function main() {
  await assertIsolated();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const base = -2000000000;
    await client.query(`INSERT INTO public."USER" ("User_ID", "Role", "Password_Hash") VALUES ($1, 'USER', 'UNUSABLE_SYNTHETIC_FIXTURE')`, [base]);
    await client.query('INSERT INTO public."CATEGORY" VALUES ($1, $2)', [base, 'Synthetic category']);
    await client.query('INSERT INTO public."LOCATION" VALUES ($1, $2, $3)', [base, 'Synthetic location', 'Synthetic building']);
    for (const [table, key, date] of [['FOUND_REPORT', 'Found_ID', 'Date_Found'], ['LOST_REPORT', 'Lost_ID', 'Date_Lost']]) {
      const vectors = Array.from({ length: ROWS }, () => JSON.stringify(unitVector()));
      // One INSERT ... SELECT unnest() per table keeps this fast.
      await client.query(`INSERT INTO public."${table}" ("${key}", "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description", "${date}", "Embedding")
        SELECT $1 - n, $1, $1, $1, 'Synthetic item ' || n, 'Synthetic description', CURRENT_DATE, v::public.vector(384)
        FROM unnest($2::text[]) WITH ORDINALITY AS t(v, n)`, [base, vectors]);
    }
    await client.query('ANALYZE public."FOUND_REPORT"');
    await client.query('ANALYZE public."LOST_REPORT"');

    // Run as the application would: anonymous role, iterative scans enabled.
    await client.query("SELECT set_config('role', 'lf_anon', true), set_config('app.user_id', '', true)");
    await client.query('SET LOCAL hnsw.iterative_scan = relaxed_order');
    const query = JSON.stringify(unitVector());
    const params = [query, null, null, SEMANTIC_RESULT_LIMIT, 'Both'];
    const plan = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) ${SEMANTIC_SEARCH_SQL}`, params))
      .rows.map((row) => row['QUERY PLAN']).join('\n').replace(/'\[[^\]]+\]'/g, "'[...384 values...]'");
    if (savePlan) fs.writeFileSync(savePlan, `-- ${ROWS} synthetic vectors per table (rolled back); role lf_anon\n${plan}\n`);
    assert.match(plan, /Index Scan using idx_found_report_embedding_hnsw on "FOUND_REPORT"/, 'FOUND_REPORT branch must use its HNSW index');
    assert.match(plan, /Index Scan using idx_lost_report_embedding_hnsw on "LOST_REPORT"/, 'LOST_REPORT branch must use its HNSW index');
    console.log(`PASS HNSW: with ${ROWS} synthetic vectors per table, EXPLAIN (ANALYZE, BUFFERS) of the exported semantic-search SQL uses both HNSW indexes`);

    // Recall@10: approximate (index) vs exact (sequential scan) over 20 queries.
    let overlap = 0;
    const queries = 20;
    const found = `SELECT "Found_ID" FROM public."FOUND_REPORT" WHERE "Embedding" IS NOT NULL
      ORDER BY "Embedding" OPERATOR(public.<=>) $1::public.vector(384) LIMIT 10`;
    for (let n = 0; n < queries; n++) {
      const q = JSON.stringify(unitVector());
      await client.query('SET LOCAL enable_seqscan = off');
      const approximate = (await client.query(found, [q])).rows.map((r) => r.Found_ID);
      await client.query('SET LOCAL enable_seqscan = on');
      await client.query('SET LOCAL enable_indexscan = off');
      const exact = (await client.query(found, [q])).rows.map((r) => r.Found_ID);
      await client.query('SET LOCAL enable_indexscan = on');
      overlap += approximate.filter((value) => exact.includes(value)).length;
    }
    const recall = overlap / (queries * 10);
    console.log(`INFO recall@10 of HNSW (ef_search default 40) vs exact ranking over ${queries} random queries: ${(recall * 100).toFixed(1)}%`);
    if (savePlan) fs.appendFileSync(savePlan, `\n-- recall@10 vs exact ranking over ${queries} random queries: ${(recall * 100).toFixed(1)}%\n`);
    assert.ok(recall > 0.5, 'Approximate results must substantially agree with exact ranking');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  const leftover = (await pool.query(`SELECT COUNT(*)::int AS n FROM public."FOUND_REPORT" WHERE "Item_Name" LIKE 'Synthetic item %'`)).rows[0].n;
  assert.equal(leftover, 0, 'Synthetic rows must not persist');
  console.log('PASS rollback: no synthetic rows persist');
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}).finally(closePools);
