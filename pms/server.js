const http = require('http');
const fs = require('fs');
const path = require('path');
const D = require('./data');
const L = require('./logic');
const { config, employees, forms, annualForms, questions, paramsVersions, auditLog, emailsOutbox, editRequests, audit } = D;

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

class HttpError extends Error { constructor(code, msg, extra) { super(msg); this.code = code; this.extra = extra; } }
const bad = (msg, extra) => new HttpError(400, msg, extra);
const forbid = () => new HttpError(403, 'You do not have access to this.');

const view = (u, i) => ({ id: u.id, code: u.code, name: u.name, designation: u.designation, team: u.team, role: u.role, managerId: u.managerId });

function formPayload(viewer, f) {
  const e = L.emp(f.empId);
  const month = f.month;
  const manage = L.canManage(viewer, f.empId), selfEdit = L.canSelfEdit(viewer, f.empId);
  const open = !f.locked;
  const valid = L.validate(f);
  return {
    form: f, employee: view(e), manager: e.managerId ? view(L.emp(e.managerId)) : null,
    questions: L.activeQuestions(month, f), status: L.reviewStatus(f), due: L.dueInfo(f),
    rating: f.submitted ? L.monthlyRating(f) : null, previewRating: L.monthlyRating(f),
    newJoiner: L.isNewJoiner(f), validation: valid,
    perms: {
      upcoming: month > config.currentMonth,
      editSelf: selfEdit && open && month <= config.currentMonth, editManager: manage && open && month <= config.currentMonth, canSubmit: manage && open && month <= config.currentMonth,
      editKras: canEditKras(viewer, f), requestEdit: f.locked && selfEdit && viewer.role !== 'admin',
      requestKra: !f.locked && viewer.id === f.empId && !hasReports(viewer.id) && !f.kraAccess && !f.kraRequested && viewer.role !== 'admin',
      kraRequested: !!f.kraRequested && !f.kraAccess, approveKra: !!f.kraRequested && manage && !f.locked, kraAccess: !!f.kraAccess,
      unlock: f.locked && manage,
    },
    fy: fyLabel(month),
  };
}
// reporting persons, managers, directors and admin edit KRAs directly; an employee with no reports needs approval first
const hasReports = id => D.employees.some(e => e.managerId === id && e.active);
const canEditKras = (viewer, f) => !f.locked && (L.canManage(viewer, f.empId) || (viewer.id === f.empId && (hasReports(viewer.id) || !!f.kraAccess)));
const fyLabel = m => { const [y, mo] = m.split('-').map(Number); const s = mo >= 4 ? y : y - 1; return `FY ${s}-${s + 1}`; };

function mustForm(viewer, empId, month) {
  empId = +empId;
  if (!L.emp(empId) || !L.canView(viewer, empId)) throw forbid();
  const f = L.getForm(empId, month);
  if (!f) throw bad('No form exists for this month.');
  return f;
}

// ---------- route table ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern + '$'), fn });

route('GET', '/api/users', () => employees.filter(e => e.active).map(e => ({ id: e.id, name: e.name, role: e.role, designation: e.designation })));
route('GET', '/api/me', ({ user }) => ({ ...view(user), months: D.fyMonths().map(m => ({ key: m, label: D.monthLabel(m), started: m <= config.currentMonth })), currentMonth: config.currentMonth, today: config.today, fy: fyLabel(config.currentMonth) }));

// Home
route('GET', '/api/home', ({ user, q }) => {
  const month = q.month || config.currentMonth;
  const rows = L.reportRows(user, month);
  const attention = rows.filter(r => r.status !== 'Completed and Submitted' || r.flags.length)
    .map(r => ({ empId: r.empId, name: r.name, team: r.team, scheduled: r.scheduled, issue: r.flags[0] || (r.status === 'Pending' ? 'Review pending' : r.status), status: r.status, reschedules: r.reschedules }))
    .slice(0, 12);
  const own = user.role !== 'admin' && user.managerId ? L.peek(user.id, month) : null;
  const win = D.windowFor(user.team, month);
  return { counts: L.counts(rows), attention, window: win, ownStatus: own ? L.reviewStatus(own) : null, month };
});

