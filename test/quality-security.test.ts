import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { call, connect, hmacHex, makeAlumni, makePerson, respond, rows, sendRequest } from './helpers';

const eventBody = (eventId: string) =>
  JSON.stringify({
    event_id: eventId,
    event_type: 'alumni.event',
    occurred_at: '2026-11-10T00:00:00Z',
    data: {
      title: 'Quality test event',
      starts_at: '2026-12-01T09:00:00Z',
    },
  });

describe('focused authentication and authorization checks', () => {
  it('rejects unauthenticated access to protected endpoints', async () => {
    const protectedRoutes = [
      ['GET', '/alumni'],
      ['GET', '/mentoring-requests/me'],
      ['PATCH', '/admin/alumni/missing/deactivate'],
    ] as const;

    for (const [method, path] of protectedRoutes) {
      const res = await call(method, path, method === 'PATCH' ? { body: { status: 'accepted' } } : {});
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.json.code).toBe('UNAUTHENTICATED');
    }
  });

  it('prevents a student from using an admin-only endpoint', async () => {
    const student = await makePerson('student');
    const res = await call('PATCH', '/admin/alumni/missing/deactivate', {
      as: student,
    });

    expect(res.status).toBe(403);
    expect(res.json.code).toBe('FORBIDDEN');
  });

  it('rejects a target profile ID and keeps PATCH /alumni/me scoped to the authenticated alumni', async () => {
    const first = await makeAlumni({ display_name: 'First Alumni' });
    const second = await makeAlumni({ display_name: 'Second Alumni' });

    const res = await call('PATCH', '/alumni/me', {
      as: first,
      body: { id: second.profileId, display_name: 'Unauthorized Update' },
    });

    expect(res.status).toBe(400);
    expect(res.json.code).toBe('VALIDATION_ERROR');
    expect(res.json.fields).toHaveProperty('id');

    const firstProfile = await call('GET', `/alumni/${first.profileId}`, { as: first });
    const secondProfile = await call('GET', `/alumni/${second.profileId}`, { as: first });
    expect(firstProfile.json.display_name).toBe('First Alumni');
    expect(secondProfile.json.display_name).toBe('Second Alumni');
  });
});

describe('focused privacy and consent checks', () => {
  it('does not expose contact information in public profile views', async () => {
    const alumni = await makeAlumni({
      contact_email: 'private@example.com',
      contact_line: 'private.line',
      contact_linkedin: 'https://www.linkedin.com/in/private',
      consent_contact_email: true,
      consent_contact_line: true,
      consent_contact_linkedin: true,
    });
    const viewer = await makePerson('student');

    const search = await call('GET', '/alumni', { as: viewer });
    const profile = await call('GET', `/alumni/${alumni.profileId}`, { as: viewer });

    expect(search.status).toBe(200);
    expect(profile.status).toBe(200);
    expect(search.text).not.toContain('private@example.com');
    expect(search.text).not.toContain('private.line');
    expect(profile.text).not.toContain('private@example.com');
    expect(profile.text).not.toContain('private.line');
    expect(profile.json.contact).toBeUndefined();
  });

  it('reveals only consented contact fields after an active connection', async () => {
    const alumni = await makeAlumni({
      contact_email: 'shared@example.com',
      contact_line: 'private.line',
      consent_contact_email: true,
      consent_contact_line: false,
    });
    const student = await makePerson('student');

    const beforeConnection = await call('GET', `/alumni/${alumni.profileId}`, { as: student });
    expect(beforeConnection.json.contact).toBeUndefined();

    await connect(student, alumni);
    const afterConnection = await call('GET', `/alumni/${alumni.profileId}`, { as: student });

    expect(afterConnection.status).toBe(200);
    expect(afterConnection.json.contact).toEqual({ email: 'shared@example.com' });
    expect(afterConnection.text).not.toContain('private.line');
  });

  it('stops disclosing a contact field after consent is withdrawn', async () => {
    const alumni = await makeAlumni({
      contact_email: 'withdraw@example.com',
      consent_contact_email: true,
    });
    const student = await makePerson('student');
    await connect(student, alumni);

    const shared = await call('GET', `/alumni/${alumni.profileId}`, { as: student });
    expect(shared.json.contact).toEqual({ email: 'withdraw@example.com' });

    const withdrawal = await call('PATCH', '/alumni/me', {
      as: alumni,
      body: { consent_contact_email: false },
    });
    expect(withdrawal.status).toBe(200);

    const hidden = await call('GET', `/alumni/${alumni.profileId}`, { as: student });
    expect(hidden.status).toBe(200);
    expect(hidden.json.contact).toEqual({});
    expect(hidden.text).not.toContain('withdraw@example.com');
  });
});

