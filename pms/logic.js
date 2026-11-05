const D = require('./data');
const { config, employees, forms, questions, paramsVersions } = D;

const emp = id => employees.find(e => e.id === id);
const KRAS = [['operational', 'Operational'], ['process', 'Process'], ['people', 'People']];
const has = v => v !== null && v !== undefined && v !== '';
const blank = v => !has(v) || String(v).trim() === '';
const hasLink = s => /(https?:\/\/|www\.)\S+/i.test(s || '');
const prevMonth = m => { let [y, mo] = m.split('-').map(Number); mo--; if (!mo) { mo = 12; y--; } return `${y}-${D.pad(mo)}`; };

// ---------- hierarchy ----------
function subordinates(id) {
  const out = [];
  const walk = x => employees.filter(e => e.managerId === x && e.active).forEach(e => { out.push(e); walk(e.id); });
  walk(id);
  return out;
}
const isAncestor = (viewerId, targetId) => subordinates(viewerId).some(e => e.id === targetId);
function canView(viewer, targetId) {
  if (!emp(targetId)) return false;
  if (viewer.role === 'admin' || viewer.role === 'director') return true;
  return viewer.id === targetId || isAncestor(viewer.id, targetId);
}
// A reviewer can enter manager ratings and submit; admin can do everything
const canManage = (viewer, targetId) => viewer.role === 'admin' || isAncestor(viewer.id, targetId) ||
  (viewer.role === 'director' && viewer.id !== targetId);
const canSelfEdit = (viewer, targetId) => viewer.id === targetId || viewer.role === 'admin';
function visibleEmployees(viewer, includeInactive = false) {
  const base = employees.filter(e => e.role !== 'admin' && canView(viewer, e.id));
  return includeInactive ? base : base.filter(e => e.active);
}

// ---------- forms ----------
const peek = (empId, month) => forms[`${empId}|${month}`] || null;
function getForm(empId, month) {
  const k = `${empId}|${month}`;
  if (forms[k]) return forms[k];
  const e = emp(empId);
  if (!e || !D.fyMonths().includes(month) || month < e.joined.slice(0, 7)) return null;
  // a new month starts with no KRAs; the person chooses whether to copy last month's (Copy KRAs from last month)
  const kras = D.emptyKras();
  const win = D.windowFor(e.team, month);
  return forms[k] = { empId, month, reviewDate: '', scheduledDate: null, actualDate: null, reschedules: [], submitted: false, locked: false, kras, qa: {}, qSnapshot: null };
}

function activeQuestions(month, form) {
  if (form && form.submitted && form.qSnapshot) return form.qSnapshot;
  return questions.filter(q => q.from <= month && (!q.to || month < q.to)).sort((a, b) => a.order - b.order)
    .map(q => ({ id: q.id, text: q.text, type: q.type, mandatory: q.mandatory }));
}
const paramsFor = month => {
  const v = paramsVersions.filter(x => x.from <= month).sort((a, b) => b.from.localeCompare(a.from))[0] || paramsVersions[0];
  return { from: v.from, data: v.data };
};

const isNewJoiner = f => KRAS.every(([k]) => f.kras[k].rows.length === 0) && !!emp(f.empId).newJoiner;
const kraAvg = (rows, key) => { const v = rows.map(r => r[key]).filter(has); return v.length ? v.reduce((a, b) => a + +b, 0) / v.length : null; };

// ---------- rating ----------
function monthlyRating(f) {
  if (isNewJoiner(f)) return null;
  let total = 0, wsum = 0;
  for (const [k] of KRAS) {
    const { rows, weight } = f.kras[k];
    if (!rows.length) continue;
    let s = 0, w = 0;
    for (const r of rows) {
      if (!has(r.self) || !has(r.mgr)) return null;
      s += r.weight * (config.selfShare * r.self + config.mgrShare * r.mgr); w += r.weight;
    }
    total += weight * (s / w); wsum += weight;
  }
  return wsum ? Math.round(total / wsum * 10) / 10 : null;
}

