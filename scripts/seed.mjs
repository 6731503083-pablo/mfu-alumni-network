// Creates or updates fictional alumni profiles, so search shows results across countries. Every
// name ends in "(demo)" and every email uses example.com. Each profile has a fixed identity ID, so
// running this again updates the same profiles instead of adding copies.
//
//   npm run demo:seed                                   # live site
//   BASE_URL=http://localhost:8787 npm run demo:seed    # local `npm run dev`
import { pathToFileURL } from 'node:url';

import { BASE_URL, c, person, request } from './lib.mjs';

// Faculty IDs follow the seed order in migrations/0002_alumni_network.sql.
const FACULTY = { management: 3, law: 4, agroIndustry: 6, it: 7, nursing: 10 };

export const SEED_ALUMNI = {
  'kyaw-zin-htet': {
    display_name: 'Kyaw Zin Htet (demo)',
    grad_year: 2019,
    faculty_id: FACULTY.it,
    job_title: 'ဆော့ဖ်ဝဲ အင်ဂျင်နီယာ', // Software engineer
    company: 'Golden Pagoda Apps (demo)',
    country_code: 'MM',
    city: 'Yangon',
    bio: 'Backend developer. Happy to talk about first jobs in Myanmar tech.',
    is_open_to_mentoring: true,
    mentee_capacity: 3,
    contact_email: 'kyawzin.demo@example.com',
    consent_contact_email: true,
    interests: ['Software Development', 'Working Abroad'],
  },
  'nattaya-srisuk': {
    display_name: 'Nattaya Srisuk (demo)',
    grad_year: 2018,
    faculty_id: FACULTY.nursing,
    job_title: 'พยาบาลวิชาชีพ', // Registered nurse
    company: 'Northern Care Hospital (demo)',
    country_code: 'TH',
    city: 'Chiang Rai',
    bio: 'ICU nurse. Ask me about licensing exams and hospital internships.',
    is_open_to_mentoring: true,
    mentee_capacity: 2,
    contact_email: 'nattaya.demo@example.com',
    contact_line: 'nattaya_demo',
    consent_contact_email: true,
    consent_contact_line: true,
    interests: ['Healthcare', 'Nursing Practice'],
  },
  'li-wei': {
    display_name: 'Li Wei (demo)',
    grad_year: 2020,
    faculty_id: FACULTY.management,
    job_title: 'Marketing Manager',
    company: 'Kunming Trade Co. (demo)',
    country_code: 'CN',
    city: 'Kunming',
    bio: 'Cross-border marketing between Thailand and Yunnan.',
    is_open_to_mentoring: true,
    mentee_capacity: 3,
    contact_email: 'liwei.demo@example.com',
    consent_contact_email: true,
    interests: ['Marketing', 'Entrepreneurship'],
  },
  'may-thu-kyaw': {
    display_name: 'May Thu Kyaw (demo)',
    grad_year: 2022,
    faculty_id: FACULTY.it,
    job_title: 'Data Analyst',
    company: 'Siam Insights (demo)',
    country_code: 'TH',
    city: 'Bangkok',
    bio: 'Moved from Myanmar to Bangkok after MFU. Data, SQL and visas.',
    is_open_to_mentoring: true,
    mentee_capacity: 2,
    contact_email: 'maythu.demo@example.com',
    contact_linkedin: 'https://www.linkedin.com/in/maythu-demo',
    consent_contact_email: true,
    consent_contact_linkedin: true,
    interests: ['Data & AI', 'Working Abroad', 'Studying Abroad'],
  },
  'somchai-rattanakul': {
    display_name: 'Somchai Rattanakul (demo)',
    grad_year: 2016,
    faculty_id: FACULTY.law,
    job_title: 'ที่ปรึกษากฎหมาย', // Legal advisor
    company: 'Lanna Legal (demo)',
    country_code: 'TH',
    city: 'Bangkok',
    bio: 'PDPA compliance advisor. Not taking mentees this term.',
    is_open_to_mentoring: false,
    mentee_capacity: 0,
    interests: ['Law & Compliance'],
  },
  'aung-ko-ko': {
    display_name: 'Aung Ko Ko (demo)',
    grad_year: 2017,
    faculty_id: FACULTY.agroIndustry,
    job_title: 'Food Technologist',
    company: 'Lion City Foods (demo)',
    country_code: 'SG',
    city: 'Singapore',
    bio: 'Product development for packaged foods.',
    is_open_to_mentoring: true,
    mentee_capacity: 1,
    contact_email: 'aungkoko.demo@example.com',
    consent_contact_email: true,
    interests: ['Food Technology', 'Working Abroad'],
  },
};

export const seedPerson = (slug) => person('alumni', `demo-alumni-${slug}`, SEED_ALUMNI[slug].display_name);

/** Upserts every seed profile and returns their profile IDs by slug. */
export async function seed({ quiet = false } = {}) {
  const ids = {};
  for (const [slug, profile] of Object.entries(SEED_ALUMNI)) {
    const res = await request('PATCH', '/alumni/me', { as: seedPerson(slug), body: profile });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Seeding ${slug} failed: ${res.status} ${res.text}`);
    }
    ids[slug] = res.json.id;
    if (!quiet) {
      const verb = res.status === 201 ? c.green('created') : c.dim('updated');
      console.log(`  ${verb}  ${profile.display_name.padEnd(28)} ${profile.city}, ${profile.country_code}`);
    }
  }
  return ids;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(c.bold(`Seeding demo alumni on ${BASE_URL}`));
  await seed();
  console.log(c.green(`Done: ${Object.keys(SEED_ALUMNI).length} profiles.`));
}
