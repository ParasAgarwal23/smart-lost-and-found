// Shared harness for the database/action test suites.
//
// Safety: every connection is retargeted to the isolated database
// smart_lost_found_test, whatever .env.local says, and assertIsolated() refuses
// to continue unless all three connections really reach it. The tests can
// therefore never write to smart_lost_found. Create the test database as a
// clone first (see README "Testing"):
//   createdb -T smart_lost_found smart_lost_found_test
//
// Connections (the same variables as the application):
//   DATABASE_URL              lf_web       production modules (USER/anonymous)
//   ADMIN_DATABASE_URL        lf_admin_web production admin analytics
//   MAINTENANCE_DATABASE_URL  table owner  fixtures, snapshots and cleanup only
// Production modules run with only the request session supplied through
// AsyncLocalStorage (no Next.js HTTP/cookie runtime in this runner).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import pg from 'pg';
import nextEnv from '@next/env';
import { renderToStaticMarkup } from 'react-dom/server';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root);
process.env.NODE_ENV = 'development';

export const TEST_DATABASE = 'smart_lost_found_test';
export const applicationName = `lf-tests-${process.pid}`;

for (const name of ['DATABASE_URL', 'ADMIN_DATABASE_URL', 'MAINTENANCE_DATABASE_URL']) {
  if (!process.env[name]) throw new Error(`${name} must be configured (see .env.example).`);
  const url = new URL(process.env[name]);
  url.pathname = `/${TEST_DATABASE}`;
  url.searchParams.set('application_name', applicationName);
  process.env[name] = url.toString();
}

// Owner connection: fixtures, snapshots, cleanup and catalog checks only.
export const pool = new pg.Pool({ connectionString: process.env.MAINTENANCE_DATABASE_URL });

export async function assertIsolated() {
  for (const [name, applicationLogin] of [['MAINTENANCE_DATABASE_URL', false], ['DATABASE_URL', true], ['ADMIN_DATABASE_URL', true]]) {
    const client = new pg.Client({ connectionString: process.env[name] });
    await client.connect();
    try {
      const { rows: [info] } = await client.query(
        'SELECT current_database() AS db, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser');
      if (info.db !== TEST_DATABASE) throw new Error(`${name} must reach ${TEST_DATABASE}, not ${info.db}`);
      if (applicationLogin && info.superuser) throw new Error(`${name} must be a non-superuser application login`);
    } finally { await client.end(); }
  }
}

const requireDependency = createRequire(import.meta.url);
export const sessions = new AsyncLocalStorage();
export const invalidatedPaths = [];
export const redirects = [];
const modules = new Map();

export function loadProduction(relative) {
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
    // Static header rendering has no mounted App Router; keep redirect() and the other exports real.
    if (name === 'next/navigation') return { ...requireDependency(name), useRouter: () => ({ refresh() {} }) };
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

export async function renderPage(relative, userId, params = {}, inspect = () => {}) {
  const page = loadProduction(relative).default;
  const element = await sessions.run(userId === null ? null : { User_ID: userId },
    () => page({ searchParams: Promise.resolve(params) }));
  inspect(element);
  return renderToStaticMarkup(element);
}

// Runs a Server Action that ends in redirect(); returns the redirect target.
export async function expectRedirect(promise) {
  try {
    await promise;
  } catch (error) {
    const target = error?.digest?.split(';')[2];
    if (target) return target;
    throw error;
  }
  throw new Error('Expected the action to redirect');
}

// Runs a raw statement as an application role on the web login, exactly as
// lib/db.ts does (transaction-local role + identity), then rolls back.
export async function asRole(role, userId, statement, values = [], { login = 'DATABASE_URL' } = {}) {
  const client = new pg.Client({ connectionString: process.env[login] });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (role) await client.query("SELECT set_config('role', $1, true), set_config('app.user_id', $2, true)", [role, userId === null ? '' : String(userId)]);
    return await client.query(statement, values);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

export async function closePools() {
  await pool.end();
  for (const appPool of Object.values(globalThis.postgresPools ?? {})) await appPool.end();
}

// Overall watchdog: a hung run fails instead of waiting forever.
export function watchdog(seconds) {
  const timer = setTimeout(() => { console.error(`FAIL: test run exceeded ${seconds}s`); process.exit(1); }, seconds * 1000);
  timer.unref();
}
