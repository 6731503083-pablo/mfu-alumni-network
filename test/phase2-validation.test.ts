import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { call, hmacHex, makeAlumni, makePerson } from './helpers';

const signedEvent = async (event: Record<string, unknown>) => {
  const body = JSON.stringify(event);
  return call('POST', '/webhooks/events-clubs', {
    rawBody: body,
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': await hmacHex(env.EVENTS_CLUBS_WEBHOOK_SECRET, body),
    },
  });
};

const validEvent = (data: Record<string, unknown> = {}) => ({
  event_id: `phase2-${crypto.randomUUID()}`,
  event_type: 'alumni.event',
  occurred_at: '2026-11-10T00:00:00Z',
  data: {
    title: 'Phase 2 validation event',
    starts_at: '2026-12-01T09:00:00Z',
    ...data,
  },
});

describe('Phase 2 API input validation', () => {
  it('reports all missing required mentoring-request fields', async () => {
    const res = await call('POST', '/mentoring-requests', {
      as: await makePerson('student'),
      body: {},
    });

    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({
      code: 'VALIDATION_ERROR',
      error: 'Some fields are invalid',
    });
    expect(res.json.fields).toHaveProperty('alumni_id');
    expect(res.json.fields).toHaveProperty('message');
  });

  it('rejects a whitespace-only profile display name', async () => {
    const res = await call('PATCH', '/alumni/me', {
      as: await makePerson('alumni'),
      body: {
        display_name: '   \t  ',
        grad_year: 2021,
        faculty_id: 7,
      },
    });

    expect(res.status).toBe(400);
    expect(res.json.code).toBe('VALIDATION_ERROR');
    expect(res.json.fields).toHaveProperty('display_name');
  });

  it('rejects a profile field with the wrong JSON type', async () => {
    const alumni = await makeAlumni();
    const res = await call('PATCH', '/alumni/me', {
      as: alumni,
      body: { grad_year: '2021' },
    });

    expect(res.status).toBe(400);
    expect(res.json.code).toBe('VALIDATION_ERROR');
    expect(res.json.fields).toHaveProperty('grad_year');
  });

  it('rejects a webhook title over its documented 200-character limit', async () => {
    const res = await signedEvent(validEvent({ title: 'x'.repeat(201) }));

    expect(res.status).toBe(400);
    expect(res.json.code).toBe('VALIDATION_ERROR');
    expect(res.json.fields).toHaveProperty('data.title');
  });

  it('rejects a webhook URL with an unsupported scheme', async () => {
    const res = await signedEvent(validEvent({ url: 'ftp://events.example.test/alumni/1' }));

    expect(res.status).toBe(400);
    expect(res.json.code).toBe('VALIDATION_ERROR');
    expect(res.json.fields).toHaveProperty('data.url');
  });
});
