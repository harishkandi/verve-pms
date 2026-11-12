const http = require('http');
const fs = require('fs');
const path = require('path');
const D = require('./data');
const L = require('./logic');
const DB = require('./db');
const A = require('./auth');
const C = require('./calendar');
const N = require('./notify');
// notification helpers: the person's reporting manager, and "November 2026 review"
const mgrOf = id => N.managerOf(id);
const revOf = f => `${D.monthLabel(f.month)} review`;
const { config, employees, forms, annualForms, questions, paramsVersions, auditLog, emailsOutbox, appraisals, audit } = D;

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp' };

class HttpError extends Error { constructor(code, msg, extra) { super(msg); this.code = code; this.extra = extra; } }
const bad = (msg, extra) => new HttpError(400, msg, extra);
const forbid = () => new HttpError(403, 'You do not have access to this.');
const notFound = msg => new HttpError(404, msg);
// look up an employee from a request id; a missing or unknown id is a 404, not a crash
const mustEmp = id => { const e = L.emp(+id); if (!e) throw notFound('Employee not found.'); return e; };

class Redirect { constructor(url) { this.url = url; } }

const view = u => ({ id: u.id, code: u.code, name: u.name, email: u.email || '', designation: u.designation, team: u.team, role: u.role, managerId: u.managerId });

// managers, and the employee themself, may copy last month's KRAs (copying does not need approval)
// (until they send the form to their manager: then their part is read-only)
const canCopyKras = (viewer, f) => canEditKras(viewer, f) || (!f.locked && !f.selfSubmitted && viewer.id === f.empId);
function formPayload(viewer, f) {
  const e = L.emp(f.empId);
  const month = f.month;
  const manage = L.canManage(viewer, f.empId), selfEdit = L.canSelfEdit(viewer, f.empId);
  const open = !f.locked;
  const valid = L.validate(f);
  // once the employee has sent their part to the manager, it is read-only for them until the manager sends it back
  const selfOpen = open && (!f.selfSubmitted || manage);
  return {
    // a submitted form names the manager who reviewed it, even if the person reports to someone else now
    form: f, employee: view(e), manager: f.reviewedBy && f.reviewedBy.managerId && L.emp(f.reviewedBy.managerId) ? view(L.emp(f.reviewedBy.managerId)) : e.managerId ? view(L.emp(e.managerId)) : null,
    questions: L.activeQuestions(month, f), status: L.reviewStatus(f), due: L.dueInfo(f),
    rating: f.submitted ? L.monthlyRating(f) : null, previewRating: L.monthlyRating(f), summary: L.kraSummary(f),
    newJoiner: L.isNewJoiner(f), validation: valid,
    perms: {
      editSelf: selfEdit && selfOpen, editManager: (manage || selfEdit) && selfOpen, canSubmit: manage && open,
      canSelfSubmit: viewer.id === f.empId && open && !f.selfSubmitted, canReturn: manage && open && !!f.selfSubmitted,
      editKras: canEditKras(viewer, f), copyKras: canCopyKras(viewer, f),
      requestKra: canRequestKra(viewer, f), decideKra: canDecideKra(viewer, f),
    },
    kraRequest: f.kraRequest || null,
    fy: fyLabel(month),
  };
}
// the employee and their reviewers (managers, directors, admin) edit KRAs directly until the review is submitted
// employees cannot change their own KRAs; they send a request, and once their manager approves it they can make the change (one save)
const kraGrant = (viewer, f) => viewer.id === f.empId && !f.selfSubmitted && !!f.kraRequest && f.kraRequest.status === 'approved';
const canEditKras = (viewer, f) => !f.locked && (L.canManage(viewer, f.empId) || kraGrant(viewer, f));
// admins and directors set their own KRAs (no manager to approve), so they never request a change
const canRequestKra = (viewer, f) => !['admin', 'director'].includes(viewer.role) && !!viewer.managerId && !f.locked && !f.selfSubmitted && viewer.id === f.empId && !L.canManage(viewer, f.empId) && !(f.kraRequest && ['pending', 'approved'].includes(f.kraRequest.status));
const canDecideKra = (viewer, f) => !f.locked && viewer.id !== f.empId && L.canManage(viewer, f.empId) && !!f.kraRequest && f.kraRequest.status === 'pending';
const fyLabel = m => { const [y, mo] = m.split('-').map(Number); const s = mo >= 4 ? y : y - 1; return `FY ${s}-${s + 1}`; };

function mustForm(viewer, empId, month) {
  empId = +empId;
  if (!L.emp(empId) || !L.canView(viewer, empId)) throw forbid();
  // people with no reporting manager (top-level directors) are not reviewed: no new form for them (old ones stay readable)
  if (!L.emp(empId).managerId && !L.peek(empId, month)) throw bad('Top-level directors have no monthly review, so there is no form to open.');
  const f = L.getForm(empId, month);
  if (!f) throw bad('No form exists for this month.');
  return f;
}

// ---------- route table ----------
const routes = [];
// open: no sign-in needed (login page and the Google sign-in round trip)
const route = (method, pattern, fn, open = false) => routes.push({ method, re: new RegExp('^' + pattern + '$'), fn, open });

// ---------- sign-in ----------
const findByEmail = email => employees.find(e => (e.email || '').toLowerCase() === String(email || '').toLowerCase());
// "harish.kandi@..." -> "Harish Kandi"
const nameFromEmail = email => email.split('@')[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
// people in ADMIN_EMAILS get an admin record as soon as the server starts, plus one shared test admin (no email: never invited)
function ensureAccounts() {
  const add = (match, rec) => {
    if (employees.some(match)) return;
    const id = Math.max(0, ...employees.map(x => x.id)) + 1;
    employees.push({ id, code: 'A' + String(id).padStart(3, '0'), team: 'HR', managerId: null, role: 'admin', level: null, joined: config.today, active: true, ...rec });
  };
  add(e => e.code === 'A900', { code: 'A900', name: 'Verve Admin', designation: 'System Admin', demo: true });
  A.ADMIN_EMAILS.forEach(email => add(e => (e.email || '').toLowerCase() === email, { name: nameFromEmail(email), email, designation: 'PMS Admin' }));
}
// test logins: the role addresses are login names only, never stored as the person's email, so no invite can reach those inboxes
const byCode = c => employees.find(e => e.code === c);
const testAccounts = () => [
  ['admin', 'Admin', byCode('A900')], ['hr', 'HR', byCode('E001')], ['manager', 'Manager', byCode('E006')], ['employee', 'Employee', byCode('E101')],
  ...A.ADMIN_EMAILS.map(em => [em, 'Admin (you)', findByEmail(em)]),
].filter(([, , e]) => e && e.active).map(([login, label, emp]) => ({ email: login.includes('@') ? login : `${login}@${A.ORG_DOMAIN}`, label, emp }));
route('GET', '/api/auth/status', ({ user }) => ({
  google: A.google, demo: A.demo, domain: A.ORG_DOMAIN, signedIn: !!user,
  ...(A.demo && A.DEMO_PASSWORD && { accounts: testAccounts().map(a => ({ email: a.email, label: a.label, name: a.emp.name })), ...(A.showPassword && { password: A.DEMO_PASSWORD }) }),
}), true);
route('POST', '/api/auth/password', ({ body, setCookie, secure }) => {
  if (!A.demo) throw forbidMsg('Password sign-in is not switched on. Please use Sign in with Google.');
  const email = String(body.email || '').trim().toLowerCase();
  if (!A.isOrgEmail(email)) throw bad(`Use your @${A.ORG_DOMAIN} email.`);
  const acc = testAccounts().find(a => a.email === email);
  if (!acc || !A.checkPassword(body.password || '')) throw bad('Wrong email or password.');
  setCookie(A.sessionCookie(acc.emp.id, null, secure, body.remember !== false));
  audit(acc.emp.name, 'signed in', `${email} (password)`);
  return { ok: true };
}, true);
const forbidMsg = msg => new HttpError(403, msg);
// demo picker: dummy users, only when the server allows it (no Google sign-in set up, or DEMO_LOGIN=1)
route('GET', '/api/users', () => {
  if (!A.demo) throw notFound('Not found');
  return employees.filter(e => e.active).map(e => ({ id: e.id, name: e.name, role: e.role, designation: e.designation }));
}, true);
route('POST', '/api/auth/demo', ({ body, setCookie, secure }) => {
  if (!A.demo || !A.pickById) throw forbid();
  const e = L.emp(+body.id); if (!e || !e.active) throw notFound('User not found.');
  setCookie(A.sessionCookie(e.id, null, secure));
  return { ok: true };
}, true);
route('POST', '/api/auth/logout', ({ setCookie, secure }) => (setCookie(A.clearSession(secure)), { ok: true }), true);

// Google: /start sends the browser to Google; Google sends it back to /callback on the same address (origin)
route('GET', '/api/auth/google/start', ({ q, realUser, setCookie }) => {
  if (!A.google) throw bad('Google sign-in is not set up on this server.');
  const origin = A.okOrigin(q.origin); if (!origin) throw bad('This app address is not allowed for sign-in. Add it to APP_ORIGINS.');
  const calendar = q.calendar === '1';
  if (calendar && !realUser) throw new HttpError(401, 'Sign in first.');
  const s = A.authStart({ origin, calendar, uid: calendar ? realUser.id : null, loginHint: calendar ? realUser.email : undefined });
  setCookie(s.cookie);
  return new Redirect(s.url);
}, true);
const AUTH_ERRORS = ['cancelled', 'expired', 'google', 'domain', 'not_registered', 'inactive', 'calendar_mismatch', 'calendar_norefresh'];
route('GET', '/api/auth/google/callback', async ({ q, cookies, setCookie }) => {
  const s = A.oauthState(q.state);
  if (!s) throw bad('This sign-in link has expired. Please go back to PMS and try again.');
  const { origin } = s, secure = origin.startsWith('https');
  // back to the app; problems are shown on the page that opens (login, or Scheduling for calendar)
  const back = (params = {}, page = '') => new Redirect(`${origin}/${Object.keys(params).length ? '?' + new URLSearchParams(params) : ''}#/${page}`);
  setCookie(A.clearOauth(secure));
  const page = s.calendar ? 'scheduling' : '';
  if (q.error) return back({ auth_error: q.error === 'access_denied' ? 'cancelled' : 'google' }, page);
  if (!cookies.pms_oauth || cookies.pms_oauth !== s.nonce) return back({ auth_error: 'expired' }, page);
  let tok, id;
  try { tok = await A.exchange(q.code, origin); id = A.identity(tok.id_token); }
  catch (e) { console.error('Google sign-in failed:', e.message); return back({ auth_error: 'google' }, page); }
  if (!A.orgAccount(id)) return back({ auth_error: 'domain', email: id.email }, page);

  if (s.calendar) {
    const u = L.emp(s.uid);
    if (!u || (u.email || '').toLowerCase() !== id.email) return back({ auth_error: 'calendar_mismatch', email: id.email }, page);
    if (!tok.refresh_token) return back({ auth_error: 'calendar_norefresh' }, page);
    C.link(u.id, id.email, tok.refresh_token, tok.access_token, tok.expires_in);
    audit(u.name, 'Google Calendar connected', id.email);
    return back({ calendar: 'connected' }, page);
  }

  let e = findByEmail(id.email);
  if (!e && A.ADMIN_EMAILS.includes(id.email)) {
    const nid = Math.max(...employees.map(x => x.id)) + 1;
    e = { id: nid, code: 'A' + String(nid).padStart(3, '0'), name: id.name || id.email.split('@')[0], email: id.email, designation: 'PMS Admin', team: 'HR', managerId: null, role: 'admin', level: null, joined: new Date().toISOString().slice(0, 10), active: true };
    employees.push(e);
    audit(e.name, 'admin added', `${id.email} (from ADMIN_EMAILS)`);
  }
  if (!e) return back({ auth_error: 'not_registered', email: id.email });
  if (!e.active) return back({ auth_error: 'inactive', email: id.email });
  setCookie(A.sessionCookie(e.id, null, secure));
  audit(e.name, 'signed in', id.email);
  return back();
}, true);

// admins can look at PMS as anyone else, to check what each role sees
route('GET', '/api/auth/view-as', ({ realUser }) => {
  if (realUser.role !== 'admin') throw forbid();
  return employees.filter(e => e.active && e.id !== realUser.id).map(e => ({ id: e.id, name: e.name, role: e.role, designation: e.designation, team: e.team }));
});
route('POST', '/api/auth/view-as', ({ realUser, body, setCookie, secure, session }) => {
  if (realUser.role !== 'admin') throw forbid();
  const as = body.id ? mustEmp(body.id) : null;
  if (as && !as.active) throw bad('That employee is inactive.');
  setCookie(A.sessionCookie(realUser.id, as && as.id !== realUser.id ? as.id : null, secure, session.keep !== false));
  audit(realUser.name, as ? 'view as' : 'view as ended', as ? as.name : '');
  return { ok: true };
});

// the current month's form is open for everyone from the 1st, whether or not last month's review is complete
const ensureMonthForms = () => employees.filter(e => e.active && e.managerId && e.role !== 'admin').forEach(e => L.getForm(e.id, config.currentMonth));
ensureMonthForms();
const calendarState = real => { const l = C.linked(real.id); return { google: A.google, connected: !!l, email: l ? l.email : '', canConnect: A.google && A.isOrgEmail(real.email) }; };
route('GET', '/api/me', ({ user, realUser }) => (ensureMonthForms(), {
  ...view(user), teams: [...new Set(employees.filter(e => e.active && e.role !== 'admin').map(e => e.team).filter(Boolean))].sort(),
  months: D.fyMonths().map(m => ({ key: m, label: D.monthLabel(m), started: m <= config.currentMonth })), currentMonth: config.currentMonth, today: config.today, fy: fyLabel(config.currentMonth),
  photo: D.photos[user.id] || '', real: { id: realUser.id, name: realUser.name, role: realUser.role }, viewingAs: realUser.id !== user.id, domain: A.ORG_DOMAIN, calendar: calendarState(realUser),
}));

// Profile information (top bar menu): the person's own details as the admin set them; read-only for them.
// Joining date and code from the employee list are placeholders until the admin sets them (joinedSet / codeSet).
route('GET', '/api/profile', ({ user }) => {
  const e = L.emp(user.id), mgr = e.managerId ? L.emp(e.managerId) : null;
  // reporting line, top-level director first, the person last
  const chain = [e]; for (let x = e, i = 0; x.managerId && i < 50; i++) { x = L.emp(x.managerId); if (!x) break; chain.unshift(x); }
  const top = chain[0];
  const unset = k => e.src === 'list' && !e[k + 'Set'];
  const w = e.managerId ? D.windowFor(e.team, config.currentMonth) : null;
  return {
    name: e.name, code: unset('code') ? '' : e.code, email: e.email || '', designation: e.designation || '', team: e.team || '',
    role: e.role, manager: mgr ? { name: mgr.name, designation: mgr.designation || '' } : null,
    director: top.id !== e.id ? top.name : '', joined: unset('joined') ? '' : e.joined || '', active: e.active !== false,
    reports: employees.filter(x => x.active && x.managerId === e.id).length,
    chain: chain.map(x => ({ id: x.id, name: x.name, designation: x.designation || '', me: x.id === e.id, photo: D.photos[x.id] || '' })),
    photo: D.photos[e.id] || '',
    window: w ? { month: D.monthLabel(config.currentMonth), start: w.start, end: w.end } : null,
  };
});

// profile photo: the person sets or removes their own (the browser crops it to a small square JPEG first)
route('POST', '/api/profile/photo', ({ user, body }) => {
  const photo = String(body.photo || '');
  if (!photo) { delete D.photos[user.id]; audit(user.name, 'profile photo', 'removed'); return { photo: '' }; }
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) throw bad('That file is not a supported image (JPG, PNG or WebP).');
  if (photo.length > 300000) throw bad('That photo is too large. Please pick a smaller image.');
  D.photos[user.id] = photo; audit(user.name, 'profile photo', 'updated');
  return { photo };
});

