import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { z } from 'zod';

import { ApiError } from '../lib/errors';
import { parseJsonBody } from '../lib/validate';
import type { AppEnv } from '../types';

const TOKEN_LIFETIME_SECONDS = 2 * 3600;

// Each demo ID fixes its role, so a student account can't ask to be admin. Only demo IDs: real
// users will come from the Identity service, which this can't impersonate.
const ID_PATTERN = {
  student: /^demo-student-[a-z0-9-]{1,50}$/,
  alumni: /^demo-alumni-[a-z0-9-]{1,50}$/,
  admin: /^demo-admin(-[a-z0-9-]{1,50})?$/,
} as const;

const loginBody = z
  .strictObject({
    role: z.enum(['student', 'alumni', 'admin']),
    user_id: z.string().max(80),
  })
  .refine((body) => ID_PATTERN[body.role].test(body.user_id), {
    path: ['user_id'],
    message: 'Use a demo ID for this role: demo-student-…, demo-alumni-… or demo-admin',
  });

export const demoAuth = new Hono<AppEnv>();

/**
 * Stands in for the Identity service until it publishes its token contract (PRD Assumption 1), so
 * the web app can sign people in without holding JWT_SECRET. It is open to anyone, so it only signs
 * demo IDs, and routes limit what a demo token can touch. Delete this route when Identity arrives.
 */
demoAuth.post('/demo-login', async (c) => {
  // An empty key would let anyone sign any token, so refuse everything instead.
  if (!c.env.JWT_SECRET) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not set up on this server');
  }

  const { role, user_id: userId } = await parseJsonBody(c, loginBody);

  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_LIFETIME_SECONDS;
  // `demo: true` lets routes limit what demo accounts can touch. A demo admin, for one, can only
  // turn off demo profiles.
  const token = await sign({ sub: userId, role, demo: true, iat: now, exp }, c.env.JWT_SECRET, 'HS256');
  return c.json({ token, expires_at: new Date(exp * 1000).toISOString(), user: { id: userId, role } });
});