// Forms
route('GET', '/api/form', ({ user, q }) => formPayload(user, mustForm(user, q.emp || user.id, q.month || config.currentMonth)));

route('PUT', '/api/form', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (f.locked) throw bad('This form is locked. Request edit access to reopen it.');
  const manage = L.canManage(user, f.empId), selfEdit = L.canSelfEdit(user, f.empId);
  if (!manage && !selfEdit) throw forbid();
  if (body.reviewDate !== undefined) f.reviewDate = body.reviewDate;
  for (const [k] of L.KRAS) (body.kras?.[k]?.rows || []).forEach(br => {
    const r = f.kras[k].rows.find(x => x.id === br.id); if (!r) return;
    if (selfEdit) { r.self = num(br.self); r.selfRemark = br.selfRemark ?? r.selfRemark; }
    if (manage) { r.mgr = num(br.mgr); r.mgrRemark = br.mgrRemark ?? r.mgrRemark; }
  });
  for (const [id, a] of Object.entries(body.qa || {})) {
    if (typeof a === 'string') { if (selfEdit || manage) f.qa[id] = a; continue; }
    const cur = f.qa[id] || {};
    f.qa[id] = { self: selfEdit ? num(a.self) : cur.self, mgr: manage ? num(a.mgr) : cur.mgr, remark: manage ? (a.remark ?? cur.remark) : cur.remark };
  }
  audit(user.name, 'save form', `${L.emp(f.empId).name} ${f.month}`);
  return formPayload(user, f);
});
const has = v => v;
const num = v => (v === '' || v === null || v === undefined) ? null : Number(v);

route('POST', '/api/form/submit', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (!L.canManage(user, f.empId)) throw new HttpError(403, 'Only managers and admins can submit the form. Employees can fill in their self-ratings and self-remarks.');
  if (f.locked) throw bad('This form is already submitted.');
  const errs = L.validate(f).filter(x => x.level === 'block').map(x => x.msg);
  if (!L.ratingsComplete(f)) errs.push('All self and manager ratings must be entered before the form is submitted.');
  if (errs.length) throw bad('Form cannot be submitted.', { errors: [...new Set(errs)] });
  f.submitted = true; f.locked = true; f.actualDate = f.actualDate || f.reviewDate;
  f.qSnapshot = L.activeQuestions(f.month, null);
  audit(user.name, 'submit form', `${L.emp(f.empId).name} ${f.month}`);
  return formPayload(user, f);
});

route('POST', '/api/form/request-edit', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  editRequests.unshift({ type: 'form', empId: f.empId, month: f.month, by: user.name, at: new Date().toISOString(), status: 'open', note: body.note || '' });
  audit(user.name, 'edit access requested', `${L.emp(f.empId).name} ${f.month}`);
  return { ok: true };
});
route('POST', '/api/form/kra-request', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (user.id !== f.empId || f.locked) throw forbid();
  f.kraRequested = true; f.kraAccess = false;
  editRequests.unshift({ type: 'kra', empId: f.empId, month: f.month, by: user.name, at: new Date().toISOString(), status: 'open' });
  audit(user.name, 'KRA edit requested', `${L.emp(f.empId).name} ${f.month}`);
  return formPayload(user, f);
});
route('POST', '/api/form/kra-approve', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (!L.canManage(user, f.empId)) throw forbid();
  f.kraAccess = !!body.approve; f.kraRequested = false;
  editRequests.filter(r => r.type === 'kra' && r.empId === f.empId && r.month === f.month && r.status === 'open').forEach(r => r.status = body.approve ? 'granted' : 'declined');
  audit(user.name, body.approve ? 'KRA edit approved' : 'KRA edit declined', `${L.emp(f.empId).name} ${f.month}`);
  return formPayload(user, f);
});
route('GET', '/api/edit-requests', ({ user }) => editRequests.filter(r => r.status === 'open' && (user.role === 'admin' || L.canManage(user, r.empId))).map(r => ({ ...r, name: L.emp(r.empId).name })));
route('POST', '/api/form/unlock', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (!L.canManage(user, f.empId)) throw forbid();
  f.locked = false; f.submitted = false;
  editRequests.filter(r => r.empId === f.empId && r.month === f.month).forEach(r => r.status = 'granted');
  audit(user.name, 'form reopened', `${L.emp(f.empId).name} ${f.month}`);
  return formPayload(user, f);
});

