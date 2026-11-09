import { SELF, env } from 'cloudflare:test';
import { sign } from 'hono/jwt';

export type Role = 'student' | 'alumni' | 'admin';
export type Person = { id: string; role: string; token: string };
export type Alumni = Person & { profileId: string; profile: any };

type CallOptions = {
  as?: Person | string | null;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
};

export const shortId = () => crypto.randomUUID().slice(0, 8);
export const nowSeconds = () => Math.floor(Date.now() / 1000);

export function tokenFor(role: string, sub: string, overrides: Record<string, unknown> = {}) {
  const now = nowSeconds();
  return sign({ sub, role, iat: now, exp: now + 3600, ...overrides }, env.JWT_SECRET, 'HS256');
}

export async function makePerson(role: string): Promise<Person> {
  const id = `${role}-${crypto.randomUUID()}`;
  return { id, role, token: await tokenFor(role, id) };
}

export async function call(method: string, path: string, options: CallOptions = {}) {
  const headers = new Headers(options.headers);
  if (options.as) {
    const token = typeof options.as === 'string' ? options.as : options.as.token;
    headers.set('Authorization', `Bearer ${token}`);
  }
  let body: string | undefined = options.rawBody;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers.set('Content-Type', 'application/json');
  }
  const res = await SELF.fetch(`https://alumni.test${path}`, { method, headers, body });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Left null: the assertion on status or text will explain it.
  }
  return { status: res.status, headers: res.headers, text, json };
}

/** Creates an alumni through the real API, open to mentoring unless a test says otherwise. */
export async function makeAlumni(fields: Record<string, unknown> = {}): Promise<Alumni> {
  const user = await makePerson('alumni');
  const res = await call('PATCH', '/alumni/me', {
    as: user,
    body: {
      display_name: 'Aung Kyaw',
      grad_year: 2021,
      faculty_id: 7,
      is_open_to_mentoring: true,
      ...fields,
    },
  });
  if (res.status !== 201) throw new Error(`makeAlumni failed: ${res.status} ${res.text}`);
  return { ...user, profileId: res.json.id, profile: res.json };
}

export const MESSAGE = 'I want advice on backend jobs abroad.';

export function sendRequest(student: Person, alumni: Alumni, message = MESSAGE) {
  return call('POST', '/mentoring-requests', {
    as: student,
    body: { alumni_id: alumni.profileId, message },
  });
}

export async function makeRequest(student: Person, alumni: Alumni): Promise<string> {
  const res = await sendRequest(student, alumni);
  if (res.status !== 201) throw new Error(`makeRequest failed: ${res.status} ${res.text}`);
  return res.json.id;
}

export function respond(person: Person, requestId: string, status: string) {
  return call('PATCH', `/mentoring-requests/${requestId}`, { as: person, body: { status } });
}

/** Runs the whole request and accept flow, and returns the new connection's ID. */
export async function connect(student: Person, alumni: Alumni): Promise<string> {
  const requestId = await makeRequest(student, alumni);
  const res = await respond(alumni, requestId, 'accepted');
  if (res.status !== 200) throw new Error(`connect failed: ${res.status} ${res.text}`);
  return res.json.connection.id;
}

export async function rows(sql: string, ...params: unknown[]): Promise<any[]> {
  const result = await env.DB.prepare(sql).bind(...params).all();
  return result.results;
}

// Written separately from the Worker's own HMAC code, so a bug there can't hide from the tests.
export async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
