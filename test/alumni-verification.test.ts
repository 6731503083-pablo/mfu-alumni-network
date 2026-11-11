import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { call, makePerson, rows, tokenFor } from './helpers';

// PRD Assumption 1 fallback: personal email plus Alumni Association approval.

let counter = 0;
function claim(fields: Record<string, unknown> = {}) {
  counter += 1;
  return {
    email: `alumni${counter}.${crypto.randomUUID().slice(0, 6)}@gmail.com`,
    display_name: 'Thiri Aung',
    student_id: String(6000000000 + Math.floor(Math.random() * 999999999)),
    faculty_id: 7,
    grad_year: 2022,
    ...fields,
  };
}

const register = (body: unknown) => call('POST', '/auth/alumni/register', { body });
const review = (as: unknown, id: string, body: unknown) =>
  call('PATCH', `/admin/alumni-verifications/${id}`, { as: as as any, body });
const askForCode = (email: string) => call('POST', '/auth/alumni/sign-in-link', { body: { email } });
const signIn = (code: string) => call('POST', '/auth/alumni/sign-in', { body: { code } });

// @example.com is reserved, so it can never be a real inbox: the only claims demo powers reach.
const demoEmail = () => `thiri.${crypto.randomUUID().slice(0, 8)}@example.com`;
const demoAdmin = () => tokenFor('admin', 'demo-admin', { demo: true });
const tokenClaims = (token: string) => JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function approvedAccount(email = demoEmail()) {
  const admin = await makePerson('admin');
  const body = claim({ email });
  const res = await register(body);
  const approved = await review(admin, res.json.id, { status: 'approved' });
  return { body, id: res.json.id as string, identityUserId: approved.json.identity_user_id as string };
}

describe('POST /auth/alumni/register', () => {
  it('stores a pending claim without signing anyone in', async () => {
    const body = claim({ email: '  Thiri.Aung@Gmail.com ' });
    const res = await register(body);
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ status: 'pending' });
    expect(res.json.token).toBeUndefined();
    const [row] = await rows('SELECT email, status, identity_user_id FROM alumni_verifications WHERE id = ?', res.json.id);
    expect(row).toEqual({ email: 'thiri.aung@gmail.com', status: 'pending', identity_user_id: null });
  });

  it('refuses a student address, which closes after graduation', async () => {
    const res = await register(claim({ email: '6531501234@lamduan.mfu.ac.th' }));
    expect(res.status).toBe(400);
    expect(res.json.fields.email).toMatch(/personal email/);
  });

  it('refuses the student domain in capitals too', async () => {
    const res = await register(claim({ email: '6531501234@LAMDUAN.MFU.AC.TH' }));
    expect(res.status).toBe(400);
  });

  it.each([
    ['a student ID that is not 10 digits', { student_id: '12345' }, 'student_id'],
    ['a year in the future', { grad_year: new Date().getUTCFullYear() + 1 }, 'grad_year'],
    ['a year before MFU', { grad_year: 1990 }, 'grad_year'],
    ['an empty name', { display_name: ' ' }, 'display_name'],
    ['an unknown faculty', { faculty_id: 9999 }, 'faculty_id'],
    ['a field the API does not take', { status: 'approved' }, 'status'],
  ])('refuses %s', async (_label, fields, field) => {
    const res = await register(claim(fields));
    expect(res.status).toBe(400);
    expect(res.json.fields).toHaveProperty(field);
  });

  it('refuses a second open claim for the same email or student ID', async () => {
    const first = claim();
    expect((await register(first)).status).toBe(201);
    const sameEmail = await register(claim({ email: first.email.toUpperCase() }));
    const sameStudent = await register(claim({ student_id: first.student_id }));
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.json.code).toBe('ALREADY_REGISTERED');
    expect(sameStudent.status).toBe(409);
  });

  it('accepts a new claim after the last one was rejected', async () => {
    const admin = await makePerson('admin');
    const body = claim();
    const first = await register(body);
    await review(admin, first.json.id, { status: 'rejected', note: 'Not in the 2022 records' });
    expect((await register(body)).status).toBe(201);
  });
});

