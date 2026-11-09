import { Hono } from 'hono';
import { z } from 'zod';

import { requireRole } from '../lib/auth';
import { conflict, isCheckViolation, isUniqueViolation, notFound, validationError } from '../lib/errors';
import { paginationFields, parseJsonBody, parseQuery } from '../lib/validate';
import type { AppEnv } from '../types';

const CONSENT_PURPOSE_VERSION = 'v1';

const CONTACT_FIELDS = [
  ['contact_email', 'consent_contact_email'],
  ['contact_line', 'consent_contact_line'],
  ['contact_linkedin', 'consent_contact_linkedin'],
] as const;

const INTERESTS_JSON = `(
  SELECT json_group_array(i.name) FROM alumni_interests ai
  JOIN interests i ON i.id = ai.interest_id WHERE ai.alumni_id = a.id
) AS interests`;

// This list is the privacy filter: contact and consent columns are never selected, so they can't leak.
const PUBLIC_COLUMNS = `a.id, a.display_name, a.grad_year, a.faculty_id, f.name AS faculty, a.job_title,
  a.company, a.country_code, a.city, a.bio, a.is_open_to_mentoring, ${INTERESTS_JSON}`;

type Row = Record<string, unknown>;

function toPublicProfile(row: Row) {
  const { is_active: _active, identity_user_id: _identity, ...profile } = row;
  return {
    ...profile,
    is_open_to_mentoring: Boolean(row.is_open_to_mentoring),
    interests: (JSON.parse(row.interests as string) as string[]).sort(),
  };
}

async function loadOwnerProfile(db: D1Database, id: string) {
  const row = await db
    .prepare(
      `SELECT a.*, f.name AS faculty, ${INTERESTS_JSON}
       FROM alumni_profiles a JOIN faculties f ON f.id = a.faculty_id WHERE a.id = ?`,
    )
    .bind(id)
    .first<Row>();
  if (!row) throw notFound('Alumni');
  return {
    ...toPublicProfile(row),
    is_active: Boolean(row.is_active),
    consent_contact_email: Boolean(row.consent_contact_email),
    consent_contact_line: Boolean(row.consent_contact_line),
    consent_contact_linkedin: Boolean(row.consent_contact_linkedin),
  };
}

/**
 * What a student connected to this alumni may see. Non-consented values never leave the database.
 *
 * BR-10: the accept flow logs the fields consented at that moment. A field consented later is
 * logged here, the first time this connection shows it. The log insert and the read run in one
 * batch, so they see the same consent flags.
 */
async function loadConsentedContact(db: D1Database, alumniId: string, studentId: string) {
  const [, contact] = await db.batch<Row>([
    db
      .prepare(
        `INSERT INTO contact_reveal_log (connection_id, viewer_id, field_name, revealed_at)
         SELECT c.id, c.student_id, f.field_name, ?3
         FROM connections c
         JOIN alumni_profiles a ON a.id = c.alumni_id
         JOIN (
           SELECT 'contact_email' AS field_name UNION ALL
           SELECT 'contact_line' UNION ALL
           SELECT 'contact_linkedin'
         ) f ON (f.field_name = 'contact_email' AND a.consent_contact_email = 1 AND a.contact_email IS NOT NULL)
             OR (f.field_name = 'contact_line' AND a.consent_contact_line = 1 AND a.contact_line IS NOT NULL)
             OR (f.field_name = 'contact_linkedin' AND a.consent_contact_linkedin = 1 AND a.contact_linkedin IS NOT NULL)
         WHERE c.alumni_id = ?1 AND c.student_id = ?2 AND c.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM contact_reveal_log l WHERE l.connection_id = c.id AND l.field_name = f.field_name
           )`,
      )
      .bind(alumniId, studentId, new Date().toISOString()),
    db
      .prepare(
        `SELECT CASE WHEN a.consent_contact_email = 1 THEN a.contact_email END AS email,
                CASE WHEN a.consent_contact_line = 1 THEN a.contact_line END AS line,
                CASE WHEN a.consent_contact_linkedin = 1 THEN a.contact_linkedin END AS linkedin
         FROM connections c JOIN alumni_profiles a ON a.id = c.alumni_id
         WHERE c.alumni_id = ? AND c.student_id = ? AND c.status = 'active'
         LIMIT 1`,
      )
      .bind(alumniId, studentId),
  ]);
  const row = contact.results[0];
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
}