// KRA settings: sub-KRA totals must equal the parent KRA weight
route('PUT', '/api/kras', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (f.locked) throw bad('This form is locked.');
  if (!canEditKras(user, f)) throw new HttpError(403, 'You cannot change KRA settings or weightage. Send a request for edit to your manager.');
  const errors = [];
  for (const [k, label] of L.KRAS) {
    const nk = body.kras[k]; if (!nk) continue;
    const sum = nk.rows.reduce((a, r) => a + (Number(r.weight) || 0), 0);
    if (nk.rows.length && sum !== Number(nk.weight)) errors.push(`The total weightage of Sub-KRAs under ${label} must be ${nk.weight}%. The current total is ${sum}%. Please correct the weightage before saving.`);
  }
  if (errors.length) throw bad('Sub-KRAs not saved.', { errors });
  const old = f.kras;
  const apply = target => {
    for (const [k] of L.KRAS) {
      if (!body.kras[k]) continue;
      const prev = target.kras[k].rows;
      target.kras[k].weight = Number(body.kras[k].weight);
      target.kras[k].rows = body.kras[k].rows.map((r, i) => {
        const keep = prev.find(p => p.id === r.id) || { self: num(r.self), selfRemark: r.selfRemark || '', mgr: num(r.mgr), mgrRemark: r.mgrRemark || '' };
        return { ...keep, id: r.id || `${k[0]}${Date.now()}${i}`, kpi: r.kpi, target: r.target, weight: Number(r.weight) };
      });
    }
  };
  apply(f);
  // later unsubmitted months follow the new structure
  D.fyMonths().filter(m => m > f.month && m <= config.currentMonth).forEach(m => { const g = D.forms[`${f.empId}|${m}`]; if (g && !g.locked) apply(g); });
  L.emp(f.empId).newJoiner = L.emp(f.empId).newJoiner && L.KRAS.every(([k]) => f.kras[k].rows.length === 0);
  audit(user.name, 'KRA settings', `${L.emp(f.empId).name} from ${f.month}`);
  return formPayload(user, f);
});

// copy the KRA structure (KPIs, targets, weightages) from the previous month; ratings and remarks start empty
route('POST', '/api/form/copy-kras', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (!canEditKras(user, f)) throw new HttpError(403, 'You cannot change KRA settings or weightage. Send a request for edit to your manager.');
  const months = D.fyMonths(), i = months.indexOf(f.month);
  const src = i > 0 ? L.getForm(f.empId, months[i - 1]) : null;
  if (!src) throw bad('There is no previous month to copy KRAs from.');
  f.kras = JSON.parse(JSON.stringify(src.kras));
  for (const [k] of L.KRAS) f.kras[k].rows.forEach(r => { r.self = null; r.selfRemark = ''; r.mgr = null; r.mgrRemark = ''; });
  audit(user.name, 'KRAs copied from last month', `${L.emp(f.empId).name} ${f.month}`);
  return formPayload(user, f);
});

// ---------- Appraisal form (annual, 6 steps) ----------
const appraisals = {};
const blankAppraisal = () => ({ recap: [{ expectation: '', achievements: '', improvement: '' }], kraProgress: [{ kra: '', progress: '' }], strengths: '', improvements: '', operational: '', process: '', people: '', submittedAt: null });
const appraisalPayload = (user, empId) => {
  const e = L.emp(empId), m = e.managerId ? L.emp(e.managerId) : null, a = appraisals[empId] || blankAppraisal();
  return { employee: { id: e.id, name: e.name, designation: e.designation, department: e.team, reviewer: m ? m.name : '–' }, fy: '2026-27', form: a,
    perms: { edit: L.canSelfEdit(user, empId) || L.canManage(user, empId) } };
};
route('GET', '/api/appraisal', ({ user, q }) => {
  const id = +(q.emp || user.id);
  if (!L.emp(id) || !L.canView(user, id)) throw forbid();
  return appraisalPayload(user, id);
});
route('PUT', '/api/appraisal', ({ user, body }) => {
  const id = +body.empId;
  if (!L.emp(id) || !L.canView(user, id)) throw forbid();
  if (!L.canSelfEdit(user, id) && !L.canManage(user, id)) throw forbid();
  const s = v => String(v ?? '');
  const f = body.form || {}, cur = appraisals[id] || blankAppraisal();
  appraisals[id] = {
    recap: (f.recap || []).map(r => ({ expectation: s(r.expectation), achievements: s(r.achievements), improvement: s(r.improvement) })),
    kraProgress: (f.kraProgress || []).map(r => ({ kra: s(r.kra), progress: s(r.progress) })),
    strengths: s(f.strengths), improvements: s(f.improvements), operational: s(f.operational), process: s(f.process), people: s(f.people),
    submittedAt: body.submit ? new Date().toISOString() : cur.submittedAt,
  };
  audit(user.name, body.submit ? 'submit appraisal' : 'save appraisal', L.emp(id).name);
  return appraisalPayload(user, id);
});

