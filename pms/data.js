// Seed data and shared config for the PMS demo. State lives in these objects; db.js stores them in Postgres when configured.
// Demo employees have no email on purpose: no calendar invite can reach a real inbox by accident.

const config = {
  currentMonth: '2026-11',     // review month being run; its forms are open from the 1st of the month
  fyStartMonth: '2026-04',
  today: '2026-11-04',
  weights: { operational: 60, process: 20, people: 20 },
  operationalRange: [40, 80],
  peopleMin: 10,
  peopleMax: 20,
  // ratings are on a 0-5 scale
  clickupMin: 3,
  learningMin: 2,
  ratingGapFlag: 1,            // section 8.4 O3
  emailGapFlag: 0.75,          // section 11
  selfShare: 0.3,
  mgrShare: 0.7,
  lookbackMonths: 5,
  timeZone: 'Asia/Kolkata',    // calendar invites use this time zone
  windows: {
    Operations: { start: 25, end: 31 },
    Marketing: { start: 10, end: 15 },
    Finance: { start: 25, end: 30 },
    Sales: { start: 25, end: 31 },
  },
};

// role: admin | director | manager | teamlead | employee ; level is for the Reporting Manager menu
const employees = [
  { id: 1, code: 'E001', name: 'Priya Menon', designation: 'HR Admin', team: 'HR', managerId: null, role: 'admin', level: null, joined: '2020-01-06', active: true },
  { id: 2, code: 'E002', name: 'Anita Verma', designation: 'Director', team: 'Leadership', managerId: null, role: 'director', level: 'Directors', joined: '2018-04-01', active: true },
  { id: 3, code: 'E003', name: 'Anjali Kapoor', designation: 'Senior Manager', team: 'Sales', managerId: 2, role: 'manager', level: 'Senior Manager', joined: '2019-02-11', active: true },
  { id: 4, code: 'E004', name: 'Fiza Khan', designation: 'Manager', team: 'Sales', managerId: 3, role: 'manager', level: 'Manager', joined: '2021-06-01', active: true },
  { id: 5, code: 'E005', name: 'Debarima Das', designation: 'Executive', team: 'Sales', managerId: 4, role: 'employee', level: null, joined: '2023-03-15', active: true },
  { id: 6, code: 'E006', name: 'Rohan Shah', designation: 'Manager', team: 'Operations', managerId: 2, role: 'manager', level: 'Manager', joined: '2020-08-17', active: true },
  { id: 7, code: 'E101', name: 'Aarav Mehta', designation: 'Executive', team: 'Operations', managerId: 6, role: 'employee', level: null, joined: '2023-06-12', active: true },
  { id: 8, code: 'E102', name: 'Isha Kapoor', designation: 'Senior Executive', team: 'Operations', managerId: 6, role: 'employee', level: 'Senior Executives', joined: '2022-01-03', active: true },
  { id: 9, code: 'E103', name: 'Dev Patel', designation: 'Executive', team: 'Operations', managerId: 6, role: 'employee', level: null, joined: '2024-09-15', active: true },
  { id: 10, code: 'E104', name: 'Tanvi Shah', designation: 'Executive', team: 'Operations', managerId: 6, role: 'employee', level: null, joined: '2024-02-01', active: true },
  { id: 11, code: 'E105', name: 'Yash Jain', designation: 'Executive', team: 'Operations', managerId: 6, role: 'employee', level: null, joined: '2024-05-20', active: true },
  { id: 12, code: 'E152', name: 'Rahul Verma', designation: 'Executive', team: 'Operations', managerId: 6, role: 'employee', level: null, joined: '2026-10-03', active: true, newJoiner: true },
  { id: 13, code: 'E007', name: 'Sana Iyer', designation: 'Manager', team: 'Marketing', managerId: 2, role: 'manager', level: 'Manager', joined: '2020-11-02', active: true },
  { id: 14, code: 'E118', name: 'Neha Rao', designation: 'Executive', team: 'Marketing', managerId: 13, role: 'employee', level: null, joined: '2025-04-01', active: true },
  { id: 15, code: 'E121', name: 'Meera Joshi', designation: 'Team Lead', team: 'Marketing', managerId: 13, role: 'teamlead', level: null, joined: '2021-07-20', active: true },
  { id: 16, code: 'E122', name: 'Zoya Ali', designation: 'Executive', team: 'Marketing', managerId: 15, role: 'employee', level: null, joined: '2025-01-13', active: true },
  { id: 17, code: 'E008', name: 'Vikram Rao', designation: 'Manager', team: 'Finance', managerId: 2, role: 'manager', level: 'Manager', joined: '2019-10-07', active: true },
  { id: 18, code: 'E140', name: 'Kabir Nair', designation: 'Analyst', team: 'Finance', managerId: 17, role: 'employee', level: null, joined: '2026-02-08', active: true },
  { id: 19, code: 'E087', name: 'Rohit Sen', designation: 'Executive', team: 'Marketing', managerId: 13, role: 'employee', level: null, joined: '2022-03-01', active: false, inactiveFrom: '2026-09-30', reason: 'Resigned' },
  { id: 20, code: 'E093', name: 'Pooja Bhat', designation: 'Analyst', team: 'Finance', managerId: 17, role: 'employee', level: null, joined: '2023-01-09', active: false, inactiveFrom: '2026-08-15', reason: 'Resigned' },
  { id: 21, code: 'E064', name: 'Karan Shah', designation: 'Senior Executive', team: 'Operations', managerId: 6, role: 'employee', level: 'Senior Executives', joined: '2021-02-15', active: false, inactiveFrom: '2026-06-30', reason: 'Transferred out' },
];

