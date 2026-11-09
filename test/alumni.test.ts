import { describe, expect, it } from 'vitest';

import { call, connect, makeAlumni, makePerson, respond, rows, shortId } from './helpers';

const CURRENT_YEAR = new Date().getUTCFullYear();

async function searchIds(query: string, as: Awaited<ReturnType<typeof makePerson>>) {
  const res = await call('GET', `/alumni?${query}`, { as });
  expect(res.status).toBe(200);
  return (res.json.data as { id: string }[]).map((alumni) => alumni.id);
}

describe('PATCH /alumni/me (API-03)', () => {
  it('creates the profile on the first call', async () => {
    const user = await makePerson('alumni');
    const res = await call('PATCH', '/alumni/me', {
      as: user,
      body: { display_name: 'Aung Kyaw', grad_year: 2021, faculty_id: 7 },
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      display_name: 'Aung Kyaw',
      grad_year: 2021,
      faculty_id: 7,
      faculty: 'School of Applied Digital Technology',
      is_open_to_mentoring: false,
      mentee_capacity: 3,
      is_active: true,
      interests: [],
    });
    expect(res.json.id).toEqual(expect.any(String));
  });

  it('requires name, graduation year and faculty when creating', async () => {
    const user = await makePerson('alumni');
    const res = await call('PATCH', '/alumni/me', { as: user, body: { city: 'Yangon' } });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.json.fields).sort()).toEqual(['display_name', 'faculty_id', 'grad_year']);
  });

  it('updates only the fields sent', async () => {
    const alumni = await makeAlumni({ city: 'Yangon', company: 'Grab' });
    const res = await call('PATCH', '/alumni/me', { as: alumni, body: { city: 'Mandalay' } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: alumni.profileId, city: 'Mandalay', company: 'Grab' });
  });

  it('lets a nullable field be cleared', async () => {
    const alumni = await makeAlumni({ company: 'Grab' });
    const res = await call('PATCH', '/alumni/me', { as: alumni, body: { company: null } });
    expect(res.status).toBe(200);
    expect(res.json.company).toBeNull();
  });

  it('rejects an update with no fields', async () => {
    const alumni = await makeAlumni();
    const res = await call('PATCH', '/alumni/me', { as: alumni, body: {} });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a body that is not valid JSON', async () => {
    const alumni = await makeAlumni();
    const res = await call('PATCH', '/alumni/me', { as: alumni, rawBody: '{oops' });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('VALIDATION_ERROR');
  });

  // PRD test 3.
  it('rejects fields outside the allow-list and changes nothing', async () => {
    const alumni = await makeAlumni({ city: 'Yangon' });
    const res = await call('PATCH', '/alumni/me', {
      as: alumni,
      body: {
        city: 'Mandalay',
        is_active: false,
        identity_user_id: 'someone-else',
        consent_timestamp: '2020-01-01T00:00:00Z',
      },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.json.fields).sort()).toEqual([
      'consent_timestamp',
      'identity_user_id',
      'is_active',
    ]);
    const [row] = await rows(
      'SELECT city, is_active, identity_user_id FROM alumni_profiles WHERE id = ?',
      alumni.profileId,
    );
    expect(row).toEqual({ city: 'Yangon', is_active: 1, identity_user_id: alumni.id });
  });

  it.each([
    ['display_name', ''],
    ['display_name', 'x'.repeat(101)],
    ['grad_year', 1997],
    ['grad_year', CURRENT_YEAR + 2],
    ['grad_year', 2020.5],
    ['faculty_id', 999],
    ['job_title', 'x'.repeat(101)],
    ['company', 'x'.repeat(101)],
    ['city', 'x'.repeat(101)],
    ['bio', 'x'.repeat(1001)],
    ['country_code', 'mm'],
    ['country_code', 'MMR'],
    ['mentee_capacity', 11],
    ['mentee_capacity', -1],
    ['is_open_to_mentoring', 'yes'],
    ['contact_email', 'not-an-email'],
    ['contact_line', 'has spaces'],
    ['contact_linkedin', 'javascript:alert(1)'],
    ['contact_linkedin', 'https://evil.example/in/aung'],
    ['interests', ['Not A Real Interest']],
    ['interests', 'Finance'],
  ])('rejects %s = %j', async (field, value) => {
    const alumni = await makeAlumni();
    const res = await call('PATCH', '/alumni/me', { as: alumni, body: { [field]: value } });
    expect(res.status).toBe(400);
    expect(res.json.fields).toHaveProperty(field);
  });

  it('accepts the earliest and latest allowed graduation years', async () => {
    const alumni = await makeAlumni();
    for (const year of [1998, CURRENT_YEAR + 1]) {
      const res = await call('PATCH', '/alumni/me', { as: alumni, body: { grad_year: year } });
      expect(res.status).toBe(200);
    }
  });

  it('replaces the whole interest list', async () => {
    const alumni = await makeAlumni({ interests: ['Finance', 'Marketing'] });
    expect(alumni.profile.interests).toEqual(['Finance', 'Marketing']);
    const res = await call('PATCH', '/alumni/me', {
      as: alumni,
      body: { interests: ['Data & AI'] },
    });
    expect(res.json.interests).toEqual(['Data & AI']);
  });

  it('records when consent was given and to which purpose version (BR-02)', async () => {
    const alumni = await makeAlumni({ contact_email: 'a@example.com' });
    expect(alumni.profile.consent_timestamp).toBeNull();
    const res = await call('PATCH', '/alumni/me', {
      as: alumni,
      body: { consent_contact_email: true },
    });
    expect(res.status).toBe(200);
    expect(res.json.consent_contact_email).toBe(true);
    expect(res.json.consent_purpose_version).toBe('v1');
    expect(Date.parse(res.json.consent_timestamp)).not.toBeNaN();
  });

  it('refuses consent for a contact field that is empty', async () => {
    const alumni = await makeAlumni();
    const res = await call('PATCH', '/alumni/me', {
      as: alumni,
      body: { consent_contact_line: true },
    });
    expect(res.status).toBe(400);
    expect(res.json.fields).toHaveProperty('consent_contact_line');
  });

  it('refuses to clear a contact field while consent is on', async () => {
    const alumni = await makeAlumni({
      contact_email: 'a@example.com',
      consent_contact_email: true,
    });
    const res = await call('PATCH', '/alumni/me', { as: alumni, body: { contact_email: null } });
    expect(res.status).toBe(400);
    expect(res.json.fields).toHaveProperty('contact_email');
  });

  it('lets consent and the contact field be cleared together', async () => {
    const alumni = await makeAlumni({
      contact_email: 'a@example.com',
      consent_contact_email: true,
    });
    const res = await call('PATCH', '/alumni/me', {
      as: alumni,
      body: { contact_email: null, consent_contact_email: false },
    });
    expect(res.status).toBe(200);
    expect(res.json.contact_email).toBeNull();
  });

  it('never gives one alumni access to another alumni profile', async () => {
    const first = await makeAlumni({ city: 'Yangon' });
    const second = await makeAlumni({ city: 'Bangkok' });
    expect(second.profileId).not.toBe(first.profileId);
    const [row] = await rows('SELECT city FROM alumni_profiles WHERE id = ?', first.profileId);
    expect(row.city).toBe('Yangon');
  });
});

