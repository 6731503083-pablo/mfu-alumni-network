import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { call, hmacHex, rows } from './helpers';

const makeEvent = (overrides: Record<string, unknown> = {}) => ({
  event_id: `evt-${crypto.randomUUID()}`,
  event_type: 'alumni.event',
  occurred_at: '2026-11-03T10:00:00Z',
  source: 'events-clubs',
  data: {
    title: 'Alumni career talk',
    starts_at: '2026-12-01T09:00:00Z',
    faculty_id: 7,
    interests: ['Data & AI'],
    url: 'https://example.com/events/1',
  },
  ...overrides,
});

async function deliver(body: string, signature?: string) {
  return call('POST', '/webhooks/events-clubs', {
    rawBody: body,
    headers: {
      'Content-Type': 'application/json',
      ...(signature === undefined ? {} : { 'X-Webhook-Signature': signature }),
    },
  });
}

const signed = async (body: string) =>
  deliver(body, await hmacHex(env.EVENTS_CLUBS_WEBHOOK_SECRET, body));

const storedCount = async (eventId: string) =>
  (await rows('SELECT id FROM alumni_events WHERE event_id = ?', eventId)).length;

describe('POST /webhooks/events-clubs (API-09)', () => {
  it('stores a correctly signed event, with no JWT needed', async () => {
    const event = makeEvent();
    const res = await signed(JSON.stringify(event));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ received: true });
    const [row] = await rows(
      'SELECT event_type, title, starts_at, occurred_at FROM alumni_events WHERE event_id = ?',
      event.event_id,
    );
    expect(row).toEqual({
      event_type: 'alumni.event',
      title: 'Alumni career talk',
      starts_at: '2026-12-01T09:00:00Z',
      occurred_at: '2026-11-03T10:00:00Z',
    });
  });

  it('stores a retried delivery only once', async () => {
    const event = makeEvent();
    const body = JSON.stringify(event);
    await signed(body);
    const res = await signed(body);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ received: true, duplicate: true });
    expect(await storedCount(event.event_id)).toBe(1);
  });

  it('stores one copy when two deliveries arrive together', async () => {
    const event = makeEvent();
    const body = JSON.stringify(event);
    const results = await Promise.all([signed(body), signed(body)]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(await storedCount(event.event_id)).toBe(1);
  });

  it('ignores extra fields so the sender can add to its schema', async () => {
    const event = makeEvent({ new_field: 'from a later schema version' });
    expect((await signed(JSON.stringify(event))).status).toBe(200);
  });

  it.each([
    ['no signature', undefined],
    ['a forged signature', 'deadbeef'],
    ['a signature of the wrong length', 'a'.repeat(63)],
    ['an empty signature', ''],
  ])('rejects %s and stores nothing', async (_label, signature) => {
    const event = makeEvent();
    const res = await deliver(JSON.stringify(event), signature);
    expect(res.status).toBe(401);
    expect(res.json.code).toBe('INVALID_SIGNATURE');
    expect(await storedCount(event.event_id)).toBe(0);
  });

  it('rejects a body changed after signing', async () => {
    const event = makeEvent();
    const signature = await hmacHex(env.EVENTS_CLUBS_WEBHOOK_SECRET, JSON.stringify(event));
    const res = await deliver(JSON.stringify({ ...event, source: 'tampered' }), signature);
    expect(res.status).toBe(401);
    expect(await storedCount(event.event_id)).toBe(0);
  });

  it('rejects a signature made with the Team 17 secret', async () => {
    const event = makeEvent();
    const body = JSON.stringify(event);
    expect((await deliver(body, await hmacHex(env.WEBHOOK_SECRET, body))).status).toBe(401);
  });

  describe('malformed events (FR-11)', () => {
    it('logs and skips a signed body that is not JSON', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await signed('not json');
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('VALIDATION_ERROR');
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it.each([
      ['event_id', makeEvent({ event_id: undefined })],
      ['event_id', makeEvent({ event_id: '' })],
      ['event_type', makeEvent({ event_type: 'something.else' })],
      ['occurred_at', makeEvent({ occurred_at: 'yesterday' })],
      ['data', makeEvent({ data: undefined })],
      ['data.title', makeEvent({ data: { starts_at: '2026-12-01T09:00:00Z' } })],
      ['data.title', makeEvent({ data: { title: '', starts_at: '2026-12-01T09:00:00Z' } })],
      ['data.starts_at', makeEvent({ data: { title: 'Talk' } })],
      ['data.starts_at', makeEvent({ data: { title: 'Talk', starts_at: 'soon' } })],
      ['data.url', makeEvent({ data: { title: 'Talk', starts_at: '2026-12-01T09:00:00Z', url: 'javascript:alert(1)' } })],
    ])('skips an event with a bad %s', async (field, event) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await signed(JSON.stringify(event));
      expect(res.status).toBe(400);
      expect(res.json.fields).toHaveProperty([field]);
      warn.mockRestore();
    });

    it('stores nothing from a bad event, and the next good one still works', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const bad = makeEvent({ data: {} });
      expect((await signed(JSON.stringify(bad))).status).toBe(400);
      expect(await storedCount(bad.event_id)).toBe(0);
      const good = makeEvent();
      expect((await signed(JSON.stringify(good))).status).toBe(200);
      expect(await storedCount(good.event_id)).toBe(1);
      warn.mockRestore();
    });
  });

  it('refuses every delivery when the secret is not set', async () => {
    const body = JSON.stringify(makeEvent());
    const res = await app.request(
      '/webhooks/events-clubs',
      {
        method: 'POST',
        headers: { 'X-Webhook-Signature': 'any-value' },
        body,
      },
      { ...env, EVENTS_CLUBS_WEBHOOK_SECRET: '' },
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('WEBHOOK_NOT_CONFIGURED');
  });
});