const questions = [
  { id: 'q1', text: "What's the biggest challenge you've faced, and how did you handle it? Is there any current task or project where a different approach might help, and how are you dealing with it?", type: 'text', mandatory: true, from: '2026-04', to: null, order: 1 },
  { id: 'q2', text: "Are there any issues that you are facing on the client/team/manager end? If yes, specify.", type: 'text', mandatory: true, from: '2026-04', to: null, order: 2 },
  { id: 'q3', text: "What changes did you make this month to boost your performance?", type: 'text', mandatory: true, from: '2026-04', to: null, order: 3 },
  { id: 'q4', text: "In what ways have you stepped outside your operational responsibilities this month to contribute to the team's or organisation's broader goals?", type: 'text', mandatory: true, from: '2026-04', to: null, order: 4 },
  { id: 'q5', text: "What suggestion do you have this month for Team/Client/Organisation improvement?", type: 'text', mandatory: true, from: '2026-04', to: null, order: 5 },
  { id: 'q6', text: 'Attendance', type: 'rating', mandatory: true, from: '2026-04', to: null, order: 6 },
  { id: 'q7', text: 'Skills set and quality of work', type: 'rating', mandatory: true, from: '2026-04', to: null, order: 7 },
  { id: 'q8', text: 'Teamwork', type: 'rating', mandatory: true, from: '2026-04', to: null, order: 8 },
  { id: 'q9', text: 'General conduct', type: 'rating', mandatory: true, from: '2026-04', to: null, order: 9 },
  { id: 'q10', text: 'Initiative and motivation', type: 'rating', mandatory: true, from: '2026-04', to: null, order: 10 },
  { id: 'q11', text: 'Grooming parameters', type: 'rating', mandatory: true, from: '2026-04', to: null, order: 11 },
  { id: 'q12', text: 'Health parameters', type: 'rating', mandatory: true, from: '2026-04', to: null, order: 12 },
];

const paramsData = {
  sections: [
    { id: 's1', title: 'Attendance', items: ['Report to work on time and consistently.', 'Take breaks that do not exceed an expected length.', 'Notify your manager when you need to be absent or late.', 'No Overtime.'] },
    { id: 's2', title: 'Skills set & Quality of work', items: ['Accuracy, thoroughness, competence', 'Productivity level, time management, ability to meet deadlines'] },
    { id: 's3', title: 'Teamwork', items: ['Communication, delegation, efficiency, ideas and support.'] },
    { id: 's4', title: 'General conduct', items: ['Ethical principles - workplace behaviour and respect for all people.', 'Values - Aligning with the values & culture of the organisation.', 'Virtual etiquettes, discipline.'] },
    { id: 's5', title: 'Initiative and motivation', items: ['Initiative: the ability to take advantage of opportunities when they occur', 'Motivation: the ability to motivate yourself and the team to ensure work gets done before the deadline'] },
    { id: 's6', title: 'Grooming Parameters', items: ['Attention to Detail', 'Personal Branding', 'Etiquette', 'Self-Confidence', 'Communication'] },
    { id: 's7', title: 'Health Parameters', items: ['Physical Fitness', 'Work-Life Balance', 'Self-Care'] },
  ],
  scale: ['5 - Substantially exceeds job requirements (>100%)', '4 - Meets job requirements (80-100%)', '3 - Partially meets job requirements (50-80%)', '2 - Avg. meets the job requirements (30-50%)', '1 - Does not meet job requirements at all'],
};
// versions: each applies from a review month onwards
const paramsVersions = [{ from: '2026-04', data: JSON.parse(JSON.stringify(paramsData)) }];

