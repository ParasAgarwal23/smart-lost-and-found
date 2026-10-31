// Maintenance-only account provisioning. Never exposed through a page, Server
// Action or API: it runs from a terminal with the owner connection.
//
//   npm run provision:admin -- --name "Full Name" --email admin@example.edu
//       prompts twice for the password without echoing it, or
//   npm run provision:admin -- --name "Full Name" --email admin@example.edu \
//       --generate-password --credentials-file .local/demo-credentials.txt
//       generates a random password and appends it ONLY to that ignored file.
//   node scripts/provision-account.mjs --role USER ...   (demo USER accounts)
//
// ADMIN accounts are inserted directly through MAINTENANCE_DATABASE_URL, the
// only connection allowed to write "USER". USER accounts go through
// public.register_user, the same function public registration uses. The
// password is hashed with Argon2id (the same argon2 library and type as
// lib/password.ts). An existing email is refused: no account is ever updated,
// replaced or deleted by this script.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import nextEnv from '@next/env';
import { hash, argon2id } from 'argon2';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root);

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const role = (option('role') ?? 'ADMIN').toUpperCase();
if (role !== 'ADMIN' && role !== 'USER') fail('--role must be ADMIN or USER.');
const name = (option('name') ?? '').trim();
const email = (option('email') ?? '').trim().toLowerCase();
const phone = (option('phone') ?? '').trim() || null;
if (!name || name.length > 100) fail('--name is required (1 to 100 characters).');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 100) fail('--email must be a valid address of up to 100 characters.');
if (role === 'USER' && !phone) fail('--phone is required for USER accounts (the registration rules apply).');

const connectionString = process.env.MAINTENANCE_DATABASE_URL;
if (!connectionString) fail('MAINTENANCE_DATABASE_URL must be set. The web application connections cannot provision accounts.');

// Masked terminal prompt: characters are not echoed.
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('An interactive terminal is required; use --generate-password otherwise.'));
    process.stdout.write(question);
    const input = process.stdin;
    input.setRawMode(true);
    input.resume();
    let value = '';
    const onData = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') {
          input.setRawMode(false); input.pause(); input.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (char === '\u0003') { input.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    input.on('data', onData);
  });
}

let password;
let credentialsFile;
if (flag('generate-password')) {
  credentialsFile = option('credentials-file');
  if (!credentialsFile) fail('--generate-password needs --credentials-file <path> (a git-ignored file).');
  credentialsFile = path.resolve(root, credentialsFile);
  password = randomBytes(18).toString('base64url'); // 24 random URL-safe characters
} else {
  password = await promptHidden('Password (10-128 characters): ');
  if ((await promptHidden('Confirm password: ')) !== password) fail('The passwords do not match.');
}
if (password.length < 10 || password.length > 128) fail('The password must be 10 to 128 characters.');

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const { rows: [target] } = await client.query(
    `SELECT current_database() AS db,
            has_table_privilege(current_user, 'public."USER"', 'INSERT') AS can_insert`);
  if (!/^smart_lost_found(_test|_demo)?$/.test(target.db)) fail(`Refusing to provision into database ${target.db}.`);
  // lf_web / lf_admin_web have no direct privilege on "USER"; only the owner does.
  if (!target.can_insert) fail('This connection cannot write "USER". Use the maintenance (owner) connection.');

  const existing = await client.query('SELECT 1 FROM public."USER" WHERE "Email" = $1', [email]);
  if (existing.rows.length > 0) fail(`An account with email ${email} already exists; it was left unchanged.`);

  const passwordHash = await hash(password, { type: argon2id });
  let userId;
  if (role === 'USER') {
    ({ rows: [{ User_ID: userId }] } = await client.query(
      'SELECT "User_ID" FROM public.register_user($1, $2, $3, $4)', [name, email, phone, passwordHash]));
  } else {
    for (let attempt = 0; attempt < 5 && userId === undefined; attempt++) {
      const candidate = 1 + Math.floor(Math.random() * 2147483646);
      try {
        await client.query(
          `INSERT INTO public."USER" ("User_ID", "Name", "Email", "Phone", "Role", "Password_Hash")
           VALUES ($1, $2, $3, $4, 'ADMIN', $5)`,
          [candidate, name, email, phone, passwordHash]);
        userId = candidate;
      } catch (error) {
        if (error.constraint === 'USER_Email_key') fail(`An account with email ${email} already exists; it was left unchanged.`);
        if (error.constraint !== 'USER_pkey') throw error;
      }
    }
    if (userId === undefined) fail('Could not allocate a user ID; try again.');
  }

  if (credentialsFile) {
    fs.mkdirSync(path.dirname(credentialsFile), { recursive: true });
    const header = fs.existsSync(credentialsFile) ? '' :
      '# Local demo credentials. Git-ignored; never commit, paste or screenshot this file.\n';
    fs.appendFileSync(credentialsFile,
      `${header}\n[${role}] database=${target.db}\nname=${name}\nemail=${email}\npassword=${password}\n`, { mode: 0o600 });
  }
  console.log(`Created ${role} account ${email} (User_ID ${userId}) in ${target.db}.` +
    (credentialsFile ? ` Password written to ${path.relative(root, credentialsFile)} only.` : ''));
} catch (error) {
  fail(error.message.replace(/postgres(ql)?:\/\/\S+/g, '<connection>'));
} finally {
  await client.end();
}