// Home dashboard: every number shown on the page is computed here, in one call
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
// where the team's review window stands on the demo "today"
const windowState = w => config.today < w.start ? { state: 'upcoming', days: daysBetween(config.today, w.start) }
  : config.today > w.end ? { state: 'closed', days: daysBetween(w.end, config.today) } : { state: 'open', days: daysBetween(config.today, w.end) };
const fmtDay = iso => { const [, m, d] = iso.split('-').map(Number); return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`; };
const joinNames = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// one short line for the hero banner: scheduled count, then the most useful window fact
function homeSummary(teams, counts) {
  const bits = [`${plural(counts.scheduled, 'review')} scheduled`];
  const open = teams.filter(t => t.state === 'open'), up = teams.filter(t => t.state === 'upcoming').sort((a, b) => a.window.start.localeCompare(b.window.start));
  if (open.length) { const last = open.map(t => t.window.end).sort().pop(); bits.push(open.length === 1 ? `${open[0].team} window open until ${fmtDay(last)}` : `${open.length} windows open until ${fmtDay(last)}`); }
  else if (up.length) bits.push(`Next window: ${up[0].team}, ${fmtDay(up[0].window.start)}`);
  else if (teams.length) bits.push('All windows closed');
  if (counts.pending) bits.push(`${plural(counts.pending, 'review')} past due`);
  return bits.join(' · ');
}
function homeTips(teams, counts, emails) {
  const tips = [];
  const up = teams.filter(t => t.state === 'upcoming' && t.collected < t.total);
  if (up.length) { const first = up.map(t => t.window.start).sort()[0]; const [y, m, d] = first.split('-').map(Number); const by = new Date(y, m - 1, d - 3); tips.push(`Collect ${joinNames(up.map(t => t.team))} review dates before ${fmtDay(by.toISOString().slice(0, 10))} to avoid overdue reviews.`); }
  teams.filter(t => t.state === 'open' && t.notCompleted).forEach(t => tips.push(`${t.team} window closes on ${fmtDay(t.window.end)}: ${plural(t.notCompleted, 'review')} still to complete.`));
  teams.filter(t => t.state === 'closed' && t.pending).forEach(t => tips.push(`${plural(t.pending, 'review')} in ${t.team} ${t.pending === 1 ? 'is' : 'are'} past the due date. Open ${t.pending === 1 ? 'it' : 'them'} from the attention list.`));
  if (emails && counts.scheduled && counts.submitted === counts.scheduled && !emails.drafts && !emails.sent) tips.push('All reviews are submitted. Generate the manager emails from Manager Emails.');
  return tips.slice(0, 2);
}
const emailStates = (user, month) => {
  const mgrs = employees.filter(e => e.active && employees.some(x => x.managerId === e.id && x.active) && L.canView(user, e.id) && e.role !== 'admin');
  const allowed = mgrs.filter(m => user.role === 'admin' || user.role === 'director' || m.id === user.id || L.isAncestor(user.id, m.id));
  return allowed.map(m => ({ managerId: m.id, name: m.name, team: m.team, state: (emailsOutbox.find(x => x.managerId === m.id && x.month === month) || {}).state || 'not generated' }));
};

route('GET', '/api/home', ({ user, q }) => {
  const month = q.month || config.currentMonth;
  const mgr = user.role !== 'employee';
  const all = L.reportRows(user, month);
  const rows = q.team ? all.filter(r => r.team === q.team) : all;
  const teams = [...new Set(all.map(r => r.team))].map(t => {
    const tr = all.filter(r => r.team === t), w = D.windowFor(t, month);
    const days = config.windows[t] || { start: 25, end: 31 };
    return { team: t, ...L.counts(tr), collected: tr.filter(r => r.scheduled).length, total: tr.length, window: w, startDay: days.start, endDay: days.end, ...windowState(w) };
  });
  const counts = L.counts(rows);
  // review quality: facts the status cards do not show (timeliness, reschedules, flags, average rating)
  const rated = rows.filter(r => r.rating != null);
  const health = {
    held: rows.filter(r => r.actual).length, onTime: rows.filter(r => r.dueStatus === 'Within due date').length, late: rows.filter(r => r.dueStatus === 'After due date').length,
    rescheduled: rows.filter(r => r.reschedules).length, moves: rows.reduce((n, r) => n + r.reschedules, 0), flagged: rows.filter(r => r.flags.length).length,
    avgRating: rated.length ? Math.round(rated.reduce((n, r) => n + r.rating, 0) / rated.length * 100) / 100 : null, rated: rated.length,
  };
  const attention = rows.filter(r => r.status !== 'Completed and Submitted' || r.flags.length)
    .map(r => ({ empId: r.empId, name: r.name, team: r.team, scheduled: r.scheduled, issue: r.flags[0] || (r.status === 'Pending' ? 'Review pending' : r.status), more: Math.max(0, r.flags.length - 1), status: r.status, reschedules: r.reschedules }));
  const win = D.windowFor(user.team, month);
  const scoped = q.team ? teams.filter(t => t.team === q.team) : teams; // hero text and tips follow the team filter
  const out = { month, label: D.monthLabel(month), today: config.today, counts, health, teams, attention, canEditWindows: user.role === 'admin', window: { ...win, ...windowState(win) }, summary: homeSummary(scoped, counts), tips: [] };
  const openT = scoped.filter(t => t.state === 'open'), upT = scoped.filter(t => t.state === 'upcoming').sort((a, b) => a.window.start.localeCompare(b.window.start));
  out.nextWindow = openT.length ? { state: 'open', team: openT.length === 1 ? openT[0].team : `${openT.length} teams`, date: openT.map(t => t.window.end).sort().pop() }
    : upT.length ? { state: 'upcoming', team: upT[0].team, date: upT[0].window.start, days: upT[0].days } : { state: 'closed' };
  if (mgr) {
    const em = emailStates(user, month);
    const emails = { total: em.length, drafts: em.filter(x => x.state === 'draft').length, sent: em.filter(x => x.state === 'sent').length };
    out.quick = {
      datesCollected: all.filter(r => r.scheduled).length, datesTotal: all.length, emails, teamReviews: all.length,
      employees: user.role === 'admin' ? { active: employees.filter(e => e.role !== 'admin' && e.active).length, inactive: employees.filter(e => e.role !== 'admin' && !e.active).length } : null,
    };
    out.tips = homeTips(scoped, counts, emails);
    if (user.role === 'admin') out.orgStats = orgStats(); // All stats cards at the top of the admin dashboard
    // KRA change requests waiting for this person's approval (shown highlighted on their dashboard)
    out.kraRequests = Object.values(D.forms).filter(f => f.kraRequest && f.kraRequest.status === 'pending' && canDecideKra(user, f))
      .sort((a, b) => a.kraRequest.at.localeCompare(b.kraRequest.at))
      .map(f => ({ empId: f.empId, name: L.emp(f.empId).name, designation: L.emp(f.empId).designation, team: L.emp(f.empId).team, month: f.month, label: D.monthLabel(f.month), at: f.kraRequest.at, movedFrom: f.kraRequest.movedFrom || null }));
  }
  const ownForm = user.role !== 'admin' && user.managerId ? L.peek(user.id, month) : null;
  if (ownForm) {
    const v = L.validate(ownForm), di = L.dueInfo(ownForm);
    out.own = { status: L.reviewStatus(ownForm), scheduled: ownForm.scheduledDate, time: ownForm.scheduledTime || null, invite: inviteView(ownForm), zoom: ownForm.zoomLink || null, reviewDate: ownForm.reviewDate, due: di.due, submitted: ownForm.submitted, selfSubmitted: !!ownForm.selfSubmitted, selfSubmittedAt: ownForm.selfSubmittedAt || null, reschedules: L.rescheduleCount(ownForm),
      rating: ownForm.submitted ? L.monthlyRating(ownForm) : null, preview: !ownForm.submitted && L.ratingsComplete(ownForm) ? L.monthlyRating(ownForm) : null,
      manager: (L.emp(user.managerId) || {}).name || '',
      issues: L.employeeTodo(ownForm), // only what the person fills in; KRA set-up alerts go to their manager
      kraAccess: ownForm.kraRequest ? { status: ownForm.kraRequest.status, manager: (L.emp(user.managerId) || {}).name || '', decidedBy: ownForm.kraRequest.decidedBy || '' } : null };
  }
  return out;
});

// the bell: the signed-in person's notifications (an admin in "View as" sees that person's list but does not mark it read)
route('GET', '/api/notifications', ({ user }) => N.listFor(user.id));
route('POST', '/api/notifications/read', ({ user, realUser, body }) => {
  if (realUser.id === user.id) N.markRead(user.id, body.id || null);
  return N.listFor(user.id);
});

// Forms
route('GET', '/api/form',({ user, q }) => formPayload(user, mustForm(user, q.emp || user.id, q.month || config.currentMonth)));

route('PUT', '/api/form', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (f.locked) throw bad(LOCKED_MSG);
  const manage = L.canManage(user, f.empId), selfEdit = L.canSelfEdit(user, f.empId);
  if (!manage && !selfEdit) throw forbid();
  if (f.selfSubmitted && !manage) throw bad(SENT_MSG);
  // managers often give ratings and remarks verbally, so the team member may enter those too
  const mgrFields = manage || selfEdit;
  const kraR = L.KRAS.flatMap(([k]) => (body.kras?.[k]?.rows || []).flatMap(r => [r.self, r.mgr]));
  const qR = Object.values(body.qa || {}).filter(a => a && typeof a === 'object').flatMap(a => [a.self, a.mgr]);
  if (!kraR.every(okIn(L.KRA_SCALE))) throw bad('KRA ratings must be a percentage from 10% to 100% in steps of 10.');
  if (!qR.every(okIn(L.Q_SCALE))) throw bad('Questionnaire ratings must be a whole number from 0 to 5.');
  if (body.reviewDate !== undefined) f.reviewDate = body.reviewDate;
  // only the fields that are sent change: the employee and the manager can have the form open at the same time,
  // and one person's autosave must not wipe what the other entered meanwhile (the page sends just what was edited)
  const sent = (o, key) => o && Object.prototype.hasOwnProperty.call(o, key);
  for (const [k] of L.KRAS) (body.kras?.[k]?.rows || []).forEach(br => {
    const r = f.kras[k].rows.find(x => x.id === br.id); if (!r) return;
    if (selfEdit) { if (sent(br, 'self')) r.self = num(br.self); if (sent(br, 'selfRemark')) r.selfRemark = br.selfRemark ?? ''; }
    if (mgrFields) { if (sent(br, 'mgr')) r.mgr = num(br.mgr); if (sent(br, 'mgrRemark')) r.mgrRemark = br.mgrRemark ?? ''; }
  });
  for (const [id, a] of Object.entries(body.qa || {})) {
    if (typeof a === 'string') { if (selfEdit || manage) f.qa[id] = a; continue; }
    if (!a || typeof a !== 'object') continue;
    const cur = f.qa[id] || {};
    f.qa[id] = { self: selfEdit && sent(a, 'self') ? num(a.self) : cur.self, mgr: mgrFields && sent(a, 'mgr') ? num(a.mgr) : cur.mgr, remark: mgrFields && sent(a, 'remark') ? (a.remark ?? '') : cur.remark };
  }
  audit(user.name, 'save form', `${L.emp(f.empId).name} ${f.month}`);
  return formPayload(user, f);
});
const has = v => v;
const num = v => (v === '' || v === null || v === undefined) ? null : Number(v);
const okIn = scale => v => num(v) === null || scale.includes(num(v));

route('POST', '/api/form/submit', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (!L.canManage(user, f.empId)) throw new HttpError(403, 'Only managers and admins can submit the form. Employees can fill in their self-ratings and self-remarks.');
  if (f.locked) throw bad('This form is already submitted.');
  const errs = L.validate(f).filter(x => x.level === 'block').map(x => x.msg);
  if (!L.ratingsComplete(f)) errs.push('All self and manager ratings must be entered before the form is submitted.');
  if (errs.length) throw bad('Form cannot be submitted.', { errors: [...new Set(errs)] });
  f.submitted = true; f.locked = true;
  // who the reporting manager was when the review was done: later reporting changes do not rewrite history
  const rm = L.emp(L.emp(f.empId).managerId);
  f.reviewedBy = { managerId: rm ? rm.id : null, manager: rm ? rm.name : '', by: user.name, at: config.today };
  if (!f.selfSubmitted) { f.selfSubmitted = true; f.selfSubmittedAt = new Date().toISOString(); }
  f.qSnapshot = L.activeQuestions(f.month, null);
  audit(user.name, 'submit form', `${L.emp(f.empId).name} ${f.month}`);
  for (const k of ['sent', 'back', 'kra']) N.resolve(`${k}|${f.empId}|${f.month}`);
  const rating = L.monthlyRating(f), link = N.formLink(f.empId, f.month);
  N.push(f.empId, { type: 'review', link, text: `Your ${revOf(f)} was submitted by ${user.name}${rating != null ? `. Monthly rating: ${rating}%` : ''}. The form is now locked.` }, user);
  if (rm && rm.id !== user.id) N.push(rm.id, { type: 'review', link, text: `${user.name} submitted ${L.emp(f.empId).name}'s ${revOf(f)}.` }, user);
  return formPayload(user, f);
});

