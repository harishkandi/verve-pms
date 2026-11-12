// In-app notifications: one list per person (newest first), shown under the bell in the top bar.
// push() is called by the routes when something happens (requests, review progress, dates set, changes);
// checks() adds the date reminders (window open, closing soon, overdue, meeting tomorrow) and runs at most once a minute.
const D = require('./data');
const L = require('./logic');
const { notifications, employees, config } = D;

const MAX = 100, KEEP_MS = 60 * 864e5; // per person: the last 100, at most 60 days old
const now = () => new Date().toISOString();
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// reminders follow the real calendar date in India (config.today is the demo date used for statuses);
// PMS_TODAY (YYYY-MM-DD) overrides it, for testing
const realToday = () => process.env.PMS_TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone || 'Asia/Kolkata' }).format(new Date());
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const fmt = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// n = { type, text, link, action, key }
//   type:   request | review | date | change | admin (the icon and colour in the panel)
//   action: shows under "Needs action" until resolve(key) or the reminder no longer applies
//   key:    the same key again updates the earlier item instead of adding a second one
// by = the person who caused it: nobody is told about their own action
// opts.quiet: an existing item with this key is updated in place (still read, same position): used by reminders
function push(to, n, by, opts = {}) {
  const p = L.emp(+to); if (!p || !p.active) return;
  if (by && by.id === p.id) return;
  const list = notifications[p.id] ||= [];
  const old = n.key ? list.find(x => x.key === n.key) : null;
  if (old && opts.quiet) { if (old.text !== n.text || old.done) Object.assign(old, n, { done: false }); return; }
  if (old) list.splice(list.indexOf(old), 1);
  list.unshift({ ...(old || {}), id: old ? old.id : newId(), at: now(), read: false, done: false, ...n, ...(by && { by: by.name }) });
  const cut = Date.now() - KEEP_MS;
  for (let i = list.length - 1; i >= 0; i--) if (i >= MAX || Date.parse(list[i].at) < cut) list.splice(i, 1);
}
// an action item was handled (by anyone): it leaves "Needs action" for everyone who got it
function resolve(key) {
  for (const list of Object.values(notifications)) for (const x of list) if (x.key === key && !x.done) { x.done = true; x.read = true; }
}
// remove items whose key starts with this (e.g. the "meeting tomorrow" reminder of a meeting that was moved)
function drop(keyStart) { for (const list of Object.values(notifications)) for (let i = list.length - 1; i >= 0; i--) if (list[i].key && list[i].key.startsWith(keyStart)) list.splice(i, 1); }
const managerOf = empId => { const e = L.emp(empId); return e && e.managerId ? L.emp(e.managerId) : null; };
const admins = () => employees.filter(e => e.role === 'admin' && e.active);
// everyone who takes part in reviews: people who are reviewed and the managers who review them
const reviewPeople = () => employees.filter(e => e.active && e.role !== 'admin');
const formLink = (empId, month) => `#/form/${empId}/${month}`;

function listFor(id) {
  const list = notifications[id] || [];
  return { items: list, unread: list.filter(x => !x.read).length, action: list.filter(x => x.action && !x.done).length };
}
function markRead(id, nid) { for (const x of notifications[id] || []) if (!nid || x.id === nid) x.read = true; }