// Scheduling
route('GET', '/api/scheduling', ({ user, q }) => {
  const month = q.month || config.currentMonth;
  const rows = L.reportRows(user, month, { team: q.team });
  const teams = [...new Set(rows.map(r => r.team))];
  const windows = teams.map(t => {
    const w = D.windowFor(t, month), tr = rows.filter(r => r.team === t);
    const [y, m, d] = w.start.split('-').map(Number); const c = new Date(y, m - 1, d - 3);
    return { team: t, start: w.start, end: w.end, collectedOn: c.toISOString().slice(0, 10), collected: tr.filter(r => r.scheduled).length, total: tr.length };
  });
  return { windows, rows: rows.map(r => ({ ...r, history: L.peek(r.empId, month).reschedules })) };
});
route('POST', '/api/scheduling/reschedule', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (!L.canManage(user, f.empId)) throw forbid();
  if (!body.date) throw bad('A new date is required.');
  f.reschedules.push({ from: f.scheduledDate, to: body.date, by: user.name, at: config.today });
  f.scheduledDate = body.date;
  audit(user.name, 'reschedule', `${L.emp(f.empId).name} to ${body.date}`);
  return { ok: true };
});
route('POST', '/api/scheduling/actual', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (!L.canManage(user, f.empId)) throw forbid();
  f.actualDate = body.date || null;
  audit(user.name, 'actual date', `${L.emp(f.empId).name} ${body.date}`);
  return { ok: true };
});
route('POST', '/api/scheduling/schedule', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (!L.canManage(user, f.empId)) throw forbid();
  f.scheduledDate = body.date;
  return { ok: true };
});