const searchQuery = z.strictObject({
  faculty_id: z.coerce.number().int().positive().optional(),
  role: z.string().trim().min(1).max(100).optional(),
  interests: z
    .string()
    .transform((value) => value.split(',').map((name) => name.trim()).filter(Boolean))
    .pipe(z.array(z.string()).max(17))
    .optional(),
  grad_year: z.coerce.number().int().optional(),
  country: z.string().regex(/^[A-Z]{2}$/, 'Use a 2-letter country code, such as MM').optional(),
  open_to_mentoring: z.enum(['true', 'false']).optional(),
  ...paginationFields,
});

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();

// The allow-list (FR-03). A strict object rejects every other field.
const profilePatch = z
  .strictObject({
    display_name: z.string().trim().min(1).max(100),
    grad_year: z
      .number()
      .int()
      .min(1998)
      .refine((year) => year <= new Date().getUTCFullYear() + 1, 'Too far in the future'),
    faculty_id: z.number().int().positive(),
    job_title: nullableText(100),
    company: nullableText(100),
    country_code: z
      .string()
      .regex(/^[A-Z]{2}$/, 'Use a 2-letter country code, such as MM')
      .nullable(),
    city: nullableText(100),
    bio: nullableText(1000),
    is_open_to_mentoring: z.boolean(),
    mentee_capacity: z.number().int().min(0).max(10),
    contact_email: z
      .string()
      .trim()
      .max(254)
      .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Use a valid email address')
      .nullable(),
    contact_line: z
      .string()
      .trim()
      .regex(/^[\w.-]{1,100}$/, 'Use letters, numbers, dots, dashes and underscores only')
      .nullable(),
    // Limited to linkedin.com over https, so a client can't be handed a javascript: link.
    contact_linkedin: z
      .string()
      .trim()
      .max(200)
      .regex(/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/\S+$/i, 'Use a https://linkedin.com link')
      .nullable(),
    consent_contact_email: z.boolean(),
    consent_contact_line: z.boolean(),
    consent_contact_linkedin: z.boolean(),
    interests: z.array(z.string()).max(17),
  })
  .partial();

type ProfilePatch = z.output<typeof profilePatch>;

function checkConsentHasValues(patch: ProfilePatch, existing: Row | null) {
  const errors: Record<string, string> = {};
  for (const [field, consent] of CONTACT_FIELDS) {
    const value = field in patch ? patch[field] : existing?.[field];
    const agreed = consent in patch ? patch[consent] : Boolean(existing?.[consent]);
    if (!agreed || (value !== null && value !== undefined)) continue;
    if (field in patch) errors[field] = 'Turn off consent for this field before clearing it';
    else errors[consent] = 'Add this contact detail before agreeing to share it';
  }
  return errors;
}

export const alumni = new Hono<AppEnv>();

// API-03. Creates the profile on the first call (FR-03), then updates it.
alumni.patch('/me', requireRole('alumni'), async (c) => {
  const db = c.env.DB;
  const patch = await parseJsonBody(c, profilePatch);
  const existing = await db
    .prepare('SELECT * FROM alumni_profiles WHERE identity_user_id = ?')
    .bind(c.get('user').id)
    .first<Row>();

  const errors = checkConsentHasValues(patch, existing);
  if (existing && Object.keys(patch).length === 0) errors.body = 'Send at least one field to change';
  if (!existing) {
    for (const field of ['display_name', 'grad_year', 'faculty_id'] as const) {
      if (patch[field] === undefined) errors[field] = 'Required when creating your profile';
    }
  }

  if (patch.faculty_id !== undefined) {
    const faculty = await db.prepare('SELECT id FROM faculties WHERE id = ?').bind(patch.faculty_id).first();
    if (!faculty) errors.faculty_id = 'Unknown faculty';
  }

  let interestIds: number[] = [];
  if (patch.interests) {
    const names = [...new Set(patch.interests)];
    const found = names.length
      ? await db
          .prepare(`SELECT id, name FROM interests WHERE name IN (${names.map(() => '?').join(', ')})`)
          .bind(...names)
          .all<{ id: number; name: string }>()
      : { results: [] };
    const unknown = names.filter((name) => !found.results.some((row) => row.name === name));
    if (unknown.length) errors.interests = `Unknown interests: ${unknown.join(', ')}`;
    interestIds = found.results.map((row) => row.id);
  }

  if (Object.keys(errors).length) throw validationError(errors);

  const { interests, ...columns } = patch;
  const values: Record<string, string | number | null> = {};
  for (const [column, value] of Object.entries(columns)) {
    values[column] = typeof value === 'boolean' ? Number(value) : (value as string | number | null);
  }

  // BR-02: the server records when consent was given. Clients cannot set these two columns.
  const newlyGranted = CONTACT_FIELDS.some(([, consent]) => patch[consent] === true && !existing?.[consent]);
  if (newlyGranted) {
    values.consent_timestamp = new Date().toISOString();
    values.consent_purpose_version = CONSENT_PURPOSE_VERSION;
  }

  // Column names come from the strict schema above, never from the raw request.
  const names = Object.keys(values);
  const profileId = (existing?.id as string | undefined) ?? crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  if (!existing) {
    statements.push(
      db
        .prepare(
          `INSERT INTO alumni_profiles (id, identity_user_id, ${names.join(', ')})
           VALUES (?, ?, ${names.map(() => '?').join(', ')})`,
        )
        .bind(profileId, c.get('user').id, ...Object.values(values)),
    );
  } else if (names.length) {
    statements.push(
      db
        .prepare(`UPDATE alumni_profiles SET ${names.map((name) => `${name} = ?`).join(', ')} WHERE id = ?`)
        .bind(...Object.values(values), profileId),
    );
  }
  if (interests) {
    statements.push(db.prepare('DELETE FROM alumni_interests WHERE alumni_id = ?').bind(profileId));
    for (const interestId of interestIds) {
      statements.push(
        db.prepare('INSERT INTO alumni_interests (alumni_id, interest_id) VALUES (?, ?)').bind(profileId, interestId),
      );
    }
  }

  try {
    await db.batch(statements);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict('PROFILE_EXISTS', 'Your profile was just created. Send this update again.');
    }
    if (isCheckViolation(err)) throw validationError({ body: 'These values break a profile rule' });
    throw err;
  }

  return c.json(await loadOwnerProfile(db, profileId), existing ? 200 : 201);
});

