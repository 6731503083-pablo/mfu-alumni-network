import { SELF, env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { call, hmacHex, makePerson, rows } from './helpers';

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;');

describe('GET /docs', () => {
  it('is served as an HTML page', async () => {
    const res = await call('GET', '/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('has a console for every route the Worker serves', async () => {
    const { text } = await call('GET', '/docs');
    // Routes with middleware appear more than once in app.routes.
    const routes = new Set(
      app.routes
        .filter((route) => route.method !== 'ALL' && !['/', '/docs', '/app'].includes(route.path))
        .map((route) => `${route.method} ${route.path.replace(/:(\w+)/g, '{$1}')}`),
    );
    expect(routes.size).toBe(23);
    for (const route of routes) {
      const [method, path] = route.split(' ');
      expect(text, route).toContain(`data-method="${method}" data-path="${path}"`);
    }
  });

  it('lists every faculty and interest clients can use', async () => {
    const { text } = await call('GET', '/docs');
    for (const { name } of await rows('SELECT name FROM faculties UNION SELECT name FROM interests')) {
      expect(text).toContain(escapeHtml(name));
    }
  });

  it('holds no secret', async () => {
    const { text } = await call('GET', '/docs');
    expect(text).not.toContain(env.JWT_SECRET);
    expect(text).not.toContain(env.WEBHOOK_SECRET);
    expect(text).not.toContain(env.EVENTS_CLUBS_WEBHOOK_SECRET);
    expect(text).not.toContain(env.PARTNER_WEBHOOK_SECRET);
  });
});

describe('test setup', () => {
  it('uses fixed test secrets, not the real ones in .dev.vars', () => {
    expect(env.JWT_SECRET).toBe('test-jwt-secret');
    expect(env.WEBHOOK_SECRET).toBe('test-team17-webhook-secret');
    expect(env.PARTNER_WEBHOOK_SECRET).toBe('test-partner-secret');
    expect(env.EVENTS_CLUBS_WEBHOOK_SECRET).toBe('test-events-clubs-secret');
  });
});

describe('reference data', () => {
  it("seeds MFU's 15 current schools and the data design's 17 interests", async () => {
    expect(await rows('SELECT id FROM faculties')).toHaveLength(15);
    expect(await rows('SELECT id FROM interests')).toHaveLength(17);
    const [faculty] = await rows('SELECT name FROM faculties WHERE id = 7');
    expect(faculty.name).toBe('School of Applied Digital Technology');
  });
});

describe('errors', () => {
  it('answers an unknown route with JSON', async () => {
    const res = await call('GET', '/nope');
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('NOT_FOUND');
  });

  it('answers an unexpected failure with JSON and no internal detail', async () => {
    const silenceExpectedLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = 'not json';
    const res = await call('POST', '/api/webhooks/partner', {
      rawBody: body,
      headers: { 'X-Webhook-Signature': await hmacHex(env.WEBHOOK_SECRET, body) },
    });
    silenceExpectedLog.mockRestore();
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  });

  it('reports malformed JSON with the standard validation error shape', async () => {
    const res = await call('POST', '/mentoring-requests', {
      as: await makePerson('student'),
      rawBody: '{"alumni_id":',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(400);
    expect(res.json).toEqual({
      error: 'Some fields are invalid',
      code: 'VALIDATION_ERROR',
      fields: { body: 'Send a valid JSON body' },
    });
    expect(res.text).not.toMatch(/stack|at \S+\(/i);
    expect(res.text).not.toContain(env.JWT_SECRET);
  });
});

// OWASP's REST Security Cheat Sheet headers, on every kind of answer the Worker gives.
describe('security headers', () => {
  it.each([
    ['the web app', 'GET', '/app', 200],
    ['the docs page', 'GET', '/docs', 200],
    ['an API answer', 'GET', '/', 200],
    ['a refused request', 'GET', '/alumni', 401],
    ['a validation error', 'POST', '/auth/demo-login', 400],
    ['an unknown route', 'GET', '/nope', 404],
  ])('are sent on %s', async (_label, method, path, status) => {
    const res = await call(method, path, method === 'POST' ? { body: {} } : {});
    expect(res.status).toBe(status);
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sends plain HTTP on the live host to HTTPS, keeping the method and path', async () => {
    const res = await SELF.fetch('http://alumni-network-integration.phyo2lay.workers.dev/alumni?country=MM', {
      method: 'POST',
      redirect: 'manual',
    });
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe('https://alumni-network-integration.phyo2lay.workers.dev/alumni?country=MM');
  });

  it('leaves plain HTTP alone on a local server', async () => {
    const res = await SELF.fetch('http://localhost:8787/api/integration/status');
    expect(res.status).toBe(200);
  });
});

// The A5 lab routes were submitted as evidence, so they must keep behaving the same.
describe('A5 integration lab routes', () => {
  it('still answers the status check', async () => {
    const res = await call('GET', '/api/integration/status');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ team: 'pod5-alumni-network', status: 'ok' });
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=UTF-8');
  });

  it('still verifies and de-duplicates Team 17 webhooks', async () => {
    const body = JSON.stringify({ id: `evt-${crypto.randomUUID()}`, type: 'test.event', data: {} });
    const signature = await hmacHex(env.WEBHOOK_SECRET, body);
    const send = (value: string) =>
      call('POST', '/api/webhooks/partner', {
        rawBody: body,
        headers: { 'X-Webhook-Signature': value },
      });
    expect((await send('deadbeef')).status).toBe(401);
    expect((await send(signature)).json).toEqual({ received: true });
    expect((await send(signature)).json).toEqual({ received: true, duplicate: true });
  });

  it('still replays the idempotent create', async () => {
    const key = crypto.randomUUID();
    const send = () =>
      call('POST', '/api/connections', {
        body: { studentId: 1, alumniId: 1 },
        headers: { 'Idempotency-Key': key },
      });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.json.id).toBe(first.json.id);
  });

  it('is unaffected by the mentoring API needing a token', async () => {
    const res = await call('GET', '/api/integration/status', { as: await makePerson('student') });
    expect(res.status).toBe(200);
  });
});