// ---------- validation ----------
function lookback(empId, month, missing) {
  let n = 0, m = month;
  for (let i = 0; i < config.lookbackMonths; i++) {
    const f = peek(empId, m);
    if (!f || !missing(f)) break;
    n++; m = prevMonth(m);
  }
  return n;
}

function validate(f) {
  const out = [];
  const add = (level, area, code, msg, short) => out.push({ level, area, code, msg, short: short || msg });
  const e = emp(f.empId);
  const nj = isNewJoiner(f);

  if (blank(f.reviewDate)) add('block', 'Form', 'REVIEW_DATE', 'Review Date is mandatory. Please enter the review date before submitting the form.', 'Review date missing');

  if (!nj) {
    for (const [k, label] of KRAS) {
      const { rows, weight } = f.kras[k];
      const miss = [];
      rows.forEach((r, i) => {
        if (!has(r.self) || blank(r.selfRemark)) miss.push(r.kpi);
        if (has(r.self) && +r.self === 5 && blank(r.selfRemark))
          add('block', label, 'TOP_SELF_REMARK', `A self rating of 5 needs a remark. (${label}: ${r.kpi})`, `Remark missing for rating 5 (${r.kpi})`);
        if (has(r.mgr) && +r.mgr === 5 && blank(r.mgrRemark) && !(has(r.self) && +r.self !== 5))
          add('block', label, 'TOP_MGR_REMARK', `A manager rating of 5 needs a manager remark. (${label}: ${r.kpi})`, `Manager remark missing for rating 5 (${r.kpi})`);
        if (has(r.self) && has(r.mgr) && +r.self !== +r.mgr && blank(r.mgrRemark))
          add('block', label, 'MGR_REMARK', `Manager remarks are required because there is a difference between the employee's self-rating and the manager's rating. (${label}: ${r.kpi})`, `Manager remark missing (${r.kpi})`);
      });
      if (miss.length) add('block', label, 'SELF_MISSING', `Self rating and self remark are mandatory. Missing in ${label}: ${miss.join(', ')}.`, `Self rating/remark missing in ${label}`);
      const sum = rows.reduce((a, r) => a + (+r.weight || 0), 0);
      if (rows.length && sum !== +weight) add('flag', label, 'SUBKRA_SUM', `The total weightage of Sub-KRAs under ${label} must be ${weight}%. The current total is ${sum}%.`);
      const a = kraAvg(rows, 'self'), b = kraAvg(rows, 'mgr');
      if (a !== null && b !== null && Math.abs(a - b) >= config.ratingGapFlag)
        add('flag', label, 'RATING_GAP', `${label}: self avg ${a.toFixed(1)} vs manager avg ${b.toFixed(1)} (gap ${Math.abs(a - b).toFixed(1)})`, `Rating gap ${Math.abs(a - b).toFixed(1)} (${label})`);
    }
    const op = f.kras.operational;
    if (op.weight < config.operationalRange[0] || op.weight > config.operationalRange[1])
      add('flag', 'Operational', 'OP_WEIGHT', `Operational weightage is ${op.weight}, outside the accepted range ${config.operationalRange.join('-')}.`, `Operational weightage ${op.weight} outside ${config.operationalRange.join('-')}`);
    if (op.rows.length < 2) add('flag', 'Operational', 'OP_MIN', 'Operational KRA needs a minimum of 2 sub-KRAs.', 'Operational has fewer than 2 sub-KRAs');

    const pr = f.kras.process;
    if (pr.weight !== config.weights.process) add('flag', 'Process', 'PR_WEIGHT', `Process weightage is ${pr.weight}; standard is ${config.weights.process}.`);
    if (pr.rows.length < 2) add('flag', 'Process', 'PR_MIN', 'Process KRA needs a minimum of 2 sub-KRAs.', 'Process has fewer than 2 sub-KRAs');
    const sopRows = pr.rows.filter(r => /sop/i.test(r.kpi));
    if (!sopRows.length) {
      const n = lookback(f.empId, f.month, g => !g.kras.process.rows.some(r => /sop/i.test(r.kpi)));
      add('flag', 'Process', 'SOP_MISSING', `SOP KRA not assigned (${n} consecutive month${n > 1 ? 's' : ''}).`, `SOP KRA not assigned (${n} month${n > 1 ? 's' : ''})`);
    }
    sopRows.forEach(r => { if (!hasLink(r.selfRemark)) add('flag', 'Process', 'SOP_LINK', `SOP link not added in self remark (${r.kpi}).`, 'SOP link not added'); });
    pr.rows.filter(r => /clickup/i.test(r.kpi)).forEach(r => {
      if (has(r.mgr) && r.mgr < config.clickupMin) add('flag', 'Process', 'CLICKUP', `ClickUp rating ${r.mgr}: not managing ClickUp properly.`, `ClickUp below ${config.clickupMin}`);
    });

    const pe = f.kras.people;
    const prevF = peek(f.empId, prevMonth(f.month));
    if (pe.rows.length && (pe.weight < config.peopleMin || (pe.weight > config.peopleMax && prevF && prevF.kras.people.weight > config.peopleMax)))
      add('flag', 'People', 'PE_WEIGHT', `People weightage ${pe.weight} deviates from standard ${config.weights.people}.`);
    if (!pe.rows.length) {
      const n = lookback(f.empId, f.month, g => g.kras.people.rows.length === 0);
      add('flag', 'People', 'LEARNING_MISSING', `Learning KRA not set (${n} consecutive month${n > 1 ? 's' : ''}).`, `Learning KRA not set (${n} month${n > 1 ? 's' : ''})`);
    } else {
      if (pe.rows.length < 2) add('flag', 'People', 'PE_MIN', 'People KRA needs a minimum of 2 sub-KRAs.');
      pe.rows.filter(r => /learn/i.test(r.kpi)).forEach(r => { if (!hasLink(r.selfRemark)) add('flag', 'People', 'LEARN_LINK', 'Learning document link not added in self remark.', 'Learning link not added'); });
      pe.rows.forEach(r => { if (has(r.mgr) && r.mgr < config.learningMin) add('flag', 'People', 'LEARN_LOW', `Manager rating below ${config.learningMin} (${r.kpi}: ${r.mgr}).`, `Manager rating below ${config.learningMin}`); });
      const lr = pe.rows.filter(r => /learn/i.test(r.kpi));
      if (lr.length && lr.every(r => has(r.mgr) && r.mgr >= 4.5 && hasLink(r.selfRemark))) add('info', 'People', 'LEARN_GOOD', 'Effective learning with document link.', 'Recognition: effective learning');
    }
  }

  // questionnaire
  const qs = activeQuestions(f.month, f);
  let qComplete = true;
  for (const q of qs) {
    const a = f.qa[q.id];
    if (q.type === 'text') {
      if (q.mandatory && (blank(a) || /^(n\/a|not added)$/i.test(String(a).trim()))) add('flag', 'Questionnaire', 'Q_TEXT', `Question "${q.text}" is blank, N/A or Not Added.`, 'Questionnaire answer missing');
    } else {
      const s = a && a.self, m = a && a.mgr;
      if (!has(s) || !has(m)) { qComplete = false; add('flag', 'Questionnaire', 'Q_INCOMPLETE', `${q.text}: self and manager ratings are both needed.`, 'Questionnaire rating missing'); }
      else if (+s === +m && +s === 5 && blank(a.remark)) add('block', 'Questionnaire', 'Q_TOP_REMARK', `A rating of 5 needs a remark. (${q.text})`, 'Questionnaire remark missing for rating 5');
      else if (+s !== +m && blank(a.remark)) add('block', 'Questionnaire', 'Q_REMARK', `Manager remarks are required because there is a difference between the employee's self-rating and the manager's rating. (${q.text})`, 'Questionnaire manager remark missing');
    }
  }
  if (nj) {
    let months = 0, m = f.month;
    for (let i = 0; i < 12; i++) { const g = peek(f.empId, m); if (g && questionnaireComplete(g)) months++; else if (i > 0) break; m = prevMonth(m); }
    add('info', 'New joiner', 'NJ_MONTHS', `New joiner: questionnaire complete for ${months} month${months === 1 ? '' : 's'}.`, `New joiner, ${months} month(s) of questionnaire complete`);
    if (months === 2) add('flag', 'New joiner', 'NJ_SET', 'Need to set KRA of the month.', 'Need to set KRA of the month');
    if (months >= 3) add('flag', 'New joiner', 'NJ_SET', 'KRA needs to be set from this month.', 'KRA needs to be set');
  }
  return out;
}

