// Shared config and app state. State lives in these objects; db.js stores them in Postgres when configured.
// Employees come from the real employee list (employees.js), which is kept out of git in pms/private/.
const fs = require('fs');
const { LIST_FILE, importList } = require('./employees');

// rules behind the PMS report format (2026-11-13): learning counts as properly done from this manager rating (%),
// questionnaire text answers need at least this many words, and the Operational KRA needs at least this many sub-KRAs
function REPORT_RULES() { return { learningDoneMin: 60, qMinWords: 15, opMinSubKras: 3 }; }

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
  ...REPORT_RULES(),
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
  // a manager's whole team can have its own window: { <manager id>: { start, end } } (set from the employee list or the Scheduling page)
  managerWindows: {},
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
// the financial year (April to March) a month belongs to, named by the year it starts in
const fyStartOf = key => { const [y, m] = key.split('-').map(Number); return m >= 4 ? y : y - 1; };
// a form can exist for any month from the tool's first one up to the current month (earlier years stay viewable)
const validMonth = key => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key || '')) return false;
  return key >= config.fyStartMonth && key <= config.currentMonth;
};
const prevMonth = key => { const [y, m] = key.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const fyMonths = (startYear = fyStartOf(config.currentMonth)) => {
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
const notifications = {};   // empId -> [notification] newest first (notify.js, the bell in the top bar)
const calendarLinks = {};   // empId -> { email, token (encrypted Google refresh token), connectedAt }
const photos = {};          // empId -> profile photo (small JPEG data URL, set by the person on Profile information)
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

const DEFAULT_WINDOW = { start: 25, end: 2 };
// a window whose end day is before its start day runs into the next month (25th to the 2nd)
function windowDates(w, month) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-${pad(Math.min(w.start, daysIn(month)))}`;
  if (w.end >= w.start) return { start, end: `${month}-${pad(Math.min(w.end, daysIn(month)))}` };
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  return { start, end: `${next}-${pad(Math.min(w.end, daysIn(next)))}` };
}
const windowFor = (team, month) => windowDates(config.windows[team] || DEFAULT_WINDOW, month);
// date arithmetic on YYYY-MM-DD without time zones
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
// who sets this person's window: the nearest manager above them with their own window, otherwise the team's window
function windowSource(e) {
  const seen = new Set();
  for (let m = employees.find(x => x.id === e.managerId); m && !seen.has(m.id); m = employees.find(x => x.id === m.managerId)) {
    seen.add(m.id);
    if (config.managerWindows && config.managerWindows[m.id]) return { key: 'm' + m.id, managerId: m.id, w: config.managerWindows[m.id] };
  }
  return { key: 't:' + e.team, managerId: null, w: config.windows[e.team] || DEFAULT_WINDOW };
}
const windowOf = (e, month) => ({ ...windowDates(windowSource(e).w, month), key: windowSource(e).key });

// KRA ratings moved from 0-5 to percentages: 1 point = 20%, never below 10%
const toPct = v => v === null || v === undefined || v === '' ? v : Math.min(100, Math.max(10, Math.round(+v * 2) * 10));
function KRA_TO_PERCENT() {
  for (const f of Object.values(forms)) for (const k of ['operational', 'process', 'people']) for (const r of (f.kras[k] || { rows: [] }).rows) { r.self = toPct(r.self); r.mgr = toPct(r.mgr); }
}

// one-off fixes for state saved by an older version (db.js loads it over the seed): run after loading, safe to run again
function migrate() {
  // annual appraisals are kept per financial year (empId|2026); the ones saved before that belong to the first year
  for (const k of Object.keys(appraisals)) if (!k.includes('|')) { appraisals[`${k}|${fyStartOf(config.fyStartMonth)}`] = appraisals[k]; delete appraisals[k]; }
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
  config.managerWindows ||= {};
  // rules added after the state was first saved (the saved config replaces the defaults above)
  for (const [k, v] of Object.entries(REPORT_RULES())) if (typeof config[k] !== 'number') config[k] = v;
  // one-off: windows still at the old 25th-31st / 25th-30th defaults become 25th to the 2nd of the next month
  if (!config.windowsV2) {
    for (const [t, w] of Object.entries(config.windows)) if (w.start === 25 && (w.end === 31 || w.end === 30)) config.windows[t] = { start: 25, end: 2 };
    config.windowsV2 = true;
  }
  // once the real list is in, windows of teams nobody is in (the old demo teams) go
  if (employees.some(e => e.src === 'list')) {
    const teams = new Set(employees.filter(e => e.role !== 'admin').map(e => e.team));
    for (const t of Object.keys(config.windows)) if (t !== 'Directors' && !teams.has(t) && !(config.teamsAdded || []).includes(t)) delete config.windows[t];
  }
}

// the real employee list, when this machine has it (pms/private/employees.tsv). It is not in git, so Render does not
// have it: staging gets the list from the database (node employees.js <file> --apply).
if (fs.existsSync(LIST_FILE)) {
  try { importList({ employees, config, forms, annualForms, appraisals, calendarLinks, emailsOutbox, auditLog, audit }, fs.readFileSync(LIST_FILE, 'utf8')); }
  catch (e) { console.error(`Employee list not loaded (${LIST_FILE}): ${e.message}`); }
}

module.exports = { DEFAULT_WINDOW, migrate, config, employees, questions, paramsVersions, forms, annualForms, auditLog, emailsOutbox, appraisals, calendarLinks, photos, notifications, audit, fyMonths, daysIn, monthLabel, windowFor, windowOf, windowSource, addDays, defaultRows, emptyKras, pad, fyStartOf, validMonth, prevMonth };