// step 1 of 2: the employee sends their part (self ratings, self remarks, answers) to the manager.
// Their part is then read-only for them; the manager can send it back, or adds their ratings and submits (step 2).
route('POST', '/api/form/self-submit', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (user.id !== f.empId) throw new HttpError(403, 'Only the employee can send their own form to the manager.');
  if (f.locked) throw bad(LOCKED_MSG);
  if (f.selfSubmitted) throw bad('You have already sent this form to your manager.');
  const errs = L.employeeTodo(f);
  if (errs.length) throw bad('Form cannot be submitted yet. Please fill in:', { errors: errs });
  f.selfSubmitted = true; f.selfSubmittedAt = new Date().toISOString();
  audit(user.name, 'send form to manager', `${L.emp(f.empId).name} ${f.month}`);
  N.resolve(`back|${f.empId}|${f.month}`);
  const m = mgrOf(f.empId);
  if (m) N.push(m.id, { type: 'review', action: true, key: `sent|${f.empId}|${f.month}`, link: N.formLink(f.empId, f.month), text: `${user.name} sent you their part of the ${revOf(f)}. Add your ratings and submit it.` }, user);
  return formPayload(user, f);
});
// the manager hands the form back so the employee can change their part again
route('POST', '/api/form/return', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (!L.canManage(user, f.empId)) throw forbid();
  if (f.locked) throw bad(LOCKED_MSG);
  if (!f.selfSubmitted) throw bad('The employee has not sent this form yet.');
  f.selfSubmitted = false; f.selfSubmittedAt = null;
  audit(user.name, 'send form back to employee', `${L.emp(f.empId).name} ${f.month}`);
  N.resolve(`sent|${f.empId}|${f.month}`);
  N.push(f.empId, { type: 'review', action: true, key: `back|${f.empId}|${f.month}`, link: N.formLink(f.empId, f.month), text: `${user.name} sent your ${revOf(f)} back to you for changes.` }, user);
  return formPayload(user, f);
});

// a submitted review is final: nobody can reopen or change it (admins included)
const LOCKED_MSG = 'This review is completed and submitted, so the form can no longer be changed.';
const SENT_MSG = 'You have sent this form to your manager, so your part can no longer be changed. Ask your manager to send it back if something needs fixing.';

// KRA settings: sub-KRA totals must equal the parent KRA weight
route('PUT', '/api/kras', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (f.locked) throw bad(LOCKED_MSG);
  if (!canEditKras(user, f)) throw new HttpError(403, 'You cannot change KRA settings or weightage for this person.');
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
  const usedGrant = kraGrant(user, f);
  apply(f);
  if (usedGrant) { audit(user.name, 'KRA change made after approval', `${L.emp(f.empId).name} ${f.month}`); delete f.kraRequest; const m = mgrOf(f.empId); if (m) N.push(m.id, { type: 'request', link: N.formLink(f.empId, f.month), text: `${user.name} changed their KRAs for ${D.monthLabel(f.month)} (after your approval).` }, user); }
  else if (user.id !== f.empId) N.push(f.empId, { type: 'change', key: `kras|${f.empId}|${f.month}`, link: N.formLink(f.empId, f.month), text: `${user.name} updated your KRAs for ${D.monthLabel(f.month)}.` }, user);
  // later unsubmitted months follow the new structure
  D.fyMonths().filter(m => m > f.month && m <= config.currentMonth).forEach(m => { const g = D.forms[`${f.empId}|${m}`]; if (g && !g.locked) apply(g); });
  L.emp(f.empId).newJoiner = L.emp(f.empId).newJoiner && L.KRAS.every(([k]) => f.kras[k].rows.length === 0);
  audit(user.name, 'KRA settings', `${L.emp(f.empId).name} from ${f.month}`);
  return formPayload(user, f);
});

// an employee asks their manager for permission to change KRAs; the manager approves or rejects
route('POST', '/api/kra-request', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (f.locked) throw bad(LOCKED_MSG);
  if (!canRequestKra(user, f)) throw new HttpError(403, 'You cannot request a KRA change right now.');
  const note = String(body.note || '').trim().slice(0, 500);
  f.kraRequest = { status: 'pending', note, by: user.name, at: new Date().toISOString() };
  audit(user.name, 'KRA change requested', `${L.emp(f.empId).name} ${f.month}`);
  const km = mgrOf(f.empId);
  if (km) N.push(km.id, { type: 'request', action: true, key: `kra|${f.empId}|${f.month}`, link: N.formLink(f.empId, f.month), text: `${user.name} asked to change their KRAs for ${D.monthLabel(f.month)}${note ? `: "${note.slice(0, 120)}"` : '.'}` }, user);
  return formPayload(user, f);
});
route('POST', '/api/kra-request/decide', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (!canDecideKra(user, f)) throw new HttpError(403, 'There is no pending KRA change request you can decide.');
  const approve = !!body.approve;
  Object.assign(f.kraRequest, { status: approve ? 'approved' : 'rejected', decidedBy: user.name, decidedAt: new Date().toISOString(), reply: String(body.reply || '').trim().slice(0, 500) });
  audit(user.name, approve ? 'KRA change approved' : 'KRA change rejected', `${L.emp(f.empId).name} ${f.month}`);
  N.resolve(`kra|${f.empId}|${f.month}`);
  N.push(f.empId, { type: 'request', link: N.formLink(f.empId, f.month), text: approve ? `${user.name} approved your KRA change request for ${D.monthLabel(f.month)}. You can change your KRAs once.` : `${user.name} rejected your KRA change request for ${D.monthLabel(f.month)}${f.kraRequest.reply ? `: "${f.kraRequest.reply.slice(0, 120)}"` : '.'}` }, user);
  return formPayload(user, f);
});