function questionnaireComplete(f) {
  return activeQuestions(f.month, f).filter(q => q.type === 'rating').every(q => { const a = f.qa[q.id]; return a && has(a.self) && has(a.mgr); });
}

// ---------- status ----------
function ratingsComplete(f) {
  if (!questionnaireComplete(f)) return false;
  if (isNewJoiner(f)) return true;
  return KRAS.every(([k]) => f.kras[k].rows.every(r => has(r.self) && has(r.mgr)));
}
function managerActivity(f) {
  return !!f.actualDate || KRAS.some(([k]) => f.kras[k].rows.some(r => has(r.mgr))) ||
    Object.values(f.qa).some(a => a && typeof a === 'object' && has(a.mgr));
}
function reviewStatus(f) {
  if (f.month > config.currentMonth) return 'Not started';
  if (ratingsComplete(f)) return f.submitted ? 'Completed and Submitted' : 'Completed but Not Submitted';
  // incomplete: Pending once the due date (end of the team's window) has passed, otherwise still in progress
  return dueInfo(f).dueDate < config.today ? 'Pending' : 'Review Not Completed';
}
// the actual review date is the Review Date entered on the monthly form
const actualDate = f => f.reviewDate || null;
function dueInfo(f) {
  const e = emp(f.empId), w = D.windowFor(e.team, f.month);
  const actual = actualDate(f), due = actual ? (actual <= w.end ? 'Within due date' : 'After due date') : 'Pending';
  return { windowStart: w.start, dueDate: w.end, due };
}

