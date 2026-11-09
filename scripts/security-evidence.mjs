// Security and PDPA checks against the deployed Worker, cited by SECURITY.md. Each check prints what
// came back, and the script exits 1 if any check fails.
//
// It changes nothing on the live site: every attack is refused before it writes, and the
// append-only test edits the LOCAL database only (run `npm run db:local` and the web app once first).
//
//   npm run evidence:security                                   # live site
//   BASE_URL=http://localhost:8787 npm run evidence:security    # local `npm run dev`
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BASE_URL, IS_LOCAL, ROOT, c, person, query, request, signToken } from './lib.mjs';

const run = Date.now().toString(36);
let passed = 0;
const failures = [];
const skipped = [];

function check(id, label, ok, actual) {
  if (ok) passed++;
  else failures.push(`${id} ${label}`);
  const detail = actual === undefined ? '' : c.dim(`   got: ${actual}`);
  console.log(`  ${ok ? c.green('✓') : c.red('✗')} ${c.bold(id)} ${label}${detail}`);
}

function skip(id, label, reason) {
  skipped.push(`${id} ${label}`);
  console.log(`  ${c.yellow('–')} ${c.bold(id)} ${label}   ${c.yellow(`skipped: ${reason}`)}`);
}

const section = (title) => console.log(`\n${c.bold(c.cyan(title))}`);
const got = (res) => `${res.status}${res.json?.code ? ` ${res.json.code}` : ''}`;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

function readVar(name) {
  const file = join(ROOT, IS_LOCAL ? '.dev.vars' : '.demo.vars');
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1].trim() ?? null;
}

function tryQuery(sql) {
  try {
    return query(sql);
  } catch {
    return null;
  }
}

