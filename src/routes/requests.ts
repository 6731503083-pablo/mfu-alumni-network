import { Hono } from 'hono';
import { z } from 'zod';

import { requireRole } from '../lib/auth';
import { conflict, isCheckViolation, isUniqueViolation, notFound, notOwner, validationError } from '../lib/errors';
import { paginationFields, parseJsonBody, parseQuery } from '../lib/validate';
import type { AppEnv } from '../types';

const MAX_PENDING_PER_STUDENT = 5; // BR-08

const REQUEST_COLUMNS =
  'r.id, r.student_id, r.alumni_id, r.message, r.status, r.created_at, r.responded_at';

const createRequest = z.strictObject({
  alumni_id: z.string().min(1).max(100),
  message: z.string().trim().min(10).max(2000),
});

const changeStatus = z.strictObject({
  status: z.enum(['accepted', 'rejected', 'cancelled']),
});

const listQuery = z.strictObject(paginationFields);

const invalidState = (status: unknown) =>
  conflict('INVALID_STATE', `This request is already ${status}, so it can't change`);

type RequestRow = Record<string, unknown> & { status: string; student_id: string; alumni_identity: string | null };

const readRequest = (db: D1Database, id: string) =>
  db
    .prepare(
      `SELECT ${REQUEST_COLUMNS}, a.identity_user_id AS alumni_identity
       FROM mentoring_requests r JOIN alumni_profiles a ON a.id = r.alumni_id WHERE r.id = ?`,
    )
    .bind(id)
    .first<RequestRow>();

/** Works out why the insert guard stopped a new request, to return the right error. */
async function explainBlockedRequest(db: D1Database, alumniId: string, studentId: string): Promise<never> {
  const alumni = await db
    .prepare('SELECT is_active, is_open_to_mentoring FROM alumni_profiles WHERE id = ?')
    .bind(alumniId)
    .first<{ is_active: number; is_open_to_mentoring: number }>();
  if (!alumni?.is_active) throw notFound('Alumni');
  if (!alumni.is_open_to_mentoring) {
    throw conflict('NOT_OPEN_TO_MENTORING', 'This alumni is not taking mentoring requests right now');
  }
  const connected = await db
    .prepare("SELECT 1 FROM connections WHERE student_id = ? AND alumni_id = ? AND status = 'active'")
    .bind(studentId, alumniId)
    .first();
  if (connected) throw conflict('ALREADY_CONNECTED', 'You are already connected with this alumni');
  throw conflict('PENDING_LIMIT', `You already have ${MAX_PENDING_PER_STUDENT} pending requests`);
}

/**
 * The accept flow (FR-06). D1 has no row locks, so the design's SELECT ... FOR UPDATE becomes:
 *
 * - A single conditional UPDATE as the gate. It counts capacity and changes the status in one
 *   statement, so no other write can land between the check and the change.
 * - A batch, which D1 runs as one transaction. If any step fails, all of it is undone.
 *
 * Every later step only acts if the gate passed, because only then does this attempt's connection
 * exist. test/requests.test.ts races these requests to prove capacity holds.
 */
async function acceptRequest(db: D1Database, requestId: string) {
  const now = new Date().toISOString();
  const connectionId = crypto.randomUUID();

  const [gate] = await db.batch([
    db
      .prepare(
        `UPDATE mentoring_requests SET status = 'accepted', responded_at = ?1
         WHERE id = ?2 AND status = 'pending'
           AND (SELECT COUNT(*) FROM connections WHERE alumni_id = mentoring_requests.alumni_id AND status = 'active')
             < (SELECT mentee_capacity FROM alumni_profiles WHERE id = mentoring_requests.alumni_id AND is_active = 1)`,
      )
      .bind(now, requestId),
    db
      .prepare(
        `INSERT INTO connections (id, request_id, student_id, alumni_id, status, created_at)
         SELECT ?1, id, student_id, alumni_id, 'active', ?2 FROM mentoring_requests
         WHERE id = ?3 AND status = 'accepted'
           AND NOT EXISTS (SELECT 1 FROM connections WHERE request_id = ?3)`,
      )
      .bind(connectionId, now, requestId),
    // Consent is read here, inside the transaction, so a withdrawal a moment earlier is respected.
    db
      .prepare(
        `INSERT INTO contact_reveal_log (connection_id, viewer_id, field_name, revealed_at)
         SELECT c.id, c.student_id, f.field_name, ?2
         FROM connections c
         JOIN alumni_profiles a ON a.id = c.alumni_id
         JOIN (
           SELECT 'contact_email' AS field_name UNION ALL
           SELECT 'contact_line' UNION ALL
           SELECT 'contact_linkedin'
         ) f ON (f.field_name = 'contact_email' AND a.consent_contact_email = 1 AND a.contact_email IS NOT NULL)
             OR (f.field_name = 'contact_line' AND a.consent_contact_line = 1 AND a.contact_line IS NOT NULL)
             OR (f.field_name = 'contact_linkedin' AND a.consent_contact_linkedin = 1 AND a.contact_linkedin IS NOT NULL)
         WHERE c.id = ?1`,
      )
      .bind(connectionId, now),
    db
      .prepare(
        `INSERT INTO webhook_outbox (event_id, event_type, payload, status, attempts, next_retry_at, created_at)
         SELECT ?1, 'alumni.connection_created',
                json_object('connection_id', c.id, 'student_id', c.student_id, 'alumni_id', c.alumni_id, 'created_at', c.created_at),
                'pending', 0, ?2, ?2
         FROM connections c WHERE c.id = ?3`,
      )
      .bind(crypto.randomUUID(), now, connectionId),
  ]);

  if (!gate.meta.changes) {
    const current = await db
      .prepare(
        `SELECT r.status, a.is_active FROM mentoring_requests r
         JOIN alumni_profiles a ON a.id = r.alumni_id WHERE r.id = ?`,
      )
      .bind(requestId)
      .first<{ status: string; is_active: number }>();
    if (current?.status !== 'pending') throw invalidState(current?.status);
    if (!current.is_active) throw conflict('ALUMNI_INACTIVE', 'This alumni profile has been deactivated');
    throw conflict('CAPACITY_FULL', 'You have reached your mentee capacity');
  }

  const [connection, reveals] = await db.batch<Record<string, unknown>>([
    db
      .prepare('SELECT id, request_id, student_id, alumni_id, status, created_at, ended_at FROM connections WHERE id = ?')
      .bind(connectionId),
    db
      .prepare('SELECT field_name FROM contact_reveal_log WHERE connection_id = ? ORDER BY field_name')
      .bind(connectionId),
  ]);
  return {
    connection: connection.results[0],
    revealed_fields: reveals.results.map((row) => row.field_name),
  };
}

