// Calls our live integration with Team 17's internship API and prints what the evaluation asks for:
// the request, the status, the response, and Team 17's request ID. Run it in front of the evaluators.
//
//   npm run evidence:team17
//   BASE_URL=http://localhost:8787 npm run evidence:team17
import { BASE_URL, c, person, request } from './lib.mjs';

const student = person('student', 'demo-student-su-myat', 'Su Myat');
const path = '/partners/team17/internships?category=Engineering&limit=5';

console.log(c.bold('Team 19 Alumni Network → Team 17 Internship Management'));
console.log(`${c.bold('GET')} ${BASE_URL}${path}`);
console.log(c.dim(`  as student ${student.id}, at ${new Date().toISOString()}`));

const started = Date.now();
const res = await request('GET', path, { as: student });
const ms = Date.now() - started;

console.log(`\n${res.status < 300 ? c.green(res.status) : c.red(res.status)} in ${ms} ms`);
if (!res.json?.data) {
  console.log(res.text);
  process.exit(1);
}
for (const p of res.json.data) {
  console.log(`  ${c.dim('•')} ${p.title}, ${p.company} (${p.work_mode}) → mentor interests: ${p.mentor_interests.join(', ') || 'none'}`);
}
console.log(`\n${c.bold('source')} ${JSON.stringify(res.json.source)}`);
console.log(`${c.bold('pagination')} ${JSON.stringify(res.json.pagination)}`);
console.log(`\nTeam 17 request ID: ${c.bold(res.json.source.request_id)}`);