// ---------- reports ----------
function reportRows(viewer, month, filters = {}) {
  const people = visibleEmployees(viewer).filter(e => e.id !== viewer.id || viewer.role === 'employee');
  const rows = [];
  for (const e of people) {
    const f = peek(e.id, month);
    if (!f) continue;
    const mgr = emp(e.managerId);
    const v = validate(f);
    const di = dueInfo(f);
    rows.push({
      empId: e.id, name: e.name, team: e.team, designation: e.designation, managerId: e.managerId, manager: mgr ? mgr.name : '',
      scheduled: f.scheduledDate, due: di.dueDate, actual: actualDate(f), dueStatus: di.due,
      reschedules: f.reschedules.length, status: reviewStatus(f), rating: f.submitted ? monthlyRating(f) : null,
      flags: [...new Set(v.filter(x => x.level !== 'info').map(x => x.short))], allFlags: v,
    });
  }
  return rows.filter(r => (!filters.team || r.team === filters.team) && (!filters.manager || String(r.managerId) === String(filters.manager)) && (!filters.status || r.status === filters.status));
}
const counts = rows => ({
  scheduled: rows.length,
  submitted: rows.filter(r => r.status === 'Completed and Submitted').length,
  notSubmitted: rows.filter(r => r.status === 'Completed but Not Submitted').length,
  notCompleted: rows.filter(r => r.status === 'Review Not Completed').length,
  pending: rows.filter(r => r.status === 'Pending').length,
});

