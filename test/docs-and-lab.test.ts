import { env } from 'cloudflare:test';
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
    expect(routes.size).toBe(16);
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
    expect(text).not.toContain(env.DEMO_PASSCODE);
  });
});

describe('test setup', () => {
  it('uses fixed test secrets, not the real ones in .dev.vars', () => {
    expect(env.JWT_SECRET).toBe('test-jwt-secret');
    expect(env.WEBHOOK_SECRET).toBe('test-team17-webhook-secret');
    expect(env.PARTNER_WEBHOOK_SECRET).toBe('test-partner-secret');
    expect(env.EVENTS_CLUBS_WEBHOOK_SECRET).toBe('test-events-clubs-secret');
    expect(env.DEMO_PASSCODE).toBe('test-demo-passcode');
  });
});

describe('reference data', () => {
  it('seeds the 11 schools and 17 interests from the data design', async () => {
    expect(await rows('SELECT id FROM faculties')).toHaveLength(11);
    expect(await rows('SELECT id FROM interests')).toHaveLength(17);
    const [faculty] = await rows('SELECT name FROM faculties WHERE id = 7');
    expect(faculty.name).toBe('School of Information Technology');
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
