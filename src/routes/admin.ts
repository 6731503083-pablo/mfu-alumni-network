import { Hono } from 'hono';

import { requireRole } from '../lib/auth';
import { ApiError, notFound } from '../lib/errors';
import type { AppEnv } from '../types';

export const admin = new Hono<AppEnv>();

// API-08. Returns status fields only: admins get no private contact data here (PRD section 3).
admin.patch('/alumni/:id/deactivate', requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const demo = c.get('user').demo ? 1 : 0;
  // A demo admin (from POST /auth/demo-login) can only turn off profiles owned by demo accounts.
  const updated = await c.env.DB.prepare(
    `UPDATE alumni_profiles SET is_active = 0
     WHERE id = ?1 AND (?2 = 0 OR substr(identity_user_id, 1, 5) = 'demo-')`,
  )
    .bind(id, demo)
    .run();
  if (!updated.meta.changes) {
    const exists = demo && (await c.env.DB.prepare('SELECT 1 FROM alumni_profiles WHERE id = ?').bind(id).first());
    if (exists) throw new ApiError(403, 'DEMO_ADMIN_LIMITED', 'A demo admin can only turn off demo profiles');
    throw notFound('Alumni');
  }
  return c.json({ id, is_active: false });
});