/** Runs SQL on the LOCAL database and returns the error text, or null if it succeeded. */
function localError(sql) {
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'alumni-network-db', '--local', '--command', sql], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return null;
  } catch (err) {
    return `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
}

async function raw(method, path, { headers = {}, body, redirect = 'follow' } = {}) {
  const res = await fetch(BASE_URL + path, { method, headers, body, redirect });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON.
  }
  return { status: res.status, headers: res.headers, json, text };
}

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

console.log(c.bold('MFU Alumni Network: security and PDPA checks'));
console.log(c.dim(`${BASE_URL}   ${new Date().toISOString()}   commit ${commit}`));

const student = person('student', `demo-student-security-${run}`, 'a student');
const otherStudent = person('student', `demo-student-security-b-${run}`, 'another student');
const alumni = person('alumni', `demo-alumni-security-${run}`, 'an alumni');
const admin = person('admin', 'demo-admin', 'admin');

// ── Transport and headers ─────────────────────────────────────────────────────────────────────
section('1  Transport and headers');

const page = await raw('GET', '/app');
const csp = page.headers.get('content-security-policy') ?? '';
const nonce = /'nonce-(\w+)'/.exec(csp)?.[1];
check(
  'H1',
  "web app: CSP allows only this response's nonce, no inline code, no framing",
  Boolean(nonce) &&
    csp.includes("default-src 'none'") &&
    csp.includes("frame-ancestors 'none'") &&
    !csp.includes('unsafe-inline') &&
    [...page.text.matchAll(/<(script|style)\b[^>]*>/g)].every((m) => m[0].includes(`nonce="${nonce}"`)),
  nonce ? csp.replaceAll(nonce, '…') : csp,
);

const HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};
for (const [id, label, path] of [
  ['H2', 'an API answer', '/'],
  ['H3', 'a refused request (401)', '/alumni'],
  ['H4', 'the docs page', '/docs'],
  ['H5', 'an unknown route (404)', '/nope'],
]) {
  const res = await raw('GET', path);
  const missing = Object.entries(HEADERS).filter(([name, value]) => res.headers.get(name) !== value);
  check(id, `${label} carries all five security headers`, !missing.length, missing.length ? `missing ${missing.map(([n]) => n).join(', ')}` : `${res.status}, all five`);
}

if (IS_LOCAL) {
  skip('H6', 'plain HTTP is sent to HTTPS', 'local server');
} else {
  const plain = await fetch(BASE_URL.replace(/^https:/, 'http:') + '/app', { redirect: 'manual' });
  check(
    'H6',
    'plain http:// is sent to https:// (308)',
    plain.status === 308 && plain.headers.get('location')?.startsWith('https://'),
    `${plain.status} → ${plain.headers.get('location')}`,
  );
}

// ── Sign-in ───────────────────────────────────────────────────────────────────────────────────
section('2  Sign-in (authentication)');

let res = await request('GET', '/alumni', { as: null });
check('A1', 'no token → 401', res.status === 401, got(res));

res = await request('GET', '/alumni', { as: signToken('admin', 'demo-admin', { secret: 'guessed-secret' }) });
check('A2', 'a token signed with a guessed secret → 401', res.status === 401, got(res));

res = await request('GET', '/alumni', { as: signToken('student', student.id, { expiresIn: -3600 }) });
check('A3', 'a token that expired an hour ago → 401', res.status === 401, got(res));

const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'demo-admin', role: 'admin', iat: now, exp: now + 900 })}.`;
res = await request('GET', '/alumni', { as: unsigned });
check('A4', 'an unsigned admin token (alg: none) → 401', res.status === 401, got(res));

const [header, , signature] = student.token.split('.');
const tampered = `${header}.${b64({ ...claimsOf(student.token), role: 'admin' })}.${signature}`;
res = await request('PATCH', '/admin/alumni/any-id/deactivate', { as: tampered });
check('A5', "a student's real token edited to say admin → 401", res.status === 401, got(res));

res = await request('POST', '/auth/demo-login', { body: { passcode: 'wrong-passcode', role: 'student', user_id: 'demo-student-su-myat' } });
check('A6', 'demo sign-in with a wrong passcode → 401', res.status === 401 && res.json?.code === 'INVALID_PASSCODE', got(res));

res = await request('POST', '/auth/demo-login', { body: { passcode: 'x', role: 'admin', user_id: 'demo-student-su-myat' } });
check('A7', 'a demo student ID asking for the admin role → 400', res.status === 400, got(res));

res = await request('POST', '/auth/demo-login', { body: { passcode: 'x', role: 'student', user_id: '6731503083' } });
check('A8', 'a real-looking student ID → 400 (demo IDs only)', res.status === 400, got(res));

const passcode = readVar('DEMO_PASSCODE');
if (!passcode) {
  skip('A9', 'demo admin token is marked demo and lasts two hours', 'no DEMO_PASSCODE in the vars file');
} else {
  res = await request('POST', '/auth/demo-login', { body: { passcode, role: 'admin', user_id: 'demo-admin' } });
  const claims = res.json?.token ? claimsOf(res.json.token) : {};
  check(
    'A9',
    'a demo admin token is marked demo and lasts two hours',
    res.status === 200 && claims.demo === true && claims.exp - claims.iat === 7200,
    `${res.status}, demo: ${claims.demo}, lifetime ${(claims.exp - claims.iat) / 3600} h`,
  );
}

// ── Roles and ownership ───────────────────────────────────────────────────────────────────────
section('3  Roles and ownership (authorisation)');

const directory = await request('GET', '/alumni?limit=50', { as: student });
const someProfile = directory.json?.data?.[0]?.id ?? 'unknown';

res = await request('PATCH', `/admin/alumni/${someProfile}/deactivate`, { as: student });
check('R1', 'a student turning off a profile → 403', res.status === 403, got(res));

res = await request('PATCH', `/admin/alumni/${someProfile}/deactivate`, { as: alumni });
check('R2', 'an alumni turning off a profile → 403', res.status === 403, got(res));

res = await request('PATCH', '/alumni/me', { as: student, body: { city: 'Yangon' } });
check('R3', 'a student editing an alumni profile → 403', res.status === 403, got(res));

res = await request('POST', '/mentoring-requests', { as: admin, body: { alumni_id: someProfile, message: 'Admin posing as a student' } });
check('R4', 'an admin sending a mentoring request → 403', res.status === 403, got(res));

// An answered request, so nothing could change even if a check were missing.
const answered = tryQuery("SELECT id FROM mentoring_requests WHERE status <> 'pending' ORDER BY created_at LIMIT 1")?.[0]?.id;
if (!answered) {
  skip('R5', "cancelling another student's request", 'no database access or no answered request');
  skip('R6', "answering a request sent to another alumni", 'no database access or no answered request');
} else {
  res = await request('PATCH', `/mentoring-requests/${answered}`, { as: otherStudent, body: { status: 'cancelled' } });
  check('R5', "a student cancelling another student's request → 403", res.status === 403 && res.json?.code === 'NOT_OWNER', got(res));
  res = await request('PATCH', `/mentoring-requests/${answered}`, { as: alumni, body: { status: 'accepted' } });
  check('R6', 'an alumni accepting a request sent to someone else → 403', res.status === 403 && res.json?.code === 'NOT_OWNER', got(res));
}

// ── Input checks ──────────────────────────────────────────────────────────────────────────────
section('4  Input checks (SQL injection, mass assignment, unsafe links)');

const total = directory.json?.pagination?.total ?? 0;
const searchTotal = async (query) => {
  const r = await request('GET', `/alumni?${query}`, { as: student });
  return { r, n: r.json?.pagination?.total };
};

let probe = await searchTotal(`role=${encodeURIComponent("' OR '1'='1")}`);
check('I1', `role filter ' OR '1'='1 is plain text: 0 matches, not all ${total}`, probe.r.status === 200 && probe.n === 0, `${probe.r.status}, ${probe.n} matches`);

probe = await searchTotal(`role=${encodeURIComponent("x'); DROP TABLE alumni_profiles; --")}`);
const after = await searchTotal('limit=1');
check('I2', 'role filter with DROP TABLE is plain text, and the table is still there', probe.r.status === 200 && probe.n === 0 && after.n === total, `${probe.n} matches, then ${after.n} profiles`);

res = await request('GET', `/alumni?country=${encodeURIComponent("MM' OR '1'='1")}`, { as: student });
check('I3', 'country filter with SQL → 400', res.status === 400, got(res));

res = await request('GET', `/alumni?faculty_id=${encodeURIComponent('1 OR 1=1')}`, { as: student });
check('I4', 'faculty filter with SQL → 400', res.status === 400, got(res));

res = await request('GET', '/alumni?is_active=0', { as: student });
check('I5', 'an unknown search parameter (is_active=0) → 400', res.status === 400, got(res));

res = await request('PATCH', '/alumni/me', {
  as: alumni,
  body: {
    display_name: 'Mass Assignment (demo)',
    grad_year: 2020,
    faculty_id: 7,
    is_active: true,
    identity_user_id: 'demo-alumni-kyaw-zin-htet',
    consent_timestamp: '2020-01-01T00:00:00Z',
  },
});
const named = Object.keys(res.json?.fields ?? {}).sort().join(', ');
const created = await request('GET', '/alumni/me', { as: alumni });
check(
  'I6',
  'setting is_active, identity_user_id or consent_timestamp → 400, and nothing is saved',
  res.status === 400 && named === 'consent_timestamp, identity_user_id, is_active' && created.status === 404,
  `${got(res)} on ${named}; profile afterwards: ${created.status}`,
);

res = await request('PATCH', '/alumni/me', { as: alumni, body: { contact_linkedin: 'javascript:alert(1)' } });
check('I7', 'a javascript: LinkedIn link → 400', res.status === 400 && 'contact_linkedin' in (res.json?.fields ?? {}), got(res));

// ── Privacy and PDPA ──────────────────────────────────────────────────────────────────────────
section('5  Privacy and PDPA');

const PRIVATE = /^(contact_|consent_|identity_user_id|is_active|mentee_capacity)/;
const leaks = (rows) => rows.flatMap((row) => Object.keys(row).filter((key) => PRIVATE.test(key)));

check('P1', `student search: ${directory.json?.data?.length ?? 0} profiles, no contact or consent fields`, directory.status === 200 && !leaks(directory.json.data).length, leaks(directory.json?.data ?? []).join(', ') || 'none');

const adminDirectory = await request('GET', '/alumni?limit=50', { as: admin });
check('P2', 'admin search: no contact or consent fields', adminDirectory.status === 200 && !leaks(adminDirectory.json.data).length, leaks(adminDirectory.json?.data ?? []).join(', ') || 'none');

const sharing = tryQuery('SELECT id, display_name FROM alumni_profiles WHERE is_active = 1 AND consent_contact_email = 1 ORDER BY display_name LIMIT 1')?.[0];
if (!sharing) {
  skip('P3', 'a stranger sees no contact details', 'no database access or no profile sharing an email');
  skip('P4', 'an admin sees no contact details', 'no database access or no profile sharing an email');
} else {
  res = await request('GET', `/alumni/${sharing.id}`, { as: student });
  check('P3', `a student not connected to ${sharing.display_name}, who shares an email, sees no contact`, res.status === 200 && !('contact' in res.json) && !res.text.includes('@'), `${res.status}, contact: ${'contact' in (res.json ?? {})}`);
  res = await request('GET', `/alumni/${sharing.id}`, { as: admin });
  check('P4', `an admin opening ${sharing.display_name} sees no contact`, res.status === 200 && !('contact' in res.json) && !res.text.includes('@'), `${res.status}, contact: ${'contact' in (res.json ?? {})}`);
}

const consent = tryQuery(
  `SELECT display_name, consent_contact_email AS email, consent_contact_line AS line,
          consent_contact_linkedin AS linkedin, consent_timestamp, consent_purpose_version
   FROM alumni_profiles WHERE consent_contact_email + consent_contact_line + consent_contact_linkedin > 0
   ORDER BY display_name`,
);
if (!consent) {
  skip('P5', 'every consent has a dated, versioned record', 'no database access');
} else {
  const undated = consent.filter((row) => !row.consent_timestamp || !row.consent_purpose_version);
  check('P5', `all ${consent.length} profiles sharing something have a dated, versioned consent record`, !undated.length, `${undated.length} without`);
  for (const row of consent) {
    const shared = ['email', 'line', 'linkedin'].filter((k) => row[k]).join(' + ');
    console.log(c.dim(`        ${row.display_name}: shares ${shared}, recorded ${row.consent_timestamp}, purpose ${row.consent_purpose_version}`));
  }
}

const triggers = tryQuery("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'contact_reveal_log' ORDER BY name");
if (!triggers) {
  skip('P6', 'the reveal log has its append-only triggers', 'no database access');
} else {
  const names = triggers.map((t) => t.name).join(', ');
  check('P6', `${IS_LOCAL ? 'local' : 'live'} reveal log has its append-only triggers`, names === 'contact_reveal_log_no_delete, contact_reveal_log_no_update', names);
}

const reveals = tryQuery('SELECT viewer_id, field_name, revealed_at FROM contact_reveal_log ORDER BY id DESC LIMIT 5');
if (reveals) {
  console.log(c.dim(`        ${IS_LOCAL ? 'local' : 'live'} reveal log, newest first:`));
  for (const row of reveals) console.log(c.dim(`        ${row.revealed_at}  ${row.viewer_id} saw ${row.field_name}`));
}

const before = (() => {
  try {
    return JSON.parse(
      execFileSync('npx', ['wrangler', 'd1', 'execute', 'alumni-network-db', '--local', '--json', '--command', 'SELECT COUNT(*) AS n, MIN(id) AS first FROM contact_reveal_log'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    )[0].results[0];
  } catch {
    return null;
  }
})();
if (!before?.n) {
  skip('P7', 'editing a reveal-log row is refused', 'the local database has no reveal-log rows yet');
  skip('P8', 'deleting a reveal-log row is refused', 'the local database has no reveal-log rows yet');
} else {
  const update = localError(`UPDATE contact_reveal_log SET viewer_id = 'tampered' WHERE id = ${before.first}`);
  check('P7', 'editing a reveal-log row is refused by the database (local)', /APPEND_ONLY/.test(update ?? ''), update ? update.match(/APPEND_ONLY[^"\n\x1b]*/)?.[0] : 'the update succeeded');
  const remove = localError(`DELETE FROM contact_reveal_log WHERE id = ${before.first}`);
  check('P8', 'deleting a reveal-log row is refused by the database (local)', /APPEND_ONLY/.test(remove ?? ''), remove ? remove.match(/APPEND_ONLY[^"\n\x1b]*/)?.[0] : 'the delete succeeded');
}

// ── Webhooks ──────────────────────────────────────────────────────────────────────────────────
section('6  Signed webhooks');

const event = JSON.stringify({
  event_id: `security-check-${run}`,
  event_type: 'alumni.event',
  occurred_at: new Date().toISOString(),
  data: { title: 'Forged event', starts_at: new Date().toISOString() },
});
res = await raw('POST', '/webhooks/events-clubs', { headers: { 'Content-Type': 'application/json' }, body: event });
check('W1', 'Events & Clubs webhook with no signature → 401', res.status === 401, got(res));

res = await raw('POST', '/webhooks/events-clubs', { headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': 'ab'.repeat(32) }, body: event });
check('W2', 'Events & Clubs webhook with a made-up signature → 401', res.status === 401, got(res));

res = await raw('POST', '/api/webhooks/partner', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: `security-${run}`, type: 'test', data: {} }) });
check('W3', 'Team 17 webhook receiver with no signature → 401', res.status === 401, `${res.status} ${res.json?.error ?? ''}`);

// ── Errors ────────────────────────────────────────────────────────────────────────────────────
section('7  Errors');

res = await raw('GET', '/nope');
check('E1', 'an unknown route answers JSON with no internal detail', res.status === 404 && JSON.stringify(Object.keys(res.json ?? {})) === '["error","code"]', res.text);

// ── Result ────────────────────────────────────────────────────────────────────────────────────
const count = passed + failures.length;
console.log('');
if (skipped.length) console.log(c.yellow(`${skipped.length} check(s) skipped.`));
if (failures.length) {
  console.log(c.red(c.bold(`✗ ${failures.length} of ${count} checks failed:`)));
  for (const label of failures) console.log(c.red(`  - ${label}`));
  process.exit(1);
}
console.log(c.green(c.bold(`✓ All ${count} checks passed`)));
