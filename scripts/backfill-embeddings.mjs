// Fill missing report embeddings (e.g. seed rows) using the application's model.
//   node scripts/backfill-embeddings.mjs            # write
//   node scripts/backfill-embeddings.mjs --dry-run  # only count
// Only rows whose Embedding IS NULL are updated, and only if their text is
// unchanged since it was read. Updating "Embedding" alone does not fire the
// invalidate_report_embedding trigger (it watches Item_Name/Description only).
// Model settings must match lib/embedding.ts exactly so vectors are comparable.
// Uses MAINTENANCE_DATABASE_URL (the table owner): it updates every user's
// reports, which the RLS-restricted web login correctly cannot do.
import nextEnv from '@next/env';
import pg from 'pg';
import { pipeline } from '@huggingface/transformers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root);
const dryRun = process.argv.includes('--dry-run');
if (!process.env.MAINTENANCE_DATABASE_URL) {
  console.error('FAIL: MAINTENANCE_DATABASE_URL must be set (owner connection).');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.MAINTENANCE_DATABASE_URL });

const tables = [
  { table: 'LOST_REPORT', id: 'Lost_ID' },
  { table: 'FOUND_REPORT', id: 'Found_ID' },
];

try {
  const { rows: [target] } = await pool.query('SELECT current_database() AS db');
  if (!/^smart_lost_found(_test|_demo)?$/.test(target.db)) throw new Error('Connect to smart_lost_found, smart_lost_found_test or smart_lost_found_demo.');

  const pending = [];
  for (const { table, id } of tables) {
    const { rows } = await pool.query(
      `SELECT "${id}" AS id, "Item_Name", "Description" FROM public."${table}"
       WHERE "Embedding" IS NULL AND ("Item_Name" IS NOT NULL OR "Description" IS NOT NULL)
       ORDER BY "${id}"`,
    );
    for (const row of rows) pending.push({ table, idColumn: id, ...row });
    console.log(`${table}: ${rows.length} report(s) without an embedding`);
  }
  if (dryRun || pending.length === 0) {
    console.log(dryRun ? 'Dry run: no rows changed.' : 'Nothing to backfill.');
  } else {
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'cpu', dtype: 'fp32' });
    for (const report of pending) {
      const output = await extractor(`${(report.Item_Name ?? '').trim()}\n${(report.Description ?? '').trim()}`, { pooling: 'mean', normalize: true });
      const vector = Array.from(output.data);
      if (vector.length !== 384 || !vector.every(Number.isFinite)) throw new Error('Expected an embedding with 384 finite values.');
      report.vector = JSON.stringify(vector);
    }

    // One transaction: either every eligible row gets its vector or none do.
    const client = await pool.connect();
    let updated = 0;
    try {
      await client.query('BEGIN');
      for (const report of pending) {
        const result = await client.query(
          `UPDATE public."${report.table}" SET "Embedding" = $2::public.vector(384)
           WHERE "${report.idColumn}" = $1 AND "Embedding" IS NULL
             AND "Item_Name" IS NOT DISTINCT FROM $3 AND "Description" IS NOT DISTINCT FROM $4`,
          [report.id, report.vector, report.Item_Name, report.Description],
        );
        updated += result.rowCount;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    console.log(`Stored ${updated} embedding(s); ${pending.length - updated} skipped because the row changed.`);
  }
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
