import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { z } from 'zod';

import { requireRole } from '../lib/auth';
import { ApiError, conflict, isUniqueViolation, notFound, validationError } from '../lib/errors';
import { parseJsonBody, parseQuery } from '../lib/validate';
import type { AppEnv } from '../types';

/**
 * PRD Assumption 1 fallback. Alumni lose their @lamduan.mfu.ac.th address after graduation, so if
 * the Identity service only signs in current students, alumni sign up with a personal email and the
 * Alumni Association checks the claim before they can sign in:
 *
 *   1. POST  /auth/alumni/register             claim: personal email, name, student ID, faculty, year
 *   2. GET   /admin/alumni-verifications       the Association's queue
 *   3. PATCH /admin/alumni-verifications/{id}  approve or reject
 *   4. POST  /auth/alumni/sign-in-link         a single-use code, sent to the personal email
 *   5. POST  /auth/alumni/sign-in              the code becomes an alumni token
 *
 * Step 4's code proves the person owns the inbox. No email provider is connected yet.
 *
 * Demo powers reach demo claims only, as with demo sign-in (CLAUDE.md invariant 9). A demo claim uses
 * an @example.com address, which is reserved and can never be a real inbox. For those, and only
 * those, step 4 returns the code in the answer, a demo admin can see and review the claim, approval
 * gives a demo-alumni- ID rather than personal-, and the token carries `demo: true`. A demo claim
 * doesn't hold its student ID either (migration 0005), so it can't block the real alumni. A claim
 * with a real email needs a real admin and a real email.
 */

const STUDENT_DOMAIN = /@lamduan\.mfu\.ac\.th$/i;
const DEMO_DOMAIN = '@example.com';
const isDemoEmail = (email: string) => email.endsWith(DEMO_DOMAIN);
// substr, not LIKE, on user text (invariant 2).
const IS_DEMO_CLAIM = `substr(email, -${DEMO_DOMAIN.length}) = '${DEMO_DOMAIN}'`;
const CODE_LIFETIME_MS = 15 * 60 * 1000;
const TOKEN_LIFETIME_SECONDS = 2 * 3600;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const personalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Use a valid email address');

const registerBody = z.strictObject({
  email: personalEmail.refine((email) => !STUDENT_DOMAIN.test(email), {
    message: 'Use a personal email: student addresses close after graduation',
  }),
  display_name: z.string().trim().min(1).max(100),
  student_id: z.string().trim().regex(/^\d{10}$/, 'Use your 10-digit MFU student ID'),
  faculty_id: z.number().int().positive(),
  grad_year: z
    .number()
    .int()
    .min(1998)
    .refine((year) => year <= new Date().getUTCFullYear(), 'Use a year you have already graduated in'),
});

export const alumniSignup = new Hono<AppEnv>();

