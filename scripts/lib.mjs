// Shared helpers for the demo and seed scripts. They call the API over HTTP like any other client,
// and sign test tokens with JWT_SECRET the way the Identity service will once it publishes its
// contract (PRD Assumption 1).
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_URL = (
  process.env.BASE_URL ?? 'https://alumni-network-integration.phyo2lay.workers.dev'
).replace(/\/$/, '');
export const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);

// The live secret is in .demo.vars and the local one in .dev.vars. Both files are git-ignored.
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = join(ROOT, IS_LOCAL ? '.dev.vars' : '.demo.vars');
  if (!existsSync(file)) throw new Error(`Set JWT_SECRET, or create ${file}`);
  const match = readFileSync(file, 'utf8').match(/^JWT_SECRET=(.+)$/m);
  if (!match) throw new Error(`No JWT_SECRET in ${file}`);
  return match[1].trim();
}
const SECRET = loadSecret();

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** An HS256 token. `expiresIn` is in seconds and can be negative to make an expired one. */
export function signToken(role, sub, { secret = SECRET, expiresIn = 900 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub, role, iat: now, exp: now + expiresIn })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

export const person = (role, id, name = id) => ({ role, id, name, token: signToken(role, id) });

/** Sends one request. `as` is a person, a raw token string, or null for no token. */
export async function request(method, path, { as = null, body } = {}) {
  const headers = {};
  const token = typeof as === 'string' ? as : as?.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: callers check the status and text.
  }
  return { status: res.status, json, text };
}

/** Reads rows straight from D1 through wrangler, to show evidence tables the API doesn't expose. */
export function query(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'alumni-network-db', IS_LOCAL ? '--local' : '--remote', '--json', '--command', sql],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(out)[0].results;
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));
export const c = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  cyan: paint('36'),
};
