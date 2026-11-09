import { describe, expect, it } from 'vitest';

import { call, connect, makeAlumni, makePerson, rows, sendRequest } from './helpers';

describe('DELETE /connections/:id (API-07)', () => {
  it.each(['student', 'alumni'])('lets the %s end the connection', async (side) => {
    const student = await makePerson('student');
    const alumni = await makeAlumni();
    const connectionId = await connect(student, alumni);

    const res = await call('DELETE', `/connections/${connectionId}`, {
      as: side === 'student' ? student : alumni,
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: connectionId, status: 'ended' });
    expect(Date.parse(res.json.ended_at)).not.toBeNaN();
  });

  it('keeps the row and the reveal log (soft delete)', async () => {
    const student = await makePerson('student');
    const alumni = await makeAlumni({ contact_email: 'a@example.com', consent_contact_email: true });
    const connectionId = await connect(student, alumni);
    await call('DELETE', `/connections/${connectionId}`, { as: student });
    const [row] = await rows('SELECT status FROM connections WHERE id = ?', connectionId);
    expect(row.status).toBe('ended');
    expect(
      await rows('SELECT id FROM contact_reveal_log WHERE connection_id = ?', connectionId),
    ).toHaveLength(1);
  });

  it('returns 409 when the connection has already ended', async () => {
    const student = await makePerson('student');
    const connectionId = await connect(student, await makeAlumni());
    await call('DELETE', `/connections/${connectionId}`, { as: student });
    const res = await call('DELETE', `/connections/${connectionId}`, { as: student });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('INVALID_STATE');
  });

  it('returns 403 to anyone outside the connection', async () => {
    const connectionId = await connect(await makePerson('student'), await makeAlumni());
    for (const outsider of [await makePerson('student'), await makeAlumni(), await makePerson('alumni')]) {
      const res = await call('DELETE', `/connections/${connectionId}`, { as: outsider });
      expect(res.status).toBe(403);
      expect(res.json.code).toBe('NOT_OWNER');
    }
    const [row] = await rows('SELECT status FROM connections WHERE id = ?', connectionId);
    expect(row.status).toBe('active');
  });

  it('returns 404 for an unknown connection', async () => {
    const res = await call('DELETE', '/connections/no-such-id', { as: await makePerson('student') });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /admin/alumni/:id/deactivate (API-08)', () => {
  it('deactivates a profile without returning private data', async () => {
    const alumni = await makeAlumni({ contact_email: 'a@example.com', consent_contact_email: true });
    const res = await call('PATCH', `/admin/alumni/${alumni.profileId}/deactivate`, {
      as: await makePerson('admin'),
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ id: alumni.profileId, is_active: false });
    expect(res.text).not.toContain('a@example.com');
  });

  it('hides the profile from search, profile views and new requests', async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const alumni = await makeAlumni({ job_title: tag });
    const student = await makePerson('student');
    await call('PATCH', `/admin/alumni/${alumni.profileId}/deactivate`, {
      as: await makePerson('admin'),
    });

    const search = await call('GET', `/alumni?role=${tag}`, { as: student });
    expect(search.json.data).toEqual([]);
    expect((await call('GET', `/alumni/${alumni.profileId}`, { as: student })).status).toBe(404);
    expect((await sendRequest(student, alumni)).status).toBe(404);
  });

  it('can be repeated safely', async () => {
    const alumni = await makeAlumni();
    const admin = await makePerson('admin');
    await call('PATCH', `/admin/alumni/${alumni.profileId}/deactivate`, { as: admin });
    const res = await call('PATCH', `/admin/alumni/${alumni.profileId}/deactivate`, { as: admin });
    expect(res.status).toBe(200);
  });

  it('returns 404 for an unknown profile', async () => {
    const res = await call('PATCH', '/admin/alumni/no-such-id/deactivate', {
      as: await makePerson('admin'),
    });
    expect(res.status).toBe(404);
  });
});
