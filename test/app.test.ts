import { env } from 'cloudflare:test';
import { decode } from 'hono/jwt';
import { describe, expect, it } from 'vitest';

import app from '../src/index';
import { call, connect, makeAlumni, makePerson, nowSeconds, rows, tokenFor } from './helpers';

const PASSCODE = 'test-demo-passcode';

function demoLogin(body: Record<string, unknown>) {
  return call('POST', '/auth/demo-login', { body });
}

describe('POST /auth/demo-login', () => {
  it('signs in a demo account with the passcode, and the token works on the API', async () => {
    const res = await demoLogin({ passcode: PASSCODE, role: 'student', user_id: 'demo-student-su-myat' });
    expect(res.status).toBe(200);
    expect(res.json.user).toEqual({ id: 'demo-student-su-myat', role: 'student' });

    const search = await call('GET', '/alumni', { as: res.json.token });
    expect(search.status).toBe(200);
  });

  it('issues a token that expires within two hours', async () => {
    const res = await demoLogin({ passcode: PASSCODE, role: 'alumni', user_id: 'demo-alumni-test' });
    const { payload } = decode(res.json.token);
    expect(payload).toMatchObject({ sub: 'demo-alumni-test', role: 'alumni' });
    expect(payload.exp).toBeGreaterThan(nowSeconds());
    expect(payload.exp).toBeLessThanOrEqual(nowSeconds() + 2 * 3600);
    expect(res.json.expires_at).toBe(new Date((payload.exp as number) * 1000).toISOString());
  });

  it('rejects a wrong passcode', async () => {
    const res = await demoLogin({ passcode: 'wrong', role: 'admin', user_id: 'demo-admin' });
    expect(res.status).toBe(401);
    expect(res.json.code).toBe('INVALID_PASSCODE');
    expect(res.json).not.toHaveProperty('token');
  });

  it('marks its tokens as demo tokens', async () => {
    const res = await demoLogin({ passcode: PASSCODE, role: 'admin', user_id: 'demo-admin' });
    expect(decode(res.json.token).payload).toMatchObject({ sub: 'demo-admin', role: 'admin', demo: true });
  });

  it.each([
    ['an account outside the demo- prefix', { role: 'student', user_id: 'student-1' }, 'user_id'],
    ['a real-looking user ID', { role: 'admin', user_id: '6731503083' }, 'user_id'],
    ['a student ID asking to be admin', { role: 'admin', user_id: 'demo-student-su-myat' }, 'user_id'],
    ['an alumni ID asking to be a student', { role: 'student', user_id: 'demo-alumni-li-wei' }, 'user_id'],
    ['an unknown role', { role: 'superuser', user_id: 'demo-x1' }, 'role'],
    ['a missing passcode', { role: 'student', user_id: 'demo-student-1', passcode: undefined }, 'passcode'],
  ])('refuses %s', async (_label, fields, badField) => {
    const res = await demoLogin({ passcode: PASSCODE, ...fields });
    expect(res.status).toBe(400);
    expect(res.json.fields).toHaveProperty(badField);
  });

  it('refuses every request when no passcode is configured', async () => {
    const res = await app.request(
      '/auth/demo-login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: '', role: 'student', user_id: 'demo-student-1' }),
      },
      { ...env, DEMO_PASSCODE: '' },
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('DEMO_LOGIN_NOT_CONFIGURED');
  });
});

describe('a demo admin', () => {
  async function demoAdminToken() {
    const res = await demoLogin({ passcode: PASSCODE, role: 'admin', user_id: 'demo-admin' });
    return res.json.token as string;
  }

  it('can turn off a demo profile', async () => {
    const demoAlumni = await call('PATCH', '/alumni/me', {
      as: await tokenFor('alumni', `demo-alumni-${crypto.randomUUID().slice(0, 8)}`),
      body: { display_name: 'Demo Profile', grad_year: 2020, faculty_id: 7 },
    });
    const res = await call('PATCH', `/admin/alumni/${demoAlumni.json.id}/deactivate`, { as: await demoAdminToken() });
    expect(res.status).toBe(200);
  });

  it('cannot turn off a real profile', async () => {
    const real = await makeAlumni();
    const res = await call('PATCH', `/admin/alumni/${real.profileId}/deactivate`, { as: await demoAdminToken() });
    expect(res.status).toBe(403);
    expect(res.json.code).toBe('DEMO_ADMIN_LIMITED');
    const [row] = await rows('SELECT is_active FROM alumni_profiles WHERE id = ?', real.profileId);
    expect(row.is_active).toBe(1);
  });

  it('still gets 404 for an unknown profile', async () => {
    const res = await call('PATCH', '/admin/alumni/no-such-id/deactivate', { as: await demoAdminToken() });
    expect(res.status).toBe(404);
  });
});