describe('GET /alumni (API-01)', () => {
  // PRD test 1.
  it('applies each filter, alone and combined', async () => {
    const tag = shortId();
    const student = await makePerson('student');
    const match = await makeAlumni({
      job_title: `Engineer ${tag}`,
      faculty_id: 7,
      grad_year: 2020,
      country_code: 'MM',
      interests: ['Data & AI'],
    });
    const other = await makeAlumni({
      job_title: `Accountant ${tag}`,
      faculty_id: 3,
      grad_year: 2015,
      country_code: 'TH',
      interests: ['Finance'],
    });

    expect((await searchIds(`role=${tag}`, student)).sort()).toEqual(
      [match.profileId, other.profileId].sort(),
    );
    expect(await searchIds(`role=${tag}&faculty_id=7`, student)).toEqual([match.profileId]);
    expect(await searchIds(`role=Engineer%20${tag}`, student)).toEqual([match.profileId]);
    expect(await searchIds(`role=${tag}&grad_year=2015`, student)).toEqual([other.profileId]);
    expect(await searchIds(`role=${tag}&country=TH`, student)).toEqual([other.profileId]);
    expect(
      await searchIds(`role=${tag}&interests=${encodeURIComponent('Data & AI')}`, student),
    ).toEqual([match.profileId]);
    expect(
      await searchIds(
        `role=${tag}&faculty_id=7&grad_year=2020&country=MM&interests=${encodeURIComponent('Data & AI')}`,
        student,
      ),
    ).toEqual([match.profileId]);
    expect(await searchIds(`role=${tag}&faculty_id=7&country=TH`, student)).toEqual([]);
  });

  it('matches any of several interests', async () => {
    const tag = shortId();
    const student = await makePerson('student');
    const a = await makeAlumni({ job_title: tag, interests: ['Finance'] });
    const b = await makeAlumni({ job_title: tag, interests: ['Marketing'] });
    await makeAlumni({ job_title: tag, interests: ['Healthcare'] });
    const ids = await searchIds(`role=${tag}&interests=Finance,Marketing`, student);
    expect(ids.sort()).toEqual([a.profileId, b.profileId].sort());
  });

  it.each([
    ['Burmese', 'ဆော့ဖ်ဝဲအင်ဂျင်နီယာ'],
    ['Thai', 'วิศวกรซอฟต์แวร์'],
    ['Chinese', '软件工程师'],
  ])('finds a %s job title', async (_language, title) => {
    const student = await makePerson('student');
    const alumni = await makeAlumni({ job_title: `${title} ${shortId()}` });
    await makeAlumni({ job_title: `English title ${shortId()}` });
    const ids = await searchIds(`role=${encodeURIComponent(title)}`, student);
    expect(ids).toContain(alumni.profileId);
    expect(ids.length).toBeLessThan(50);
    const res = await call('GET', `/alumni/${alumni.profileId}`, { as: student });
    expect(res.json.job_title).toBe(alumni.profile.job_title);
  });

  // D1 caps LIKE patterns at 50 bytes, which a Burmese job title passes in under 20 characters.
  it.each([
    ['English', 'x'.repeat(100)],
    ['Burmese', 'ဆ'.repeat(100)],
  ])('finds a %s job title at the full 100-character length', async (_language, title) => {
    const student = await makePerson('student');
    const alumni = await makeAlumni({ job_title: title });
    const ids = await searchIds(`role=${encodeURIComponent(title)}&limit=50`, student);
    expect(ids).toContain(alumni.profileId);
  });

  it('matches English job titles whatever the case', async () => {
    const tag = shortId();
    const student = await makePerson('student');
    const alumni = await makeAlumni({ job_title: `Backend Engineer ${tag}` });
    expect(await searchIds(`role=backend%20ENGINEER%20${tag}`, student)).toEqual([alumni.profileId]);
  });

  it('treats % and _ in the role filter as plain text', async () => {
    const tag = shortId();
    const student = await makePerson('student');
    const literal = await makeAlumni({ job_title: `${tag} 100% remote` });
    const plain = await makeAlumni({ job_title: `${tag} on site` });
    expect(await searchIds(`role=${tag}%20100%25`, student)).toEqual([literal.profileId]);
    const anyChar = await searchIds(`role=${tag}%20on_site`, student);
    expect(anyChar).not.toContain(plain.profileId);
  });

  it('can limit results to alumni open to mentoring', async () => {
    const tag = shortId();
    const student = await makePerson('student');
    const open = await makeAlumni({ job_title: tag, is_open_to_mentoring: true });
    await makeAlumni({ job_title: tag, is_open_to_mentoring: false });
    expect(await searchIds(`role=${tag}&open_to_mentoring=true`, student)).toEqual([open.profileId]);
    expect(await searchIds(`role=${tag}`, student)).toHaveLength(2);
  });

  it('returns pages with a total', async () => {
    const tag = shortId();
    const student = await makePerson('student');
    for (let i = 0; i < 3; i++) await makeAlumni({ job_title: tag });
    const first = await call('GET', `/alumni?role=${tag}&limit=2`, { as: student });
    expect(first.json.data).toHaveLength(2);
    expect(first.json.pagination).toEqual({ limit: 2, offset: 0, total: 3 });
    const second = await call('GET', `/alumni?role=${tag}&limit=2&offset=2`, { as: student });
    expect(second.json.data).toHaveLength(1);
  });

  it('never returns contact or consent data, even when consent is given', async () => {
    const tag = shortId();
    const student = await makePerson('student');
    await makeAlumni({
      job_title: tag,
      contact_email: `secret-${tag}@example.com`,
      consent_contact_email: true,
    });
    const res = await call('GET', `/alumni?role=${tag}`, { as: student });
    expect(res.json.data).toHaveLength(1);
    expect(res.text).not.toContain(`secret-${tag}`);
    expect(res.text).not.toContain('contact');
    expect(res.text).not.toContain('consent');
    expect(res.text).not.toContain('identity_user_id');
  });

  it.each([
    ['grad_year=abc', 'grad_year'],
    ['faculty_id=abc', 'faculty_id'],
    ['limit=999', 'limit'],
    ['limit=0', 'limit'],
    ['offset=-1', 'offset'],
    ['country=myanmar', 'country'],
    ['open_to_mentoring=maybe', 'open_to_mentoring'],
    ['unknown_filter=1', 'unknown_filter'],
  ])('rejects the query %s', async (query, field) => {
    const res = await call('GET', `/alumni?${query}`, { as: await makePerson('student') });
    expect(res.status).toBe(400);
    expect(res.json.fields).toHaveProperty(field);
  });
});