// copy the KRA structure (KPIs, targets, weightages) from the previous month; ratings and remarks start empty
route('POST', '/api/form/copy-kras', ({ user, body }) => {
  const f = mustForm(user, body.empId, body.month);
  if (!canCopyKras(user, f)) throw forbid();
  const months = D.fyMonths(), i = months.indexOf(f.month);
  const src = i > 0 ? L.getForm(f.empId, months[i - 1]) : null;
  if (!src) throw bad('There is no previous month to copy KRAs from.');
  f.kras = JSON.parse(JSON.stringify(src.kras));
  for (const [k] of L.KRAS) f.kras[k].rows.forEach(r => { r.self = null; r.selfRemark = ''; r.mgr = null; r.mgrRemark = ''; });
  audit(user.name, 'KRAs copied from last month', `${L.emp(f.empId).name} ${f.month}`);
  if (user.id !== f.empId) N.push(f.empId, { type: 'change', key: `kras|${f.empId}|${f.month}`, link: N.formLink(f.empId, f.month), text: `${user.name} set your ${D.monthLabel(f.month)} KRAs (copied from last month).` }, user);
  return formPayload(user, f);
});

// ---------- Appraisal form (annual, 6 steps) ----------
const blankAppraisal = () => ({ recap: [{ expectation: '', achievements: '', improvement: '' }], kraProgress: [{ kra: '', progress: '' }], strengths: '', improvements: '', operational: '', process: '', people: '', submittedAt: null });
const appraisalPayload = (user, empId) => {
  const e = L.emp(empId), m = e.managerId ? L.emp(e.managerId) : null, a = appraisals[empId] || blankAppraisal();
  return { employee: { id: e.id, name: e.name, designation: e.designation, department: e.team, reviewer: m ? m.name : 'Not assigned' }, fy: '2026-27', form: a,
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
route('GET', '/api/scheduling', ({ user, realUser, q }) => {
  const month = q.month || config.currentMonth;
  // only people with a reporting manager have a review (same rule as ensureMonthForms); top-level directors are not reviewed
  L.visibleEmployees(user).filter(e => e.managerId && (e.id !== user.id || user.role === 'employee')).forEach(e => L.getForm(e.id, month));
  // admins and directors see only the people who report to them directly (the reviews they schedule), not the whole company
  const all = L.reportRows(user, month, { team: q.team }), directOnly = ['admin', 'director'].includes(user.role);
  const rows = directOnly ? all.filter(r => r.managerId === user.id) : all;
  // admins keep every team's window here, because they set the windows
  const teams = [...new Set((user.role === 'admin' ? all : rows).map(r => r.team))];
  const windows = teams.map(t => {
    const w = D.windowFor(t, month), tr = (user.role === 'admin' ? all : rows).filter(r => r.team === t);
    const [y, m, d] = w.start.split('-').map(Number); const c = new Date(y, m - 1, d - 3);
    const days = config.windows[t] || { start: 25, end: 31 };
    return { team: t, start: w.start, end: w.end, startDay: days.start, endDay: days.end, collectedOn: c.toISOString().slice(0, 10), collected: tr.filter(r => r.scheduled).length, total: tr.length };
  });
  // admins (also while viewing as someone) only watch the schedule: the reporting managers book the reviews
  const adminView = realUser.role === 'admin';
  return { windows, canEditWindows: user.role === 'admin', adminView, directOnly, calendar: calendarState(realUser), rows: rows.map(r => {
    const f = L.peek(r.empId, month), e = L.emp(r.empId);
    return { ...r, history: f.reschedules, time: f.scheduledTime || null, invite: inviteView(f), zoom: f.zoomLink || null, hasEmail: A.isOrgEmail(e.email), canManage: !adminView && L.canManage(user, r.empId) };
  }) };
});

// ---------- calendar invites ----------
const DURATIONS = [15, 30, 45, 60, 90];
// the Zoom link the manager pasted: optional, and only real https zoom.us links, because employees get it as a button
function zoomOf(body, f) {
  if (body.zoom === undefined) return f.zoomLink || '';
  const s = String(body.zoom).trim(); if (!s) return '';
  let u = null; try { u = new URL(s); } catch {}
  if (!u || u.protocol !== 'https:' || !/(^|\.)zoom\.us$/i.test(u.hostname)) throw bad('Enter a valid Zoom link, for example https://zoom.us/j/123456789.');
  return u.href;
}
// the review slot from a request: date (required), time (default 11:00), length in minutes (default 30) and Zoom link
function slotOf(body, f) {
  const date = String(body.date || ''), time = String(body.time || f.scheduledTime || '11:00'), duration = +(body.duration || (f.invite && f.invite.duration) || 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date))) throw bad('Select a review date.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw bad('Select a valid time.');
  if (!DURATIONS.includes(duration)) throw bad('Select how long the review takes.');
  return { date, time, duration, tz: config.timeZone || 'Asia/Kolkata', zoom: zoomOf(body, f) };
}
const inviteView = f => f.invite ? { link: f.invite.link, owner: f.invite.owner, guests: f.invite.guests, date: f.invite.date, time: f.invite.time, duration: f.invite.duration, sentAt: f.invite.sentAt } : null;
// Google errors are shown to the user as they are (expired access, calendar not connected, ...)
const viaGoogle = async fn => { try { return await fn(); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, e.message); } };
// the text of the calendar event, including the manager's Zoom link
function reviewNote(f, body, senderName, zoom) {
  const origin = A.okOrigin(body.origin) || A.ORIGINS.find(o => !o.includes('localhost')) || A.ORIGINS[0];
  return `Monthly performance review for ${D.monthLabel(f.month)}.\n\n${zoom ? `Join the Zoom meeting: ${zoom}\n\n` : ''}Review form: ${origin}/#/form/${f.empId}/${f.month}\n\nPlease fill in your self ratings and remarks before the meeting.\n\nSent from Verve PMS by ${senderName}.`;
}
// the invite comes from the signed-in person's own calendar; guests are the employee and, if someone else schedules, their manager
async function sendInvite(sender, f, slot, body) {
  const e = L.emp(f.empId), mgr = e.managerId ? L.emp(e.managerId) : null;
  if (!A.google) throw bad('Calendar invites need Google sign-in to be set up on the server.');
  if (!A.isOrgEmail(e.email)) throw bad(`${e.name} has no @${A.ORG_DOMAIN} email in PMS. An admin can add it on the Employees page.`);
  if (!C.linked(sender.id)) throw bad('Connect your Google Calendar first (top of this page).');
  const guests = [e.email.toLowerCase()];
  if (mgr && mgr.id !== sender.id && A.isOrgEmail(mgr.email)) guests.push(mgr.email.toLowerCase());
  const ev = await viaGoogle(() => C.create(sender.id, { ...slot, guests,
    summary: `PMS review: ${e.name} (${D.monthLabel(f.month)})`,
    description: reviewNote(f, body, sender.name, slot.zoom) }));
  f.invite = { eventId: ev.id, ownerId: sender.id, owner: sender.name, link: ev.link, guests, date: slot.date, time: slot.time, duration: slot.duration, sentAt: new Date().toISOString() };
}
// tell the employee (and their reporting manager when someone else did it) about the review meeting
function meetingNote(user, f, text) {
  const e = L.emp(f.empId), m = mgrOf(f.empId), link = N.formLink(f.empId, f.month), key = `meetset|${f.empId}|${f.month}`;
  N.drop(`meet|${f.empId}|`); // a "meeting tomorrow" reminder for the old date no longer applies
  N.push(e.id, { type: 'date', key, link, text: text('Your') }, user);
  if (m && m.id !== user.id) N.push(m.id, { type: 'date', key, link, text: text(`${e.name}'s`) }, user);
}
const meetOf = f => `${D.monthLabel(f.month).split(' ')[0]} review meeting`;
const slotText = f => `${f.scheduledDate}${f.scheduledTime ? ' at ' + f.scheduledTime : ''}`;
const manageForm = (user, realUser, body) => {
  if (realUser.role === 'admin') throw bad('Admins do not schedule reviews. The reporting manager schedules them.');
  const f = mustForm(user, body.empId, body.month); if (!L.canManage(user, f.empId)) throw forbid(); return f;
};

route('POST', '/api/scheduling/schedule', async ({ user, realUser, body }) => {
  const f = manageForm(user, realUser, body);
  if (f.scheduledDate) throw bad('This review is already scheduled. Use Reschedule to change the date.');
  const slot = slotOf(body, f);
  if (body.invite) await sendInvite(realUser, f, slot, body);
  f.scheduledDate = slot.date; f.scheduledTime = slot.time; f.zoomLink = slot.zoom;
  audit(user.name, 'schedule', `${L.emp(f.empId).name} ${slot.date} ${slot.time}${f.invite ? ' (calendar invite sent)' : ''}`);
  meetingNote(user, f, who => `${who} ${meetOf(f)} is set for ${slotText(f)} by ${user.name}${f.invite ? ' (Google Calendar invite sent)' : ''}.`);
  return { ok: true, invite: inviteView(f) };
});
route('POST', '/api/scheduling/reschedule', async ({ user, realUser, body }) => {
  const f = manageForm(user, realUser, body);
  const slot = slotOf(body, f);
  if (slot.date === f.scheduledDate && slot.time === f.scheduledTime && (!f.invite || slot.duration === f.invite.duration) && slot.zoom === (f.zoomLink || '')) throw bad('Pick a different date or time, or change the Zoom link.');
  // an existing invite moves with the review; Google tells every guest. It lives on the calendar of whoever sent it.
  if (f.invite) {
    if (!C.linked(f.invite.ownerId)) throw bad(`The invite was sent from ${f.invite.owner}'s Google Calendar, which is no longer connected. ${f.invite.owner} needs to connect it again to move the invite.`);
    await viaGoogle(() => C.move(f.invite.ownerId, f.invite.eventId, { ...slot, description: reviewNote(f, body, f.invite.owner, slot.zoom) }));
    Object.assign(f.invite, { date: slot.date, time: slot.time, duration: slot.duration });
  } else if (body.invite) await sendInvite(realUser, f, slot, body);
  if (slot.date !== f.scheduledDate) f.reschedules.push({ from: f.scheduledDate, to: slot.date, by: user.name, at: config.today });
  f.scheduledDate = slot.date; f.scheduledTime = slot.time; f.zoomLink = slot.zoom;
  audit(user.name, 'reschedule', `${L.emp(f.empId).name} to ${slot.date} ${slot.time}${f.invite ? ' (calendar invite updated)' : ''}`);
  meetingNote(user, f, who => `${who} ${meetOf(f)} was moved to ${slotText(f)} by ${user.name}.`);
  return { ok: true, invite: inviteView(f) };
});
// send an invite for a review that already has a date
route('POST', '/api/scheduling/invite', async ({ user, realUser, body }) => {
  const f = manageForm(user, realUser, body);
  if (!f.scheduledDate) throw bad('Schedule the review first.');
  if (f.invite) throw bad('An invite was already sent. Use Reschedule to change it.');
  const slot = slotOf({ ...body, date: f.scheduledDate }, f);
  await sendInvite(realUser, f, slot, body);
  f.scheduledTime = slot.time; f.zoomLink = slot.zoom;
  audit(user.name, 'calendar invite sent', `${L.emp(f.empId).name} ${slot.date} ${slot.time}`);
  return { ok: true, invite: inviteView(f) };
});
route('POST', '/api/scheduling/cancel-invite', async ({ user, realUser, body }) => {
  const f = manageForm(user, realUser, body);
  if (!f.invite) throw bad('There is no invite to cancel.');
  if (!C.linked(f.invite.ownerId)) throw bad(`The invite is on ${f.invite.owner}'s Google Calendar, which is no longer connected. ${f.invite.owner} can delete it in Google Calendar.`);
  await viaGoogle(() => C.cancel(f.invite.ownerId, f.invite.eventId));
  delete f.invite;
  audit(user.name, 'calendar invite cancelled', `${L.emp(f.empId).name} ${f.month}`);
  meetingNote(user, f, who => `The Google Calendar invite for ${who === 'Your' ? 'your' : who} ${meetOf(f)} was cancelled by ${user.name}. The date (${slotText(f)}) stays in PMS.`);
  return { ok: true };
});
route('POST', '/api/calendar/disconnect', async ({ realUser }) => {
  await C.unlink(realUser.id);
  audit(realUser.name, 'Google Calendar disconnected', '');
  return calendarState(realUser);
});

