const D = require('./data');
const { config, employees, forms, questions, paramsVersions } = D;

const emp = id => employees.find(e => e.id === id);
const KRAS = [['operational', 'Operational'], ['process', 'Process'], ['people', 'People']];
const has = v => v !== null && v !== undefined && v !== '';
const blank = v => !has(v) || String(v).trim() === '';
const hasLink = s => /(https?:\/\/|www\.)\S+/i.test(s || '');
const URL_RE = /(https?:\/\/|www\.)\S+/gi; // global: only for match / replace
const linksIn = s => (String(s || '').match(URL_RE) || []).map(u => u.toLowerCase().replace(/[).,;:!?'"]+$/, ''));
const noLinks = s => String(s || '').replace(URL_RE, ' ').replace(/\s+/g, ' ').trim();
const wordCount = s => (noLinks(s).match(/[\p{L}\p{N}]+/gu) || []).length;
// the SOP sub-KRAs (Process) and learning sub-KRAs (People) are found by name, as the flags always did
const sopRows = f => f.kras.process.rows.filter(r => /sop/i.test(r.kpi));
const learnRows = f => f.kras.people.rows.filter(r => /learn/i.test(r.kpi));
const noKras = f => KRAS.every(([k]) => !f.kras[k].rows.length);
// a text answer that is there but shorter than the minimum (blank / N/A answers are reported as missing instead)
const textAnswer = a => !blank(a) && !/^(n\/a|not added)$/i.test(String(a).trim());
const shortAnswer = a => textAnswer(a) && wordCount(a) < config.qMinWords;
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
  if (viewer.role === 'admin') return true; // everyone else, directors included, sees themselves and the people under them
  return viewer.id === targetId || isAncestor(viewer.id, targetId);
}
// A reviewer can enter manager ratings and submit; admin can do everything
const canManage = (viewer, targetId) => viewer.role === 'admin' || isAncestor(viewer.id, targetId);
const canSelfEdit = (viewer, targetId) => viewer.id === targetId || viewer.role === 'admin';
// The role follows the reporting line (same rule as the employee-list import): no manager = director, "Team lead" in the
// designation = team lead, active people reporting to them = manager, otherwise employee. Admin accounts are left alone.
const deriveRole = e => !e.managerId ? 'director' : /team ?lead/i.test(e.designation || '') ? 'teamlead'
  : employees.some(x => x.active && x.managerId === e.id) ? 'manager' : 'employee';
// run after every change to a reporting line; returns who changed (for the audit log)
function refreshRoles() {
  const changed = [];
  for (const e of employees) {
    if (e.role === 'admin') continue;
    const r = deriveRole(e);
    if (r !== e.role) { changed.push({ e, from: e.role, to: r }); e.role = r; }
  }
  return changed;
}
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
  if (!e || !D.validMonth(month) || month < e.joined.slice(0, 7)) return null;
  // a new month starts with no KRAs; the person chooses whether to copy last month's (Copy KRAs from last month)
  const kras = D.emptyKras();
  return forms[k] = { empId, month, reviewDate: '', scheduledDate: null, actualDate: null, reschedules: [], selfSubmitted: false, selfSubmittedAt: null, submitted: false, locked: false, kras, qa: {}, qSnapshot: null };
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
// KRA ratings are percentages (10 to 100 in steps of 10); questionnaire ratings stay on the 1-5 parameter scale (0 allowed)
const KRA_SCALE = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const Q_SCALE = [0, 1, 2, 3, 4, 5];
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
// the calculation behind the monthly rating, KRA by KRA (shown as the form's Review summary)
const r1 = x => x == null ? null : Math.round(x * 10) / 10;
function kraSummary(f) {
  const wavg = (rows, key) => { const w = rows.filter(r => has(r[key])), tw = w.reduce((a, r) => a + (+r.weight || 0), 0); return tw ? w.reduce((a, r) => a + r.weight * r[key], 0) / tw : null; };
  const kras = KRAS.map(([k, label]) => {
    const { rows, weight } = f.kras[k], s = wavg(rows, 'self'), m = wavg(rows, 'mgr');
    const score = s != null && m != null && rows.every(r => has(r.self) && has(r.mgr)) ? config.selfShare * s + config.mgrShare * m : null;
    return { key: k, label, weight: +weight, subKras: rows.length, self: r1(s), mgr: r1(m), score: r1(score), scoreRaw: score, points: score == null ? null : r1(weight * score / 100) };
  });
  const qr = activeQuestions(f.month, f).filter(q => q.type === 'rating').map(q => f.qa[q.id] || {});
  const qavg = key => { const v = qr.map(a => a[key]).filter(has); return v.length ? r1(v.reduce((a, b) => a + +b, 0) / v.length) : null; };
  return { kras, rating: monthlyRating(f), final: !!f.submitted, questionnaire: { self: qavg('self'), mgr: qavg('mgr'), count: qr.length } };
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
      const miss = [], noRemark = [];
      rows.forEach(r => {
        if (!has(r.self) || blank(r.selfRemark)) miss.push(r.kpi);
        // every sub-KRA the manager has rated needs a manager remark (2026-11-13; it used to be only when the ratings differed).
        // Rows not rated yet are caught at submit by "manager rating missing", so unstarted forms are not flagged twice.
        if (has(r.mgr) && blank(r.mgrRemark)) noRemark.push(r.kpi);
      });
      if (miss.length) add('block', label, 'SELF_MISSING', `Self rating and self remark are mandatory. Missing in ${label}: ${miss.join(', ')}.`, `Self rating/remark missing in ${label}`);
      if (noRemark.length) add('block', label, 'MGR_REMARK', `Manager remark is mandatory for every sub-KRA. Missing in ${label}: ${noRemark.join(', ')}.`, `Manager remark missing in ${label}`);
      const sum = rows.reduce((a, r) => a + (+r.weight || 0), 0);
      if (rows.length && sum !== +weight) add('flag', label, 'SUBKRA_SUM', `The total weightage of Sub-KRAs under ${label} must be ${weight}%. The current total is ${sum}%.`);
      const a = kraAvg(rows, 'self'), b = kraAvg(rows, 'mgr');
      if (a !== null && b !== null && Math.abs(a - b) >= config.ratingGapFlag)
        add('flag', label, 'RATING_GAP', `${label}: self avg ${Math.round(a)}% vs manager avg ${Math.round(b)}% (gap ${Math.round(Math.abs(a - b))} points)`, `Rating gap ${Math.round(Math.abs(a - b))} points (${label})`);
    }
    const op = f.kras.operational;
    if (op.weight < config.operationalRange[0] || op.weight > config.operationalRange[1])
      add('flag', 'Operational', 'OP_WEIGHT', `Operational weightage is ${op.weight}, outside the accepted range ${config.operationalRange.join('-')}.`, `Operational weightage ${op.weight} outside ${config.operationalRange.join('-')}`);
    if (op.rows.length < config.opMinSubKras) add('flag', 'Operational', 'OP_MIN', `Operational KRA needs a minimum of ${config.opMinSubKras} sub-KRAs.`, `Operational has fewer than ${config.opMinSubKras} sub-KRAs`);

    const pr = f.kras.process;
    if (pr.weight !== config.weights.process) add('flag', 'Process', 'PR_WEIGHT', `Process weightage is ${pr.weight}; standard is ${config.weights.process}.`);
    if (pr.rows.length < 2) add('flag', 'Process', 'PR_MIN', 'Process KRA needs a minimum of 2 sub-KRAs.', 'Process has fewer than 2 sub-KRAs');
    const sop = sopRows(f);
    if (!sop.length) {
      const n = lookback(f.empId, f.month, g => !sopRows(g).length);
      add('flag', 'Process', 'SOP_MISSING', `SOP KRA not assigned (${n} consecutive month${n > 1 ? 's' : ''}).`, `SOP KRA not assigned (${n} month${n > 1 ? 's' : ''})`);
    }
    // the SOP and learning document links are mandatory before the review is submitted (2026-11-13)
    sop.forEach(r => { if (!hasLink(r.selfRemark)) add('block', 'Process', 'SOP_LINK', `SOP link is mandatory: add the SOP document link in the self remark (${r.kpi}).`, 'SOP link not added'); });
    pr.rows.filter(r => /clickup/i.test(r.kpi)).forEach(r => {
      if (has(r.mgr) && r.mgr < config.clickupMin) add('flag', 'Process', 'CLICKUP', `ClickUp rating ${r.mgr}%: not managing ClickUp properly.`, `ClickUp below ${config.clickupMin}%`);
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
      learnRows(f).forEach(r => { if (!hasLink(r.selfRemark)) add('block', 'People', 'LEARN_LINK', `Learning document link is mandatory: add it in the self remark (${r.kpi}).`, 'Learning link not added'); });
      pe.rows.forEach(r => { if (has(r.mgr) && r.mgr < config.learningMin) add('flag', 'People', 'LEARN_LOW', `Manager rating below ${config.learningMin}% (${r.kpi}: ${r.mgr}%).`, `Manager rating below ${config.learningMin}%`); });
      const lr = learnRows(f);
      if (lr.length && lr.every(r => has(r.mgr) && r.mgr >= 90 && hasLink(r.selfRemark))) add('info', 'People', 'LEARN_GOOD', 'Effective learning with document link.', 'Recognition: effective learning');
    }
  }

  // questionnaire
  const qs = activeQuestions(f.month, f);
  let qComplete = true;
  const short = [];
  qs.filter(q => q.type === 'text').forEach((q, i) => { if (shortAnswer(f.qa[q.id])) short.push(i + 1); });
  if (short.length) add('flag', 'Questionnaire', 'Q_SHORT', `Questionnaire not properly filled: answer${short.length > 1 ? 's to questions' : ' to question'} ${short.join(', ')} ${short.length > 1 ? 'are' : 'is'} under ${config.qMinWords} words.`, `Questionnaire answer under ${config.qMinWords} words`);
  for (const q of qs) {
    const a = f.qa[q.id];
    if (q.type === 'text') {
      if (q.mandatory && !textAnswer(a)) add('flag', 'Questionnaire', 'Q_TEXT', `Question "${q.text}" is blank, N/A or Not Added.`, 'Questionnaire answer missing');
    } else {
      const s = a && a.self, m = a && a.mgr;
      if (!has(s) || !has(m)) { qComplete = false; add('flag', 'Questionnaire', 'Q_INCOMPLETE', `${q.text}: self and manager ratings are both needed.`, 'Questionnaire rating missing'); }
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

// what the employee still has to fill in themselves: question answers, self ratings and self remarks.
// KRA set-up (not assigned, too few sub-KRAs, weightage, SOP/learning) and review-date alerts are the manager's and are not listed here.
function employeeTodo(f) {
  if (f.submitted || f.selfSubmitted) return [];
  const out = [], cut = t => t.length > 70 ? t.slice(0, 67).trimEnd() + '…' : t;
  if (employeeKrasMissing(f)) out.push('Add your KRAs for this month (or copy last month\'s)');
  const qs = activeQuestions(f.month, f);
  qs.forEach((q, i) => {
    const a = f.qa[q.id];
    if (q.type === 'text') {
      if (q.mandatory && !textAnswer(a)) out.push(`Answer question ${i + 1}: ${cut(q.text)}`);
      else if (shortAnswer(a)) out.push(`Answer question ${i + 1} in more detail (at least ${config.qMinWords} words)`);
    }
    else if (!a || !has(a.self)) out.push(`Self rating for question ${i + 1}: ${cut(q.text)}`);
  });
  if (!isNewJoiner(f)) {
    const sop = new Set(sopRows(f)), learn = new Set(learnRows(f));
    for (const [k, label] of KRAS) f.kras[k].rows.forEach(r => {
      const need = [!has(r.self) && 'self rating', blank(r.selfRemark) && 'self remark'].filter(Boolean);
      // the SOP / learning document link goes in the self remark
      const link = sop.has(r) ? 'the SOP document link' : learn.has(r) ? 'the learning document link' : '';
      if (link && !hasLink(r.selfRemark)) need.push(`${link} in your remark`);
      if (need.length) out.push(`${label} KRA "${cut(r.kpi || 'Untitled')}": ${need.join(' and ')}`);
    });
  }
  return out;
}

// what stops the manager's final Submit, beyond validate(): the sub-KRAs and questions still without a manager rating
function managerGaps(f) {
  const out = [];
  if (!isNewJoiner(f)) for (const [k, label] of KRAS) {
    const miss = f.kras[k].rows.filter(r => !has(r.mgr)).map(r => r.kpi || 'Untitled');
    if (miss.length) out.push(`Manager rating is mandatory. Missing in ${label}: ${miss.join(', ')}.`);
  }
  const q = activeQuestions(f.month, f).filter(x => x.type === 'rating' && !(f.qa[x.id] && has(f.qa[x.id].mgr))).length;
  if (q) out.push(`Manager rating missing on ${q} questionnaire question${q === 1 ? '' : 's'}.`);
  return out;
}

// no KRA at all this month (and not a new joiner): the employee must add or copy them before sending the form
const employeeKrasMissing = f => !isNewJoiner(f) && KRAS.every(([k]) => !f.kras[k].rows.length);

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
  const e = emp(f.empId), w = D.windowOf(e, f.month);
  const actual = actualDate(f), due = actual ? (actual <= w.end ? 'Within due date' : 'After due date') : 'Pending';
  return { windowStart: w.start, dueDate: w.end, due };
}

// times a review was moved, counted by distinct new dates: moving it twice to the same day, or changing only the time, counts once
const rescheduleCount = f => new Set((f.reschedules || []).map(r => r.to).filter(Boolean)).size;
// the first date the manager picked (forms scheduled before firstScheduledDate existed: the "from" of the first move)
const firstScheduled = f => f.firstScheduledDate || ((f.reschedules || [])[0] || {}).from || f.scheduledDate || null;

// ---------- PMS report format (the management sheet, 2026-11-13) ----------
// "On leave" / "Serving notice" are set by the admin on the employee (Employees › Edit) from a review month onwards
const WORK_STATUS = { leave: 'Employee on leave', notice: 'Serving Notice' };
const workStatusIn = (e, month) => e && e.workStatus && WORK_STATUS[e.workStatus.type] && month >= e.workStatus.from ? e.workStatus.type : null;
const nextMonth = m => { let [y, mo] = m.split('-').map(Number); mo++; if (mo > 12) { mo = 1; y++; } return `${y}-${D.pad(mo)}`; };
const monthsBack = (m, n) => { for (let i = 0; i < n; i++) m = prevMonth(m); return m; };
// the top of the reporting line (the director the person sits under)
function directorOf(e) {
  const seen = new Set();
  let top = null;
  for (let m = emp(e.managerId); m && !seen.has(m.id); m = emp(m.managerId)) { seen.add(m.id); top = m; }
  return top;
}
function finalStatus(f, e) {
  if (f.month > config.currentMonth) return 'N/A';
  const nj = isNewJoiner(f);
  if (f.submitted) return nj ? 'Questionnaire Done' : 'Review Done';
  const ws = workStatusIn(e, f.month);
  if (ws) return WORK_STATUS[ws];
  if (nj) return questionnaireComplete(f) ? 'Questionnaire Done' : 'Questionnaire Pending';
  // every rating is in, but something still stops the submit (a remark, a link, the review date)
  if (ratingsComplete(f) && validate(f).some(x => x.level === 'block')) return 'PMS form incomplete/errors/queries';
  return 'Review Pending';
}
// a new joiner's KRAs are due the month after their second month with a complete questionnaire
function kraDueMonth(f) {
  if (!isNewJoiner(f)) return null;
  let done = 0;
  for (const m of D.fyMonths()) {
    if (m > f.month) break;
    const g = peek(f.empId, m);
    if (g && isNewJoiner(g) && questionnaireComplete(g) && ++done === 2) return nextMonth(m);
  }
  return null;
}
// what an SOP / learning entry is about: its document links, and the remark text (3 words or more) without them
function topicKeys(rows) {
  const keys = new Set();
  for (const r of rows) {
    linksIn(r.selfRemark).forEach(u => keys.add(u));
    const t = noLinks(r.selfRemark).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (t.split(' ').length >= 3) keys.add('t:' + t);
  }
  return keys;
}
// how many months in a row (this one included) share an SOP / learning topic; 0 when this month has none
function topicRun(f, pick) {
  let cur = topicKeys(pick(f)), n = cur.size ? 1 : 0, m = f.month;
  for (let i = 0; n && i < config.lookbackMonths; i++) {
    const p = peek(f.empId, prevMonth(m)); if (!p) break;
    const prev = topicKeys(pick(p)), shared = [...cur].filter(x => prev.has(x));
    if (!shared.length) break;
    n++; cur = new Set(shared); m = p.month;
  }
  return n;
}
function escalations(f) {
  const out = [], since = n => D.monthLabel(monthsBack(f.month, n - 1));
  const due = kraDueMonth(f);
  if (due && due <= f.month) return [`KRA setting due since ${D.monthLabel(due)}`];
  if (isNewJoiner(f)) return out;
  if (noKras(f)) {
    const n = lookback(f.empId, f.month, noKras);
    if (n >= 2) out.push(`KRAs not set since ${since(n)}`);
    return out;
  }
  if (!sopRows(f).length) { const n = lookback(f.empId, f.month, g => !noKras(g) && !sopRows(g).length); if (n >= 2) out.push(`SOP KRA not assigned since ${since(n)}`); }
  if (!learnRows(f).length) { const n = lookback(f.empId, f.month, g => !noKras(g) && !learnRows(g).length); if (n >= 2) out.push(`Learning not assigned since ${since(n)}`); }
  const s = topicRun(f, sopRows), l = topicRun(f, learnRows);
  if (s >= 2) out.push(`Same SOP topic for ${s} months in a row`);
  if (l >= 2) out.push(`Same learning topic for ${l} months in a row`);
  return out;
}
// one KRA's remarks in one line, so the report reads without opening the form: each sub-KRA's self and manager remark
// (document links left out; they have their own columns)
const kraRemarks = rows => rows.map(r => {
  const s = noLinks(r.selfRemark), m = noLinks(r.mgrRemark);
  return s || m ? `${r.kpi || 'Sub-KRA'}: ${[s && `Self: ${s}`, m && `Manager: ${m}`].filter(Boolean).join(' / ')}` : null;
}).filter(Boolean).join(' | ');
const yn = b => b ? 'Yes' : 'No';
// one row of the report, in the sheet's column order
function pmsDetail(f, e) {
  const nj = isNewJoiner(f), op = f.kras.operational, sop = sopRows(f), learn = learnRows(f);
  const dir = directorOf(e), mgr = emp(e.managerId);
  const opSum = op.rows.reduce((a, r) => a + (+r.weight || 0), 0);
  const opOk = +op.weight === config.weights.operational && op.rows.length >= config.opMinSubKras && opSum === +op.weight && op.rows.every(r => !blank(r.target));
  const learnRated = learn.length && learn.every(r => has(r.mgr));
  const texts = activeQuestions(f.month, f).filter(q => q.type === 'text');
  return {
    code: e.src === 'list' && !e.codeSet ? '' : e.code || '', name: e.name, doj: e.src === 'list' && !e.joinedSet ? '' : e.joined || '',
    designation: e.designation || '', department: e.team || '', manager: mgr ? mgr.name : '', director: dir ? dir.name : '',
    scheduled: firstScheduled(f), reschedules: rescheduleCount(f), actual: actualDate(f), finalStatus: finalStatus(f, e),
    opSet: nj ? 'N/A' : yn(opOk),
    sop: nj ? 'N/A' : yn(sop.length), sopKra: sop.map(r => noLinks(r.selfRemark) || r.kpi).filter(Boolean).join('; '),
    sopLink: !sop.length ? 'N/A' : yn(sop.every(r => hasLink(r.selfRemark))),
    learning: nj ? 'N/A' : yn(learn.length),
    learningDone: !learn.length ? 'N/A' : !learnRated ? 'Not rated yet' : yn(learn.every(r => +r.mgr >= config.learningDoneMin)),
    learningLink: !learn.length ? 'N/A' : yn(learn.every(r => hasLink(r.selfRemark))),
    questionnaire: !texts.length ? 'N/A' : yn(texts.every(q => textAnswer(f.qa[q.id]) && !shortAnswer(f.qa[q.id]))),
    percentage: monthlyRating(f),
    opRemark: kraRemarks(op.rows), processRemark: kraRemarks(f.kras.process.rows), peopleRemark: kraRemarks(f.kras.people.rows),
    escalations: escalations(f),
  };
}

// ---------- reports ----------
// opts.detail adds the PMS report format columns (pmsDetail) to each row
function reportRows(viewer, month, filters = {}, opts = {}) {
  // people with no reporting manager (top-level directors) are not reviewed, even if an older version left a form for them
  const people = visibleEmployees(viewer).filter(e => e.managerId && (e.id !== viewer.id || viewer.role === 'employee'));
  const rows = [];
  for (const e of people) {
    const f = peek(e.id, month);
    if (!f) continue;
    const mgr = emp(e.managerId);
    const v = validate(f);
    const di = dueInfo(f);
    rows.push({
      empId: e.id, name: e.name, team: e.team, winKey: D.windowSource(e).key, designation: e.designation, managerId: e.managerId, manager: mgr ? mgr.name : '',
      scheduled: f.scheduledDate, due: di.dueDate, actual: actualDate(f), dueStatus: di.due,
      reschedules: rescheduleCount(f), status: reviewStatus(f), rating: f.submitted ? monthlyRating(f) : null,
      flags: [...new Set(v.filter(x => x.level !== 'info').map(x => x.short))], allFlags: v,
      ...(opts.detail && { detail: pmsDetail(f, e) }),
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
    // the same issue on several questions (e.g. 5 unanswered questions) is one line with a count, not 5 lines
    const seen = new Map();
    for (const x of r.v) {
      const s = ['RATING_GAP', 'OP_WEIGHT', 'OP_MIN', 'MGR_REMARK', 'Q_TEXT', 'Q_SHORT', 'Q_INCOMPLETE', 'Q_REMARK', 'REVIEW_DATE', 'SELF_MISSING'].includes(x.code) ? 'form'
        : ['SOP_MISSING', 'SOP_LINK', 'CLICKUP', 'PR_MIN', 'PR_WEIGHT'].includes(x.code) ? 'process'
        : ['LEARNING_MISSING', 'LEARN_LINK', 'LEARN_LOW', 'LEARN_GOOD', 'NJ_MONTHS', 'NJ_SET', 'PE_WEIGHT', 'PE_MIN'].includes(x.code) ? 'people' : null;
      if (!s) continue;
      const k = s + '|' + x.short, o = seen.get(k);
      if (o) o.count++; else seen.set(k, { s, short: x.short, count: 1, hot: x.code === 'RATING_GAP' });
    }
    for (const o of seen.values()) sec[o.s].push({ text: `${o.short}${o.count > 1 ? ` (${o.count})` : ''}: ${n}`, ...(o.s === 'form' && { hot: o.hot }) });
    const gapE = ['operational', 'process', 'people'].map(k => { const a = kraAvg(r.f.kras[k].rows, 'self'), b = kraAvg(r.f.kras[k].rows, 'mgr'); return a !== null && b !== null ? Math.abs(a - b) : 0; });
    if (Math.max(...gapE) >= config.emailGapFlag && !r.v.some(x => x.code === 'RATING_GAP')) sec.rating.push({ text: `Rating gap of ${config.emailGapFlag} points or more: ${n}`, hot: true });
    const w = r.f.kras;
    if (!isNewJoiner(r.f) && (w.operational.weight !== 60 || w.process.weight !== 20 || w.people.weight !== 20)) sec.rating.push({ text: `Weightage ${w.operational.weight} / ${w.process.weight} / ${w.people.weight}: ${n}`, hot: false });
  }
  if (!sec.rating.length) sec.rating.push({ text: 'Weightage 60 / 20 / 20 for all employees.' });
  return { to: m.name, subject: `PMS review summary, ${m.team}, ${D.monthLabel(month)}`, team: m.team, managerId, month, counts: counts(rows.map(r => ({ status: r.st }))), sections: sec, attachment: `PMS_${m.team}_${D.monthLabel(month).replace(' ', '')}.csv` };
}

module.exports = { emp, KRAS, deriveRole, refreshRoles, managerActivity, subordinates, isAncestor, canView, canManage, canSelfEdit, visibleEmployees, peek, getForm, activeQuestions, paramsFor, isNewJoiner, monthlyRating, kraSummary, employeeTodo, managerGaps, KRA_SCALE, Q_SCALE, validate, reviewStatus, dueInfo, rescheduleCount, firstScheduled, WORK_STATUS, pmsDetail, reportRows, counts, buildEmail, kraAvg, has, blank, prevMonth, ratingsComplete };