// ---------- helpers ----------
const pad = n => String(n).padStart(2, '0');
const monthKey = (y, m) => `${y}-${pad(m)}`;
const fyMonths = (startYear = 2026) => {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1, y = startYear + (3 + i >= 12 ? 1 : 0);
    out.push(monthKey(y, m));
  }
  return out;
};
const daysIn = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const monthLabel = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long' }) + ' ' + y; };

// ---------- forms ----------
const forms = {};           // `${empId}|${month}` -> form
const annualForms = {};     // `${empId}|${fy}` -> form
const auditLog = [];
const emailsOutbox = [];
const editRequests = [];
const appraisals = {};      // empId -> annual appraisal form (6 steps)
const calendarLinks = {};   // empId -> { email, token (encrypted Google refresh token), connectedAt }
const audit = (who, action, detail) => auditLog.unshift({ at: new Date().toISOString(), who, action, detail });

const defaultRows = () => ({
  operational: { weight: 60, rows: [
    { id: 'o1', kpi: 'Variant regular tasks', target: 'Handling BO', weight: 30 },
    { id: 'o2', kpi: 'Client reporting', target: '5 on time', weight: 30 } ] },
  process: { weight: 20, rows: [
    { id: 'p1', kpi: 'SOP: campaign QA checklist', target: '1 SOP', weight: 10 },
    { id: 'p2', kpi: 'ClickUp task management', target: 'All tasks updated', weight: 10 } ] },
  people: { weight: 20, rows: [
    { id: 'l1', kpi: 'Learning: Ads certification', target: '1 course', weight: 10 },
    { id: 'l2', kpi: 'Knowledge sharing', target: '1 session', weight: 10 } ] },
});

const emptyKras = () => ({ operational: { weight: 60, rows: [] }, process: { weight: 20, rows: [] }, people: { weight: 20, rows: [] } });

// tiny deterministic rng so reloads give the same demo
let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a, b) => a + Math.floor(rnd() * (b - a + 1));

function windowFor(team, month) {
  const w = config.windows[team] || { start: 25, end: 31 };
  return { start: `${month}-${pad(w.start)}`, end: `${month}-${pad(Math.min(w.end, daysIn(month)))}` };
}

function buildForm(emp, month, state = 'submitted') {
  const win = windowFor(emp.team, month);
  const kras = emp.newJoiner ? emptyKras() : defaultRows();
  const f = {
    empId: emp.id, month, reviewDate: win.start.slice(0, 8) + pad(Math.min(+win.start.slice(8) + 2, +win.end.slice(8))),
    scheduledDate: null, actualDate: null, reschedules: [], submitted: false, locked: false,
    kras, qa: {}, qSnapshot: null,
  };
  f.scheduledDate = f.reviewDate;
  const SOP = 'SOP link: https://docs.company.com/sop/qa';
  const LRN = 'Document link: https://docs.company.com/learn/ads';
  for (const k of Object.keys(kras)) for (const r of kras[k].rows) {
    r.self = pick(4, 5);
    r.selfRemark = r.kpi.startsWith('SOP') ? SOP : r.kpi.startsWith('Learning') ? LRN : 'Completed as planned this month';
    r.mgr = rnd() < 0.7 ? r.self : r.self - 1;
    r.mgrRemark = r.mgr !== r.self ? 'Adjusted for delivery quality vs target' : r.mgr === 5 ? 'Exceeded the target this month' : '';
  }
  [['q1', 'Tight deadlines on two accounts; planned work earlier in the week'], ['q2', 'No issues at the moment'], ['q3', 'Launched 3 campaigns and automated the weekly report'], ['q4', 'Helped onboard a new teammate'], ['q5', 'Share a reusable report template across the team']]
    .forEach(([id, v]) => f.qa[id] = v);
  for (let i = 6; i <= 12; i++) {
    const s = pick(3, 5), m = rnd() < 0.75 ? s : Math.max(1, s - 1);
    f.qa['q' + i] = { self: s, mgr: m, remark: m !== s ? 'Slightly below expectation this month' : s === 5 ? 'Excellent this month' : '' };
  }
  if (state === 'submitted') { f.actualDate = f.reviewDate; f.submitted = true; f.locked = true; }
  if (emp.newJoiner) { Object.keys(f.qa).forEach(k => { }); }
  return f;
}