// Review status report
route('GET', '/api/report', ({ user, q }) => {
  const month = q.month || config.currentMonth;
  const view = q.view === 'team' || user.role === 'manager' || user.role === 'teamlead' ? q.view || 'team' : q.view || 'org';
  const rows = L.reportRows(user, month, { team: q.team, manager: q.manager, status: q.status });
  const all = L.reportRows(user, month);
  const managers = [...new Set(all.map(r => r.managerId))].map(id => L.emp(id)).filter(Boolean).map(m => ({ id: m.id, name: m.name, team: m.team }));
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
  const head = ['Manager', 'Team', 'Employee', 'Scheduled', 'Due', 'Actual', 'Due status', 'Reschedules', 'Status', 'Monthly rating (%)', 'Flags'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return { csv: [head, ...rows.map(r => [r.manager, r.team, r.name, r.scheduled, r.due, r.actual, r.dueStatus, r.reschedules, r.status, r.rating, r.flags.join('; ')])].map(r => r.map(esc).join(',')).join('\n') };
});

// Emails (not sent automatically: generate drafts, then send)
// manager emails, the MIS report and the KPI report are for admins only
route('GET', '/api/emails', ({ user, q }) => { adminOnly(user); return emailStates(user, q.month || config.currentMonth); });
route('GET', '/api/email', ({ user, q }) => {
  adminOnly(user);
  const id = mustEmp(q.manager).id;
  if (user.role !== 'admin' && user.role !== 'director' && id !== user.id && !L.isAncestor(user.id, id)) throw forbid();
  const month = q.month || config.currentMonth;
  const e = emailsOutbox.find(x => x.managerId === id && x.month === month);
  return { ...L.buildEmail(id, month), state: e ? e.state : 'not generated', sentAt: e && e.sentAt };
});
route('POST', '/api/emails/generate', ({ user, body }) => {
  adminOnly(user);
  const month = body.month || config.currentMonth; let n = 0;
  employees.filter(e => e.active && employees.some(x => x.managerId === e.id && x.active) && e.role !== 'admin').forEach(m => {
    if (user.role !== 'admin' && user.role !== 'director' && m.id !== user.id && !L.isAncestor(user.id, m.id)) return;
    if (!emailsOutbox.find(x => x.managerId === m.id && x.month === month)) { emailsOutbox.push({ managerId: m.id, month, state: 'draft' }); n++; }
  });
  audit(user.name, 'generate emails', `${n} drafts for ${month}`);
  return { created: n };
});
route('POST', '/api/emails/send', ({ user, body }) => {
  adminOnly(user);
  const mgr = mustEmp(body.managerId);
  if (user.role !== 'admin' && user.role !== 'director' && mgr.id !== user.id && !L.isAncestor(user.id, mgr.id)) throw forbid();
  const month = body.month || config.currentMonth;
  let e = emailsOutbox.find(x => x.managerId === +body.managerId && x.month === month);
  if (!e) emailsOutbox.push(e = { managerId: +body.managerId, month });
  e.state = 'sent'; e.sentAt = new Date().toISOString();
  audit(user.name, 'email sent', `${mgr.name} ${month} (local demo: logged, no SMTP)`);
  return { ok: true, sentAt: e.sentAt };
});

// Annual review + one page summary
// the One Pager Document is for reviewers only: employees do not see it
const noEmployees = u => { if (u.role === 'employee') throw forbid(); };
route('GET', '/api/annual', ({ user, q }) => {
  noEmployees(user);
  const e = mustEmp(q.emp || user.id), empId = e.id;
  if (!L.canView(user, empId)) throw forbid();
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
  noEmployees(user);
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

// organisation counts (admin): All stats cards on the dashboard and the tiles on the Employees page
function orgStats() {
  const rows = employees.filter(e => e.role !== 'admin'), active = rows.filter(e => e.active), role = r => active.filter(e => e.role === r).length;
  return { members: active.length, directors: role('director'), managers: role('manager') + role('teamlead'), executives: role('employee'),
    inactive: rows.length - active.length, questions: L.activeQuestions(config.currentMonth).length };
}

// Employees (admin)
const adminOnly = u => { if (u.role !== 'admin') throw forbid(); };
route('GET', '/api/employees', ({ user, q }) => {
  adminOnly(user);
  const month = config.currentMonth;
  const rows = employees.filter(e => e.role !== 'admin').map(e => { const f = L.peek(e.id, month); const { notices, ...rest } = e;
    return { ...rest, manager: e.managerId ? L.emp(e.managerId).name : '', reviewStatus: f ? L.reviewStatus(f) : 'n/a',
      pending: e.pendingManager ? { to: nameOf(e.pendingManager.id), from: D.monthLabel(e.pendingManager.from) } : null }; });
  const active = rows.filter(e => e.active);
  return { active, inactive: rows.filter(e => !e.active), stats: orgStats(),
    teams: [...new Set([...Object.keys(config.windows), ...rows.map(e => e.team)])].filter(Boolean).sort(),
    designations: [...new Set(rows.map(e => e.designation))].filter(Boolean).sort(),
    // anyone active can become a reporting manager (their role then changes to Manager by itself); people who already lead come first
    managers: employees.filter(e => e.active && e.role !== 'admin').sort((a, b) => (a.role === 'employee') - (b.role === 'employee') || a.name.localeCompare(b.name))
      .map(e => ({ id: e.id, name: e.name, lead: e.role !== 'employee', team: e.team, top: !e.managerId })) };
});
route('GET', '/api/employee-forms', ({ user, q }) => {
  adminOnly(user);
  const e = mustEmp(q.emp), id = e.id;
  // admin can open any month of the year; the form is created on first open. Only months before joining have none.
  const joined = (e.joined || '').slice(0, 7);
  const rows = D.fyMonths().map(m => { const f = L.peek(id, m); return { month: m, label: D.monthLabel(m), reviewDate: f ? f.reviewDate : '', status: f ? L.reviewStatus(f) : 'Not started', rating: f && f.submitted ? L.monthlyRating(f) : null, open: !!f || m >= joined, beforeJoining: !f && m < joined }; });
  return { employee: { ...e, manager: e.managerId ? L.emp(e.managerId).name : '' }, rows, annual: annualForms[`${id}|FY2026`] ? 'Submitted' : 'Opens in March' };
});
route('POST', '/api/employees', ({ user, body }) => {
  adminOnly(user);
  const need = ['name', 'code', 'email', 'designation', 'team', 'managerId', 'joined', 'window'];
  const miss = need.filter(k => !body[k]);
  if (miss.length) throw bad('Mandatory fields missing: ' + miss.join(', '), { errors: ['Mandatory fields missing: ' + miss.join(', ')] });
  if (employees.some(e => e.code === body.code)) throw bad('Employee code already exists.');
  const email = checkEmail(body.email, null, true);
  const m = checkManager(null, body.managerId);
  const id = Math.max(...employees.map(e => e.id)) + 1;
  // the role follows the reporting line (a new member has no reports yet, so employee or team lead)
  const e = { id, code: body.code, name: body.name, email, designation: body.designation, team: body.team, managerId: m.id, role: 'employee', level: null, joined: body.joined, active: true, newJoiner: true, codeSet: true, joinedSet: true };
  e.role = L.deriveRole(e);
  employees.push(e);
  audit(user.name, 'add member', `${body.name} (${body.code}), reports to ${m.name}`);
  notify(m.id, `${body.name} joined and reports to you. Set their KRAs once they are ready (new joiners start with the questionnaire only).`);
  syncRoles(user.name);
  return { id };
});
// work emails are how people sign in, so they must be on the org domain and belong to one person only
function checkEmail(raw, selfId, required) {
  const email = String(raw || '').trim().toLowerCase();
  if (!email) { if (required) throw bad('Work email is required.'); return ''; }
  if (!A.isOrgEmail(email)) throw bad(`Work email must end with @${A.ORG_DOMAIN}.`, { errors: [`Work email must end with @${A.ORG_DOMAIN}.`] });
  const other = findByEmail(email);
  if (other && other.id !== selfId) throw bad(`${email} already belongs to ${other.name}.`, { errors: [`${email} already belongs to ${other.name}.`] });
  return email;
}
const ROLES = ['employee', 'teamlead', 'manager', 'director', 'admin'];

// ---------- reporting changes ----------
// Every change of reporting manager goes through here (Employees table and Edit, Add member, Move to inactive):
// check the new manager, decide who finishes this month's review, clean up what belonged to the old manager,
// re-derive roles and leave a note on the dashboards of the people involved.
const nextMonthOf = m => { let [y, mo] = m.split('-').map(Number); mo++; if (mo > 12) { mo = 1; y++; } return `${y}-${D.pad(mo)}`; };
const nameOf = id => (L.emp(id) || {}).name || 'no one';
// a dashboard note for one person (newest first, the last 20 kept)
const notify = (id, text, link) => N.push(id, { type: 'change', text, ...(link && { link }) });
// the dashboard notes of an earlier version become notifications (once, on boot)
function moveOldNotices() {
  for (const e of employees) if (e.notices) { e.notices.slice().reverse().forEach(n => N.push(e.id, { type: 'change', text: n.text })); delete e.notices; }
}
// the new reporting manager must be a real, active person outside the employee's own team
function checkManager(e, managerId) {
  if (!managerId) return null;
  const m = L.emp(+managerId);
  const fail = msg => bad(msg, { errors: [msg] });
  if (!m) throw fail('Unknown reporting manager.');
  if (e && (m.id === e.id || L.subordinates(e.id).some(x => x.id === m.id))) throw fail('That reporting manager would create a loop.');
  if (!m.active) throw fail(`${m.name} is inactive. Choose an active person as the reporting manager.`);
  if (m.role === 'admin') throw fail('The admin account cannot be a reporting manager. Choose a person from the list.');
  return m;
}
// what has already happened in this month's (unsubmitted) review; empty = nothing started
function reviewProgress(f) {
  if (!f || f.submitted) return [];
  return [f.scheduledDate && `review meeting set for ${f.scheduledDate}`, f.selfSubmitted && 'employee has sent their part',
    L.managerActivity(f) && 'manager ratings entered', f.kraRequest && f.kraRequest.status === 'pending' && 'KRA change request waiting'].filter(Boolean);
}
// Plan a change without touching anything. Returns { ask } when the admin has to decide first:
//   top:    no manager means a top-level director, who is not reviewed (body.makeTop confirms)
//   choice: this month's review has started (body.thisMonth = 'keep' | 'move')
function planMove(e, newId, body = {}) {
  newId = newId ? +newId : null;
  if (newId === (e.managerId || null)) return { same: true };
  const m = checkManager(e, newId);
  if (!m && !body.makeTop) return { ask: { needsTop: true, name: e.name } };
  const f = L.peek(e.id, config.currentMonth), started = reviewProgress(f);
  const choice = started.length ? body.thisMonth : 'move';
  if (!['keep', 'move'].includes(choice)) return { ask: { needsChoice: true, name: e.name, from: nameOf(e.managerId), to: m ? m.name : 'no manager', month: D.monthLabel(config.currentMonth), next: D.monthLabel(nextMonthOf(config.currentMonth)), started } };
  return { newId, choice, f };
}
// The team follows the reporting manager: someone who gets a new manager joins that manager's team. A top-level director
// leads several departments, so reporting to one keeps the person's own team; no manager at all = the Directors team.
function teamOfManager(e, managerId) {
  const m = managerId ? L.emp(managerId) : null;
  if (!m) return 'Directors';
  return m.managerId ? m.team : e.team;
}
// move a person to another team; the people under them who were in their old team come along. Returns one line per move.
function moveTeam(who, e, team, why) {
  const from = e.team; if (!team || team === from) return [];
  const moved = [e, ...L.subordinates(e.id).filter(x => x.active && x.team === from)];
  for (const x of moved) x.team = team;
  audit(who, 'team changed', `${moved.map(x => x.name).join(', ')}: ${from} → ${team} (${why})`);
  return [`${e.name} is now in the ${team} team (was ${from})${moved.length > 1 ? `, with ${moved.length - 1} ${moved.length === 2 ? 'person' : 'people'} under them: ${moved.slice(1).map(x => x.name).join(', ')}` : ''}.`];
}
// Carry out a plan. "keep" = the current manager finishes this month's review; the change applies from next month.
async function applyMove(user, e, plan) {
  const warnings = [];
  if (plan.same) { if (e.pendingManager) { delete e.pendingManager; audit(user.name, 'reporting change cancelled', e.name); } return warnings; }
  const oldId = e.managerId || null, to = nameOf(plan.newId), from = nameOf(oldId);
  if (plan.choice === 'keep') {
    const next = nextMonthOf(config.currentMonth), when = D.monthLabel(next);
    e.pendingManager = { id: plan.newId, from: next, by: user.name, at: config.today, ...(plan.keepTeam ? { keepTeam: true } : {}) };
    audit(user.name, 'reporting manager change planned', `${e.name}: ${from} → ${to} from ${when} (${from} finishes ${D.monthLabel(config.currentMonth)})`);
    notify(e.id, `From ${when} you report to ${to}. ${from} finishes your ${D.monthLabel(config.currentMonth)} review.`);
    if (oldId) notify(oldId, `${e.name} moves to ${to} from ${when}. Please finish their ${D.monthLabel(config.currentMonth)} review.`);
    if (plan.newId) notify(plan.newId, `${e.name} will report to you from ${when}.`);
    return warnings;
  }
  // move now: the new manager takes over this month's open review
  const f = plan.f && !plan.f.submitted ? plan.f : null;
  if (f && f.invite) {
    const inv = f.invite;
    if (C.linked(inv.ownerId)) { try { await C.cancel(inv.ownerId, inv.eventId); } catch (er) { warnings.push(`The calendar invite from ${inv.owner} could not be cancelled (${er.message}). ${inv.owner} can delete it in Google Calendar.`); } }
    else { warnings.push(`The calendar invite is on ${inv.owner}'s Google Calendar, which is not connected. ${inv.owner} can delete it in Google Calendar.`); N.push(inv.ownerId, { type: 'admin', text: `${e.name} moved to another manager, but the review invite you sent could not be cancelled because your Google Calendar is not connected. Please delete it in Google Calendar.` }); }
    delete f.invite;
  }
  if (f && f.scheduledDate) {
    warnings.push(`The review meeting ${from} had set (${f.scheduledDate}) was cleared; ${to} schedules it again.`);
    f.scheduledDate = null; f.scheduledTime = null; f.zoomLink = '';
  }
  if (f && f.kraRequest && f.kraRequest.status === 'pending') f.kraRequest.movedFrom = from; // shown to the new manager
  e.managerId = plan.newId; e.managerSetInApp = true; delete e.pendingManager;
  audit(user.name, 'reporting manager changed', `${e.name}: ${from} → ${to}${plan.newId ? '' : ' (top-level director, not reviewed)'}`);
  if (!plan.keepTeam) (plan.notes ||= []).push(...moveTeam(user.name, e, teamOfManager(e, plan.newId), `new reporting manager ${to}`));
  const month = D.monthLabel(config.currentMonth);
  notify(e.id, plan.newId ? `You now report to ${to} (was ${from}). ${to} does your ${month} review.` : `You are now a top-level director (no reporting manager), so you have no monthly review.`);
  if (oldId) notify(oldId, `${e.name} no longer reports to you. ${plan.newId ? `${to} does their ${month} review.` : ''}`.trim());
  if (plan.newId) notify(plan.newId, `${e.name} now reports to you. Their ${month} review is yours${f && f.selfSubmitted ? ': they have already sent you their part' : ''}.`);
  return warnings;
}
// roles follow the reporting line; log who changed (e.g. an employee who got their first report becomes a manager)
function syncRoles(who) {
  for (const c of L.refreshRoles()) {
    audit(who, 'role updated', `${c.e.name}: ${ROLE_NAME[c.from] || c.from} → ${ROLE_NAME[c.to]} (from the reporting line)`);
    if (c.to === 'manager' && c.from === 'employee') notify(c.e.id, 'You now have people reporting to you. My team, Scheduling and the team reports are in your menu.');
  }
}
const ROLE_NAME = { employee: 'Employee', teamlead: 'Team lead', manager: 'Manager', director: 'Director', admin: 'Admin' };
// changes planned with "keep" take effect once their month is the review month
function applyPendingMoves() {
  for (const e of employees) {
    const p = e.pendingManager; if (!p || p.from > config.currentMonth) continue;
    delete e.pendingManager;
    const m = p.id ? L.emp(p.id) : null;
    if (p.id && (!m || !m.active || m.role === 'admin' || L.subordinates(e.id).some(x => x.id === m.id))) { audit('System', 'planned reporting change dropped', `${e.name}: ${nameOf(p.id)} is no longer a valid manager`); continue; }
    const from = nameOf(e.managerId); e.managerId = p.id; e.managerSetInApp = true;
    audit('System', 'reporting manager changed', `${e.name}: ${from} → ${nameOf(p.id)} (planned by ${p.by})`);
    if (!p.keepTeam) moveTeam('System', e, teamOfManager(e, p.id), `new reporting manager ${nameOf(p.id)}`);
  }
  syncRoles('System');
}
route('PUT', '/api/employees', async ({ user, body }) => {
  adminOnly(user);
  const e = mustEmp(body.id);
  const email = checkEmail(body.email, e.id, false);
  if (!String(body.name || '').trim() || !String(body.designation || '').trim()) throw bad('Name and designation are required.', { errors: ['Name and designation are required.'] });
  if (body.role && !ROLES.includes(body.role)) throw bad('Unknown access role.');
  if (e.id === user.id && body.role && body.role !== 'admin') throw bad('You cannot remove your own admin access.', { errors: ['You cannot remove your own admin access.'] });
  // the reporting manager goes through planMove: it may need the admin's answer first (nothing is saved until then)
  const plan = body.managerId !== undefined ? planMove(e, body.managerId || null, body) : null;
  if (plan && plan.ask) return plan.ask;
  // roles follow the reporting line; only Admin is chosen by hand
  const role = body.role === 'admin' ? 'admin' : e.role === 'admin' && body.role ? L.deriveRole(e) : e.role;
  const next = { name: String(body.name).trim(), email, designation: String(body.designation).trim(), team: body.team || e.team, role };
  // employee code and date of joining (optional here: the quick edits in the table do not send them)
  const code = String(body.code ?? '').trim();
  if (code) {
    if (employees.some(x => x.id !== e.id && x.code === code)) throw bad('Employee code already exists.', { errors: ['Employee code already exists.'] });
    next.code = code; e.codeSet = true;
  }
  if (body.joined !== undefined && body.joined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.joined)) throw bad('Date of joining is not a valid date.', { errors: ['Date of joining is not a valid date.'] });
    if (body.joined !== e.joined || !e.joinedSet) { next.joined = body.joined; e.joinedSet = true; }
  }
  // the audit line says what changed, e.g. "team Finance → Operations"
  const show = (k, v) => k === 'managerId' ? (v ? (L.emp(v) || {}).name || v : 'none') : (v || 'none');
  const LBL = { name: 'name', email: 'email', designation: 'designation', team: 'team', role: 'role', managerId: 'manager', code: 'code', joined: 'joining date' };
  const changes = Object.keys(next).filter(k => (next[k] ?? '') !== (e[k] ?? '')).map(k => `${LBL[k]} ${show(k, e[k])} → ${show(k, next[k])}`);
  const teamBefore = e.team;
  // the admin picked a team by hand in this save: that choice wins over the new manager's team
  if (plan && !plan.same && next.team !== teamBefore) plan.keepTeam = true;
  const notes = [];
  if (next.team !== teamBefore) { notes.push(...moveTeam(user.name, e, next.team, 'changed by hand')); const i = changes.findIndex(c => c.startsWith('team ')); if (i >= 0) changes.splice(i, 1); }
  Object.assign(e, next);
  if (changes.length) audit(user.name, 'edit member', `${e.name} (${e.code}): ${changes.join(', ')}`);
  const warnings = plan ? await applyMove(user, e, plan) : [];
  if (plan && plan.notes) notes.push(...plan.notes);
  syncRoles(user.name);
  // a new department can have another review window: say so when the meeting already set falls outside it
  const f = L.peek(e.id, config.currentMonth);
  if (e.team !== teamBefore && f && !f.submitted && f.scheduledDate) {
    const w = D.windowFor(e.team, config.currentMonth);
    if (f.scheduledDate < w.start || f.scheduledDate > w.end) warnings.push(`The review meeting (${f.scheduledDate}) is outside the ${e.team} review window (${w.start} to ${w.end}). Reschedule it if needed.`);
  }
  return { ok: true, warnings, notes, team: e.team, pending: e.pendingManager ? { to: nameOf(e.pendingManager.id), from: D.monthLabel(e.pendingManager.from) } : null };
});
route('POST', '/api/employees/inactive', async ({ user, body }) => {
  adminOnly(user);
  const e = mustEmp(body.id);
  body.date = body.date || config.today; body.reason = body.reason || 'Moved to inactive'; // the screen only asks for a confirmation
  // people who report to this person must be moved under someone else first
  const reports = employees.filter(x => x.active && x.managerId === e.id);
  const team = new Set(L.subordinates(e.id).map(x => x.id));
  const candidates = employees.filter(c => c.active && c.id !== e.id && c.role !== 'admin' && !team.has(c.id) && !(c.pendingManager && c.pendingManager.id === e.id))
    .sort((a, b) => (a.role === 'employee') - (b.role === 'employee') || a.name.localeCompare(b.name))
    .map(c => ({ id: c.id, name: c.name, designation: c.designation }));
  if (body.check) return { reports: reports.map(r => ({ id: r.id, name: r.name, designation: r.designation })), candidates, suggested: candidates.some(c => c.id === e.managerId) ? e.managerId : null };
  let newManager = null;
  if (reports.length) {
    if (!body.newManagerId) throw bad(`${e.name} has ${reports.length} ${reports.length === 1 ? 'person' : 'people'} reporting to them. Choose who they should report to.`);
    newManager = candidates.find(c => c.id === +body.newManagerId);
    if (!newManager) throw bad('Choose an active person outside this team as the new reporting manager.');
  }
  const f = L.peek(e.id, config.currentMonth);
  const warning = f && !['Completed and Submitted', 'Completed but Not Submitted'].includes(L.reviewStatus(f)) && body.date.slice(0, 7) === config.currentMonth
    ? 'Their review this month is not completed. It is counted until the inactive date.' : null;
  if (!body.confirm && warning) return { needsConfirm: true, warning };
  // the person is leaving, so their team's reviews move now (same clean-up as any reporting change: invites, notes, roles)
  const warnings = [];
  const notes = [];
  for (const r of reports) { const plan = { newId: newManager.id, choice: 'move', f: L.peek(r.id, config.currentMonth) }; warnings.push(...await applyMove(user, r, plan)); notes.push(...(plan.notes || [])); }
  // planned moves to or from this person no longer make sense
  for (const x of employees) if (x.pendingManager && x.pendingManager.id === e.id) { delete x.pendingManager; audit(user.name, 'planned reporting change dropped', `${x.name}: ${e.name} is now inactive`); }
  delete e.pendingManager;
  e.active = false; e.inactiveFrom = body.date; e.reason = body.reason; e.note = body.note;
  audit(user.name, 'move to inactive', `${e.name} from ${body.date} (${body.reason})`);
  syncRoles(user.name);
  return { ok: true, warnings, notes };
});
route('POST', '/api/employees/reactivate', ({ user, body }) => {
  adminOnly(user);
  const e = mustEmp(body.id);
  // their old manager may have left meanwhile: then they come back without one and the admin picks a new manager
  const m = e.managerId ? L.emp(e.managerId) : null, lost = m && !m.active;
  if (lost) e.managerId = null;
  e.active = true; delete e.inactiveFrom; delete e.reason;
  audit(user.name, 'reactivate', `${e.name} from ${body.date || config.today}${lost ? ` (their manager ${m.name} is inactive: choose a new one)` : ''}`);
  syncRoles(user.name);
  return { ok: true, warnings: lost ? [`${m.name} is inactive, so ${e.name} has no reporting manager now. Choose one in the Reporting manager column.`] : [] };
});

// shared by the hierarchy pages: who reports to whom and how their reviews stand in a month
function orgHelpers(month) {
  const people = employees.filter(e => e.active && e.role !== 'admin');
  const direct = id => people.filter(e => e.managerId === id);
  const reviewOf = e => { const f = L.peek(e.id, month); return f ? { status: L.reviewStatus(f), rating: f.submitted ? L.monthlyRating(f) : null, reviewDate: f.reviewDate || null } : null; };
  // review counts for a set of people (only those with a form this month)
  const countsOf = list => L.counts(list.map(reviewOf).filter(Boolean));
  const above = e => { const out = []; for (let c = L.emp(e.managerId); c && c.role !== 'admin' && out.length < 20; c = L.emp(c.managerId)) out.unshift(c); return out; };
  const rowFor = e => {
    const under = L.subordinates(e.id), up = above(e), mgr = up[up.length - 1], dir = up.find(x => x.role === 'director');
    return { id: e.id, name: e.name, designation: e.designation, email: e.email || '', team: e.team, role: e.role,
      manager: mgr ? { id: mgr.id, name: mgr.name } : null, director: dir ? { id: dir.id, name: dir.name } : null,
      direct: direct(e.id).length, total: under.length, review: reviewOf(e), teamCounts: countsOf(under) };
  };
  return { people, direct, reviewOf, countsOf, above, rowFor };
}
const byName = (a, b) => a.name.localeCompare(b.name);
const leadsFirst = (a, b) => (b.role !== 'employee') - (a.role !== 'employee') || byName(a, b);

// Reporting hierarchy (admin). Five lists by designation (the admin menu's Reporting manager group):
//   level=director | srmanager | manager (and team leads) | srexec | other (everyone else: executives, analysts, ...)
// Each person is in exactly one list (first match wins). And a drill-down: id=<person> lists the people who report
// to that person, so the admin follows director -> their managers -> a manager's employees, with the path back up.
const desigOf = e => String(e.designation || '').toLowerCase();
const ORG_LEVELS = {
  director: e => e.role === 'director' || /director/.test(desigOf(e)),
  srmanager: e => /senior manager/.test(desigOf(e)),
  manager: e => /manager/.test(desigOf(e)) || e.role === 'teamlead' || e.role === 'manager',
  srexec: e => /senior executive/.test(desigOf(e)),
  other: () => true,
};
const levelOf = e => Object.keys(ORG_LEVELS).find(k => ORG_LEVELS[k](e));
const STAFF_LEVELS = ['srexec', 'other']; // their tiles count their own reviews; leader lists count the whole organisation
route('GET', '/api/org', ({ user, q }) => {
  adminOnly(user);
  const month = q.month || config.currentMonth, H = orgHelpers(month);
  const levelCounts = Object.fromEntries(Object.keys(ORG_LEVELS).map(k => [k, H.people.filter(e => levelOf(e) === k).length]));
  if (!q.id) {
    const level = ORG_LEVELS[q.level] ? q.level : 'director';
    const list = H.people.filter(e => levelOf(e) === level).sort(byName);
    return { month, level, levelCounts, person: null, path: [], counts: H.countsOf(STAFF_LEVELS.includes(level) ? list : H.people), rows: list.map(H.rowFor) };
  }
  const p = mustEmp(q.id);
  if (p.role === 'admin') throw notFound('Employee not found.');
  return { month, level: null, levelCounts, person: { ...H.rowFor(p), active: p.active }, path: H.above(p).map(c => ({ id: c.id, name: c.name })),
    counts: H.countsOf(L.subordinates(p.id)), rows: H.direct(p.id).sort(leadsFirst).map(H.rowFor) };
});

// ---------- manager reports: My Team, My Team Report, My MIS Report, My KPI Report ----------
// Each works for the signed-in person (no id) or for someone they can see (a manager under them; admin and
// directors can see everyone).
const scopeRoot = (user, id) => {
  const root = id ? mustEmp(id) : user;
  if (root.id !== user.id && !L.canView(user, root.id)) throw forbid();
  return root;
};
const personView = p => ({ id: p.id, name: p.name, designation: p.designation, team: p.team, email: p.email || '' });
const round1 = x => x == null ? null : Math.round(x * 10) / 10;
const avgOf = list => list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : null;
const reportMonths = () => D.fyMonths().filter(m => m <= config.currentMonth);

// My Team: the people who report to the root, and every manager anywhere under them
route('GET', '/api/myteam', ({ user, q }) => {
  const month = q.month || config.currentMonth, H = orgHelpers(month), root = scopeRoot(user, q.id);
  const chain = [...H.above(root), root], from = chain.findIndex(c => c.id === user.id);
  const under = L.subordinates(root.id);
  return { month, me: root.id === user.id, person: H.rowFor(root), path: chain.slice(Math.max(from, 0), -1).map(c => ({ id: c.id, name: c.name })),
    counts: H.countsOf(under), members: H.direct(root.id).sort(leadsFirst).map(H.rowFor), managers: under.filter(e => H.direct(e.id).length).sort(byName).map(H.rowFor) };
});

// MIS report: month by month for the root's whole team, and each person's monthly rating
// whose reviews the MIS report covers: everyone under the root; admins and directors without an id get the whole organisation
const misScope = (user, q) => {
  const org = !q.id && (user.role === 'admin' || user.role === 'director');
  const root = scopeRoot(user, q.id);
  const people = (org ? L.visibleEmployees(user) : L.subordinates(root.id)).filter(e => e.role !== 'admin' && e.managerId).sort(byName);
  return { org, root, people };
};
route('GET', '/api/mis', ({ user, q }) => {
  adminOnly(user);
  const { org, root, people } = misScope(user, q), months = reportMonths();
  const byMonth = months.map(m => {
    const fs = people.map(e => L.peek(e.id, m)).filter(Boolean);
    const due = fs.map(f => L.dueInfo(f).due);
    return { month: m, label: D.monthLabel(m), ...L.counts(fs.map(f => ({ status: L.reviewStatus(f) }))),
      onTime: due.filter(x => x === 'Within due date').length, late: due.filter(x => x === 'After due date').length,
      avgRating: avgOf(fs.filter(f => f.submitted).map(f => L.monthlyRating(f)).filter(x => x != null)) };
  });
  const grid = people.map(e => {
    const cells = months.map(m => { const f = L.peek(e.id, m); return f ? { status: L.reviewStatus(f), rating: f.submitted ? L.monthlyRating(f) : null } : null; });
    const mgr = L.emp(e.managerId);
    return { id: e.id, name: e.name, designation: e.designation, manager: mgr ? mgr.name : '', cells, avg: avgOf(cells.map(c => c && c.rating).filter(x => x != null)) };
  });
  return { me: root.id === user.id, org, person: personView(root), months: months.map(m => ({ key: m, label: D.monthLabel(m) })), byMonth, grid };
});
// MIS Reporting graph: the average KRA score per month (submitted reviews), for a financial year,
// optionally only the people under one director. kra = total | operational | process | people
route('GET', '/api/mis/graph', ({ user, q }) => {
  adminOnly(user);
  const { org, people: all } = misScope(user, q);
  const curFy = +fyLabel(config.currentMonth).slice(3, 7), firstFy = +config.fyStartMonth.slice(0, 4);
  const fy = Math.min(Math.max(+q.fy || curFy, firstFy), curFy);
  const kra = ['operational', 'process', 'people'].includes(q.kra) ? q.kra : 'total';
  const directors = org ? employees.filter(e => e.active && e.role === 'director' && L.canView(user, e.id)).sort(byName) : [];
  const dir = q.director && directors.find(e => String(e.id) === String(q.director));
  const people = dir ? all.filter(e => L.isAncestor(dir.id, e.id)) : all;
  const months = D.fyMonths(fy).map(m => {
    const vals = people.map(e => L.peek(e.id, m)).filter(f => f && f.submitted && !L.isNewJoiner(f)).map(f => {
      const sm = L.kraSummary(f);
      if (kra === 'total') { const set = sm.kras.filter(x => x.subKras && x.scoreRaw != null), tw = set.reduce((a, x) => a + x.weight, 0); return tw ? set.reduce((a, x) => a + x.weight * x.scoreRaw, 0) / tw : null; }
      const x = sm.kras.find(k => k.key === kra); return x && x.subKras ? x.scoreRaw : null;
    }).filter(v => v != null);
    return { key: m, label: D.monthLabel(m), open: m <= config.currentMonth, value: avg2(vals), n: vals.length };
  });
  return { fy, fys: Array.from({ length: curFy - firstFy + 1 }, (_, i) => firstFy + i), kra, director: dir ? dir.id : '', directors: directors.map(e => ({ id: e.id, name: e.name })), people: people.length, months };
});

// KPI report: one person's KRA scores month by month (30% self + 70% manager, weighted by sub-KRA)
// Team report / My report: KRA scores month by month for a financial year, one table per person (submitted reviews only).
// An employee gets their own table; a manager gets their own and everyone under them (all levels);
// admins and directors without an id get the whole organisation (with a team filter).
const round2 = x => x == null ? null : Math.round(x * 100) / 100;
const avg2 = list => list.length ? round2(list.reduce((a, b) => a + b, 0) / list.length) : null;
route('GET', '/api/yearly', ({ user, q }) => {
  const curFy = +fyLabel(config.currentMonth).slice(3, 7), firstFy = +config.fyStartMonth.slice(0, 4);
  const fy = Math.min(Math.max(+q.fy || curFy, firstFy), curFy), months = D.fyMonths(fy);
  const org = !q.id && !q.self && (user.role === 'admin' || user.role === 'director');
  const root = org ? null : scopeRoot(user, q.id);
  // Team report: only the people under the root (their own table is My report, so it is not shown twice);
  // someone with nobody under them gets their own table
  const under = org || q.self || root.role === 'admin' ? [] : L.subordinates(root.id), teamView = under.length > 0;
  let people = org ? L.visibleEmployees(user) : teamView ? under : [root];
  people = people.filter(e => e.role !== 'admin' && e.managerId);
  const teams = [...new Set(people.map(e => e.team))].sort();
  if (q.team) people = people.filter(e => e.team === q.team);
  // status cards at the top of the Team report (this used to be the separate My team report): one month of reviews
  const cardMonth = q.month || config.currentMonth;
  const counts = L.counts(people.map(e => L.peek(e.id, cardMonth)).filter(Boolean).map(f => ({ status: L.reviewStatus(f) })));
  const blocks = people.map(e => {
    const cells = months.map(m => {
      const f = L.peek(e.id, m);
      if (!f || !f.submitted || L.isNewJoiner(f)) return null;
      const sm = L.kraSummary(f), kra = {};
      sm.kras.forEach(x => { kra[x.key] = x.subKras ? x.scoreRaw : null; });
      const set = sm.kras.filter(x => x.subKras && x.scoreRaw != null), tw = set.reduce((a, x) => a + x.weight, 0);
      // months reviewed by an earlier manager are marked with that manager's name
      const rb = f.reviewedBy && f.reviewedBy.managerId !== e.managerId ? f.reviewedBy.manager : null;
      return { operational: round2(kra.operational), process: round2(kra.process), people: round2(kra.people), total: tw ? round2(set.reduce((a, x) => a + x.weight * x.scoreRaw, 0) / tw) : null, reviewedBy: rb };
    });
    const totals = q4 => cells.map((c, i) => ({ c, i })).filter(x => x.c && x.c.total != null && q4(x.i)).map(x => x.c.total);
    const mgr = e.managerId ? L.emp(e.managerId) : null;
    return { ...personView(e), manager: mgr ? mgr.name : '', hasTeam: L.subordinates(e.id).length > 0, cells,
      quarters: [0, 1, 2, 3].map(qi => avg2(totals(i => Math.floor(i / 3) === qi))), year: avg2(totals(() => true)) };
  });
  return { teamView, counts, cardMonth, me: !!root && root.id === user.id, person: root ? personView(root) : null, org, fy, fyLabel: `FY ${fy}-${fy + 1}`,
    fys: Array.from({ length: curFy - firstFy + 1 }, (_, i) => firstFy + i), teams, team: q.team || '',
    months: months.map(m => ({ key: m, label: D.monthLabel(m), open: m <= config.currentMonth })), people: blocks };
});

route('GET', '/api/kpi', ({ user, q }) => {
  adminOnly(user);
  const root = scopeRoot(user, q.id);
  const months = reportMonths().filter(m => m >= (root.joined || '').slice(0, 7));
  const rows = months.map(m => {
    const f = L.peek(root.id, m);
    if (!f) return { month: m, label: D.monthLabel(m), none: true };
    const kra = Object.fromEntries(L.KRAS.map(([k]) => {
      const rs = f.kras[k].rows;
      const wavg = key => { const w = rs.filter(r => L.has(r[key])), tw = w.reduce((a, r) => a + (+r.weight || 0), 0); return tw ? w.reduce((a, r) => a + r.weight * r[key], 0) / tw : null; };
      const s = wavg('self'), mg = wavg('mgr');
      return [k, { weight: f.kras[k].weight, subKras: rs.length, self: round1(s), mgr: round1(mg), score: s != null && mg != null ? round1(config.selfShare * s + config.mgrShare * mg) : null }];
    }));
    return { month: m, label: D.monthLabel(m), status: L.reviewStatus(f), reviewDate: f.reviewDate || null, kra, rating: f.submitted ? L.monthlyRating(f) : null, submitted: f.submitted };
  });
  return { me: root.id === user.id, person: personView(root), rows, avg: avgOf(rows.map(r => r.rating).filter(x => x != null)) };
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
  N.reviewPeople().forEach(p => N.push(p.id, { type: 'change', key: `params|${body.from}`, link: '#/params', text: `The Parameters summary was updated. It applies from ${D.monthLabel(body.from)}.` }, user));
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
  N.reviewPeople().forEach(p => N.push(p.id, { type: 'change', key: `questions|${q.from}`, ...(p.managerId && { link: N.formLink(p.id, config.currentMonth) }), text: `The review questionnaire changes from ${D.monthLabel(q.from)}.` }, user));
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
  N.reviewPeople().forEach(p => N.push(p.id, { type: 'change', key: `questions|${body.from}`, ...(p.managerId && { link: N.formLink(p.id, config.currentMonth) }), text: `The review questionnaire changes from ${D.monthLabel(body.from)}.` }, user));
  return { ok: true };
});
route('POST', '/api/questions/delete', ({ user, body }) => {
  adminOnly(user);
  const q = questions.find(x => x.id === body.id); if (!q) throw bad('Not found');
  if (!body.from) throw bad('Choose the month from which the question is removed.');
  q.to = body.from; audit(user.name, 'question deleted', `${q.text} from ${body.from}`);
  N.reviewPeople().forEach(p => N.push(p.id, { type: 'change', key: `questions|${body.from}`, ...(p.managerId && { link: N.formLink(p.id, config.currentMonth) }), text: `The review questionnaire changes from ${D.monthLabel(body.from)}.` }, user));
  return { ok: true };
});
// drag-and-drop on the Questionnaire page: the new order of one answer type's active questions, sent as a list of ids
route('POST', '/api/questions/reorder', ({ user, body }) => {
  adminOnly(user);
  const type = body.type === 'rating' ? 'rating' : 'text';
  const grp = questions.filter(q => !q.to && q.type === type).sort((a, b) => a.order - b.order);
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (ids.length !== grp.length || new Set(ids).size !== ids.length || !grp.every(q => ids.includes(q.id))) throw bad('The question list changed. Reload the page and try again.');
  const was = Object.fromEntries(grp.map((q, i) => [q.id, i + 1])); // position before the move, for the audit log
  const slots = grp.map(q => q.order); // the same order numbers, handed out in the new sequence
  ids.forEach((id, i) => { questions.find(q => q.id === id).order = slots[i]; });
  renumber();
  audit(user.name, 'questions reordered', `${type === 'text' ? 'Text' : 'Rating'} questions, new order (old numbers): ${ids.map(id => 'Q' + was[id]).join(', ')}`);
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
  employees.filter(e => e.active && ['manager', 'teamlead', 'director'].includes(e.role)).forEach(e => N.push(e.id, { type: 'change', key: `rules|${config.currentMonth}`, link: '#/report', text: `The review rules (thresholds for flags such as ClickUp, learning and rating gaps) were updated by ${user.name}.` }, user));
  return config;
});
// one team's review window (day of month, same every month), edited from the Scheduling page
route('PUT', '/api/windows', ({ user, body }) => {
  adminOnly(user);
  const team = String(body.team || '').trim(), start = Number(body.start), end = Number(body.end);
  if (!team) throw bad('Team is required.');
  if (![start, end].every(n => Number.isInteger(n) && n >= 1 && n <= 31)) throw bad('Days must be whole numbers from 1 to 31.');
  if (start > end) throw bad('The window must start on or before the day it ends.');
  config.windows[team] = { start, end };
  audit(user.name, 'review window updated', `${team}: day ${start} to ${end}`);
  { const w = D.windowFor(team, config.currentMonth), people = employees.filter(e => e.active && e.team === team && e.role !== 'admin');
    const mgrs = new Set(people.map(e => e.managerId).filter(Boolean));
    [...new Set([...people.map(e => e.id), ...mgrs])].forEach(id => N.push(id, { type: 'date', key: `win|${team}|${config.currentMonth}`, text: `The ${team} review window for ${D.monthLabel(config.currentMonth)} is now ${w.start} to ${w.end} (day ${start} to ${end} every month).` }, user)); }
  return config.windows[team];
});

// ---------- server ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) {
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
    const st = file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file);
    if (!st || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    // browsers must check for a newer copy every time (a quick 304 when unchanged), so after an update
    // nobody keeps running old page code against the new server
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag, 'Last-Modified': st.mtime.toUTCString() };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers);
    return fs.createReadStream(file).pipe(res);
  }
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', async () => {
    const setCookies = [];
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(setCookies.length && { 'Set-Cookie': setCookies }) }); res.end(JSON.stringify(data)); };
    try {
      const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
      // NO_ROUTE tells an out-of-date page that the server was updated (the page then reloads itself)
      if (!r) return send(404, { error: 'Not found', code: 'NO_ROUTE' });
      applyPendingMoves(); // reporting changes planned for a month that has now started
      N.checks();          // date reminders (window open, closing soon, overdue, meeting tomorrow): at most once a minute
      // changes must come from the app itself (JSON), which a form on another site cannot send with our cookie
      if (req.method !== 'GET' && !/application\/json/.test(req.headers['content-type'] || '')) return send(415, { error: 'Send JSON.' });
      const cookies = A.parseCookies(req.headers.cookie), s = A.session(cookies);
      const realUser = s ? L.emp(s.uid) : null, signedIn = realUser && realUser.active ? realUser : null;
      // an admin "viewing as" someone gets that person's permissions; realUser stays the admin
      const asUser = signedIn && s.as && signedIn.role === 'admin' ? L.emp(s.as) : null;
      const user = asUser && asUser.active ? asUser : signedIn;
      if (!r.open && !user) return send(401, { error: 'Please sign in to continue.' });
      // The cookie is shared by every tab. A tab says who it was opened for ("<user id>:<real user id>"); if someone
      // else has signed in (or switched "View as") in another tab since, refuse instead of reading or saving as them.
      const tabFor = req.headers['x-pms-user'];
      if (tabFor && user && !r.open && url.pathname !== '/api/me' && !url.pathname.startsWith('/api/auth/') && tabFor !== `${user.id}:${signedIn.id}`)
        return send(409, { error: 'You are signed in as someone else in another tab.', code: 'SESSION_CHANGED' });
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch { return send(400, { error: 'Request body is not valid JSON.' }); } }
      const result = await r.fn({ user, realUser: signedIn, session: s, q: Object.fromEntries(url.searchParams), body, cookies, secure: A.isSecure(req), setCookie: c => setCookies.push(c) });
      // store any change before answering, so a saved form survives a restart
      try { await DB.save(); } catch (e) { console.error('Saving to Postgres failed:', e.message); return send(503, { error: 'Could not save to the database. Please try again.' }); }
      if (result instanceof Redirect) { res.writeHead(302, { Location: result.url, 'Cache-Control': 'no-store', ...(setCookies.length && { 'Set-Cookie': setCookies }) }); return res.end(); }
      send(200, result);
    } catch (e) {
      if (e instanceof HttpError) return send(e.code, { error: e.message, ...e.extra });
      console.error(e); send(500, { error: 'Server error: ' + e.message });
    }
  });
});
DB.init().then(() => { D.migrate(); ensureAccounts(); moveOldNotices(); return DB.save(); }).then(
  () => server.listen(PORT, () => console.log(`Verve PMS running at http://localhost:${PORT} · sign-in: ${[A.google && `Google (@${A.ORG_DOMAIN})`, A.demo && 'demo users'].filter(Boolean).join(' + ') || 'none'}`)),
  e => { console.error('Could not connect to Postgres:', e.message); process.exit(1); });
