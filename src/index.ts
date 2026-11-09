import { Hono } from 'hono';

import appHtml from './app.html';
import docsHtml from './docs.html';
import { handleError } from './lib/errors';
import { hmacHex, timingSafeEqual } from './lib/hmac';
import { admin } from './routes/admin';
import { alumni } from './routes/alumni';
import { connections } from './routes/connections';
import { demoAuth } from './routes/demo-auth';
import { partnerInternships } from './routes/partner-internships';
import { eventsClubs } from './routes/events-clubs';
import { requests } from './routes/requests';
import type { AppEnv } from './types';

type WebhookEvent = {
  id: string;
  type: string;
  data: Record<string, unknown>;
};

const app = new Hono<AppEnv>();

app.onError(handleError);
app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404));

app.use('*', async (c, next) => {
  await next();
  // JSON responses only: /docs is HTML.
  if (c.res.headers.get('Content-Type')?.startsWith('application/json')) {
    c.header('Content-Type', 'application/json; charset=UTF-8');
  }
});

app.get('/', (c) =>
  c.json({
    message: 'MFU Alumni Network API',
    app: '/app',
    docs: '/docs',
    endpoints: [
      'POST /auth/demo-login',
      'GET /alumni',
      'GET /alumni/me',
      'GET /alumni/{id}',
      'PATCH /alumni/me',
      'POST /mentoring-requests',
      'GET /mentoring-requests/me',
      'PATCH /mentoring-requests/{id}',
      'DELETE /connections/{id}',
      'PATCH /admin/alumni/{id}/deactivate',
      'POST /webhooks/events-clubs',
      'GET /partners/team17/internships',
      'GET /api/integration/status',
      'GET /api/partner/status',
      'POST /api/webhooks/partner',
      'POST /api/webhooks/send-test',
      'POST /api/connections',
    ],
  }),
);

// API reference with a request console. It holds no secrets: test webhooks are signed in the
// visitor's browser with a secret they type in.
app.get('/docs', (c) => c.html(docsHtml));

// The web app. A new nonce on every response lets the page's own <script> and <style> tags run and
// nothing else, so injected markup can't execute even if it got into the page.
app.get('/app', (c) => {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      "img-src 'self' data:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(appHtml.replace(/<(script|style)\b/g, `<$1 nonce="${nonce}"`));
});

// 1. Public endpoint the partner team calls.
app.get('/api/integration/status', (c) =>
  c.json({
    team: c.env.TEAM_NAME,
    service: c.env.SERVICE_NAME,
    version: c.env.SERVICE_VERSION,
    status: 'ok',
  }),
);

// 2. Calls the partner team's endpoint, with a timeout so a dead partner can't hang us.
app.get('/api/partner/status', async (c) => {
  try {
    const res = await fetch(c.env.PARTNER_API_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return c.json({ error: 'partner returned an error', status: res.status }, 502);
    return c.json(await res.json());
  } catch (err) {
    return c.json({ error: 'partner unreachable', detail: String(err) }, 504);
  }
});

// 3. Receives a partner webhook; verifies the shared-secret HMAC signature before storing it.
app.post('/api/webhooks/partner', async (c) => {
  const signature = c.req.header('X-Webhook-Signature');
  const rawBody = await c.req.text();

  if (!signature || !timingSafeEqual(signature, await hmacHex(c.env.WEBHOOK_SECRET, rawBody))) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  const event = JSON.parse(rawBody) as WebhookEvent;

  try {
    await c.env.DB.prepare(
      'INSERT INTO webhook_events (source_id, event_type, payload, received_at) VALUES (?, ?, ?, ?)',
    )
      .bind(event.id, event.type, rawBody, new Date().toISOString())
      .run();
  } catch {
    // UNIQUE constraint on source_id — a retried delivery of the same event, already stored.
    return c.json({ received: true, duplicate: true });
  }

  return c.json({ received: true });
});

// 4. Sends a test webhook to the partner team's receiver, in the shape their contract requires.
//    Team 17's receiver checks a raw shared secret in `X-Webhook-Secret`, not an HMAC signature —
//    that's their receiver's design, distinct from how we verify inbound webhooks below.
app.post('/api/webhooks/send-test', async (c) => {
  const payload = {
    event_id: `alumni-team17-handshake-${Date.now()}`,
    event_type: 'partner.updated',
    occurred_at: new Date().toISOString(),
    source: 'pod5-alumni-network',
    data: { resource_id: 'alumni-demo-001', status: 'updated' },
  };

  try {
    const res = await fetch(c.env.PARTNER_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': c.env.PARTNER_WEBHOOK_SECRET },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return c.json({ sent: true, partnerStatus: res.status, partnerBody: await res.text() });
  } catch (err) {
    return c.json({ error: 'partner webhook receiver unreachable', detail: String(err) }, 504);
  }
});

// 5. Idempotent create endpoint — replaying the same Idempotency-Key returns the first result.
app.post('/api/connections', async (c) => {
  const idempotencyKey = c.req.header('Idempotency-Key');
  if (!idempotencyKey) return c.json({ error: 'Idempotency-Key header required' }, 400);

  const existing = await c.env.DB.prepare('SELECT response_body FROM idempotency_keys WHERE key = ?')
    .bind(idempotencyKey)
    .first<{ response_body: string }>();

  if (existing) return c.json(JSON.parse(existing.response_body));

  const body = await c.req.json();
  const result = { id: crypto.randomUUID(), ...body, createdAt: new Date().toISOString() };

  await c.env.DB.prepare('INSERT INTO idempotency_keys (key, response_body, created_at) VALUES (?, ?, ?)')
    .bind(idempotencyKey, JSON.stringify(result), new Date().toISOString())
    .run();

  return c.json(result, 201);
});

// The Mentoring API from the PRD (API-01 to API-09).
app.route('/auth', demoAuth);
app.route('/alumni', alumni);
app.route('/mentoring-requests', requests);
app.route('/connections', connections);
app.route('/admin', admin);
app.route('/webhooks/events-clubs', eventsClubs);

// Team 17's internship listings, for students looking for a mentor in that field.
app.route('/partners/team17', partnerInternships);

export default app;
