import { describe, expect, it } from 'vitest';

import { call, connect, makeAlumni, makePerson, rows } from './helpers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const available = async (interest: string) => {
  const res = await call('GET', `/api/mentors?interest=${encodeURIComponent(interest)}`);
  return res.json.data[0].mentors_available as number;
};

// The public endpoint other teams call, such as Team 17 from their internship pages.
describe('GET /api/mentors', () => {
  it('needs no token, and lists every interest with a count and a link', async () => {
    const res = await call('GET', '/api/mentors');
    expect(res.status).toBe(200);
    const interests = (await rows('SELECT name FROM interests ORDER BY id')).map((row) => row.name);
    expect(res.json.data.map((item: any) => item.interest)).toEqual(interests);
    for (const item of res.json.data) {
      expect(Object.keys(item).sort()).toEqual(['find_mentors_url', 'interest', 'mentors_available']);
      expect(item.find_mentors_url).toBe(`https://alumni.test/app#/mentors/${encodeURIComponent(item.interest)}`);
    }
  });

  it('counts only alumni who are active, open to mentoring and have room', async () => {
    const interest = 'Cosmetic Science';
    const start = await available(interest);

    await makeAlumni({ interests: [interest] });
    await makeAlumni({ interests: [interest], is_open_to_mentoring: false });
    await makeAlumni({ interests: [interest], mentee_capacity: 0 });
    const full = await makeAlumni({ interests: [interest], mentee_capacity: 1 });
    await connect(await makePerson('student'), full);
    const turnedOff = await makeAlumni({ interests: [interest] });
    await call('PATCH', `/admin/alumni/${turnedOff.profileId}/deactivate`, { as: await makePerson('admin') });

    expect(await available(interest)).toBe(start + 1);
  });

  it('never returns names, IDs or contact details', async () => {
    const alumni = await makeAlumni({
      display_name: 'Hidden Name',
      interests: ['Finance'],
      contact_email: 'hidden@example.com',
      consent_contact_email: true,
    });
    const res = await call('GET', '/api/mentors');
    for (const secret of ['Hidden Name', 'hidden@example.com', alumni.profileId, alumni.id]) {
      expect(res.text).not.toContain(secret);
    }
  });

  it.each([
    ['Engineering', ['Software Development']],
    ['Design', ['UX/UI Design']],
    ['data', ['Data & AI']],
    ['MARKETING', ['Marketing']],
  ])('takes Team 17 category %s and answers with our matching interests', async (category, interests) => {
    const res = await call('GET', `/api/mentors?category=${category}`);
    expect(res.status).toBe(200);
    expect(res.json.data.map((item: any) => item.interest)).toEqual(interests);
  });

  it('can be narrowed to one of our interests', async () => {
    const res = await call('GET', `/api/mentors?interest=${encodeURIComponent('UX/UI Design')}`);
    expect(res.status).toBe(200);
    expect(res.json.data).toHaveLength(1);
    expect(res.json.data[0].find_mentors_url).toBe('https://alumni.test/app#/mentors/UX%2FUI%20Design');
  });

  it.each([
    ['an unknown category', 'category=Cooking', 'category'],
    ['an unknown interest', 'interest=Cooking', 'interest'],
    ['both filters at once', 'category=Design&interest=Finance', 'interest'],
    ['an unknown parameter', 'name=Aung', 'name'],
  ])('rejects %s', async (_label, query, field) => {
    const res = await call('GET', `/api/mentors?${query}`);
    expect(res.status).toBe(400);
    expect(res.json.fields).toHaveProperty(field);
  });

  it('lets any website read it, including its errors', async () => {
    for (const path of ['/api/mentors', '/api/mentors?category=Cooking']) {
      const res = await call('GET', path, { headers: { Origin: 'https://team17-internship.vercel.app' } });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
  });

  it('gives every answer a request ID, for matching logs with the caller', async () => {
    const first = await call('GET', '/api/mentors');
    const second = await call('GET', '/api/mentors');
    expect(first.json.meta).toMatchObject({ api_version: '1.0', request_id: expect.stringMatching(UUID) });
    expect(first.headers.get('X-Request-Id')).toBe(first.json.meta.request_id);
    expect(second.json.meta.request_id).not.toBe(first.json.meta.request_id);
  });
});
