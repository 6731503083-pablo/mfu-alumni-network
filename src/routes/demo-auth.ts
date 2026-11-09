import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { z } from 'zod';

import { ApiError } from '../lib/errors';
import { timingSafeEqual } from '../lib/hmac';
import { parseJsonBody } from '../lib/validate';
import type { AppEnv } from '../types';

const TOKEN_LIFETIME_SECONDS = 2 * 3600;

const loginBody = z.strictObject({
  passcode: z.string().min(1).max(200),
  role: z.enum(['student', 'alumni', 'admin']),
  // Only demo accounts. Real users will come from the Identity service, which this can't impersonate.
  user_id: z.string().regex(/^demo-[a-z0-9-]{1,60}$/, 'Demo sign-in only works for IDs that start with demo-'),
});

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const demoAuth = new Hono<AppEnv>();

/**
 * Stands in for the Identity service until it publishes its token contract (PRD Assumption 1), so
 * the web app can sign people in without holding JWT_SECRET. Delete this route when Identity arrives.
 */
demoAuth.post('/demo-login', async (c) => {
  // An empty passcode or key would let anyone in, so refuse everything instead.
  if (!c.env.DEMO_PASSCODE) {
    throw new ApiError(503, 'DEMO_LOGIN_NOT_CONFIGURED', 'Demo sign-in is not set up on this server');
  }
  if (!c.env.JWT_SECRET) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not set up on this server');
  }

  const { passcode, role, user_id: userId } = await parseJsonBody(c, loginBody);
  // Hashing both first makes the comparison take the same time whatever the passcode's length.
  if (!timingSafeEqual(await sha256Hex(passcode), await sha256Hex(c.env.DEMO_PASSCODE))) {
    throw new ApiError(401, 'INVALID_PASSCODE', 'The passcode is wrong');
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_LIFETIME_SECONDS;
  const token = await sign({ sub: userId, role, iat: now, exp }, c.env.JWT_SECRET, 'HS256');
  return c.json({ token, expires_at: new Date(exp * 1000).toISOString(), user: { id: userId, role } });
});