// ---------- manager email ----------
function buildEmail(managerId, month) {
  const m = emp(managerId);
  const team = employees.filter(e => e.managerId === managerId && e.active);
  const items = team.map(e => ({ e, f: peek(e.id, month) })).filter(x => x.f);
  const sec = { completion: [], form: [], process: [], people: [], rating: [] };
  const rows = items.map(({ e, f }) => ({ e, f, v: validate(f), st: reviewStatus(f), di: dueInfo(f) }));
  const within = rows.filter(r => r.di.due === 'Within due date').map(r => r.e.name);
  const after = rows.filter(r => r.di.due === 'After due date').map(r => r.e.name);
  const pending = rows.filter(r => r.di.due === 'Pending').map(r => r.e.name);
  sec.completion.push(`Scheduled ${rows.length}, within due date ${within.length}, after due date ${after.length}${after.length ? ' (' + after.join(', ') + ')' : ''}, pending ${pending.length}${pending.length ? ' (' + pending.join(', ') + ')' : ''}.`);
  for (const r of rows) {
    const n = r.e.name;
    for (const x of r.v) {
      if (x.code === 'RATING_GAP' || x.code === 'OP_WEIGHT' || x.code === 'OP_MIN' || x.code === 'MGR_REMARK' || x.code === 'Q_TEXT' || x.code === 'Q_INCOMPLETE' || x.code === 'Q_REMARK' || x.code === 'REVIEW_DATE' || x.code === 'SELF_MISSING')
        sec.form.push({ text: `${x.short}: ${n}`, hot: x.code === 'RATING_GAP' });
      else if (['SOP_MISSING', 'SOP_LINK', 'CLICKUP', 'PR_MIN', 'PR_WEIGHT'].includes(x.code)) sec.process.push({ text: `${x.short}: ${n}` });
      else if (['LEARNING_MISSING', 'LEARN_LINK', 'LEARN_LOW', 'LEARN_GOOD', 'NJ_MONTHS', 'NJ_SET', 'PE_WEIGHT', 'PE_MIN'].includes(x.code)) sec.people.push({ text: `${x.short}: ${n}` });
    }
    const gapE = ['operational', 'process', 'people'].map(k => { const a = kraAvg(r.f.kras[k].rows, 'self'), b = kraAvg(r.f.kras[k].rows, 'mgr'); return a !== null && b !== null ? Math.abs(a - b) : 0; });
    if (Math.max(...gapE) >= config.emailGapFlag && !r.v.some(x => x.code === 'RATING_GAP')) sec.rating.push({ text: `Rating gap of ${config.emailGapFlag} or more: ${n}`, hot: true });
    const w = r.f.kras;
    if (!isNewJoiner(r.f) && (w.operational.weight !== 60 || w.process.weight !== 20 || w.people.weight !== 20)) sec.rating.push({ text: `Weightage ${w.operational.weight} / ${w.process.weight} / ${w.people.weight}: ${n}`, hot: false });
  }
  if (!sec.rating.length) sec.rating.push({ text: 'Weightage 60 / 20 / 20 for all employees.' });
  return { to: m.name, subject: `PMS review summary, ${m.team}, ${D.monthLabel(month)}`, team: m.team, managerId, month, counts: counts(rows.map(r => ({ status: r.st }))), sections: sec, attachment: `PMS_${m.team}_${D.monthLabel(month).replace(' ', '')}.csv` };
}

module.exports = { emp, KRAS, subordinates, isAncestor, canView, canManage, canSelfEdit, visibleEmployees, peek, getForm, activeQuestions, paramsFor, isNewJoiner, monthlyRating, validate, reviewStatus, dueInfo, reportRows, counts, buildEmail, kraAvg, has, blank, prevMonth, ratingsComplete };