describe('GET /alumni/me', () => {
  it('returns 404 before the alumni has a profile', async () => {
    const res = await call('GET', '/alumni/me', { as: await makePerson('alumni') });
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('NOT_FOUND');
  });

  it('returns the owner view, with contact and consent fields', async () => {
    const alumni = await makeAlumni({ contact_email: 'me@example.com', consent_contact_email: true });
    const res = await call('GET', '/alumni/me', { as: alumni });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: alumni.profileId,
      contact_email: 'me@example.com',
      consent_contact_email: true,
      consent_purpose_version: 'v1',
    });
  });

  it('is for alumni only', async () => {
    const res = await call('GET', '/alumni/me', { as: await makePerson('student') });
    expect(res.status).toBe(403);
  });
});

describe('admin browsing the directory', () => {
  it('can search and open profiles, without contact or consent data', async () => {
    const alumni = await makeAlumni({
      display_name: 'Admin Visible',
      contact_email: 'hidden@example.com',
      consent_contact_email: true,
    });
    await connect(await makePerson('student'), alumni);
    const admin = await makePerson('admin');

    const list = await call('GET', '/alumni?limit=50', { as: admin });
    expect(list.status).toBe(200);

    const profile = await call('GET', `/alumni/${alumni.profileId}`, { as: admin });
    expect(profile.status).toBe(200);
    expect(profile.json.display_name).toBe('Admin Visible');
    expect(profile.text).not.toContain('hidden@example.com');
    expect(profile.text).not.toContain('consent');
    expect(profile.json).not.toHaveProperty('contact');
  });
});

describe('GET /app', () => {
  it('is served as an HTML page', async () => {
    const res = await call('GET', '/app');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('sends a strict Content-Security-Policy whose nonce matches every script and style tag', async () => {
    const res = await call('GET', '/app');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    const nonce = /'nonce-([\w-]+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    const tags = [...res.text.matchAll(/<(script|style)\b[^>]*>/g)].map((match) => match[0]);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toContain(`nonce="${nonce}"`);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('uses a new nonce on every request', async () => {
    const first = (await call('GET', '/app')).headers.get('Content-Security-Policy');
    const second = (await call('GET', '/app')).headers.get('Content-Security-Policy');
    expect(first).not.toBe(second);
  });

  // PRD test 10, page half: user text is only ever set as text, never parsed as HTML.
  it('never builds HTML from strings or uses inline event handlers', async () => {
    const { text } = await call('GET', '/app');
    expect(text).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(text).not.toMatch(/\son[a-z]+=/i);
  });

  it('lists exactly the faculties and interests in the database', async () => {
    const { text } = await call('GET', '/app');
    const json = /<script\b[^>]*\bid="reference"[^>]*>([\s\S]*?)<\/script>/.exec(text)?.[1];
    const reference = JSON.parse(json ?? '{}');
    expect(reference.faculties).toEqual(await rows('SELECT id, name FROM faculties ORDER BY id'));
    expect(reference.interests).toEqual((await rows('SELECT name FROM interests ORDER BY id')).map((r) => r.name));
  });

  it('holds no secret', async () => {
    const { text } = await call('GET', '/app');
    for (const secret of [env.JWT_SECRET, env.DEMO_PASSCODE, env.WEBHOOK_SECRET, env.PARTNER_WEBHOOK_SECRET]) {
      expect(text).not.toContain(secret);
    }
  });
});