// Review status report
route('GET', '/api/report', ({ user, q }) => {
  const month = q.month || config.currentMonth;
  const view = q.view === 'team' || user.role === 'manager' || user.role === 'teamlead' ? q.view || 'team' : q.view || 'org';
  const rows = L.reportRows(user, month, { team: q.team, manager: q.manager, status: q.status });
  const all = L.reportRows(user, month);
  const managers = [...new Set(all.map(r => r.managerId))].map(id => ({ id, name: L.emp(id).name, team: L.emp(id).team }));
  const byTeam = {};
  rows.forEach(r => (byTeam[`${r.manager} / ${r.team}`] ||= []).push(r));
  return {
    view, counts: L.counts(rows), rows, teams: [...new Set(all.map(r => r.team))], managers,
    teamCounts: Object.entries(byTeam).map(([name, rs]) => ({ name, ...L.counts(rs) })),
    scope: user.role === 'director' || user.role === 'admin' ? 'Organisation' : 'Your team and everyone under you',
  };
});
route('GET', '/api/report.csv', ({ user, q }) => {
  const rows = L.reportRows(user, q.month || config.currentMonth, { team: q.team, manager: q.manager, status: q.status });
  const head = ['Manager', 'Team', 'Employee', 'Scheduled', 'Due', 'Actual', 'Due status', 'Reschedules', 'Status', 'Monthly rating', 'Flags'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return { csv: [head, ...rows.map(r => [r.manager, r.team, r.name, r.scheduled, r.due, r.actual, r.dueStatus, r.reschedules, r.status, r.rating, r.flags.join('; ')])].map(r => r.map(esc).join(',')).join('\n') };
});

// Emails (not sent automatically: generate drafts, then send)
route('GET', '/api/emails', ({ user, q }) => {
  const month = q.month || config.currentMonth;
  const mgrs = employees.filter(e => e.active && employees.some(x => x.managerId === e.id && x.active) && L.canView(user, e.id) && e.role !== 'admin');
  const allowed = mgrs.filter(m => user.role === 'admin' || user.role === 'director' || m.id === user.id || L.isAncestor(user.id, m.id));
  return allowed.map(m => ({ managerId: m.id, name: m.name, team: m.team, state: (emailsOutbox.find(x => x.managerId === m.id && x.month === month) || {}).state || 'not generated' }));
});
route('GET', '/api/email', ({ user, q }) => {
  const id = +q.manager;
  if (user.role !== 'admin' && user.role !== 'director' && id !== user.id && !L.isAncestor(user.id, id)) throw forbid();
  const month = q.month || config.currentMonth;
  const e = emailsOutbox.find(x => x.managerId === id && x.month === month);
  return { ...L.buildEmail(id, month), state: e ? e.state : 'not generated', sentAt: e && e.sentAt };
});
route('POST', '/api/emails/generate', ({ user, body }) => {
  if (user.role === 'employee') throw forbid();
  const month = body.month || config.currentMonth; let n = 0;
  employees.filter(e => e.active && employees.some(x => x.managerId === e.id && x.active) && e.role !== 'admin').forEach(m => {
    if (user.role !== 'admin' && user.role !== 'director' && m.id !== user.id && !L.isAncestor(user.id, m.id)) return;
    if (!emailsOutbox.find(x => x.managerId === m.id && x.month === month)) { emailsOutbox.push({ managerId: m.id, month, state: 'draft' }); n++; }
  });
  audit(user.name, 'generate emails', `${n} drafts for ${month}`);
  return { created: n };
});
route('POST', '/api/emails/send', ({ user, body }) => {
  if (user.role === 'employee') throw forbid();
  const month = body.month || config.currentMonth;
  let e = emailsOutbox.find(x => x.managerId === +body.managerId && x.month === month);
  if (!e) emailsOutbox.push(e = { managerId: +body.managerId, month });
  e.state = 'sent'; e.sentAt = new Date().toISOString();
  audit(user.name, 'email sent', `${L.emp(+body.managerId).name} ${month} (local demo: logged, no SMTP)`);
  return { ok: true, sentAt: e.sentAt };
});

// Annual review + one page summary
route('GET', '/api/annual', ({ user, q }) => {
  const empId = +(q.emp || user.id);
  if (!L.canView(user, empId)) throw forbid();
  const e = L.emp(empId);
  const months = D.fyMonths();
  const summary = months.map(m => {
    const f = L.peek(empId, m);
    if (!f) return { month: m, label: D.monthLabel(m), filled: false };
    const k = f.kras;
    const sa = [], ma = [];
    L.KRAS.forEach(([x]) => { const a = L.kraAvg(k[x].rows, 'self'), b = L.kraAvg(k[x].rows, 'mgr'); if (a !== null) sa.push(a); if (b !== null) ma.push(b); });
    const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
    const sop = k.process.rows.filter(r => /sop/i.test(r.kpi)).map(r => r.kpi.replace(/^SOP:\s*/i, ''));
    const learn = k.people.rows.filter(r => /learn/i.test(r.kpi)).map(r => r.kpi.replace(/^Learning:\s*/i, ''));
    const v = L.validate(f).filter(x => x.level === 'flag');
    return {
      month: m, label: D.monthLabel(m), filled: true, weightage: `${k.operational.weight} / ${k.process.weight} / ${k.people.weight}`,
      work: [f.qa.q3].filter(Boolean).join(''), self: avg(sa), mgr: f.submitted ? avg(ma) : null, rating: f.submitted ? L.monthlyRating(f) : null,
      selfRemarks: L.KRAS.flatMap(([x]) => k[x].rows.map(r => r.selfRemark)).filter(Boolean).slice(0, 2),
      mgrRemarks: L.KRAS.flatMap(([x]) => k[x].rows.map(r => r.mgrRemark)).filter(Boolean).slice(0, 2),
      sop, learn, status: L.reviewStatus(f), highlights: v.map(x => x.short).slice(0, 3), subKras: L.KRAS.map(([x, l]) => `${l}: ${k[x].rows.map(r => `${r.kpi} (${r.weight})`).join(', ') || 'not set'}`),
    };
  });
  const key = `${empId}|FY2026`;
  return { employee: view(e), fy: 'FY 2026-2027', months: summary, annual: annualForms[key] || { reviewDate: '', accomplishments: '', kraReflection: '', learnings: '', selfRating: '', mgrRating: '', mgrRemark: '', submitted: false },
    perms: { editSelf: (L.canSelfEdit(user, empId)) && !(annualForms[key] || {}).submitted, editMgr: L.canManage(user, empId) && !(annualForms[key] || {}).submitted, submit: L.canManage(user, empId) } };
});
route('PUT', '/api/annual', ({ user, body }) => {
  const empId = +body.empId; if (!L.canView(user, empId)) throw forbid();
  const key = `${empId}|FY2026`;
  const cur = annualForms[key] || {};
  if (cur.submitted) throw bad('The annual review is already submitted.');
  const next = { ...cur };
  if (L.canSelfEdit(user, empId)) Object.assign(next, { reviewDate: body.reviewDate, accomplishments: body.accomplishments, kraReflection: body.kraReflection, learnings: body.learnings, selfRating: body.selfRating });
  if (L.canManage(user, empId)) Object.assign(next, { mgrRating: body.mgrRating, mgrRemark: body.mgrRemark, reviewDate: body.reviewDate ?? next.reviewDate });
  if (body.submit) {
    if (!L.canManage(user, empId)) throw new HttpError(403, 'Only managers and admins can submit the annual review.');
    if (!next.reviewDate) throw bad('Review Date is mandatory. Please enter the review date before submitting the form.', { errors: ['Review Date is mandatory. Please enter the review date before submitting the form.'] });
    if (next.selfRating !== '' && next.mgrRating !== '' && next.selfRating != null && next.mgrRating != null && +next.selfRating !== +next.mgrRating && !(next.mgrRemark || '').trim())
      throw bad('Form cannot be submitted.', { errors: ["Manager remarks are required because there is a difference between the employee's self-rating and the manager's rating."] });
    next.submitted = true;
  }
  annualForms[key] = next; audit(user.name, body.submit ? 'submit annual' : 'save annual', L.emp(empId).name);
  return { ok: true };
});

// Employees (admin)
const adminOnly = u => { if (u.role !== 'admin') throw forbid(); };
route('GET', '/api/employees', ({ user, q }) => {
  adminOnly(user);
  const month = config.currentMonth;
  const rows = employees.filter(e => e.role !== 'admin').map(e => { const f = L.peek(e.id, month); return { ...e, manager: e.managerId ? L.emp(e.managerId).name : '', reviewStatus: f ? L.reviewStatus(f) : 'n/a' }; });
  return { active: rows.filter(e => e.active), inactive: rows.filter(e => !e.active), teams: Object.keys(config.windows), managers: employees.filter(e => e.role === 'manager' || e.role === 'director' || e.role === 'teamlead').map(e => ({ id: e.id, name: e.name })) };
});
route('GET', '/api/employee-forms', ({ user, q }) => {
  adminOnly(user);
  const id = +q.emp, e = L.emp(id);
  const rows = D.fyMonths().map(m => { const f = L.peek(id, m); return { month: m, label: D.monthLabel(m), reviewDate: f ? f.reviewDate : '', status: f ? L.reviewStatus(f) : (m > config.currentMonth ? 'Not started' : 'Not started'), rating: f && f.submitted ? L.monthlyRating(f) : null, open: !!f }; });
  return { employee: { ...e, manager: e.managerId ? L.emp(e.managerId).name : '' }, rows, annual: annualForms[`${id}|FY2026`] ? 'Submitted' : 'Opens in March' };
});
route('POST', '/api/employees', ({ user, body }) => {
  adminOnly(user);
  const need = ['name', 'code', 'email', 'designation', 'team', 'managerId', 'joined', 'role', 'window'];
  const miss = need.filter(k => !body[k]);
  if (miss.length) throw bad('Mandatory fields missing: ' + miss.join(', '), { errors: ['Mandatory fields missing: ' + miss.join(', ')] });
  if (employees.some(e => e.code === body.code)) throw bad('Employee code already exists.');
  const id = Math.max(...employees.map(e => e.id)) + 1;
  employees.push({ id, code: body.code, name: body.name, email: body.email, designation: body.designation, team: body.team, managerId: +body.managerId, role: body.role, level: null, joined: body.joined, active: true, newJoiner: true });
  audit(user.name, 'add member', `${body.name} (${body.code})`);
  return { id };
});
route('POST', '/api/employees/inactive', ({ user, body }) => {
  adminOnly(user);
  const e = L.emp(+body.id);
  if (!body.date || !body.reason) throw bad('Inactive-from date and reason are required.');
  const f = L.peek(e.id, config.currentMonth);
  const warning = f && !['Completed and Submitted', 'Completed but Not Submitted'].includes(L.reviewStatus(f)) && body.date.slice(0, 7) === config.currentMonth
    ? 'Their review this month is not completed. It is counted until the inactive date.' : null;
  if (!body.confirm && warning) return { needsConfirm: true, warning };
  e.active = false; e.inactiveFrom = body.date; e.reason = body.reason; e.note = body.note;
  audit(user.name, 'move to inactive', `${e.name} from ${body.date} (${body.reason})`);
  return { ok: true };
});
route('POST', '/api/employees/reactivate', ({ user, body }) => {
  adminOnly(user);
  const e = L.emp(+body.id); e.active = true; delete e.inactiveFrom; delete e.reason;
  audit(user.name, 'reactivate', `${e.name} from ${body.date || config.today}`);
  return { ok: true };
});

// Reporting managers (admin)
route('GET', '/api/reporting', ({ user, q }) => {
  adminOnly(user);
  const lv = q.level, month = config.currentMonth;
  const direct = e => employees.filter(x => x.managerId === e.id && x.active);
  const director = e => { let c = e; while (c && c.role !== 'director') c = L.emp(c.managerId); return c && c.id !== e.id ? c.name : (c ? '' : ''); };
  const list = employees.filter(e => e.active && e.level === lv).map(e => ({
    id: e.id, name: e.name, designation: e.designation, email: e.email || `${e.name.toLowerCase().replace(/ /g, '.')}@company.com`, employees: direct(e).length, director: director(e),
    team: direct(e).map(x => { const f = L.peek(x.id, month); return { id: x.id, name: x.name, designation: x.designation, status: f ? L.reviewStatus(f) : '-' }; }),
  }));
  return list;
});
route('GET', '/api/reporting/person', ({ user, q }) => {
  adminOnly(user);
  const e = L.emp(+q.id), month = config.currentMonth;
  const team = L.subordinates(e.id).filter(x => x.managerId === e.id).map(x => { const f = L.peek(x.id, month); return { id: x.id, name: x.name, designation: x.designation, reviewDate: f && f.reviewDate, status: f ? L.reviewStatus(f) : '-', rating: f && f.submitted ? L.monthlyRating(f) : null }; });
  return { person: { ...e, manager: e.managerId ? L.emp(e.managerId).name : '', director: (() => { let c = e; while (c && c.role !== 'director') c = L.emp(c.managerId); return c ? c.name : ''; })() }, team, counts: L.counts(team) };
});

// Parameters summary
route('GET', '/api/params', ({ q }) => ({ ...L.paramsFor(q.month || config.currentMonth), versions: paramsVersions.map(v => v.from) }));
route('PUT', '/api/params', ({ user, body }) => {
  adminOnly(user);
  if (!/^\d{4}-\d{2}$/.test(body.from || '')) throw bad('Choose the month from which the change applies.');
  const idx = paramsVersions.findIndex(v => v.from === body.from);
  const v = { from: body.from, data: body.data };
  idx >= 0 ? paramsVersions[idx] = v : paramsVersions.push(v);
  audit(user.name, 'parameters summary updated', `applies from ${body.from}`);
  return { ok: true };
});

// Questions
route('GET', '/api/questions', ({ user }) => { adminOnly(user); return questions.slice().sort((a, b) => a.order - b.order); });
route('POST', '/api/questions', ({ user, body }) => {
  adminOnly(user);
  if (!body.text || !body.from) throw bad('Question text and the month it applies from are required.');
  const type = body.type === 'rating' ? 'rating' : 'text';
  const grp = questions.filter(q => q.type === type);
  const q = { id: 'q' + Date.now(), text: body.text, type, mandatory: body.mandatory !== false, from: body.from, to: null, order: Math.max(...questions.map(x => x.order)) + 1 };
  questions.push(q); renumber();
  audit(user.name, 'question added', `${q.text} from ${q.from}`);
  return q;
});
route('PUT', '/api/questions', ({ user, body }) => {
  adminOnly(user);
  const q = questions.find(x => x.id === body.id); if (!q) throw bad('Not found');
  if (!body.from) throw bad('Choose the month the change applies from.');
  // keep the earlier wording for earlier months by closing the old one and adding a new one
  if (body.text !== q.text || body.mandatory !== q.mandatory) {
    if (q.from < body.from) {
      const clone = { ...q, id: 'q' + Date.now(), text: body.text, mandatory: body.mandatory, from: body.from, to: q.to };
      q.to = body.from; questions.push(clone);
      // submitted forms of earlier months keep their snapshot; carry answers under new id from the effective month
      Object.values(forms).filter(f => f.month >= body.from && f.qa[q.id] !== undefined && !f.submitted).forEach(f => { f.qa[clone.id] = f.qa[q.id]; });
    } else { q.text = body.text; q.mandatory = body.mandatory; }
  }
  renumber();
  audit(user.name, 'question updated', `${body.text} from ${body.from}`);
  return { ok: true };
});
route('POST', '/api/questions/delete', ({ user, body }) => {
  adminOnly(user);
  const q = questions.find(x => x.id === body.id); if (!q) throw bad('Not found');
  if (!body.from) throw bad('Choose the month from which the question is removed.');
  q.to = body.from; audit(user.name, 'question deleted', `${q.text} from ${body.from}`);
  return { ok: true };
});
route('POST', '/api/questions/move', ({ user, body }) => {
  adminOnly(user);
  const list = questions.filter(q => !q.to).sort((a, b) => a.order - b.order);
  const type = (questions.find(x => x.id === body.id) || {}).type;
  const grp = list.filter(q => q.type === type);
  const i = grp.findIndex(q => q.id === body.id), j = i + (body.dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= grp.length) return { ok: true };
  [grp[i].order, grp[j].order] = [grp[j].order, grp[i].order];
  audit(user.name, 'question reordered', grp[i].text);
  return { ok: true };
});
function renumber() {
  // text questions first (1-5...), rating questions after, keeping relative order
  const sorted = questions.slice().sort((a, b) => (a.type === b.type ? a.order - b.order : a.type === 'text' ? -1 : 1));
  sorted.forEach((q, i) => q.order = i + 1);
}

route('GET', '/api/audit', ({ user }) => { adminOnly(user); return auditLog.slice(0, 200); });
route('GET', '/api/config', ({ user }) => { adminOnly(user); return config; });
route('PUT', '/api/config', ({ user, body }) => {
  adminOnly(user);
  for (const k of ['operationalRange', 'peopleMin', 'peopleMax', 'clickupMin', 'learningMin', 'ratingGapFlag', 'emailGapFlag', 'selfShare', 'mgrShare']) if (body[k] !== undefined) config[k] = body[k];
  if (body.windows) config.windows = body.windows;
  audit(user.name, 'config updated', 'thresholds / windows');
  return config;
});

// ---------- server ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) {
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    return fs.createReadStream(file).pipe(res);
  }
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
      if (!r) return send(404, { error: 'Not found' });
      const user = L.emp(+req.headers['x-user']);
      if (url.pathname !== '/api/users' && (!user || !user.active)) return send(401, { error: 'Pick a user to continue.' });
      const body = raw ? JSON.parse(raw) : {};
      send(200, r.fn({ user, q: Object.fromEntries(url.searchParams), body }));
    } catch (e) {
      if (e instanceof HttpError) return send(e.code, { error: e.message, ...e.extra });
      console.error(e); send(500, { error: 'Server error: ' + e.message });
    }
  });
});
server.listen(PORT, () => console.log(`Verve PMS demo running at http://localhost:${PORT}`));
