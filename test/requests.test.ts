import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

import {
  MESSAGE,
  call,
  connect,
  makeAlumni,
  makePerson,
  makeRequest,
  respond,
  rows,
  sendRequest,
} from './helpers';

const statuses = (...results: { status: number }[]) =>
  results.map((result) => result.status).sort((a, b) => a - b);

describe('POST /mentoring-requests (API-04)', () => {
  it('creates a pending request', async () => {
    const student = await makePerson('student');
    const alumni = await makeAlumni();
    const res = await sendRequest(student, alumni);
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      student_id: student.id,
      alumni_id: alumni.profileId,
      message: MESSAGE,
      status: 'pending',
      responded_at: null,
    });
    expect(res.json.id).toEqual(expect.any(String));
  });

  it.each([
    ['missing', undefined],
    ['blank', '                '],
    ['too short', 'short'],
    ['too long', 'x'.repeat(2001)],
  ])('rejects a message that is %s', async (_label, message) => {
    const res = await call('POST', '/mentoring-requests', {
      as: await makePerson('student'),
      body: { alumni_id: (await makeAlumni()).profileId, message },
    });
    expect(res.status).toBe(400);
    expect(res.json.fields).toHaveProperty('message');
  });

  it('accepts a non-Latin message of 10 characters', async () => {
    const res = await sendRequest(await makePerson('student'), await makeAlumni(), '请帮助我了解工作机会吗');
    expect(res.status).toBe(201);
  });

  it('will not let a student send a request as someone else', async () => {
    const student = await makePerson('student');
    const res = await call('POST', '/mentoring-requests', {
      as: student,
      body: {
        alumni_id: (await makeAlumni()).profileId,
        message: MESSAGE,
        student_id: 'someone-else',
      },
    });
    expect(res.status).toBe(400);
    expect(res.json.fields).toHaveProperty('student_id');
  });

  it('returns 404 for an unknown alumni', async () => {
    const res = await call('POST', '/mentoring-requests', {
      as: await makePerson('student'),
      body: { alumni_id: 'no-such-id', message: MESSAGE },
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 when the alumni is not open to mentoring', async () => {
    const res = await sendRequest(
      await makePerson('student'),
      await makeAlumni({ is_open_to_mentoring: false }),
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('NOT_OPEN_TO_MENTORING');
  });

  // PRD test 4, BR-05.
  it('rejects a second pending request to the same alumni', async () => {
    const student = await makePerson('student');
    const alumni = await makeAlumni();
    await makeRequest(student, alumni);
    const res = await sendRequest(student, alumni);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('DUPLICATE_PENDING');
  });

  it('lets one of two simultaneous duplicate requests through', async () => {
    const student = await makePerson('student');
    const alumni = await makeAlumni();
    const results = await Promise.all([sendRequest(student, alumni), sendRequest(student, alumni)]);
    expect(statuses(...results)).toEqual([201, 409]);
    const stored = await rows(
      "SELECT id FROM mentoring_requests WHERE student_id = ? AND status = 'pending'",
      student.id,
    );
    expect(stored).toHaveLength(1);
  });

  it('allows a new request after the earlier one was rejected', async () => {
    const student = await makePerson('student');
    const alumni = await makeAlumni();
    await respond(alumni, await makeRequest(student, alumni), 'rejected');
    expect((await sendRequest(student, alumni)).status).toBe(201);
  });

  // PRD test 4, BR-08.
  it('rejects a sixth pending request', async () => {
    const student = await makePerson('student');
    for (let i = 0; i < 5; i++) await makeRequest(student, await makeAlumni());
    const res = await sendRequest(student, await makeAlumni());
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('PENDING_LIMIT');
  });

  it('holds the five-request cap when the last two arrive together', async () => {
    const student = await makePerson('student');
    for (let i = 0; i < 4; i++) await makeRequest(student, await makeAlumni());
    const [first, second] = [await makeAlumni(), await makeAlumni()];
    const results = await Promise.all([sendRequest(student, first), sendRequest(student, second)]);
    expect(statuses(...results)).toEqual([201, 409]);
    const stored = await rows(
      "SELECT id FROM mentoring_requests WHERE student_id = ? AND status = 'pending'",
      student.id,
    );
    expect(stored).toHaveLength(5);
  });

  it('frees a slot when a pending request is cancelled', async () => {
    const student = await makePerson('student');
    const requestIds: string[] = [];
    for (let i = 0; i < 5; i++) requestIds.push(await makeRequest(student, await makeAlumni()));
    await respond(student, requestIds[0], 'cancelled');
    expect((await sendRequest(student, await makeAlumni())).status).toBe(201);
  });

  it('rejects a request while the pair is already connected, and allows it after', async () => {
    const student = await makePerson('student');
    const alumni = await makeAlumni();
    const connectionId = await connect(student, alumni);
    const blocked = await sendRequest(student, alumni);
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe('ALREADY_CONNECTED');
    await call('DELETE', `/connections/${connectionId}`, { as: student });
    expect((await sendRequest(student, alumni)).status).toBe(201);
  });
});

describe('GET /mentoring-requests/me (API-05)', () => {
  it('shows a student only their own requests', async () => {
    const student = await makePerson('student');
    const other = await makePerson('student');
    const alumni = await makeAlumni();
    const mine = await makeRequest(student, alumni);
    await makeRequest(other, alumni);
    const res = await call('GET', '/mentoring-requests/me', { as: student });
    expect(res.status).toBe(200);
    expect(res.json.data.map((request: { id: string }) => request.id)).toEqual([mine]);
    expect(res.json.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
  });

  it('shows an alumni only the requests sent to them', async () => {
    const student = await makePerson('student');
    const alumni = await makeAlumni();
    const incoming = await makeRequest(student, alumni);
    await makeRequest(student, await makeAlumni());
    const res = await call('GET', '/mentoring-requests/me', { as: alumni });
    expect(res.json.data.map((request: { id: string }) => request.id)).toEqual([incoming]);
    expect(res.json.data[0]).toMatchObject({ message: MESSAGE, student_id: student.id });
  });

  it('returns an empty list to an alumni with no profile yet', async () => {
    const res = await call('GET', '/mentoring-requests/me', { as: await makePerson('alumni') });
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual([]);
  });

  it('includes the status and connection once accepted (FR-07)', async () => {
    const student = await makePerson('student');
    const alumni = await makeAlumni();
    const connectionId = await connect(student, alumni);
    for (const person of [student, alumni]) {
      const res = await call('GET', '/mentoring-requests/me', { as: person });
      expect(res.json.data[0]).toMatchObject({
        status: 'accepted',
        connection: { id: connectionId, status: 'active' },
      });
    }
  });

  it('returns connection as null while pending', async () => {
    const student = await makePerson('student');
    await makeRequest(student, await makeAlumni());
    const res = await call('GET', '/mentoring-requests/me', { as: student });
    expect(res.json.data[0].connection).toBeNull();
  });

  it('never exposes alumni contact details', async () => {
    const student = await makePerson('student');
    const alumni = await makeAlumni({
      contact_email: 'hidden@example.com',
      consent_contact_email: true,
    });
    await connect(student, alumni);
    const res = await call('GET', '/mentoring-requests/me', { as: student });
    expect(res.text).not.toContain('hidden@example.com');
  });

  it('pages through results', async () => {
    const student = await makePerson('student');
    for (let i = 0; i < 3; i++) await makeRequest(student, await makeAlumni());
    const res = await call('GET', '/mentoring-requests/me?limit=2&offset=2', { as: student });
    expect(res.json.data).toHaveLength(1);
    expect(res.json.pagination).toEqual({ limit: 2, offset: 2, total: 3 });
  });

  it('rejects unknown query parameters', async () => {
    const res = await call('GET', '/mentoring-requests/me?student_id=someone', {
      as: await makePerson('student'),
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /mentoring-requests/:id (API-06)', () => {
  describe('accept', () => {
    // PRD test 5 and test 6 (queueing half; delivery is not built yet).
    it('creates the connection, reveal log and queued event together', async () => {
      const student = await makePerson('student');
      const alumni = await makeAlumni({
        contact_email: 'a@example.com',
        contact_line: 'aung.kyaw',
        contact_linkedin: 'https://www.linkedin.com/in/aung',
        consent_contact_email: true,
        consent_contact_line: true,
      });
      const requestId = await makeRequest(student, alumni);

      const res = await respond(alumni, requestId, 'accepted');

      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        id: requestId,
        status: 'accepted',
        connection: { status: 'active', student_id: student.id, alumni_id: alumni.profileId },
        revealed_fields: ['contact_email', 'contact_line'],
      });
      expect(Date.parse(res.json.responded_at)).not.toBeNaN();
      const connectionId = res.json.connection.id;

      const connections = await rows('SELECT * FROM connections WHERE request_id = ?', requestId);
      expect(connections).toHaveLength(1);
      expect(connections[0]).toMatchObject({ id: connectionId, status: 'active', ended_at: null });

      const reveals = await rows(
        'SELECT viewer_id, field_name FROM contact_reveal_log WHERE connection_id = ? ORDER BY field_name',
        connectionId,
      );
      expect(reveals).toEqual([
        { viewer_id: student.id, field_name: 'contact_email' },
        { viewer_id: student.id, field_name: 'contact_line' },
      ]);

      const queued = await rows(
        "SELECT * FROM webhook_outbox WHERE json_extract(payload, '$.connection_id') = ?",
        connectionId,
      );
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        event_type: 'alumni.connection_created',
        status: 'pending',
        attempts: 0,
      });
      expect(queued[0].event_id).toEqual(expect.any(String));
      expect(JSON.parse(queued[0].payload)).toEqual({
        connection_id: connectionId,
        student_id: student.id,
        alumni_id: alumni.profileId,
        created_at: connections[0].created_at,
      });
      expect(queued[0].payload).not.toContain('a@example.com');
    });

    it('gives each event its own event_id', async () => {
      const alumni = await makeAlumni();
      const firstId = await connect(await makePerson('student'), alumni);
      const secondId = await connect(await makePerson('student'), alumni);
      const events = await rows(
        "SELECT event_id FROM webhook_outbox WHERE json_extract(payload, '$.connection_id') IN (?, ?)",
        firstId,
        secondId,
      );
      expect(new Set(events.map((event) => event.event_id)).size).toBe(2);
    });

    it('logs only the fields consented at the moment of accepting (FR-06)', async () => {
      const student = await makePerson('student');
      const alumni = await makeAlumni({
        contact_email: 'a@example.com',
        consent_contact_email: true,
      });
      const requestId = await makeRequest(student, alumni);
      await call('PATCH', '/alumni/me', { as: alumni, body: { consent_contact_email: false } });

      const res = await respond(alumni, requestId, 'accepted');

      expect(res.json.revealed_fields).toEqual([]);
      const reveals = await rows(
        'SELECT field_name FROM contact_reveal_log WHERE connection_id = ?',
        res.json.connection.id,
      );
      expect(reveals).toEqual([]);
    });

    it('returns 409 when capacity is full, and writes nothing', async () => {
      const alumni = await makeAlumni({ mentee_capacity: 1 });
      await connect(await makePerson('student'), alumni);
      const requestId = await makeRequest(await makePerson('student'), alumni);

      const res = await respond(alumni, requestId, 'accepted');

      expect(res.status).toBe(409);
      expect(res.json.code).toBe('CAPACITY_FULL');
      const [request] = await rows('SELECT status FROM mentoring_requests WHERE id = ?', requestId);
      expect(request.status).toBe('pending');
      expect(await rows('SELECT id FROM connections WHERE request_id = ?', requestId)).toEqual([]);
    });

    it('returns 409 when capacity is zero', async () => {
      const alumni = await makeAlumni({ mentee_capacity: 0 });
      const requestId = await makeRequest(await makePerson('student'), alumni);
      const res = await respond(alumni, requestId, 'accepted');
      expect(res.status).toBe(409);
      expect(res.json.code).toBe('CAPACITY_FULL');
    });

    it('frees a capacity slot when a connection ends', async () => {
      const alumni = await makeAlumni({ mentee_capacity: 1 });
      const student = await makePerson('student');
      const connectionId = await connect(student, alumni);
      const waiting = await makeRequest(await makePerson('student'), alumni);
      expect((await respond(alumni, waiting, 'accepted')).status).toBe(409);
      await call('DELETE', `/connections/${connectionId}`, { as: student });
      expect((await respond(alumni, waiting, 'accepted')).status).toBe(200);
    });

    it('returns 409 when the alumni has been deactivated', async () => {
      const alumni = await makeAlumni();
      const requestId = await makeRequest(await makePerson('student'), alumni);
      const admin = await makePerson('admin');
      await call('PATCH', `/admin/alumni/${alumni.profileId}/deactivate`, { as: admin });
      const res = await respond(alumni, requestId, 'accepted');
      expect(res.status).toBe(409);
      expect(res.json.code).toBe('ALUMNI_INACTIVE');
    });

    it('rolls everything back if a later step fails', async () => {
      const student = await makePerson('student');
      const alumni = await makeAlumni({
        contact_email: 'a@example.com',
        consent_contact_email: true,
      });
      const requestId = await makeRequest(student, alumni);
      const silenceExpectedLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      await env.DB.prepare(
        "CREATE TRIGGER test_fail_outbox BEFORE INSERT ON webhook_outbox BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
      ).run();

      let failed;
      try {
        failed = await respond(alumni, requestId, 'accepted');
      } finally {
        await env.DB.prepare('DROP TRIGGER test_fail_outbox').run();
        silenceExpectedLog.mockRestore();
      }

      expect(failed.status).toBe(500);
      expect(failed.json.code).toBe('INTERNAL_ERROR');
      const [request] = await rows(
        'SELECT status, responded_at FROM mentoring_requests WHERE id = ?',
        requestId,
      );
      expect(request).toEqual({ status: 'pending', responded_at: null });
      expect(await rows('SELECT id FROM connections WHERE request_id = ?', requestId)).toEqual([]);
      expect((await respond(alumni, requestId, 'accepted')).status).toBe(200);
    });
  });

  // PRD test 8: this is the race the data design chose row locks for.
  describe('racing requests', () => {
    it('creates one connection when two accepts race for the last slot', async () => {
      const alumni = await makeAlumni({ mentee_capacity: 1 });
      const first = await makeRequest(await makePerson('student'), alumni);
      const second = await makeRequest(await makePerson('student'), alumni);

      const results = await Promise.all([
        respond(alumni, first, 'accepted'),
        respond(alumni, second, 'accepted'),
      ]);

      expect(statuses(...results)).toEqual([200, 409]);
      expect(results.find((result) => result.status === 409)?.json.code).toBe('CAPACITY_FULL');
      const active = await rows(
        "SELECT id FROM connections WHERE alumni_id = ? AND status = 'active'",
        alumni.profileId,
      );
      expect(active).toHaveLength(1);
      const events = await rows(
        "SELECT event_id FROM webhook_outbox WHERE json_extract(payload, '$.alumni_id') = ?",
        alumni.profileId,
      );
      expect(events).toHaveLength(1);
    });

    it('never passes capacity under a larger burst', async () => {
      const alumni = await makeAlumni({ mentee_capacity: 3 });
      const requestIds: string[] = [];
      for (let i = 0; i < 10; i++) requestIds.push(await makeRequest(await makePerson('student'), alumni));

      const results = await Promise.all(requestIds.map((id) => respond(alumni, id, 'accepted')));

      expect(results.filter((result) => result.status === 200)).toHaveLength(3);
      expect(results.filter((result) => result.status === 409)).toHaveLength(7);
      const active = await rows(
        "SELECT id FROM connections WHERE alumni_id = ? AND status = 'active'",
        alumni.profileId,
      );
      expect(active).toHaveLength(3);
    });

    it('creates one connection when the same request is accepted twice at once', async () => {
      const alumni = await makeAlumni();
      const requestId = await makeRequest(await makePerson('student'), alumni);
      const results = await Promise.all([
        respond(alumni, requestId, 'accepted'),
        respond(alumni, requestId, 'accepted'),
      ]);
      expect(statuses(...results)).toEqual([200, 409]);
      expect(results.find((result) => result.status === 409)?.json.code).toBe('INVALID_STATE');
      expect(await rows('SELECT id FROM connections WHERE request_id = ?', requestId)).toHaveLength(1);
    });

    it('lets exactly one side win when accept races cancel', async () => {
      const student = await makePerson('student');
      const alumni = await makeAlumni();
      const requestId = await makeRequest(student, alumni);
      const [accepted, cancelled] = await Promise.all([
        respond(alumni, requestId, 'accepted'),
        respond(student, requestId, 'cancelled'),
      ]);
      expect(statuses(accepted, cancelled)).toEqual([200, 409]);
      const connections = await rows('SELECT id FROM connections WHERE request_id = ?', requestId);
      const [request] = await rows('SELECT status FROM mentoring_requests WHERE id = ?', requestId);
      if (accepted.status === 200) {
        expect(request.status).toBe('accepted');
        expect(connections).toHaveLength(1);
      } else {
        expect(request.status).toBe('cancelled');
        expect(connections).toEqual([]);
      }
    });
  });

  describe('reject and cancel', () => {
    it('lets the recipient reject', async () => {
      const alumni = await makeAlumni();
      const requestId = await makeRequest(await makePerson('student'), alumni);
      const res = await respond(alumni, requestId, 'rejected');
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ status: 'rejected', connection: null });
      expect(Date.parse(res.json.responded_at)).not.toBeNaN();
      expect(await rows('SELECT id FROM connections WHERE request_id = ?', requestId)).toEqual([]);
    });

    it('lets the sender cancel', async () => {
      const student = await makePerson('student');
      const requestId = await makeRequest(student, await makeAlumni());
      const res = await respond(student, requestId, 'cancelled');
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ status: 'cancelled', connection: null });
    });
  });

  // PRD test 9.
  describe('state machine', () => {
    it.each([
      ['accepted', 'accepted'],
      ['accepted', 'rejected'],
      ['accepted', 'cancelled'],
      ['rejected', 'accepted'],
      ['rejected', 'rejected'],
      ['rejected', 'cancelled'],
      ['cancelled', 'accepted'],
      ['cancelled', 'rejected'],
      ['cancelled', 'cancelled'],
    ])('rejects %s to %s', async (from, to) => {
      const student = await makePerson('student');
      const alumni = await makeAlumni();
      const requestId = await makeRequest(student, alumni);
      const closer = from === 'cancelled' ? student : alumni;
      expect((await respond(closer, requestId, from)).status).toBe(200);

      const actor = to === 'cancelled' ? student : alumni;
      const res = await respond(actor, requestId, to);

      expect(res.status).toBe(409);
      expect(res.json).toEqual({
        error: `This request is already ${from}, so it can't change`,
        code: 'INVALID_STATE',
      });
      expect(res.text).not.toMatch(/stack|at \S+\(/i);
    });

    it.each(['pending', 'ended', 'ACCEPTED', 7, null])('rejects the status %j', async (status) => {
      const alumni = await makeAlumni();
      const requestId = await makeRequest(await makePerson('student'), alumni);
      const res = await respond(alumni, requestId, status as string);
      expect(res.status).toBe(400);
      expect(res.json.fields).toHaveProperty('status');
    });

    it('rejects extra fields', async () => {
      const alumni = await makeAlumni();
      const requestId = await makeRequest(await makePerson('student'), alumni);
      const res = await call('PATCH', `/mentoring-requests/${requestId}`, {
        as: alumni,
        body: { status: 'accepted', responded_at: '2020-01-01T00:00:00Z' },
      });
      expect(res.status).toBe(400);
    });
  });

  // PRD test 7, ownership half.
  describe('ownership', () => {
    it('stops a student accepting their own request', async () => {
      const student = await makePerson('student');
      const requestId = await makeRequest(student, await makeAlumni());
      const res = await respond(student, requestId, 'accepted');
      expect(res.status).toBe(403);
      expect(res.json.code).toBe('NOT_OWNER');
      const [request] = await rows('SELECT status FROM mentoring_requests WHERE id = ?', requestId);
      expect(request.status).toBe('pending');
    });

    it('stops a student rejecting their own request', async () => {
      const student = await makePerson('student');
      const requestId = await makeRequest(student, await makeAlumni());
      expect((await respond(student, requestId, 'rejected')).status).toBe(403);
    });

    it('stops a different alumni accepting or rejecting', async () => {
      const requestId = await makeRequest(await makePerson('student'), await makeAlumni());
      const other = await makeAlumni();
      expect((await respond(other, requestId, 'accepted')).status).toBe(403);
      expect((await respond(other, requestId, 'rejected')).status).toBe(403);
    });

    it('stops an alumni with no profile accepting', async () => {
      const requestId = await makeRequest(await makePerson('student'), await makeAlumni());
      expect((await respond(await makePerson('alumni'), requestId, 'accepted')).status).toBe(403);
    });

    it('stops a different student cancelling', async () => {
      const requestId = await makeRequest(await makePerson('student'), await makeAlumni());
      const res = await respond(await makePerson('student'), requestId, 'cancelled');
      expect(res.status).toBe(403);
      expect(res.json.code).toBe('NOT_OWNER');
    });

    it('stops the recipient alumni cancelling', async () => {
      const alumni = await makeAlumni();
      const requestId = await makeRequest(await makePerson('student'), alumni);
      expect((await respond(alumni, requestId, 'cancelled')).status).toBe(403);
    });

    it('returns 404 for an unknown request', async () => {
      const res = await respond(await makeAlumni(), 'no-such-id', 'accepted');
      expect(res.status).toBe(404);
      expect(res.json).toEqual({ error: 'Request not found', code: 'NOT_FOUND' });
      expect(res.text).not.toMatch(/stack|at \S+\(/i);
    });
  });
});

describe('contact reveal log (BR-10)', () => {
  it('cannot be edited or deleted', async () => {
    const alumni = await makeAlumni({ contact_email: 'a@example.com', consent_contact_email: true });
    const connectionId = await connect(await makePerson('student'), alumni);
    const update = env.DB.prepare(
      "UPDATE contact_reveal_log SET viewer_id = 'someone-else' WHERE connection_id = ?",
    ).bind(connectionId);
    const remove = env.DB.prepare('DELETE FROM contact_reveal_log WHERE connection_id = ?').bind(
      connectionId,
    );
    await expect(update.run()).rejects.toThrow(/APPEND_ONLY/);
    await expect(remove.run()).rejects.toThrow(/APPEND_ONLY/);
    expect(
      await rows('SELECT id FROM contact_reveal_log WHERE connection_id = ?', connectionId),
    ).toHaveLength(1);
  });
});
