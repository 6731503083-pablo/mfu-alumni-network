import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import { call, makePerson, type Person } from './helpers';

// A fake Team 17. These tests never reach the real service: every outbound fetch is mocked.
const PARTNER_ORIGIN = 'https://team17-internship.vercel.app';

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000002',
    title: 'Frontend Developer Intern',
    skills: ['React', 'Next.js', 'TypeScript'],
    status: 'open',
    company: 'Sample Web Lab',
    is_demo: true,
    category: 'Engineering',
    location: 'Remote',
    work_mode: 'remote',
    updated_at: '2026-11-07T11:56:20.628Z',
    description: 'Build accessible interfaces with a frontend mentor.',
    published_at: '2026-11-07T11:56:20.628Z',
    allowance_thb: 10000,
    duration_weeks: 12,
    application_deadline: '2027-02-05',
    details_url: `${PARTNER_ORIGIN}/opportunities/10000000-0000-4000-8000-000000000002`,
    internal_note: 'a field we do not pass on',
    ...overrides,
  };
}

function partnerBody(data: unknown[], pagination: Record<string, unknown> = {}) {
  return {
    success: true,
    data,
    pagination: { page: 1, limit: 10, total: data.length, total_pages: 1, has_next: false, ...pagination },
    meta: { api_version: '1.0', request_id: 'team17-req-123', timestamp: '2026-11-09T07:00:00.000Z', data_source: 'postgresql' },
  };
}

function partnerReplies(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'team17-header-req' },
    }),
  );
}

async function get(path: string, as: Person) {
  const res = await app.request(path, { headers: { Authorization: `Bearer ${as.token}` } }, env);
  return { status: res.status, json: (await res.json()) as any };
}

let student: Person;
beforeEach(async () => {
  student = await makePerson('student');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('GET /partners/team17/internships', () => {
  it("returns Team 17's open internships with only the fields we use", async () => {
    partnerReplies(partnerBody([listing()]));
    const res = await get('/partners/team17/internships', student);
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual([
      {
        id: '10000000-0000-4000-8000-000000000002',
        title: 'Frontend Developer Intern',
        company: 'Sample Web Lab',
        description: 'Build accessible interfaces with a frontend mentor.',
        location: 'Remote',
        category: 'Engineering',
        work_mode: 'remote',
        skills: ['React', 'Next.js', 'TypeScript'],
        allowance_thb: 10000,
        duration_weeks: 12,
        application_deadline: '2027-02-05',
        is_demo: true,
        details_url: `${PARTNER_ORIGIN}/opportunities/10000000-0000-4000-8000-000000000002`,
        mentor_interests: ['Software Development'],
      },
    ]);
    expect(res.json.pagination).toMatchObject({ page: 1, total: 1, has_next: false });
    expect(res.json.source).toMatchObject({ partner: 'Team 17 Internship Management', request_id: 'team17-req-123', skipped: 0 });
  });

  it.each([
    ['Engineering', ['Software Development']],
    ['Data', ['Data & AI']],
    ['Design', ['UX/UI Design']],
    ['Marketing', ['Marketing']],
    ['Logistics', []],
  ])('maps the %s category to our mentor interests', async (category, interests) => {
    partnerReplies(partnerBody([listing({ category })]));
    const res = await get('/partners/team17/internships', student);
    expect(res.json.data[0].mentor_interests).toEqual(interests);
  });

  it('forwards only the filters Team 17 accepts, with status=open', async () => {
    const fetchSpy = partnerReplies(partnerBody([]));
    await get('/partners/team17/internships?q=React&category=Engineering&work_mode=remote&page=2&limit=5', student);
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe(`${PARTNER_ORIGIN}/api/placements`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'open',
      page: '2',
      limit: '5',
      q: 'React',
      category: 'Engineering',
      work_mode: 'remote',
    });
  });

  it.each([
    ['an unknown work mode', 'work_mode=office'],
    ['a search over 100 characters', `q=${'a'.repeat(101)}`],
    ['a limit over 50', 'limit=51'],
    ['an unknown parameter', 'sort=newest'],
  ])('rejects %s without calling Team 17', async (_label, query) => {
    const fetchSpy = partnerReplies(partnerBody([]));
    const res = await get(`/partners/team17/internships?${query}`, student);
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips a listing that breaks the contract, and counts it', async () => {
    partnerReplies(partnerBody([listing(), listing({ id: 'not-a-uuid', title: 42 })]));
    const res = await get('/partners/team17/internships', student);
    expect(res.status).toBe(200);
    expect(res.json.data).toHaveLength(1);
    expect(res.json.source.skipped).toBe(1);
  });

  it.each([
    ['another site', 'https://evil.example/opportunities/1'],
    ['a javascript: link', 'javascript:alert(1)'],
    ['plain http', 'http://team17-internship.vercel.app/opportunities/1'],
  ])('drops a details link to %s', async (_label, detailsUrl) => {
    partnerReplies(partnerBody([listing({ details_url: detailsUrl })]));
    const res = await get('/partners/team17/internships', student);
    expect(res.json.data[0].details_url).toBeNull();
  });

  it('answers 503 when Team 17 says it is unavailable', async () => {
    partnerReplies({ success: false, error: { code: 'PLACEMENTS_UNAVAILABLE', retryable: true } }, 503);
    const res = await get('/partners/team17/internships', student);
    expect(res.status).toBe(503);
    expect(res.json.code).toBe('PARTNER_UNAVAILABLE');
  });

  it('answers 503 when Team 17 cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network connection lost.'));
    const res = await get('/partners/team17/internships', student);
    expect(res.status).toBe(503);
    expect(res.json.code).toBe('PARTNER_UNAVAILABLE');
  });

  it('answers 504 when Team 17 is too slow', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    const res = await get('/partners/team17/internships', student);
    expect(res.status).toBe(504);
    expect(res.json.code).toBe('PARTNER_TIMEOUT');
  });

  it('answers 502 when Team 17 returns another error', async () => {
    partnerReplies({ success: false, error: { code: 'INVALID_QUERY' } }, 400);
    const res = await get('/partners/team17/internships', student);
    expect(res.status).toBe(502);
    expect(res.json.code).toBe('PARTNER_ERROR');
  });

  it.each([
    ['not JSON', '<html>Bad gateway</html>'],
    ['the wrong shape', { ok: true, items: [] }],
    ['success: false with 200', { success: false, data: [] }],
  ])('answers 502 when the response is %s', async (_label, body) => {
    partnerReplies(body);
    const res = await get('/partners/team17/internships', student);
    expect(res.status).toBe(502);
    expect(res.json.code).toBe('PARTNER_BAD_RESPONSE');
  });

  it('is for students and alumni', async () => {
    partnerReplies(partnerBody([]));
    expect((await get('/partners/team17/internships', await makePerson('alumni'))).status).toBe(200);
    expect((await get('/partners/team17/internships', await makePerson('admin'))).status).toBe(403);
  });

  it('needs a token', async () => {
    const res = await call('GET', '/partners/team17/internships');
    expect(res.status).toBe(401);
  });
});
