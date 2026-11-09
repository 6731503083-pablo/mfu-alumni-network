import { Hono } from 'hono';
import { z } from 'zod';

import { validationError } from '../lib/errors';
import { parseQuery } from '../lib/validate';
import type { AppEnv } from '../types';
import { MENTOR_INTERESTS } from './partner-internships';

const API_VERSION = '1.0';

const query = z
  .strictObject({
    category: z.string().trim().min(1).max(60).optional(),
    interest: z.string().trim().min(1).max(60).optional(),
  })
  .refine((q) => !(q.category && q.interest), { path: ['interest'], message: 'Send category or interest, not both' });

export const partnerMentors = new Hono<AppEnv>();

// Public and read-only, for other teams' websites, so any site may read it. It holds counts only.
partnerMentors.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
});

/**
 * How many alumni can take a mentee in each field, with a link that opens our directory filtered to
 * it. Team 17 shows this on their internship pages, the way we show their internships. It returns
 * counts only: no names, IDs or contact details, so no alumni's personal data leaves this service.
 */
partnerMentors.get('/', async (c) => {
  const { category, interest } = parseQuery(c, query);

  let names: string[] | null = null;
  if (category) {
    names = MENTOR_INTERESTS[category.toLowerCase()] ?? null;
    if (!names) throw validationError({ category: 'Unknown category. Use Design, Engineering, Data or Marketing' });
  } else if (interest) {
    names = [interest];
  }

  const filter = names ? `WHERE i.name IN (${names.map(() => '?').join(', ')})` : '';
  const { results } = await c.env.DB.prepare(
    // An alumni counts when their profile is on, they're open to mentoring, and they have room left.
    `SELECT i.name AS interest, COUNT(a.id) AS mentors_available
     FROM interests i
     LEFT JOIN alumni_interests ai ON ai.interest_id = i.id
     LEFT JOIN alumni_profiles a ON a.id = ai.alumni_id
       AND a.is_active = 1 AND a.is_open_to_mentoring = 1
       AND (SELECT COUNT(*) FROM connections c WHERE c.alumni_id = a.id AND c.status = 'active') < a.mentee_capacity
     ${filter}
     GROUP BY i.id
     ORDER BY i.id`,
  )
    .bind(...(names ?? []))
    .all<{ interest: string; mentors_available: number }>();
  if (interest && !results.length) throw validationError({ interest: 'Unknown interest' });

  const appUrl = `${new URL(c.req.url).origin}/app#/mentors/`;
  const requestId = crypto.randomUUID();
  console.log(
    JSON.stringify({ route: 'GET /api/mentors', request_id: requestId, category, interest, origin: c.req.header('Origin') ?? null }),
  );
  c.header('X-Request-Id', requestId);
  return c.json({
    data: results.map((row) => ({ ...row, find_mentors_url: appUrl + encodeURIComponent(row.interest) })),
    meta: { api_version: API_VERSION, request_id: requestId, generated_at: new Date().toISOString() },
  });
});