// ---------- date reminders ----------
let lastCheck = 0, lastDay = '';
function checks() {
  const today = realToday();
  if (Date.now() - lastCheck < (process.env.PMS_TODAY ? 0 : 60000) && today === lastDay) return; // tests (PMS_TODAY) check every time
  lastCheck = Date.now(); lastDay = today;
  const month = config.currentMonth, label = D.monthLabel(month), tomorrow = addDays(today, 1), live = new Set();
  const teams = new Map(); // manager id -> { open, closing, overdue } lists of people
  const team = id => { if (!teams.has(id)) teams.set(id, { open: [], closing: [], overdue: [], end: '' }); return teams.get(id); };
  for (const e of employees.filter(x => x.active && x.managerId && x.role !== 'admin')) {
    const f = L.peek(e.id, month), w = D.windowFor(e.team, month), mgr = L.emp(e.managerId), link = formLink(e.id, month);
    if (!f || month < (e.joined || '').slice(0, 7)) continue;
    const t = mgr && mgr.active ? team(mgr.id) : null;
    if (t && (!t.end || w.end < t.end)) t.end = w.end;
    // the window is open: once per person and month
    if (today >= w.start && today <= w.end) {
      push(e.id, { type: 'date', key: `open|${e.id}|${month}`, text: `Your ${label} review window is open: ${fmt(w.start)} to ${fmt(w.end)}. Fill in your self ratings, remarks and answers.`, link }, null, { quiet: true });
      if (t) t.open.push(e);
    }
    // the meeting is tomorrow: employee and reporting manager
    if (f.scheduledDate === tomorrow && !f.submitted) {
      const when = `${fmt(f.scheduledDate)}${f.scheduledTime ? ' at ' + f.scheduledTime : ''}`;
      push(e.id, { type: 'date', key: `meet|${e.id}|${f.scheduledDate}`, text: `Your ${label} review meeting is tomorrow, ${when}.`, link }, null, { quiet: true });
      if (mgr) push(mgr.id, { type: 'date', key: `meet|${e.id}|${f.scheduledDate}`, text: `Review meeting with ${e.name} tomorrow, ${when}.`, link }, null, { quiet: true });
    }
    if (f.submitted) continue;
    const todo = f.selfSubmitted ? 0 : L.employeeTodo(f).length;
    const closing = today >= addDays(w.end, -2) && today <= w.end, overdue = today > w.end;
    if ((closing || overdue) && todo) {
      const k = `${overdue ? 'overdue' : 'closing'}|${e.id}|${month}`; live.add(k);
      push(e.id, { type: 'date', action: true, rem: true, key: k, link,
        text: overdue ? `Your ${label} review is overdue (the window closed on ${fmt(w.end)}). ${plural(todo, 'item')} on your form still to fill in.`
          : `Your ${label} review window closes on ${fmt(w.end)}. ${plural(todo, 'item')} on your form still to fill in.` }, null, { quiet: true });
    }
    if (t && closing) t.closing.push(e);
    if (t && overdue) t.overdue.push(e);
  }
  const names = list => list.slice(0, 3).map(x => x.name).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');
  for (const [id, t] of teams) {
    if (t.open.length) push(id, { type: 'date', key: `open-team|${id}|${month}`, link: '#/scheduling', text: `${label} review windows are open: ${plural(t.open.length, 'review')} in your team to schedule and complete.` }, null, { quiet: true });
    for (const [kind, list] of [['closing', t.closing], ['overdue', t.overdue]]) {
      if (!list.length) continue;
      const k = `${kind}-team|${id}|${month}`; live.add(k);
      push(id, { type: 'date', action: true, rem: true, key: k, link: '#/report', text: kind === 'overdue'
        ? `${plural(list.length, 'review')} in your team ${list.length === 1 ? 'is' : 'are'} overdue and not submitted: ${names(list)}.`
        : `${plural(list.length, 'review')} in your team ${list.length === 1 ? 'is' : 'are'} not submitted yet; the window closes on ${fmt(t.end)}: ${names(list)}.` }, null, { quiet: true });
    }
  }
  // admin: people without a work email cannot sign in or get invites (once a month, updated as the number changes)
  const noEmail = employees.filter(e => e.active && e.role !== 'admin' && !e.email).length;
  const ek = `noemail|${month}`;
  if (noEmail) { live.add(ek); admins().forEach(a => push(a.id, { type: 'admin', action: true, rem: true, key: ek, link: '#/employees/active', text: `${noEmail} active ${noEmail === 1 ? 'person has' : 'people have'} no work email, so they cannot sign in with Google or receive review invites. Add them with Edit.` }, null, { quiet: true })); }
  // reminders that no longer apply (form filled in, review submitted, emails added) leave "Needs action"
  for (const list of Object.values(notifications)) for (const x of list) if (x.rem && !x.done && !live.has(x.key)) { x.done = true; }
}

module.exports = { push, resolve, drop, listFor, markRead, checks, managerOf, admins, reviewPeople, formLink, realToday };
