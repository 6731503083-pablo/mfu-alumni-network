// The happy path from the presentation (slide 6, "Five steps to a mentor"), run against the real
// API. Every call checks its expected status, so this is also an end-to-end test: it exits 1 if
// any check fails.
//
//   npm run demo                                   # live site
//   BASE_URL=http://localhost:8787 npm run demo    # local `npm run dev`
//   npm run demo -- --keep                         # skip the admin step that hides this run's alumni
import { BASE_URL, IS_LOCAL, c, person, query, request, signToken } from './lib.mjs';
import { seed, seedPerson } from './seed.mjs';

const KEEP = process.argv.includes('--keep');
const run = Date.now().toString(36);
const UUID = /^[0-9a-f-]{36}$/;

let passed = 0;
const failures = [];

function check(label, ok) {
  if (ok) passed++;
  else failures.push(label);
  console.log(`    ${ok ? c.green('✓') : c.red('✗')} ${label}`);
}

function heading(number, title, rule) {
  console.log(`\n${c.bold(c.cyan(`${number}  ${title}`))}${rule ? c.dim(`   ${rule}`) : ''}`);
}

const describeCaller = (as) =>
  as === null ? 'no token' : typeof as === 'string' ? 'hand-made token' : `${as.role} ${c.dim(as.name)}`;

/**
 * Sends a request, prints it, and checks the status. `show` picks what to print from the response:
 * an object, or an array of lines for a list. `caller` replaces the "as ..." label.
 */
