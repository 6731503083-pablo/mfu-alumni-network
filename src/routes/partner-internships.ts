import { Hono } from 'hono';
import { z } from 'zod';

import { requireRole } from '../lib/auth';
import { ApiError } from '../lib/errors';
import { parseQuery } from '../lib/validate';
import type { AppEnv } from '../types';

// Team 17's public Internship Opportunities API, contract 1.0 (Team17-Team12-API-Handover). It needs
// no secret. Students browse the listings here, then ask an alumni in that field for advice.
const PARTNER = 'Team 17 Internship Management';
const TIMEOUT_MS = 10_000;

// Our interests that fit each Team 17 category, for "Find a mentor for this".
const MENTOR_INTERESTS: Record<string, string[]> = {
  design: ['UX/UI Design'],
  engineering: ['Software Development'],
  data: ['Data & AI'],
  marketing: ['Marketing'],
};

// Team 17 answers 400 to unknown or repeated parameters, so only these are forwarded.
const listQuery = z.strictObject({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  work_mode: z.enum(['remote', 'hybrid', 'on-site']).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const envelope = z.object({
  success: z.literal(true),
  data: z.array(z.unknown()),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    total_pages: z.number().int(),
    has_next: z.boolean(),
  }),
  meta: z.object({ request_id: z.string().max(100).optional() }).optional(),
});

// Each listing is checked on its own, so one broken record is skipped instead of failing the page.
const listing = z.object({
  id: z.guid(),
  title: z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  description: z.string().max(5000),
  location: z.string().max(200),
  category: z.string().max(60),
  work_mode: z.enum(['remote', 'hybrid', 'on-site']),
  skills: z.array(z.string().max(60)).max(30),
  allowance_thb: z.number().int().nonnegative().nullable(),
  duration_weeks: z.number().int().positive(),
  application_deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_demo: z.boolean(),
  details_url: z.string().max(500),
});

/** Keeps a link only if it's https on Team 17's own site, so a bad record can't send students elsewhere. */
function safeLink(raw: string, origin: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.origin === origin ? url.href : null;
  } catch {
    return null;
  }
}

const unavailable = () => new ApiError(503, 'PARTNER_UNAVAILABLE', `${PARTNER} can't be reached right now`);
const badResponse = () =>
  new ApiError(502, 'PARTNER_BAD_RESPONSE', `${PARTNER} sent a response that doesn't match its contract`);

export const partnerInternships = new Hono<AppEnv>();

partnerInternships.get('/internships', requireRole('student', 'alumni'), async (c) => {
  const query = parseQuery(c, listQuery);
  const url = new URL(c.env.PARTNER_PLACEMENTS_URL);
  url.searchParams.set('status', 'open');
  url.searchParams.set('page', String(query.page));
  url.searchParams.set('limit', String(query.limit));
  for (const key of ['q', 'category', 'work_mode'] as const) {
    if (query[key]) url.searchParams.set(key, query[key]);
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    console.warn(JSON.stringify({ partner: 'team17', path: url.pathname + url.search, error: timedOut ? 'timeout' : String(err) }));
    if (timedOut) throw new ApiError(504, 'PARTNER_TIMEOUT', `${PARTNER} didn't answer within 10 seconds`);
    throw unavailable();
  }

  // Their handover asks consumers to keep the request ID, status and time as evidence.
  const headerRequestId = res.headers.get('X-Request-Id');
  console.log(JSON.stringify({
    partner: 'team17',
    path: url.pathname + url.search,
    status: res.status,
    request_id: headerRequestId,
    ms: Date.now() - started,
  }));
  if (res.status === 503) throw unavailable();
  if (!res.ok) throw new ApiError(502, 'PARTNER_ERROR', `${PARTNER} answered ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw badResponse();
  }
  const page = envelope.safeParse(body);
  if (!page.success) throw badResponse();

  const origin = new URL(c.env.PARTNER_PLACEMENTS_URL).origin;
  const data = [];
  let skipped = 0;
  for (const item of page.data.data) {
    const parsed = listing.safeParse(item);
    if (!parsed.success) {
      skipped++;
      continue;
    }
    const p = parsed.data;
    data.push({
      id: p.id,
      title: p.title,
      company: p.company,
      description: p.description,
      location: p.location,
      category: p.category,
      work_mode: p.work_mode,
      skills: p.skills,
      allowance_thb: p.allowance_thb,
      duration_weeks: p.duration_weeks,
      application_deadline: p.application_deadline,
      is_demo: p.is_demo,
      details_url: safeLink(p.details_url, origin),
      mentor_interests: MENTOR_INTERESTS[p.category.toLowerCase()] ?? [],
    });
  }
  const requestId = page.data.meta?.request_id ?? headerRequestId;
  if (skipped) console.warn(JSON.stringify({ partner: 'team17', skipped, request_id: requestId }));

  return c.json({
    data,
    pagination: page.data.pagination,
    source: { partner: PARTNER, request_id: requestId, fetched_at: new Date().toISOString(), skipped },
  });
});
