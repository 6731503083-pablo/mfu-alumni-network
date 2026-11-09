import { Hono } from 'hono';

import { requireRole } from '../lib/auth';
import { conflict, notFound, notOwner } from '../lib/errors';
import type { AppEnv } from '../types';

export const connections = new Hono<AppEnv>();

// API-07. Ending a connection is a soft delete: the row and its reveal log stay as evidence.
connections.delete('/:id', requireRole('student', 'alumni'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = c.req.param('id');

  const connection = await db
    .prepare(
      `SELECT c.id, c.request_id, c.student_id, c.alumni_id, c.status, c.created_at, c.ended_at,
              a.identity_user_id AS alumni_identity
       FROM connections c JOIN alumni_profiles a ON a.id = c.alumni_id WHERE c.id = ?`,
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!connection) throw notFound('Connection');

  const isParty =
    user.role === 'student' ? connection.student_id === user.id : connection.alumni_identity === user.id;
  if (!isParty) throw notOwner('Only the student or alumni in a connection can end it');

  const endedAt = new Date().toISOString();
  const updated = await db
    .prepare("UPDATE connections SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'active'")
    .bind(endedAt, id)
    .run();
  if (!updated.meta.changes) throw conflict('INVALID_STATE', 'This connection has already ended');

  const { alumni_identity: _identity, ...ended } = connection;
  return c.json({ ...ended, status: 'ended', ended_at: endedAt });
});
