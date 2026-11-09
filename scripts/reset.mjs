// Gets the web app's demo accounts ready for another run of the happy path. For students Su Myat and
// Ko Min it cancels pending requests and ends active connections, then it puts the seed alumni's
// details and consent back. It goes through the API like any user, so nothing is deleted: requests,
// ended connections and the reveal log stay as history.
//
//   npm run demo:reset                                   # live site
//   BASE_URL=http://localhost:8787 npm run demo:reset    # local `npm run dev`
import { BASE_URL, c, person, request } from './lib.mjs';
import { seed } from './seed.mjs';

const STUDENTS = { 'su-myat': 'Su Myat', 'ko-min': 'Ko Min' };

console.log(c.bold('Resetting the demo accounts'), c.dim(BASE_URL));

for (const [key, name] of Object.entries(STUDENTS)) {
  const student = person('student', `demo-student-${key}`, name);
  const list = await request('GET', '/mentoring-requests/me?limit=50', { as: student });
  if (list.status !== 200) {
    console.log(c.red(`  ${name}: couldn't list requests (${list.status})`));
    process.exitCode = 1;
    continue;
  }

  let changed = 0;
  for (const r of list.json.data) {
    let res;
    let action;
    if (r.status === 'pending') {
      action = `cancelled the request to ${r.alumni_name}`;
      res = await request('PATCH', `/mentoring-requests/${r.id}`, { as: student, body: { status: 'cancelled' } });
    } else if (r.connection?.status === 'active') {
      action = `ended the connection with ${r.alumni_name}`;
      res = await request('DELETE', `/connections/${r.connection.id}`, { as: student });
    } else {
      continue;
    }
    changed++;
    const ok = res.status === 200;
    if (!ok) process.exitCode = 1;
    console.log(`  ${ok ? c.green('✓') : c.red('✗')} ${name}: ${action}${ok ? '' : ` (${res.status})`}`);
  }
  if (!changed) console.log(`  ${c.dim('·')} ${name}: nothing to reset`);
}

const seeded = await seed({ quiet: true });
console.log(`  ${c.green('✓')} ${Object.keys(seeded).length} seed alumni: details and consent put back`);
