// Run one command against the demonstration database smart_lost_found_demo.
//   npm run demo -- npm start
//   npm run demo -- npm run db:backfill-embeddings
//   npm run demo -- psql -X -v ON_ERROR_STOP=1 -v demo_user_email=... -f db/demo_seed.sql
// .env.local is read but never changed: the database name in the three
// connection URLs is set to smart_lost_found_demo for this command, whatever
// .env.local names. psql receives the owner connection through the
// standard PG* variables of the child process (no password on the command line).
import nextEnv from '@next/env';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO_DATABASE = 'smart_lost_found_demo';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root);

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: npm run demo -- <command> [arguments...]');
  process.exit(1);
}

const env = { ...process.env };
for (const name of ['DATABASE_URL', 'ADMIN_DATABASE_URL', 'MAINTENANCE_DATABASE_URL']) {
  if (!env[name]) {
    console.error(`${name} must be configured in .env.local (see .env.example).`);
    process.exit(1);
  }
  const url = new URL(env[name]);
  url.pathname = `/${DEMO_DATABASE}`;
  env[name] = url.toString();
}
const owner = new URL(env.MAINTENANCE_DATABASE_URL);
Object.assign(env, {
  PGHOST: owner.hostname,
  PGPORT: owner.port || '5432',
  PGUSER: decodeURIComponent(owner.username),
  PGPASSWORD: decodeURIComponent(owner.password),
  PGDATABASE: DEMO_DATABASE,
});

console.error(`[demo] ${DEMO_DATABASE}: ${[command, ...args].join(' ')}`);
// A shell resolves npm/psql/next on Windows; quote arguments that contain spaces.
const quote = (value) => (/[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value);
const child = spawn([command, ...args].map(quote).join(' '), { stdio: 'inherit', shell: true, env, cwd: root });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
