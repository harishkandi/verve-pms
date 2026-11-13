// Real employee list import. The list itself is company data and lives only in pms/private/ (git-ignored,
// never committed: the staging repo is public). Columns: Name, Reporting Manager (required); Email, Designation,
// Team, Joined, Code (optional, used when present). Tab- or comma-separated, first row = headers.
//
//   node employees.js private/employees.tsv           check the file and show what would change (nothing is written)
//   node employees.js private/employees.tsv --apply   write it into the database (DATABASE_URL, i.e. staging)
//
// First import: the demo employees and all demo records (forms, scheduling, appraisals, emails, audit log,
// calendar links) are removed. Later imports update people by name, add new ones and mark people no longer on
// the list inactive; forms are kept. Admin records (ADMIN_EMAILS, test admin) are never touched.
const fs = require('fs');
const path = require('path');

const LIST_FILE = path.join(__dirname, 'private', 'employees.tsv');
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const key = s => clean(s).toLowerCase();

const COLS = { name: /^(employee )?name$/, manager: /^(reporting )?manager$/, email: /e-?mail/, designation: /designation|title/,
  team: /^(team|department)$/, joined: /join|doj/, code: /code|emp(loyee)? ?id/, director: /^director$/, window: /window|cycle/ };

function splitLine(line, sep) {
  if (sep === '\t') return line.split('\t');
  const out = []; let cur = '', q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
  return [...out, cur];
}

function parse(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const head = splitLine(lines[0], sep).map(key);
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, re]) => [k, head.findIndex(h => re.test(h))]));
  if (idx.name < 0 || idx.manager < 0) throw new Error('The first row must have the headers "Name" and "Reporting Manager".');
  return lines.slice(1).map(l => {
    const c = splitLine(l, sep), get = k => idx[k] < 0 ? '' : clean(c[idx[k]]);
    return { name: get('name'), manager: get('manager'), email: get('email').toLowerCase(), designation: get('designation'), team: get('team'), joined: get('joined'), code: get('code'), director: get('director'), window: get('window') };
  }).filter(r => r.name);
}

// checks the list and works out who is who; throws on problems that would break the hierarchy
function plan(rows) {
  const problems = [], notes = [];
  const byName = new Map();
  rows.forEach(r => { if (byName.has(key(r.name))) problems.push(`"${r.name}" appears twice.`); byName.set(key(r.name), r); });
  // managers who are not on the list themselves: added as top-level people (not reviewed, no manager)
  const tops = [...new Set(rows.map(r => r.manager).filter(m => m && !byName.has(key(m))))];
  tops.forEach(m => notes.push(`"${m}" is a reporting manager but not on the list: added as a top-level person (director, not reviewed). Reports: ${rows.filter(r => r.manager === m).map(r => r.name).join(', ')}.`));
  const all = [...rows, ...tops.map(name => ({ name, manager: '', email: '', designation: rows.some(r => key(r.director) === key(name)) ? 'Director' : '', team: '', joined: '', code: '', top: true }))];
  const mgrOf = r => r.manager ? key(r.manager) : null;
  for (const r of rows) { // loops (A reports to B reports to A)
    const seen = [key(r.name)]; let m = mgrOf(r);
    while (m && byName.has(m)) { if (seen.includes(m)) { problems.push(`Reporting loop: ${seen.concat(m).join(' -> ')}.`); break; } seen.push(m); m = mgrOf(byName.get(m)); }
  }
  rows.filter(r => !r.manager).forEach(r => notes.push(`"${r.name}" has no reporting manager: top-level person (not reviewed).`));
  // the Director column is only a cross-check: the app works the director out from the reporting chain
  const topOf = r => { let m = r.manager, n = 0; while (m && byName.has(key(m)) && n++ < 50) m = byName.get(key(m)).manager; return m; };
  rows.filter(r => r.director && r.manager && key(topOf(r)) !== key(r.director))
    .forEach(r => notes.push(`WARNING "${r.name}": Director column says "${r.director}" but the reporting chain leads to "${topOf(r)}".`));
  const emails = all.map(r => r.email).filter(Boolean);
  emails.filter((e, i) => emails.indexOf(e) !== i).forEach(e => problems.push(`Email ${e} is used by more than one person.`));
  const hasReports = new Set(rows.map(mgrOf).filter(Boolean));
  const people = all.map(r => ({ ...r, role: !r.manager ? 'director' : /team ?lead/i.test(r.designation) ? 'teamlead' : hasReports.has(key(r.name)) ? 'manager' : 'employee' }));
  return { people, problems, notes, missing: ['email', 'designation', 'team', 'joined', 'code'].filter(k => !rows.some(r => r[k])) };
}