describe('Alumni Association review', () => {
  it('only lets admins see the queue', async () => {
    const student = await makePerson('student');
    const alumni = await makePerson('alumni');
    expect((await call('GET', '/admin/alumni-verifications')).status).toBe(401);
    expect((await call('GET', '/admin/alumni-verifications', { as: student })).status).toBe(403);
    expect((await call('GET', '/admin/alumni-verifications', { as: alumni })).status).toBe(403);
  });

  it('lists pending claims with what the Association needs to check them', async () => {
    const admin = await makePerson('admin');
    const body = claim();
    const { json } = await register(body);
    const res = await call('GET', '/admin/alumni-verifications', { as: admin });
    expect(res.status).toBe(200);
    const row = res.json.data.find((r: any) => r.id === json.id);
    expect(row).toMatchObject({
      email: body.email,
      student_id: body.student_id,
      grad_year: 2022,
      faculty_id: 7,
      status: 'pending',
    });
    expect(row.faculty).toEqual(expect.any(String));
  });

  it('approves a claim and gives it an ID that cannot collide with Identity', async () => {
    const admin = await makePerson('admin');
    const { json } = await register(claim());
    const res = await review(admin, json.id, { status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.json.identity_user_id).toMatch(/^personal-[0-9a-f-]{36}$/);
    const [row] = await rows('SELECT reviewed_by, reviewed_at FROM alumni_verifications WHERE id = ?', json.id);
    expect(row.reviewed_by).toBe(admin.id);
    expect(row.reviewed_at).toEqual(expect.any(String));
  });

  it('refuses to review a claim twice', async () => {
    const admin = await makePerson('admin');
    const { json } = await register(claim());
    await review(admin, json.id, { status: 'rejected' });
    const again = await review(admin, json.id, { status: 'approved' });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('ALREADY_REVIEWED');
  });

  it('answers 404 for an unknown claim', async () => {
    const admin = await makePerson('admin');
    expect((await review(admin, 'nope', { status: 'approved' })).status).toBe(404);
  });

  it('does not let an alumni approve their own claim', async () => {
    const alumni = await makePerson('alumni');
    const { json } = await register(claim());
    expect((await review(alumni, json.id, { status: 'approved' })).status).toBe(403);
  });
});

describe('Signing in with a personal email', () => {
  it('says the same for a real email with an account as for one without', async () => {
    const { body } = await approvedAccount(`thiri.${crypto.randomUUID().slice(0, 8)}@gmail.com`);
    const known = await askForCode(body.email);
    const unknown = await askForCode('nobody@gmail.com');
    expect(known.status).toBe(202);
    expect(known.json.demo_code).toBeUndefined();
    expect(unknown.json).toEqual(known.json);
  });

  it('refuses an email that is not valid', async () => {
    const res = await askForCode('not-an-email');
    expect(res.status).toBe(400);
    expect(res.json.fields).toHaveProperty('email');
  });

  it('gives no code to a claim that is still pending', async () => {
    const body = claim({ email: demoEmail() });
    await register(body);
    const res = await askForCode(body.email);
    expect(res.status).toBe(202);
    expect(res.json.demo_code).toBeUndefined();
  });

  it('stores only a hash of the code', async () => {
    const { body, id } = await approvedAccount();
    const { json } = await askForCode(body.email);
    const stored = await rows('SELECT code_hash FROM alumni_sign_in_codes WHERE verification_id = ?', id);
    expect(stored).toHaveLength(1);
    expect(stored[0].code_hash).not.toBe(json.demo_code);
  });

  it('signs in once with the code, then refuses it', async () => {
    const { body, identityUserId } = await approvedAccount();
    const { json } = await askForCode(body.email.toUpperCase());
    const first = await signIn(json.demo_code);
    expect(first.status).toBe(200);
    expect(first.json.user).toEqual({ id: identityUserId, role: 'alumni' });
    const second = await signIn(json.demo_code);
    expect(second.status).toBe(401);
    expect(second.json.code).toBe('INVALID_CODE');
  });

  it('lets only one of two requests with the same code through', async () => {
    const { body } = await approvedAccount();
    const { json } = await askForCode(body.email);
    const results = await Promise.all([signIn(json.demo_code), signIn(json.demo_code)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('refuses an expired code', async () => {
    const { body, id } = await approvedAccount();
    const { json } = await askForCode(body.email);
    await env.DB.prepare('UPDATE alumni_sign_in_codes SET expires_at = ? WHERE verification_id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), id)
      .run();
    expect((await signIn(json.demo_code)).status).toBe(401);
  });

  it('refuses a made-up code', async () => {
    expect((await signIn('a'.repeat(64))).status).toBe(401);
    expect((await signIn('not-a-code')).status).toBe(400);
  });

  it('takes an approved alumni from sign-up to a profile students can find', async () => {
    const { body, identityUserId } = await approvedAccount();
    const { json } = await askForCode(body.email);
    const { json: session } = await signIn(json.demo_code);

    const created = await call('PATCH', '/alumni/me', {
      as: session.token,
      body: { display_name: body.display_name, grad_year: body.grad_year, faculty_id: body.faculty_id, is_open_to_mentoring: true },
    });
    expect(created.status).toBe(201);
    const [profile] = await rows('SELECT identity_user_id FROM alumni_profiles WHERE id = ?', created.json.id);
    expect(profile.identity_user_id).toBe(identityUserId);

    const student = await makePerson('student');
    const found = await call('GET', `/alumni/${created.json.id}`, { as: student });
    expect(found.status).toBe(200);
  });
});

describe('Demo powers reach demo claims only (invariant 9)', () => {
  it('never returns a code for a real email', async () => {
    const { body, id } = await approvedAccount('thiri.real@gmail.com'.replace('real', crypto.randomUUID().slice(0, 8)));
    const res = await askForCode(body.email);
    expect(res.status).toBe(202);
    expect(res.json.demo_code).toBeUndefined();
    expect(await rows('SELECT 1 FROM alumni_sign_in_codes WHERE verification_id = ?', id)).toHaveLength(0);
  });

  it('shows a demo admin demo claims only', async () => {
    const real = await register(claim());
    const demo = await register(claim({ email: demoEmail() }));
    const res = await call('GET', '/admin/alumni-verifications', { as: await demoAdmin() });
    expect(res.status).toBe(200);
    const ids = res.json.data.map((r: any) => r.id);
    expect(ids).toContain(demo.json.id);
    expect(ids).not.toContain(real.json.id);
    expect(res.json.data.every((r: any) => r.email.endsWith('@example.com'))).toBe(true);
  });

  it('lets a demo admin review demo claims, and answers 404 for a real one', async () => {
    const admin = await demoAdmin();
    const real = await register(claim());
    const demo = await register(claim({ email: demoEmail() }));
    const refused = await review(admin, real.json.id, { status: 'approved' });
    expect(refused.status).toBe(404);
    const [row] = await rows('SELECT status, identity_user_id FROM alumni_verifications WHERE id = ?', real.json.id);
    expect(row).toEqual({ status: 'pending', identity_user_id: null });
    expect((await review(admin, demo.json.id, { status: 'approved' })).status).toBe(200);
  });

  it('marks a demo claim\'s token as demo, and a real one\'s not', async () => {
    const demo = await approvedAccount();
    const { json } = await askForCode(demo.body.email);
    const demoSession = await signIn(json.demo_code);
    expect(tokenClaims(demoSession.json.token).demo).toBe(true);

    // A real claim's code would arrive by email. Stand in for that by storing one directly.
    const real = await approvedAccount(`thiri.${crypto.randomUUID().slice(0, 8)}@gmail.com`);
    const code = 'b'.repeat(64);
    await env.DB.prepare('INSERT INTO alumni_sign_in_codes (code_hash, verification_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(code), real.id, new Date(Date.now() + 60_000).toISOString())
      .run();
    const realSession = await signIn(code);
    expect(realSession.status).toBe(200);
    expect(tokenClaims(realSession.json.token).demo).toBeUndefined();
  });
});