export const requests = new Hono<AppEnv>();

// API-04.
requests.post('/', requireRole('student'), async (c) => {
  const db = c.env.DB;
  const student = c.get('user');
  const { alumni_id: alumniId, message } = await parseJsonBody(c, createRequest);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // One statement, so two requests arriving together can't both pass the BR-08 count.
  let inserted: D1Result;
  try {
    inserted = await db
      .prepare(
        `INSERT INTO mentoring_requests (id, student_id, alumni_id, message, status, created_at)
         SELECT ?1, ?2, ?3, ?4, 'pending', ?5
         WHERE (SELECT COUNT(*) FROM mentoring_requests WHERE student_id = ?2 AND status = 'pending') < ?6
           AND EXISTS (SELECT 1 FROM alumni_profiles WHERE id = ?3 AND is_active = 1 AND is_open_to_mentoring = 1)
           AND NOT EXISTS (SELECT 1 FROM connections WHERE student_id = ?2 AND alumni_id = ?3 AND status = 'active')`,
      )
      .bind(id, student.id, alumniId, message, now, MAX_PENDING_PER_STUDENT)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict('DUPLICATE_PENDING', 'You already have a pending request to this alumni');
    }
    // zod counts UTF-16 units and SQLite counts characters, so an emoji-heavy message can land here.
    if (isCheckViolation(err)) throw validationError({ message: 'Write at least 10 characters' });
    throw err;
  }
  if (!inserted.meta.changes) await explainBlockedRequest(db, alumniId, student.id);

  return c.json(
    { id, student_id: student.id, alumni_id: alumniId, message, status: 'pending', created_at: now, responded_at: null },
    201,
  );
});

// API-05. Students see what they sent. Alumni see what they received.
requests.get('/me', requireRole('student', 'alumni'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const { limit, offset } = parseQuery(c, listQuery);

  let column = 'r.student_id';
  let owner = user.id;
  if (user.role === 'alumni') {
    const profile = await db
      .prepare('SELECT id FROM alumni_profiles WHERE identity_user_id = ?')
      .bind(user.id)
      .first<{ id: string }>();
    if (!profile) return c.json({ data: [], pagination: { limit, offset, total: 0 } });
    column = 'r.alumni_id';
    owner = profile.id;
  }

  const [page, count] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT ${REQUEST_COLUMNS}, a.display_name AS alumni_name,
                c.id AS connection_id, c.status AS connection_status,
                c.created_at AS connection_created_at, c.ended_at AS connection_ended_at
         FROM mentoring_requests r
         JOIN alumni_profiles a ON a.id = r.alumni_id
         LEFT JOIN connections c ON c.request_id = r.id
         WHERE ${column} = ?
         ORDER BY r.created_at DESC, r.id
         LIMIT ? OFFSET ?`,
      )
      .bind(owner, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM mentoring_requests r WHERE ${column} = ?`).bind(owner),
  ]);

  const data = page.results.map(
    ({ connection_id, connection_status, connection_created_at, connection_ended_at, ...request }) => ({
      ...request,
      connection: connection_id
        ? { id: connection_id, status: connection_status, created_at: connection_created_at, ended_at: connection_ended_at }
        : null,
    }),
  );
  return c.json({ data, pagination: { limit, offset, total: count.results[0].total } });
});

// API-06. Only pending requests can change, and only the right party can change them.
requests.patch('/:id', requireRole('student', 'alumni'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = c.req.param('id');
  const { status } = await parseJsonBody(c, changeStatus);

  const request = await readRequest(db, id);
  if (!request) throw notFound('Request');

  const isSender = user.role === 'student' && request.student_id === user.id;
  const isRecipient = user.role === 'alumni' && request.alumni_identity === user.id;
  if (status === 'cancelled' && !isSender) throw notOwner('Only the student who sent a request can cancel it');
  if (status !== 'cancelled' && !isRecipient) throw notOwner('Only the alumni who received a request can answer it');

  let outcome: Record<string, unknown> = { connection: null };
  if (status === 'accepted') {
    outcome = await acceptRequest(db, id);
  } else {
    const updated = await db
      .prepare("UPDATE mentoring_requests SET status = ?, responded_at = ? WHERE id = ? AND status = 'pending'")
      .bind(status, new Date().toISOString(), id)
      .run();
    if (!updated.meta.changes) throw invalidState((await readRequest(db, id))?.status);
  }

  const { alumni_identity: _identity, ...current } = (await readRequest(db, id)) as RequestRow;
  return c.json({ ...current, ...outcome });
});