// API-01. Search results never include contact details.
alumni.get('/', requireRole('student', 'alumni'), async (c) => {
  const query = parseQuery(c, searchQuery);
  const where = ['a.is_active = 1'];
  const params: (string | number)[] = [];

  if (query.faculty_id !== undefined) {
    where.push('a.faculty_id = ?');
    params.push(query.faculty_id);
  }
  if (query.role) {
    // Not LIKE: D1 rejects patterns over 50 bytes, which a Burmese job title passes in under 20
    // characters. lower() only folds ASCII, which leaves non-Latin text as it is.
    where.push('instr(lower(a.job_title), lower(?)) > 0');
    params.push(query.role);
  }
  if (query.grad_year !== undefined) {
    where.push('a.grad_year = ?');
    params.push(query.grad_year);
  }
  if (query.country) {
    where.push('a.country_code = ?');
    params.push(query.country);
  }
  if (query.open_to_mentoring) {
    where.push('a.is_open_to_mentoring = ?');
    params.push(query.open_to_mentoring === 'true' ? 1 : 0);
  }
  if (query.interests?.length) {
    where.push(`EXISTS (
      SELECT 1 FROM alumni_interests ai JOIN interests i ON i.id = ai.interest_id
      WHERE ai.alumni_id = a.id AND i.name IN (${query.interests.map(() => '?').join(', ')})
    )`);
    params.push(...query.interests);
  }

  const condition = where.join(' AND ');
  const db = c.env.DB;
  const [page, count] = await db.batch<Row>([
    db
      .prepare(
        `SELECT ${PUBLIC_COLUMNS}
         FROM alumni_profiles a JOIN faculties f ON f.id = a.faculty_id
         WHERE ${condition}
         ORDER BY a.grad_year DESC, a.display_name, a.id
         LIMIT ? OFFSET ?`,
      )
      .bind(...params, query.limit, query.offset),
    db.prepare(`SELECT COUNT(*) AS total FROM alumni_profiles a WHERE ${condition}`).bind(...params),
  ]);

  return c.json({
    data: page.results.map(toPublicProfile),
    pagination: { limit: query.limit, offset: query.offset, total: count.results[0].total },
  });
});

// API-02. Three views: the owner sees everything, a connected student also sees consented contact
// details, and everyone else sees public fields only.
alumni.get('/:id', requireRole('student', 'alumni'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS}, a.is_active, a.identity_user_id
       FROM alumni_profiles a JOIN faculties f ON f.id = a.faculty_id WHERE a.id = ?`,
    )
    .bind(id)
    .first<Row>();
  if (!row) throw notFound('Alumni');

  if (user.role === 'alumni' && row.identity_user_id === user.id) {
    return c.json(await loadOwnerProfile(db, id));
  }
  if (!row.is_active) throw notFound('Alumni');

  const profile = toPublicProfile(row);
  if (user.role === 'student') {
    const contact = await loadConsentedContact(db, id, user.id);
    if (contact) return c.json({ ...profile, contact });
  }
  return c.json(profile);
});