describe('focused mentoring request workflow checks', () => {
  it('submits a valid pending mentoring request', async () => {
    const student = await makePerson('student');
    const alumni = await makeAlumni();

    const res = await sendRequest(student, alumni, 'Please advise me about software careers.');

    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      student_id: student.id,
      alumni_id: alumni.profileId,
      status: 'pending',
      responded_at: null,
    });
  });

  it('rejects duplicate pending requests for the same student and alumni', async () => {
    const student = await makePerson('student');
    const alumni = await makeAlumni();
    await sendRequest(student, alumni);

    const duplicate = await sendRequest(student, alumni);

    expect(duplicate.status).toBe(409);
    expect(duplicate.json.code).toBe('DUPLICATE_PENDING');
  });

  it('rejects accepting or rejecting a request after it is already closed', async () => {
    const student = await makePerson('student');
    const alumni = await makeAlumni();
    const request = await sendRequest(student, alumni);
    const requestId = request.json.id as string;

    expect((await respond(alumni, requestId, 'rejected')).status).toBe(200);

    const acceptAgain = await respond(alumni, requestId, 'accepted');
    const rejectAgain = await respond(alumni, requestId, 'rejected');

    expect(acceptAgain.status).toBe(409);
    expect(rejectAgain.status).toBe(409);
    expect(acceptAgain.json.code).toBe('INVALID_STATE');
    expect(rejectAgain.json.code).toBe('INVALID_STATE');
  });

  it('rejects a student attempting to accept another user’s request', async () => {
    const owner = await makePerson('student');
    const otherStudent = await makePerson('student');
    const alumni = await makeAlumni();
    const request = await sendRequest(owner, alumni);

    const res = await respond(otherStudent, request.json.id, 'accepted');

    expect(res.status).toBe(403);
    expect(res.json.code).toBe('NOT_OWNER');
  });
});

describe('focused webhook security checks', () => {
  it('rejects an invalid HMAC signature without storing the event', async () => {
    const eventId = `quality-invalid-${crypto.randomUUID()}`;
    const body = eventBody(eventId);

    const res = await call('POST', '/webhooks/events-clubs', {
      rawBody: body,
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': 'invalid-signature',
      },
    });

    expect(res.status).toBe(401);
    expect(res.json.code).toBe('INVALID_SIGNATURE');
    expect(await rows('SELECT id FROM alumni_events WHERE event_id = ?', eventId)).toHaveLength(0);
  });

  it('stores duplicate webhook event IDs only once', async () => {
    const eventId = `quality-duplicate-${crypto.randomUUID()}`;
    const body = eventBody(eventId);
    const signature = await hmacHex(env.EVENTS_CLUBS_WEBHOOK_SECRET, body);
    const options = {
      rawBody: body,
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
      },
    };

    const first = await call('POST', '/webhooks/events-clubs', options);
    const second = await call('POST', '/webhooks/events-clubs', options);

    expect(first.status).toBe(200);
    expect(first.json).toEqual({ received: true });
    expect(second.status).toBe(200);
    expect(second.json).toEqual({ received: true, duplicate: true });
    expect(await rows('SELECT id FROM alumni_events WHERE event_id = ?', eventId)).toHaveLength(1);
  });
});