async function call(method, path, { as = null, caller, body, expect, show } = {}) {
  console.log(`  ${c.bold(method)} ${decodeURIComponent(path)}  ${c.dim('as')} ${caller ?? describeCaller(as)}`);
  const res = await request(method, path, { as, body });
  const detail = show ? show(res.json) : res.json?.code ? `${res.json.code}: ${res.json.error}` : '';
  const colour = res.status < 300 ? c.green : res.status < 500 ? c.yellow : c.red;
  if (Array.isArray(detail)) {
    console.log(`    ${colour(res.status)} ${detail.length} result(s)`);
    for (const line of detail) console.log(`      ${c.dim('•')} ${line}`);
  } else {
    console.log(`    ${colour(res.status)} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  if (expect !== undefined) check(`returns ${expect}`, res.status === expect);
  return res;
}

const names = (json) => (json?.data ?? []).map((a) => `${a.display_name} · ${a.job_title} · ${a.city}, ${a.country_code}`);

function printRows(title, sql) {
  try {
    const rows = query(sql);
    console.log(`  ${c.bold('D1')} ${title}`);
    if (!rows.length) console.log(`      ${c.dim('(no rows)')}`);
    for (const row of rows) console.log(`      ${c.dim('•')} ${JSON.stringify(row)}`);
    return rows;
  } catch (err) {
    console.log(c.yellow(`  Skipped the database view: ${String(err.message).split('\n')[0]}`));
    return null;
  }
}

console.log(c.bold('MFU Alumni Network — happy path demo'));
console.log(c.dim(`${BASE_URL}   run ${run}${IS_LOCAL ? '   (local)' : ''}`));

const seeded = await seed({ quiet: true });
console.log(c.dim(`${Object.keys(seeded).length} seed alumni ready (npm run demo:seed)`));

const thiri = person('alumni', `demo-alumni-thiri-${run}`, 'Thiri Aung');
const student = person('student', `demo-student-${run}`, 'Su Myat');
const secondStudent = person('student', `demo-student-b-${run}`, 'Ko Min');
const liWei = seedPerson('li-wei');
const admin = person('admin', 'demo-admin', 'Admin');

// ── Setup ─────────────────────────────────────────────────────────────────────────────────────
heading('0', 'Alumni joins on their own terms', 'BR-01 · BR-02');
const created = await call('PATCH', '/alumni/me', {
  as: thiri,
  expect: 201,
  body: {
    display_name: 'Thiri Aung (demo)',
    grad_year: 2020,
    faculty_id: 7,
    job_title: 'ဆော့ဖ်ဝဲ အင်ဂျင်နီယာ',
    company: 'Golden Land Software (demo)',
    country_code: 'MM',
    city: 'Mandalay',
    bio: 'Full-stack developer. I mentor students who want to work in Myanmar tech.',
    is_open_to_mentoring: true,
    mentee_capacity: 1,
    contact_email: `thiri.${run}@example.com`,
    contact_line: `thiri_${run}`,
    consent_contact_email: true,
    consent_contact_line: false,
    interests: ['Software Development', 'Working Abroad'],
  },
  show: (p) => ({
    consent_contact_email: p.consent_contact_email,
    consent_contact_line: p.consent_contact_line,
    consent_timestamp: p.consent_timestamp,
    consent_purpose_version: p.consent_purpose_version,
    mentee_capacity: p.mentee_capacity,
  }),
});
const thiriId = created.json?.id;
check('server recorded when and for what purpose consent was given', Boolean(created.json?.consent_timestamp && created.json?.consent_purpose_version));

// ── 1. Search ─────────────────────────────────────────────────────────────────────────────────
heading('1', 'Search', '5 filters, Burmese and Thai text');
const engineer = encodeURIComponent('အင်ဂျင်နီယာ');
const mm = await call('GET', `/alumni?country=MM&role=${engineer}&open_to_mentoring=true`, {
  as: student,
  expect: 200,
  show: names,
});
check('finds Thiri by a Burmese job title', mm.json?.data?.some((a) => a.id === thiriId));
check('search results contain no contact details', !mm.text.includes('example.com'));
const nurse = encodeURIComponent('พยาบาล');
const th = await call('GET', `/alumni?country=TH&role=${nurse}`, {
  as: student,
  expect: 200,
  show: names,
});
check('finds a nurse by a Thai job title', th.json?.data?.some((a) => a.id === seeded['nattaya-srisuk']));

// ── 2. View profile ───────────────────────────────────────────────────────────────────────────
heading('2', 'View profile', 'only fields the alumni allows');
const stranger = await call('GET', `/alumni/${thiriId}`, {
  as: student,
  expect: 200,
  show: (p) => ({ display_name: p.display_name, city: p.city, interests: p.interests, contact: p.contact ?? '(hidden)' }),
});
check('no contact details before a connection', !stranger.json?.contact && !stranger.text.includes('example.com'));

// ── 3. Request ────────────────────────────────────────────────────────────────────────────────
heading('3', 'Request', 'must write "what I want help with" · 1 per alumni · 5 in total');
await call('POST', '/mentoring-requests', {
  as: student,
  expect: 400,
  body: { alumni_id: thiriId, message: 'Hi' },
  show: (json) => json?.fields,
});
const sent = await call('POST', '/mentoring-requests', {
  as: student,
  expect: 201,
  body: {
    alumni_id: thiriId,
    message: 'I am a third-year IT student. I want advice on software jobs in Myanmar after graduating.',
  },
  show: (r) => ({ id: r.id, status: r.status }),
});
const requestId = sent.json?.id;
await call('POST', '/mentoring-requests', {
  as: student,
  expect: 409,
  body: { alumni_id: thiriId, message: 'Sending the same request again by mistake.' },
});
const toLiWei = await call('POST', '/mentoring-requests', {
  as: student,
  expect: 201,
  body: { alumni_id: seeded['li-wei'], message: 'How did you start in cross-border marketing in China?' },
  show: (r) => ({ id: r.id, status: r.status }),
});

// ── 4. Accept / reject ────────────────────────────────────────────────────────────────────────
heading('4', 'Accept / reject', 'one tap · capacity, consent, log and outbox in one transaction');
const inbox = await call('GET', '/mentoring-requests/me', {
  as: thiri,
  expect: 200,
  show: (json) => (json?.data ?? []).map((r) => `${r.status} · "${r.message.slice(0, 50)}…"`),
});
check('Thiri sees the pending request', inbox.json?.data?.some((r) => r.id === requestId && r.status === 'pending'));
const accepted = await call('PATCH', `/mentoring-requests/${requestId}`, {
  as: thiri,
  expect: 200,
  body: { status: 'accepted' },
  show: (r) => ({ status: r.status, connection_id: r.connection?.id, revealed_fields: r.revealed_fields }),
});
const connectionId = accepted.json?.connection?.id;
check('only the consented field is revealed', JSON.stringify(accepted.json?.revealed_fields) === '["contact_email"]');
await call('PATCH', `/mentoring-requests/${toLiWei.json?.id}`, {
  as: liWei,
  expect: 200,
  body: { status: 'rejected' },
  show: (r) => ({ status: r.status, responded_at: r.responded_at }),
});
console.log(c.dim('  Thiri set a limit of 1 mentee. A second student asks anyway:'));
const second = await call('POST', '/mentoring-requests', {
  as: secondStudent,
  expect: 201,
  body: { alumni_id: thiriId, message: 'Could you review my CV for a junior developer role?' },
  show: (r) => ({ id: r.id, status: r.status }),
});
await call('PATCH', `/mentoring-requests/${second.json?.id}`, { as: thiri, expect: 409, body: { status: 'accepted' } });

// ── 5. Connect ────────────────────────────────────────────────────────────────────────────────
heading('5', 'Connect', 'contact shared · logged · notification queued');
const connected = await call('GET', `/alumni/${thiriId}`, {
  as: student,
  expect: 200,
  show: (p) => ({ display_name: p.display_name, contact: p.contact }),
});
check('the student sees the email', connected.json?.contact?.email === `thiri.${run}@example.com`);
check('the student does not see LINE, which was not consented', !connected.text.includes(`thiri_${run}`));
if (UUID.test(connectionId ?? '')) {
  const reveals = printRows(
    'contact_reveal_log (append-only, BR-10)',
    `SELECT field_name, viewer_id, revealed_at FROM contact_reveal_log WHERE connection_id = '${connectionId}'`,
  );
  if (reveals) check('the reveal is logged', reveals.some((r) => r.field_name === 'contact_email' && r.viewer_id === student.id));
  const outbox = printRows(
    'webhook_outbox (FR-10)',
    `SELECT event_type, status, attempts FROM webhook_outbox WHERE json_extract(payload, '$.connection_id') = '${connectionId}'`,
  );
  if (outbox) check('alumni.connection_created is queued', outbox.some((r) => r.event_type === 'alumni.connection_created'));
}

// ── Consent withdrawn ─────────────────────────────────────────────────────────────────────────
heading('6', 'Alumni takes consent back', 'BR-03');
await call('PATCH', '/alumni/me', {
  as: thiri,
  expect: 200,
  body: { consent_contact_email: false },
  show: (p) => ({ consent_contact_email: p.consent_contact_email }),
});
const withdrawn = await call('GET', `/alumni/${thiriId}`, {
  as: student,
  expect: 200,
  show: (p) => ({ display_name: p.display_name, contact: p.contact }),
});
check('the email is hidden again', !withdrawn.text.includes('example.com'));

// ── Security ──────────────────────────────────────────────────────────────────────────────────
heading('7', 'Security checks', 'token on every call · roles · ownership');
await call('GET', '/alumni', { as: null, expect: 401 });
await call('GET', '/alumni', {
  as: signToken('student', 'attacker', { secret: 'guessed-secret' }),
  caller: 'a token signed with a guessed secret',
  expect: 401,
});
await call('GET', '/alumni', {
  as: signToken('student', student.id, { expiresIn: -3600 }),
  caller: 'a token that expired an hour ago',
  expect: 401,
});
await call('PATCH', `/admin/alumni/${thiriId}/deactivate`, { as: student, expect: 403 });
await call('PATCH', `/mentoring-requests/${second.json?.id}`, {
  as: student,
  caller: `student ${c.dim("Su Myat, cancelling Ko Min's request")}`,
  expect: 403,
  body: { status: 'cancelled' },
});

// ── Admin ─────────────────────────────────────────────────────────────────────────────────────
if (!KEEP) {
  heading('8', 'Admin keeps data clean', "turns a profile off · nothing is hard-deleted");
  await call('PATCH', `/admin/alumni/${thiriId}/deactivate`, { as: admin, expect: 200, show: (r) => r });
  await call('GET', `/alumni/${thiriId}`, { as: student, expect: 404 });
}

// ── Result ────────────────────────────────────────────────────────────────────────────────────
const total = passed + failures.length;
console.log('');
if (failures.length) {
  console.log(c.red(c.bold(`✗ ${failures.length} of ${total} checks failed:`)));
  for (const label of failures) console.log(c.red(`  - ${label}`));
  process.exit(1);
}
console.log(c.green(c.bold(`✓ All ${total} checks passed`)));
