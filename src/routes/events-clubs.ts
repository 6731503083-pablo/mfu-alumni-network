import { Hono } from 'hono';
import { z } from 'zod';

import { ApiError, validationError } from '../lib/errors';
import { hmacHex, timingSafeEqual } from '../lib/hmac';
import { toFields } from '../lib/validate';
import type { AppEnv } from '../types';

const timestamp = z.iso.datetime({ offset: true });

// Draft contract: Events & Clubs has not published one. The envelope follows the Week 06 lab's
// payload shape, and extra fields are ignored so the sender can add to it.
const alumniEvent = z.object({
  event_id: z.string().trim().min(1).max(200),
  event_type: z.literal('alumni.event'),
  occurred_at: timestamp,
  data: z.object({
    title: z.string().trim().min(1).max(200),
    starts_at: timestamp,
    faculty_id: z.number().int().positive().optional(),
    interests: z.array(z.string().max(60)).max(17).optional(),
    url: z.url({ protocol: /^https?$/ }).optional(),
  }),
});

export const eventsClubs = new Hono<AppEnv>();

// API-09. Authenticated by signature, not JWT. A bad event is logged and skipped (FR-11).
eventsClubs.post('/', async (c) => {
  const secret = c.env.EVENTS_CLUBS_WEBHOOK_SECRET;
  // An empty secret would let anyone sign a valid event, so refuse everything instead.
  if (!secret) throw new ApiError(503, 'WEBHOOK_NOT_CONFIGURED', 'This webhook is not set up on this server');

  const rawBody = await c.req.text();
  const signature = c.req.header('X-Webhook-Signature') ?? '';
  if (!timingSafeEqual(signature, await hmacHex(secret, rawBody))) {
    console.warn('events-clubs webhook rejected: invalid signature');
    throw new ApiError(401, 'INVALID_SIGNATURE', 'The signature is missing or wrong');
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.warn('events-clubs webhook skipped: body is not JSON');
    throw validationError({ body: 'Send a valid JSON body' });
  }

  const event = alumniEvent.safeParse(body);
  if (!event.success) {
    const fields = toFields(event.error);
    console.warn('events-clubs webhook skipped: invalid event', JSON.stringify(fields));
    throw validationError(fields);
  }

  const { event_id, event_type, occurred_at, data } = event.data;
  const inserted = await c.env.DB.prepare(
    `INSERT INTO alumni_events (event_id, event_type, title, starts_at, occurred_at, payload, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (event_id) DO NOTHING`,
  )
    .bind(event_id, event_type, data.title, data.starts_at, occurred_at, JSON.stringify(event.data), new Date().toISOString())
    .run();

  return c.json(inserted.meta.changes ? { received: true } : { received: true, duplicate: true });
});
