import { Hono } from 'hono';

import { requireRole } from '../lib/auth';
import { notFound } from '../lib/errors';
import type { AppEnv } from '../types';

export const admin = new Hono<AppEnv>();

// API-08. Returns status fields only: admins get no private contact data here (PRD section 3).
admin.patch('/alumni/:id/deactivate', requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const updated = await c.env.DB.prepare('UPDATE alumni_profiles SET is_active = 0 WHERE id = ?').bind(id).run();
  if (!updated.meta.changes) throw notFound('Alumni');
  return c.json({ id, is_active: false });
});
