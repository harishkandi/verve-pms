// Shared config and app state. State lives in these objects; db.js stores them in Postgres when configured.
// Employees come from the real employee list (employees.js), which is kept out of git in pms/private/.
const fs = require('fs');
const { LIST_FILE, importList } = require('./employees');

const config = {
  currentMonth: '2026-11',     // review month being run; its forms are open from the 1st of the month
  fyStartMonth: '2026-04',
  today: '2026-11-04',
  weights: { operational: 60, process: 20, people: 20 },
  operationalRange: [40, 80],
  peopleMin: 10,
  peopleMax: 20,
  // KRA ratings are percentages (10-100); these thresholds are percentages / percentage points
  ratingScale: 100,
  clickupMin: 60,
  learningMin: 40,
  ratingGapFlag: 20,           // section 8.4 O3
  emailGapFlag: 15,            // section 11
  selfShare: 0.3,
  mgrShare: 0.7,
  lookbackMonths: 5,
  timeZone: 'Asia/Kolkata',    // calendar invites use this time zone
  windows: {
    Operations: { start: 25, end: 31 },
    Marketing: { start: 10, end: 15 },
    Finance: { start: 25, end: 30 },
    Sales: { start: 25, end: 31 },
    HR: { start: 25, end: 30 },
    Directors: { start: 25, end: 30 },
  },
};

// role: admin | director | manager | teamlead | employee ; level is for the Reporting Manager menu.
// Filled from the employee list (see the end of this file); admin records are added by server.js.
const employees = [];

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

// full wording of the Grooming and Health parameters (as on the old PMS portal)
const PARAM_TEXT = {
  grooming: [
    'Attention to Detail: Pay careful attention to grooming details, such as neatness, grooming accessories, and overall tidiness.',
    'Personal Branding: Understanding and cultivating a personal brand image that aligns with professional goals and reflects positively on oneself and the organization.',
    'Etiquette: Demonstrating knowledge and practice of proper social and professional etiquette, including greetings, introductions, and appropriate behavior in different situations.',
    'Self-Confidence: Displaying a positive self-image, self-assurance, and the ability to interact confidently with others.',
    'Communication: The ability to effectively express oneself verbally and non-verbally, including tone, body language, and active listening skills.',
  ],
  health: [
    "Physical Fitness: The individual's overall physical well-being, including stamina, strength, flexibility, and overall fitness level.",
    'Work-Life Balance: Demonstrating the ability to prioritize personal and professional commitments, maintaining a healthy equilibrium between work and personal life.',
    'Self-Care: Engaging in practices that promote self-care, such as regular exercise, healthy eating habits, sufficient sleep, and relaxation techniques.',
  ],
};
const paramsData = {
  sections: [
    { id: 's1', title: 'Attendance', items: ['Report to work on time and consistently.', 'Take breaks that do not exceed an expected length.', 'Notify your manager when you need to be absent or late.', 'No Overtime.'] },
    { id: 's2', title: 'Skills set & Quality of work', items: ['Accuracy, thoroughness, competence', 'Productivity level, time management, ability to meet deadlines'] },
    { id: 's3', title: 'Teamwork', items: ['Communication, delegation, efficiency, ideas and support.'] },
    { id: 's4', title: 'General conduct', items: ['Ethical principles - workplace behaviour and respect for all people.', 'Values - Aligning with the values & culture of the organisation.', 'Virtual etiquettes, discipline.'] },
    { id: 's5', title: 'Initiative and motivation', items: ['Initiative: the ability to take advantage of opportunities when they occur', 'Motivation: the ability to motivate yourself and the team to ensure work gets done before the deadline'] },
    { id: 's6', title: 'Grooming Parameters', items: PARAM_TEXT.grooming },
    { id: 's7', title: 'Health Parameters', items: PARAM_TEXT.health },
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

function windowFor(team, month) {
  const w = config.windows[team] || { start: 25, end: 31 };
  return { start: `${month}-${pad(w.start)}`, end: `${month}-${pad(Math.min(w.end, daysIn(month)))}` };
}

// KRA ratings moved from 0-5 to percentages: 1 point = 20%, never below 10%
const toPct = v => v === null || v === undefined || v === '' ? v : Math.min(100, Math.max(10, Math.round(+v * 2) * 10));
function KRA_TO_PERCENT() {
  for (const f of Object.values(forms)) for (const k of ['operational', 'process', 'people']) for (const r of (f.kras[k] || { rows: [] }).rows) { r.self = toPct(r.self); r.mgr = toPct(r.mgr); }
}

// one-off fixes for state saved by an older version (db.js loads it over the seed): run after loading, safe to run again
function migrate() {
  // Grooming and Health parameters: replace the short labels with their full wording (only items still exactly as seeded)
  const full = [...PARAM_TEXT.grooming, ...PARAM_TEXT.health], byLabel = Object.fromEntries(full.map(t => [t.split(':')[0], t]));
  for (const v of paramsVersions) for (const sec of v.data.sections || []) sec.items = sec.items.map(it => byLabel[it] || it);
  // KRA ratings: 0-5 -> 10%-100% (forms and thresholds saved before the change)
  if (config.ratingScale !== 100) {
    KRA_TO_PERCENT();
    for (const k of ['clickupMin', 'learningMin', 'ratingGapFlag', 'emailGapFlag']) if (typeof config[k] === 'number' && config[k] <= 5) config[k] = Math.round(config[k] * 20);
    config.ratingScale = 100;
    audit('System', 'migration', 'KRA ratings converted from 0-5 to percentages (x20)');
  }
  // the "Leadership" team is now "Directors"
  for (const e of employees) if (e.team === 'Leadership') e.team = 'Directors';
  if (config.windows.Leadership) { config.windows.Directors ||= config.windows.Leadership; delete config.windows.Leadership; }
  // the Directors team always has a window (top-level people); other teams come from the employee list (employees.js)
  config.windows.Directors ||= { start: 25, end: 30 };
}

// the real employee list, when this machine has it (pms/private/employees.tsv). It is not in git, so Render does not
// have it: staging gets the list from the database (node employees.js <file> --apply).
if (fs.existsSync(LIST_FILE)) {
  try { importList({ employees, config, forms, annualForms, appraisals, calendarLinks, emailsOutbox, auditLog, audit }, fs.readFileSync(LIST_FILE, 'utf8')); }
  catch (e) { console.error(`Employee list not loaded (${LIST_FILE}): ${e.message}`); }
}

module.exports = { migrate, config, employees, questions, paramsVersions, forms, annualForms, auditLog, emailsOutbox, appraisals, calendarLinks, audit, fyMonths, daysIn, monthLabel, windowFor, defaultRows, emptyKras, pad };