const SEED_MONTH = '2026-10';   // demo history runs up to October 2026; the current month starts blank
function seedForms() {
  const months = fyMonths(2026).filter(m => m <= SEED_MONTH);
  for (const emp of employees) {
    if (!emp.managerId || emp.role === 'admin') continue;
    for (const m of months) {
      const joinedMonth = emp.joined.slice(0, 7);
      if (m < joinedMonth) continue;
      if (!emp.active && m > emp.inactiveFrom.slice(0, 7)) continue;
      const state = m === SEED_MONTH ? 'open' : 'submitted';
      const f = buildForm(emp, m, state);
      if (emp.newJoiner) { f.kras = emptyKras(); }
      forms[`${emp.id}|${m}`] = f;
    }
  }
  const cm = SEED_MONTH;
  const F = id => forms[`${id}|${cm}`];
  const sub = f => { f.submitted = true; f.locked = true; f.actualDate = f.actualDate || f.reviewDate; };
  // October states shown in the spec mock-ups
  for (const id of [6, 4, 13, 17, 3]) { sub(F(id) || {}); }              // managers
  sub(F(7)); sub(F(10)); sub(F(11)); sub(F(5)); sub(F(15)); sub(F(16));
  // Aarav: submitted on time (default)  |  Isha: complete, not submitted, after due date, rescheduled twice, SOP link missing
  F(8).reviewDate = '2026-11-01'; F(8).actualDate = '2026-11-01'; F(8).submitted = false; F(8).locked = false; F(8).scheduledDate = '2026-10-28';
  F(8).reschedules = [{ from: '2026-10-28', to: '2026-10-30', by: 'Rohan Shah', at: '2026-10-28' }, { from: '2026-10-30', to: '2026-11-01', by: 'Rohan Shah', at: '2026-10-30' }];
  F(8).kras.process.rows[0].selfRemark = 'Updated checklist';
  // Dev: pending - nothing from manager, no actual date
  F(9).reviewDate = ''; F(9).actualDate = null; F(9).submitted = false; F(9).locked = false; F(9).scheduledDate = '2026-10-29';
  F(9).kras.operational.rows.forEach(r => { r.mgr = null; r.mgrRemark = ''; });
  F(9).kras.process.rows.forEach(r => { r.mgr = null; r.mgrRemark = ''; });
  F(9).kras.people.rows.forEach(r => { r.mgr = null; r.mgrRemark = ''; });
  F(9).kras.process.rows[1].self = 3; F(9).kras.process.rows[1].selfRemark = 'Tasks updated weekly';
  for (let i = 6; i <= 12; i++) F(9).qa['q' + i].mgr = null;
  // Neha: not completed, review date missing, partial manager ratings
  const n = F(14); n.reviewDate = ''; n.scheduledDate = '2026-10-12'; n.actualDate = null; n.submitted = false; n.locked = false;
  n.kras.operational.rows[1].mgr = null; n.kras.people.rows.forEach(r => r.mgr = null);
  // Meera: submitted with a 2 point gap
  const m = F(15); m.kras.operational.rows.forEach(r => { r.self = 5; r.mgr = 3; r.mgrRemark = 'Targets missed on two accounts'; });
  // Kabir: learning KRA not set for 3 months, complete, not submitted
  for (const mm of ['2026-08', '2026-09', '2026-10']) { const f = forms[`18|${mm}`]; if (f) { f.kras.people.rows = []; f.kras.people.weight = 20; } }
  F(18).submitted = false; F(18).locked = false;
  // Zoya: learning done, effective, recognised (mgr rating high)  |  Debarima: ClickUp low
  F(5).kras.process.rows[1].mgr = 2; F(5).kras.process.rows[1].mgrRemark = 'Tasks not updated daily';
  // Rahul (new joiner): questionnaire only; two complete months so the "set KRA" message appears
  const r = F(12); r.submitted = false; r.locked = false; r.actualDate = null; r.scheduledDate = '2026-10-27'; r.reviewDate = '2026-10-27';
  r.qa.q3 = 'N/A';
  // Aarav: a manager remark missing
  const a = F(7); a.kras.operational.rows[1].mgr = a.kras.operational.rows[1].self - 1; a.kras.operational.rows[1].mgrRemark = '';
  a.submitted = false; a.locked = false; a.actualDate = '2026-10-27';
  // Operational weight deviation for Tanvi (sub-KRAs also adjusted to match)
  const t = F(10); t.kras.operational.weight = 90; t.kras.operational.rows[0].weight = 45; t.kras.operational.rows[1].weight = 45;
  // months of questionnaire for Rahul prior month
  audit('System', 'seed', 'Demo data created');
}
seedForms();

module.exports = { config, employees, questions, paramsVersions, forms, annualForms, auditLog, emailsOutbox, editRequests, appraisals, calendarLinks, audit, fyMonths, daysIn, monthLabel, windowFor, defaultRows, emptyKras, buildForm, pad };
