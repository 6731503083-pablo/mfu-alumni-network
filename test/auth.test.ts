import { env } from 'cloudflare:test';
import { sign } from 'hono/jwt';
import { describe, expect, it } from 'vitest';

import app from '../src/index';
import { call, makePerson, nowSeconds, tokenFor } from './helpers';

const PROTECTED_ROUTES: [string, string][] = [
  ['GET', '/alumni'],
  ['GET', '/alumni/some-id'],
  ['GET', '/alumni/me'],
  ['PATCH', '/alumni/me'],
  ['POST', '/mentoring-requests'],
  ['GET', '/mentoring-requests/me'],
  ['PATCH', '/mentoring-requests/some-id'],
  ['DELETE', '/connections/some-id'],
  ['PATCH', '/admin/alumni/some-id/deactivate'],
];

const base64url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function expectUnauthenticated(res: Awaited<ReturnType<typeof call>>) {
  expect(res.status).toBe(401);
  expect(res.json.code).toBe('UNAUTHENTICATED');
}

describe('token checks', () => {
  it.each(PROTECTED_ROUTES)('%s %s needs a token', async (method, path) => {
    const res = await call(method, path);
    expectUnauthenticated(res);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('rejects a token that is not a JWT', async () => {
    expectUnauthenticated(await call('GET', '/alumni', { as: 'not-a-jwt' }));
  });

  it('rejects a scheme other than Bearer', async () => {
    const token = await tokenFor('student', 'student-1');
    expectUnauthenticated(
      await call('GET', '/alumni', { headers: { Authorization: `Basic ${token}` } }),
    );
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await sign(
      { sub: 'student-1', role: 'student', exp: nowSeconds() + 3600 },
      'some-other-secret',
      'HS256',
    );
    expectUnauthenticated(await call('GET', '/alumni', { as: token }));
  });

  // PRD test 11.
  it('rejects an expired token', async () => {
    const token = await tokenFor('student', 'student-1', { exp: nowSeconds() - 3600 });
    expectUnauthenticated(await call('GET', '/alumni', { as: token }));
  });

  it('allows a few seconds of clock skew on expiry', async () => {
    const token = await tokenFor('student', 'student-1', { exp: nowSeconds() - 5 });
    expect((await call('GET', '/alumni', { as: token })).status).toBe(200);
  });

  it('rejects a token with no expiry', async () => {
    const token = await sign({ sub: 'student-1', role: 'student' }, env.JWT_SECRET, 'HS256');
    expectUnauthenticated(await call('GET', '/alumni', { as: token }));
  });

  it('rejects an unsigned alg:none token', async () => {
    const payload = { sub: 'student-1', role: 'student', exp: nowSeconds() + 3600 };
    const token = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.`;
    expectUnauthenticated(await call('GET', '/alumni', { as: token }));
  });

  it('rejects a token with no user ID', async () => {
    const token = await sign({ role: 'student', exp: nowSeconds() + 3600 }, env.JWT_SECRET, 'HS256');
    expectUnauthenticated(await call('GET', '/alumni', { as: token }));
  });

  it('accepts the PRD claim name user_id when sub is absent', async () => {
    const token = await sign(
      { user_id: 'student-1', role: 'student', exp: nowSeconds() + 3600 },
      env.JWT_SECRET,
      'HS256',
    );
    expect((await call('GET', '/alumni', { as: token })).status).toBe(200);
  });

  it('refuses every token when JWT_SECRET is not set', async () => {
    const token = await tokenFor('student', 'student-1');
    const res = await app.request(
      '/alumni',
      { headers: { Authorization: `Bearer ${token}` } },
      { ...env, JWT_SECRET: '' },
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('AUTH_NOT_CONFIGURED');
  });
});

// PRD test 7, role half. The ownership half is in requests.test.ts and connections.test.ts.
describe('role checks', () => {
  const MATRIX: [string, string, string[]][] = [
    // Admins browse public fields to find profiles to deactivate (slide 4). They never see contact.
    ['GET', '/alumni', ['student', 'alumni', 'admin']],
    ['GET', '/alumni/missing-id', ['student', 'alumni', 'admin']],
    ['GET', '/alumni/me', ['alumni']],
    ['PATCH', '/alumni/me', ['alumni']],
    ['POST', '/mentoring-requests', ['student']],
    ['GET', '/mentoring-requests/me', ['student', 'alumni']],
    ['PATCH', '/mentoring-requests/missing-id', ['student', 'alumni']],
    ['DELETE', '/connections/missing-id', ['student', 'alumni']],
    ['PATCH', '/admin/alumni/missing-id/deactivate', ['admin']],
  ];

  const cases = MATRIX.flatMap(([method, path, allowed]) =>
    ['student', 'alumni', 'admin', 'superuser'].map(
      (role) => [role, method, path, allowed.includes(role)] as const,
    ),
  );

  it.each(cases)('%s calling %s %s: allowed=%s', async (role, method, path, allowed) => {
    const person = await makePerson(role);
    const hasBody = method === 'POST' || method === 'PATCH';
    const res = await call(method, path, { as: person, ...(hasBody ? { body: {} } : {}) });
    if (allowed) {
      expect([401, 403]).not.toContain(res.status);
    } else {
      expect(res.status).toBe(403);
      expect(res.json.code).toBe('FORBIDDEN');
    }
  });
});