// apply the list to the state containers in place (they are shared with the rest of the app)
function importList(S, text, { who = 'System', today } = {}) {
  const p = plan(parse(text));
  if (p.problems.length) { const e = new Error('The employee list has problems:\n- ' + p.problems.join('\n- ')); e.plan = p; throw e; }
  const { employees, config } = S;
  const first = !employees.some(e => e.src === 'list');
  const fyStart = `${config.fyStartMonth}-01`;
  // system accounts survive the first import: the test admin (A900) and ADMIN_EMAILS admins (they have an email);
  // demo admins (no email) go with the rest of the demo data
  const kept = employees.filter(e => e.role === 'admin' && (e.code === 'A900' || !!e.email));
  if (first) {
    employees.splice(0, employees.length, ...kept);
    for (const k of ['forms', 'annualForms', 'appraisals']) for (const x of Object.keys(S[k])) delete S[k][x];
    for (const x of Object.keys(S.calendarLinks)) if (!kept.some(e => String(e.id) === x)) delete S.calendarLinks[x]; // admins keep their calendar
    S.emailsOutbox.splice(0); S.auditLog.splice(0);
  }
  // people added by hand on the Employees page are matched too, so a later list does not duplicate them
  const byName = new Map(employees.filter(e => e.role !== 'admin').map(e => [key(e.name), e]));
  let nextId = Math.max(0, ...employees.map(e => e.id)) + 1;
  const added = [], updated = [], teamOverwritten = [];
  for (const r of p.people) {
    let e = byName.get(key(r.name));
    if (!e) { e = { id: nextId++, src: 'list', level: null, active: true }; employees.push(e); byName.set(key(r.name), e); added.push(r.name); }
    else updated.push(r.name);
    // a team renamed in the app keeps its new name: the sheet's old name is looked up in config.teamRenames
    const team = (r.team && (config.teamRenames || {})[r.team]) || r.team, teamBefore = e.team;
    Object.assign(e, { src: 'list' }, {
      name: r.name, role: r.role, active: true,
      code: r.code || e.code || 'V' + String(e.id).padStart(3, '0'),
      email: r.email || e.email || '', designation: r.designation || e.designation || '',
      team: team || e.team || (r.top ? 'Directors' : 'Unassigned'), joined: normDate(r.joined) || e.joined || fyStart,
      // real values (from the list or set by the admin) vs the placeholders above; the profile hides placeholders
      codeSet: !!r.code || !!e.codeSet, joinedSet: !!normDate(r.joined) || !!e.joinedSet,
    });
    delete e.inactiveFrom; delete e.reason;
    if (e.teamSetInApp && teamBefore !== e.team) teamOverwritten.push(`${e.name}: was in ${teamBefore} (changed in the app), the list says ${e.team}`);
    delete e.teamSetInApp;
  }
  // the list is the master copy: a reporting change made in the app (or planned for next month) is replaced by the list's
  // manager, and the import says so, so HR can put the change into the sheet if it should stay
  const overwritten = [...teamOverwritten];
  for (const r of p.people) {
    const e = byName.get(key(r.name)), id = r.manager ? byName.get(key(r.manager)).id : null;
    const was = e.managerId, nameOf = x => (employees.find(y => y.id === x) || {}).name || 'no manager';
    if (e.managerSetInApp && was !== id) overwritten.push(`${e.name}: reported to ${nameOf(was)} (changed in the app), the list says ${r.manager || 'no manager'}`);
    if (e.pendingManager && e.pendingManager.id !== id) overwritten.push(`${e.name}: planned move to ${nameOf(e.pendingManager.id)} dropped, the list says ${r.manager || 'no manager'}`);
    e.managerId = id; delete e.managerSetInApp; delete e.pendingManager;
  }
  overwritten.forEach(x => S.audit(who, 'change made in the app replaced by the list', x));
  // review windows: drop teams nobody is in any more (the demo teams), give new departments the default window
  const teams = new Set(employees.filter(e => e.role !== 'admin').map(e => e.team));
  for (const t of Object.keys(config.windows)) if (!teams.has(t) && !(config.teamsAdded || []).includes(t)) delete config.windows[t]; // teams added in the app stay
  for (const t of teams) config.windows[t] ||= { start: 25, end: 2 };
  // a "Review window" like 10-15 on a manager's row is the window for that manager's whole team
  config.managerWindows ||= {};
  for (const r of p.people) {
    const m = /^(\d{1,2})\s*[-–to]+\s*(\d{1,2})$/i.exec(r.window || '');
    if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 31) config.managerWindows[byName.get(key(r.name)).id] = { start: +m[1], end: +m[2] };
  }
  const listed = new Set(p.people.map(r => key(r.name)));
  const gone = employees.filter(e => e.src === 'list' && e.active && !listed.has(key(e.name)));
  gone.forEach(e => Object.assign(e, { active: false, inactiveFrom: today || config.today, reason: 'Not on the employee list' }));
  S.audit(who, 'employee list imported', `${p.people.length} people (${added.length} added, ${first ? 0 : updated.length} updated, ${gone.length} made inactive)${first ? '; demo data removed' : ''}`);
  return { ...p, first, added, updated: first ? [] : updated, inactive: gone.map(e => e.name), overwritten };
}
// 2024-06-03, 03/06/2024 or 03-06-2024 (day first) -> 2024-06-03
function normDate(s) {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

module.exports = { LIST_FILE, parse, plan, importList };

// ---------- command line ----------
if (require.main === module) (async () => {
  const file = process.argv[2], apply = process.argv.includes('--apply');
  if (!file) { console.log('Usage: node employees.js <file> [--apply]'); process.exit(1); }
  const text = fs.readFileSync(file, 'utf8');
  const p = plan(parse(text));
  console.log(`${p.people.length} people: ${['director', 'manager', 'teamlead', 'employee'].map(r => `${p.people.filter(x => x.role === r).length} ${r}`).join(', ')}`);
  p.notes.forEach(n => console.log('note:', n));
  if (p.missing.length) console.log(`not in the file (placeholders used): ${p.missing.join(', ')}`);
  if (p.problems.length) { p.problems.forEach(x => console.log('PROBLEM:', x)); process.exit(1); }
  if (!apply) { console.log('\nCheck only. Nothing was written. Add --apply to write it into the database.'); return; }
  const db = require('./db'), D = require('./data');
  if (!process.env.DATABASE_URL) { console.log('DATABASE_URL is not set: nothing to write to.'); process.exit(1); }
  await db.init(); D.migrate();
  const r = importList(D, text, { who: 'Employee list import' });
  // admins see what the import did under the bell
  const N = require('./notify');
  N.admins().forEach(a => N.push(a.id, { type: 'admin', link: '#/employees/active', text: `Employee list imported: ${r.added.length} added, ${r.updated.length} updated, ${r.inactive.length} made inactive${r.overwritten.length ? `, ${r.overwritten.length} reporting or team change${r.overwritten.length === 1 ? '' : 's'} made in the app replaced by the list (see the audit log)` : ''}.` }));
  await db.save();
  console.log(`\nSaved to the database. ${r.first ? 'Demo data removed. ' : ''}${r.added.length} added, ${r.updated.length} updated, ${r.inactive.length} made inactive${r.inactive.length ? ': ' + r.inactive.join(', ') : ''}.`);
  if (r.overwritten.length) console.log(`\nReporting and team changes made in the app were replaced by the list (put them in the sheet if they should stay):\n- ${r.overwritten.join('\n- ')}`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