// Step 1. Public: the person has no account yet. Nothing here signs anyone in.
alumniSignup.post('/register', async (c) => {
  const body = await parseJsonBody(c, registerBody);
  const faculty = await c.env.DB.prepare('SELECT id FROM faculties WHERE id = ?').bind(body.faculty_id).first();
  if (!faculty) throw validationError({ faculty_id: 'Unknown faculty' });

  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      `INSERT INTO alumni_verifications (id, email, display_name, student_id, faculty_id, grad_year)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, body.email, body.display_name, body.student_id, body.faculty_id, body.grad_year)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict('ALREADY_REGISTERED', 'This email or student ID already has an open or approved claim');
    }
    throw err;
  }
  return c.json(
    { id, status: 'pending', message: 'The Alumni Association will check your details against graduation records' },
    201,
  );
});

const linkBody = z.strictObject({ email: personalEmail });

// Step 4. The same answer whether or not the email has an account, so it can't be used to find out.
alumniSignup.post('/sign-in-link', async (c) => {
  const { email } = await parseJsonBody(c, linkBody);
  const answer = { message: 'If this email has an approved account, a sign-in code is on its way' };

  // No email provider yet, so a real address gets nothing. Only a demo address gets the code back
  // in the answer, since no one can own an @example.com inbox.
  if (!isDemoEmail(email)) return c.json(answer, 202);

  const account = await c.env.DB.prepare(
    `SELECT id FROM alumni_verifications WHERE email = ? AND status = 'approved'`,
  )
    .bind(email)
    .first<{ id: string }>();
  if (!account) return c.json(answer, 202);

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const code = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const expiresAt = new Date(Date.now() + CODE_LIFETIME_MS).toISOString();
  await c.env.DB.prepare('INSERT INTO alumni_sign_in_codes (code_hash, verification_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(code), account.id, expiresAt)
    .run();
  return c.json({ ...answer, demo_code: code, expires_at: expiresAt }, 202);
});

const signInBody = z.strictObject({ code: z.string().regex(/^[0-9a-f]{64}$/, 'Use the code from the email') });

// Step 5. A code works once, for 15 minutes, and only while the claim is still approved.
alumniSignup.post('/sign-in', async (c) => {
  if (!c.env.JWT_SECRET) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not set up on this server');
  }
  const { code } = await parseJsonBody(c, signInBody);
  const now = new Date().toISOString();

  // One statement marks the code used and checks it, so two requests with one code can't both pass.
  const used = await c.env.DB.prepare(
    `UPDATE alumni_sign_in_codes SET used_at = ?1
     WHERE code_hash = ?2 AND used_at IS NULL AND expires_at > ?1
     RETURNING verification_id`,
  )
    .bind(now, await sha256Hex(code))
    .first<{ verification_id: string }>();
  const account =
    used &&
    (await c.env.DB.prepare(
      `SELECT identity_user_id, email FROM alumni_verifications WHERE id = ? AND status = 'approved'`,
    )
      .bind(used.verification_id)
      .first<{ identity_user_id: string; email: string }>());
  if (!account) throw new ApiError(401, 'INVALID_CODE', 'The code is wrong, used or expired');

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_LIFETIME_SECONDS;
  const userId = account.identity_user_id;
  const claims = { sub: userId, role: 'alumni', ...(isDemoEmail(account.email) ? { demo: true } : {}), iat, exp };
  const token = await sign(claims, c.env.JWT_SECRET, 'HS256');
  return c.json({ token, expires_at: new Date(exp * 1000).toISOString(), user: { id: userId, role: 'alumni' } });
});

export const verificationAdmin = new Hono<AppEnv>();

const listQuery = z.strictObject({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});

// Step 2. The Association sees what it needs to check a claim, and nothing from alumni profiles.
// A demo admin sees demo claims only, so a real claimant's email and student ID stay hidden.
verificationAdmin.get('/', requireRole('admin'), async (c) => {
  const { status } = parseQuery(c, listQuery);
  const demo = c.get('user').demo ? 1 : 0;
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.email, v.display_name, v.student_id, v.faculty_id, f.name AS faculty, v.grad_year,
            v.status, v.review_note, v.reviewed_at, v.created_at
     FROM alumni_verifications v JOIN faculties f ON f.id = v.faculty_id
     WHERE v.status = ?1 AND (?2 = 0 OR ${IS_DEMO_CLAIM.replace('email', 'v.email')})
     ORDER BY v.created_at LIMIT 100`,
  )
    .bind(status, demo)
    .all();
  return c.json({ data: results });
});

const reviewBody = z.strictObject({
  status: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional(),
});

// Step 3. Only a pending claim can be reviewed, and the check and the change are one statement.
// A demo admin can only review demo claims, and a real claim answers 404 to them, as if it weren't there.
verificationAdmin.patch('/:id', requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const { status, note } = await parseJsonBody(c, reviewBody);
  const user = c.get('user');
  const demo = user.demo ? 1 : 0;

  // Approval gives an ID in the claim's own namespace: demo-alumni- for a demo claim, personal- for a
  // real one. The database refuses any other pairing.
  const updated = await c.env.DB.prepare(
    `UPDATE alumni_verifications
     SET status = ?1,
         identity_user_id = CASE WHEN ?1 = 'approved'
           THEN (CASE WHEN ${IS_DEMO_CLAIM} THEN 'demo-alumni-' ELSE 'personal-' END) || ?2 END,
         review_note = ?3, reviewed_by = ?4, reviewed_at = ?5
     WHERE id = ?6 AND status = 'pending' AND (?7 = 0 OR ${IS_DEMO_CLAIM})
     RETURNING identity_user_id`,
  )
    .bind(status, crypto.randomUUID(), note ?? null, user.id, new Date().toISOString(), id, demo)
    .first<{ identity_user_id: string | null }>();
  if (!updated) {
    const exists = await c.env.DB.prepare(
      `SELECT 1 FROM alumni_verifications WHERE id = ?1 AND (?2 = 0 OR ${IS_DEMO_CLAIM})`,
    )
      .bind(id, demo)
      .first();
    if (exists) throw conflict('ALREADY_REVIEWED', 'This claim has already been reviewed');
    throw notFound('Claim');
  }
  return c.json({ id, status, identity_user_id: updated.identity_user_id });
});