describe('GET /alumni/:id (API-02)', () => {
  const CONTACT = {
    contact_email: 'aung@example.com',
    contact_line: 'aung.kyaw',
    contact_linkedin: 'https://www.linkedin.com/in/aung-kyaw',
    consent_contact_email: true,
    consent_contact_line: false,
    consent_contact_linkedin: false,
  };

  it('shows a stranger public fields only, even when consent is given', async () => {
    const alumni = await makeAlumni({ ...CONTACT, interests: ['Finance'] });
    const stranger = await makePerson('student');
    const res = await call('GET', `/alumni/${alumni.profileId}`, { as: stranger });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: alumni.profileId, interests: ['Finance'] });
    expect(res.text).not.toContain('aung@example.com');
    expect(res.json).not.toHaveProperty('contact');
    expect(res.text).not.toContain('consent');
  });

  it('hides contact from another alumni browsing the directory', async () => {
    const alumni = await makeAlumni(CONTACT);
    const res = await call('GET', `/alumni/${alumni.profileId}`, { as: await makeAlumni() });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('aung@example.com');
  });

  // PRD test 2 and AC-FR-02.
  it('shows a connected student only the fields consented to right now', async () => {
    const alumni = await makeAlumni(CONTACT);
    const student = await makePerson('student');
    await connect(student, alumni);

    const before = await call('GET', `/alumni/${alumni.profileId}`, { as: student });
    expect(before.json.contact).toEqual({ email: 'aung@example.com' });
    expect(before.text).not.toContain('aung.kyaw');
    expect(before.text).not.toContain('linkedin.com');

    await call('PATCH', '/alumni/me', { as: alumni, body: { consent_contact_email: false } });
    const after = await call('GET', `/alumni/${alumni.profileId}`, { as: student });
    expect(after.json.contact).toEqual({});
    expect(after.text).not.toContain('aung@example.com');
  });

  // BR-10: the accept logs what was consented then. A field consented later is logged when the
  // student first sees it, so the log still records every disclosure.
  it('logs a field consented after connecting, once, when the student first sees it', async () => {
    const alumni = await makeAlumni(CONTACT);
    const student = await makePerson('student');
    const connectionId = await connect(student, alumni);
    const logged = () =>
      rows(
        'SELECT field_name, viewer_id FROM contact_reveal_log WHERE connection_id = ? ORDER BY field_name',
        connectionId,
      );
    expect(await logged()).toEqual([{ field_name: 'contact_email', viewer_id: student.id }]);

    await call('PATCH', '/alumni/me', { as: alumni, body: { consent_contact_line: true } });
    expect(await logged()).toHaveLength(1);

    const first = await call('GET', `/alumni/${alumni.profileId}`, { as: student });
    expect(first.json.contact).toEqual({ email: 'aung@example.com', line: 'aung.kyaw' });
    await call('GET', `/alumni/${alumni.profileId}`, { as: student });
    expect(await logged()).toEqual([
      { field_name: 'contact_email', viewer_id: student.id },
      { field_name: 'contact_line', viewer_id: student.id },
    ]);
  });

  it('does not log anything when a stranger views a profile', async () => {
    const alumni = await makeAlumni(CONTACT);
    await call('GET', `/alumni/${alumni.profileId}`, { as: await makePerson('student') });
    const logged = await rows(
      `SELECT l.id FROM contact_reveal_log l JOIN connections c ON c.id = l.connection_id
       WHERE c.alumni_id = ?`,
      alumni.profileId,
    );
    expect(logged).toEqual([]);
  });

  it('stops showing contact once the connection has ended', async () => {
    const alumni = await makeAlumni(CONTACT);
    const student = await makePerson('student');
    const connectionId = await connect(student, alumni);
    await call('DELETE', `/connections/${connectionId}`, { as: student });
    const res = await call('GET', `/alumni/${alumni.profileId}`, { as: student });
    expect(res.text).not.toContain('aung@example.com');
    expect(res.json).not.toHaveProperty('contact');
  });

  it('does not reveal contact while a request is only pending or was rejected', async () => {
    const alumni = await makeAlumni(CONTACT);
    const student = await makePerson('student');
    const created = await call('POST', '/mentoring-requests', {
      as: student,
      body: { alumni_id: alumni.profileId, message: 'Please help me with my career.' },
    });
    const pending = await call('GET', `/alumni/${alumni.profileId}`, { as: student });
    expect(pending.text).not.toContain('aung@example.com');
    await respond(alumni, created.json.id, 'rejected');
    const rejected = await call('GET', `/alumni/${alumni.profileId}`, { as: student });
    expect(rejected.text).not.toContain('aung@example.com');
  });

  it('shows the owner everything', async () => {
    const alumni = await makeAlumni(CONTACT);
    const res = await call('GET', `/alumni/${alumni.profileId}`, { as: alumni });
    expect(res.json).toMatchObject({
      contact_email: 'aung@example.com',
      contact_line: 'aung.kyaw',
      consent_contact_email: true,
      consent_contact_line: false,
      mentee_capacity: 3,
    });
  });

  it('returns 404 for an unknown ID', async () => {
    const res = await call('GET', '/alumni/no-such-id', { as: await makePerson('student') });
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('NOT_FOUND');
  });

  // PRD test 10, API half: the docs console and any client must still render this as text.
  it('returns stored script tags as JSON data, never as HTML', async () => {
    const bio = '<script>alert("xss")</script>';
    const alumni = await makeAlumni({ bio });
    const res = await call('GET', `/alumni/${alumni.profileId}`, {
      as: await makePerson('student'),
    });
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.json.bio).toBe(bio);
  });
});
