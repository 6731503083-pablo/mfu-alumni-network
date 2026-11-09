import type { Context, MiddlewareHandler } from 'hono';
import { verify } from 'hono/jwt';

import type { AppEnv, Role, User } from '../types';
import { ApiError, forbidden, unauthenticated } from './errors';

const CLOCK_SKEW_SECONDS = 30;

/**
 * Verifies the caller's JWT (HS256, signed with JWT_SECRET). The Identity service has not
 * published its token contract yet (PRD Assumption 1). When it does, only this file changes.
 */
async function authenticate(c: Context<AppEnv>): Promise<User> {
  // An empty secret would let anyone sign a valid token, so refuse everything instead.
  if (!c.env.JWT_SECRET) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not set up on this server');
  }

  const match = /^Bearer (\S+)$/.exec(c.req.header('Authorization') ?? '');
  if (!match) throw unauthenticated('Send a token in the Authorization header');

  let claims: Record<string, unknown>;
  try {
    // Time claims are checked below, because hono/jwt has no skew allowance and treats exp as optional.
    claims = await verify(match[1], c.env.JWT_SECRET, {
      alg: 'HS256',
      exp: false,
      nbf: false,
      iat: false,
    });
  } catch {
    throw unauthenticated('The token is invalid');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS <= now) {
    throw unauthenticated('The token has expired or has no expiry');
  }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > now) {
    throw unauthenticated('The token is not valid yet');
  }

  const id = claims.sub ?? claims.user_id;
  if (typeof id !== 'string' || !id) throw unauthenticated('The token has no user ID');

  return { id, role: claims.role as Role };
}

/** Lets a request through only with a valid token whose role is allowed on this route. */
export function requireRole(...allowed: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await authenticate(c);
    if (!allowed.includes(user.role)) throw forbidden();
    c.set('user', user);
    await next();
  };
}
