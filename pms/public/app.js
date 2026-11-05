'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = { user: null, me: null, month: null, page: null };
// anything not served from this machine is the shared staging demo
const IS_STAGING = !['localhost', '127.0.0.1', ''].includes(location.hostname);
const ROLE_LABEL = { admin: 'Admin', director: 'Director', manager: 'Manager', teamlead: 'Team lead', employee: 'Employee' };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-User': S.user || '' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (res.status === 401 && S.me) { sessionStorage.removeItem('pmsUser'); S.user = null; S.me = null; S.month = null; boot(); }
  if (!res.ok) { const e = new Error(data.error || 'Error'); e.data = data; throw e; }
  return data;
}
function toast(msg, kind = 'ok') { document.querySelectorAll('.toast').forEach(x => x.remove()); const t = document.createElement('div'); t.className = 'toast t-' + kind; t.setAttribute('role', kind === 'err' ? 'alert' : 'status'); t.innerHTML = `<span class="ti">${kind === 'err' ? '!' : '✓'}</span><span></span>`; t.lastChild.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 4000 : 2800); }
const badge = st => {
  const c = { 'Completed and Submitted': 'green', 'Completed but Not Submitted': 'amber', 'Review Not Completed': 'red', Pending: 'blue', 'Not started': 'grey', 'Within due date': 'green', 'After due date': 'red' }[st] || 'grey';
  return `<span class="badge b-${c}">${esc(st)}</span>`;
};
const fmtD = d => { if (!d) return '–'; const [y, m, dd] = d.split('-'); return `${+dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`; };
const monthOpts = sel => S.me.months.filter(m => m.started).map(m => `<option value="${m.key}" ${m.key === sel ? 'selected' : ''}>${m.label.split(" ")[0]}</option>`).join('');
// ratings are 0-5 picked from a dropdown; a 5 needs a remark explaining it
const RATINGS = [0, 1, 2, 3, 4, 5];
const rateSel = (val, attrs, enabled, cls = '') => `<select class="num ${cls}" ${attrs} ${enabled ? '' : 'disabled'}><option value="">–</option>${RATINGS.map(n => `<option value="${n}" ${val != null && val !== '' && +val === n ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
const errBox = e => `<div class="warn">${(e.data?.errors || [e.message]).map(esc).join('<br>')}</div>`;
function modal(html) { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="box">${html}</div>`; m.addEventListener('mousedown', ev => { if (ev.target === m) m.remove(); }); document.body.appendChild(m); return m; }

// ---------- theme (light by default, choice remembered in this browser) ----------
const themeBtn = () => `<button class="theme-btn" id="themeBtn" title="Switch light / dark">${document.documentElement.dataset.theme === 'dark' ? '☀ Light' : '☾ Dark'}</button>`;
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('pmsTheme', t); } catch {}
  document.querySelectorAll('#themeBtn').forEach(b => { b.outerHTML = themeBtn(); });
}
document.addEventListener('click', e => { if (e.target.closest('#themeBtn')) toggleTheme(); });

// ---------- shell ----------
async function boot() {
  const users = await api('/users');
  $('#root').innerHTML = `<div class="login">${themeBtn()}<h1 style="color:var(--navy)">VERVE PMS</h1><p class="small">Local demo with dummy data. Pick a user to sign in as.</p><div class="card">
  ${users.map(u => `<button class="btn" data-u="${u.id}"><b>${esc(u.name)}</b> <span class="small">${esc(u.designation)} · ${ROLE_LABEL[u.role]}</span></button>`).join('')}</div></div>`;
  $('#root').onclick = async e => { const b = e.target.closest('[data-u]'); if (b) { S.user = b.dataset.u; sessionStorage.setItem('pmsUser', S.user); await start(); } };
  const saved = sessionStorage.getItem('pmsUser');
  if (saved) { S.user = saved; try { await start(); } catch { sessionStorage.removeItem('pmsUser'); S.user = null; } }
}

async function start() {
  S.me = await api('/me');
  S.month = S.month || S.me.currentMonth;
  const r = S.me.role, mgr = ['manager', 'teamlead', 'director', 'admin'].includes(r);
  const items = [
    ['Home', '#/home'],
    r !== 'admin' && ['My Review', `#/form/${S.me.id}/${S.month}`],
    mgr && r !== 'admin' && ['Team Reviews', '#/team'],
    mgr && ['Scheduling', '#/scheduling'],
    mgr && ['Review Status Report', '#/report'],
    mgr && ['Manager Emails', '#/emails'],
    ['One Pager Document', `#/annual/${S.me.id}`],
    ['Parameters Summary', '#/params'],
    r === 'admin' && '--Admin',
    r === 'admin' && ['Employees', '#/employees'],
    r === 'admin' && ['Reporting Manager', '#/reporting/Manager'],
    r === 'admin' && ['Questions', '#/questions'],
    r === 'admin' && ['Audit Log', '#/audit'],
    r === 'admin' && ['Settings', '#/config'],
  ].filter(Boolean);
  $('#root').innerHTML = `<div id="app"><nav><div class="logo">VERVE<small>HR TOOL · PMS</small>${IS_STAGING ? `<span class="stage" title="Staging: dummy data, resets when the server restarts">STAGING</span>` : ''}</div>
    ${items.map(i => typeof i === 'string' ? `<div class="grp">${i.slice(2)}</div>` : `<a data-h="${i[1]}" href="${i[1]}">${i[0]}</a>`).join('')}
    <a id="logout" style="margin-top:20px;color:var(--mut)">Switch user</a></nav>
    <main><header>${themeBtn()}<div class="who"><b>${esc(S.me.name)}</b><br><small>${ROLE_LABEL[S.me.role]} · ${esc(S.me.designation)}</small></div><div class="avatar">${esc(S.me.name.split(' ').map(x => x[0]).join(''))}</div></header><div id="view"></div></main></div>`;
  $('#root').onclick = e => { if (e.target.id === 'logout') { sessionStorage.removeItem('pmsUser'); S.user = null; S.month = null; boot(); } };
  window.onhashchange = route;
  route();
}

async function route() {
  const [, page, ...args] = (location.hash || '#/home').split('/');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.h && location.hash.startsWith(a.dataset.h.split('/').slice(0, 2).join('/'))));
  const v = $('#view'); v.innerHTML = '<p class="small">Loading…</p>';
  v.onclick = v.oninput = v.onchange = null; window.onscroll = null;
  try { await (pages[page] || pages.home)(v, ...args); } catch (e) { v.innerHTML = `<h1>Something went wrong</h1>${errBox(e)}`; }
}
const head = (t, c) => `<h1>${t}</h1><div class="crumb">${c || ''}</div>`;
const monthSel = (id = 'msel') => `<select id="${id}">${monthOpts(S.month)}</select>`;
function onMonth(fn) { $('#msel').onchange = e => { S.month = e.target.value; fn(); }; }
function nameLink(id, name, month) { return `<a href="#/form/${id}/${month || S.month}" style="color:var(--navy);font-weight:600">${esc(name)}</a>`; }

const pages = {};

// ---------- home ----------
pages.home = async v => {
  const d = await api('/home?month=' + S.month);
  const c = d.counts, mgr = ['manager', 'teamlead', 'director', 'admin'].includes(S.me.role);
  const reqs = mgr ? await api('/edit-requests') : [];
  v.innerHTML = head('PMS', 'HR Tool › PMS › Home') + `<div class="row">${monthSel()}</div>` +
    (mgr ? `<div class="tiles"><div class="tile"><b>${c.scheduled}</b><span>Reviews scheduled</span></div><div class="tile g"><b>${c.submitted}</b><span>Completed and submitted</span></div><div class="tile a"><b>${c.notSubmitted}</b><span>Completed, not submitted</span></div><div class="tile r"><b>${c.notCompleted}</b><span>Review not completed</span></div><div class="tile b"><b>${c.pending}</b><span>Pending (past due, not completed)</span></div></div>`
      : `<div class="tile" style="max-width:280px;margin-bottom:14px"><span>Your review status</span><b style="font-size:18px">${d.ownStatus ? badge(d.ownStatus) : '–'}</b></div>`) +
    `<div class="row" style="align-items:flex-start"><div class="sp" style="min-width:300px">${reqs.length ? `<h2>Edit requests</h2><div class="card">${reqs.map(r => `<div class="row" style="margin:0 0 6px"><b>${esc(r.name)}</b> ${r.type === 'kra' ? 'wants to edit KRAs' : 'asked to reopen the form'} (${esc(r.month)}) <span class="sp"></span><a class="btn sm yel" href="#/form/${r.empId}/${r.month}">Review</a></div>`).join('')}</div>` : ''}<h2>Needs your attention</h2>
    ${d.attention.length ? `<div class="tablewrap"><table><tr><th>Employee</th><th>Team</th><th>Scheduled</th><th>Issue</th><th>Status</th></tr>${d.attention.map(a => `<tr><td>${nameLink(a.empId, a.name)}</td><td>${esc(a.team)}</td><td>${fmtD(a.scheduled)}</td><td>${esc(a.issue)}${a.reschedules ? ` · rescheduled ${a.reschedules}x` : ''}</td><td>${badge(a.status)}</td></tr>`).join('')}</table></div>` : '<div class="ok">Nothing needs attention.</div>'}</div>
    <div class="card" style="min-width:260px"><b>Shortcuts</b><div style="display:grid;gap:8px;margin-top:8px">
    ${S.me.role !== 'admin' ? `<a class="btn pri" href="#/form/${S.me.id}/${S.month}">Open my review</a>` : ''}
    ${mgr ? `<a class="btn yel" href="#/report">Review status report</a><a class="btn" href="#/scheduling">Scheduling</a>` : ''}
    <div class="small">Review window${S.me.team ? ' for ' + esc(S.me.team) : ''}: ${fmtD(d.window.start)} to ${fmtD(d.window.end)}</div></div></div></div>`;
  onMonth(() => pages.home(v));
};

// ---------- monthly form ----------
let FP = null, attempted = false;
pages.form = async (v, emp, month) => {
  if (month === 'annual') return drawAppraisal(v, emp);
  S.month = month || S.month;
  attempted = false; editingQ.clear(); focusQ = null;
  FP = await api(`/form?emp=${emp}&month=${S.month}`);
  drawForm(v);
};

const editingQ = new Set();
let focusQ = null; // question answer box to put the cursor in after a redraw
const qOriginal = {}; // answer text when its box was opened, to skip saving when nothing changed
function drawForm(v, errors) {
  const { form: f, perms: p, employee: e, manager: m } = FP;
  const sec = (k, label, desc) => {
    const kr = f.kras[k], ed = p.editKras, rows = kr.rows;
    const sum = rows.reduce((a, r) => a + (+r.weight || 0), 0);
    const wavg = key => { const w = rows.filter(r => r[key] != null); const tw = w.reduce((a, r) => a + (+r.weight || 0), 0); return tw ? Math.round(w.reduce((a, r) => a + r.weight * r[key], 0) / tw * 10) / 10 : 0; };
    const sr = wavg('self'), mr = wavg('mgr'), calc = Math.round((0.3 * sr + 0.7 * mr) * 10) / 10;
    const head = `<div class="kra" id="sec-${k}">${label} : ${desc}</div>
      <div class="row" style="margin:10px 0 6px"><b>Weightage Of KRA:</b> ${ed ? `<input class="num" type="number" data-kw="${k}" value="${kr.weight}"> <span title="editable">✎</span>` : kr.weight}
      ${ed && rows.length ? `<span class="badge ${sum === +kr.weight ? 'b-green' : 'b-red'}">Sub-KRA total ${sum} / ${kr.weight}</span>` : ''}</div>`;
    const btns = ed ? `<div class="row" style="margin-top:8px"><button class="btn pri sm" data-add="${k}" title="Add sub-KRA" style="min-width:60px">+</button><button class="btn pri sm" data-savek="${k}" style="min-width:60px">save</button></div>` : '';
    if (!rows.length) return head + `<div class="${FP.newJoiner ? 'info' : 'warn'}">${FP.newJoiner ? 'New joiner: no KRAs set yet. Only the questionnaire is checked.' : `${label} KRA is not set.`}</div>` + btns;
    return head + `<div class="tablewrap"><table><tr><th>Sr.No</th><th>Key Performance Indicator</th><th>Target</th><th>Weightage</th><th>Self Rating (30%)</th><th>Management Rating (70%)</th><th>Remark</th><th>Manager Remark</th></tr>
    ${rows.map((r, i) => {
      const diff = r.self != null && r.mgr != null && +r.self !== +r.mgr, needRemark = (diff || (r.mgr != null && +r.mgr === 5)) && !(r.mgrRemark || '').trim();
      const needSelf = attempted && (r.self == null || !(r.selfRemark || '').trim()), selfTop = r.self != null && +r.self === 5 && !(r.selfRemark || '').trim();
      return `<tr><td>${ed ? `<button class="xdel" data-del="${k}:${i}" title="Remove sub-KRA">✖</button> ` : ''}${i + 1}</td>
      <td>${ed ? `<textarea rows="2" data-k="${k}" data-i="${i}" data-f="kpi">${esc(r.kpi)}</textarea>` : esc(r.kpi)}</td>
      <td>${ed ? `<textarea rows="2" data-k="${k}" data-i="${i}" data-f="target">${esc(r.target)}</textarea>` : esc(r.target)}</td>
      <td>${ed ? `<input class="num" type="number" data-k="${k}" data-i="${i}" data-f="weight" value="${r.weight}">` : r.weight}</td>
      <td>${rateSel(r.self, `data-k="${k}" data-i="${i}" data-f="self"`, p.editSelf, `${r.self != null ? 'filled' : ''} ${needSelf && r.self == null ? 'err' : ''}`)}</td>
      <td>${rateSel(r.mgr, `data-k="${k}" data-i="${i}" data-f="mgr"`, p.editManager, r.mgr != null ? 'filled' : '')}</td>
      <td><textarea class="${(needSelf || selfTop) && !(r.selfRemark || '').trim() ? 'err' : ''}" rows="2" data-k="${k}" data-i="${i}" data-f="selfRemark" ${selfTop ? 'placeholder="Remark required for a rating of 5"' : ''} ${p.editSelf ? '' : 'disabled'}>${esc(r.selfRemark)}</textarea>${selfTop ? '<div class="flag">Remark required: rating is 5.</div>' : ''}</td>
      <td><textarea class="${needRemark ? 'err' : ''}" rows="2" data-k="${k}" data-i="${i}" data-f="mgrRemark" ${p.editManager ? '' : 'disabled'}>${esc(r.mgrRemark)}</textarea>
      ${needRemark ? `<div class="flag">${diff ? 'Manager remarks are required because there is a difference between the employee\'s self-rating and the manager\'s rating.' : 'Manager remark required: rating is 5.'}</div>` : ''}</td></tr>`;
    }).join('')}
    <tr class="sub"><td></td><td></td><td><b>Totals</b></td><td>Weightage : ${sum}</td><td>Total SR : ${sr}</td><td>Total MR : ${mr}</td><td colspan="2">Total Calculation : ${calc}</td></tr></table></div>` + btns;
  };
  const kraBanner = p.approveKra ? `<div class="warn" style="display:flex;gap:10px;align-items:center">${esc(e.name)} has requested to edit their KRAs. <span class="sp"></span><button class="btn pri sm" data-kapp="1">Approve</button><button class="btn sm" data-kapp="0">Decline</button></div>`
    : p.kraRequested ? '<div class="warn" style="background:var(--ambbg);color:var(--amb);border-color:var(--amb);font-weight:600">Your request to edit KRAs has been sent. You can update or add KRAs once your manager approves it.</div>'
    : (p.kraAccess && e.id === S.me.id && p.editKras) ? '<div class="ok">Your manager approved KRA editing. You can update or add sub-KRAs below.</div>' : '';
  const qs = FP.questions;
  const text = qs.filter(q => q.type === 'text'), rate = qs.filter(q => q.type === 'rating');
  const noDate = !f.reviewDate && attempted;
  const pi = (FP.previewRating != null) ? `Monthly rating${FP.rating == null ? ' (preview, shown after submit)' : ''}: <b>${FP.previewRating}</b>` : 'Monthly rating: not available until all ratings are in';
  v.innerHTML = head('Monthly review form', `PMS › ${e.id === S.me.id ? 'My Review' : esc(e.name)} › ${esc(S.me.months.find(x => x.key === S.month).label)}`) +
    `<div class="row"><select id="msel">${S.me.months.map(m => `<option value="${m.key}" ${m.key === S.month ? 'selected' : ''}>${m.label.split(" ")[0]}</option>`).join('')}<option value="annual">Annual Review</option></select>${p.copyKras ? '<button class="btn" id="copyk">Copy KRAs from last month</button>' : ''}<span class="sp"></span>${badge(FP.status)} ${f.locked ? '<span class="badge b-grey">Locked</span>' : ''}
     ${p.requestEdit ? '<button class="btn" id="req">Request edit access</button>' : ''}${p.unlock ? '<button class="btn" id="unlock">Reopen form</button>' : ''}</div>
    <div class="formhead">KRA : ${FP.fy} ${esc(S.me.months.find(x => x.key === S.month).label.replace(' ', ', '))}</div>
    <div class="card" style="margin-top:8px"><div class="row" style="margin:0"><div><b>Employee Name:</b> ${esc(e.name)} (${esc(e.designation)})<br><b>Reporting Manager:</b> ${m ? esc(m.name) : '–'}</div>
    ${p.requestKra ? '<button class="btn yel" id="kreq" style="margin-left:24px;min-width:280px;padding:10px 16px">Send Request for edit access</button>' : ''}<span class="sp"></span>
    <div><label class="f" style="margin:0">Review Date <i>*</i></label><input type="date" id="reviewDate" class="${noDate ? 'err' : ''}" value="${esc(f.reviewDate)}" ${p.editSelf || p.editManager ? '' : 'disabled'}></div></div>
    ${noDate ? '<div class="warn">Review Date is mandatory. Please enter the review date before submitting the form.</div>' : ''}
    ${errors ? `<div class="warn">${errors.map(esc).join('<br>')}</div>` : ''}
    <div class="small">${pi}</div></div>
    ${kraBanner}
    <div class="tabs" id="tabs">${[['operational', 'Operational'], ['process', 'Process'], ['people', 'People'], ['questionnaire', 'Questionnaire']].map(([k, l], i) => `<button data-t="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</div>
    ${sec('operational', 'Operational', '(Our value addition to the client via quality/financially)')}
    ${sec('process', 'Process', '(SOP and ClickUp)')}
    ${sec('people', 'People', '(Learning)')}
    <div class="kra" id="sec-questionnaire" style="background:var(--navy);color:#fff;border-left:0;border-radius:0">Question-Answers</div>
    <div class="tablewrap"><table style="table-layout:fixed"><colgroup><col style="width:90px"><col style="width:38%"><col></colgroup><tr><th>Serial No</th><th>Question Title</th><th>Question Answer</th></tr>${text.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.text)}</td><td>${editingQ.has(q.id) ? `<textarea data-qt="${q.id}" rows="3" placeholder="Type your answer" style="background:var(--bg)">${esc(f.qa[q.id] || '')}</textarea><div class="small">Saves automatically when you click away.</div>`
      : `<span style="white-space:pre-wrap">${f.qa[q.id] ? esc(f.qa[q.id]) : 'Not Added'}</span> ${p.editSelf || p.editManager ? `<button class="xdel" data-qedit="${q.id}" title="Edit" style="color:var(--ink)"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4"/><path d="M11 2l3 3-6 6H5V8z"/></svg></button>` : ''}`}</td></tr>`).join('')}${rate.map((q, i) => {
      const a = f.qa[q.id] || {}, diff = a.self != null && a.mgr != null && +a.self !== +a.mgr, top = (a.self != null && +a.self === 5) || (a.mgr != null && +a.mgr === 5), need = (diff || top) && !(a.remark || '').trim();
      return `<tr><td>${text.length + i + 1}</td><td>${esc(q.text)} (Rate out of 5)</td><td style="padding:6px"><table style="table-layout:fixed"><tr><th style="width:90px">Self Rating</th><th style="width:90px">Manager Rating</th><th>Remark</th></tr><tr>
        <td>${rateSel(a.self, `data-qr="${q.id}" data-f="self"`, p.editSelf)}</td>
        <td>${rateSel(a.mgr, `data-qr="${q.id}" data-f="mgr"`, p.editManager)}</td>
        <td><textarea class="${need ? 'err' : ''}" rows="1" data-qr="${q.id}" data-f="remark" ${p.editManager ? '' : 'disabled'}>${esc(a.remark || '')}</textarea>${need ? `<div class="flag">${diff ? 'Manager remark required: ratings differ.' : 'Remark required: rating is 5.'}</div>` : ''}</td></tr></table></td></tr>`;
    }).join('')}</table></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px">
    ${S.me.role === 'employee' || (!p.editSelf && !p.editManager) ? '' : '<button class="btn" id="save">Save draft</button>'}
    ${S.me.role !== 'employee' && S.me.role !== 'teamlead' || p.canSubmit ? `<button class="btn pri" id="submit" ${p.canSubmit ? '' : 'disabled title="Only managers and admins can submit the form"'}>Submit review</button>` : ''}
    </div>`;
  wireForm(v);
}

let changeSeq = 0; // only the latest form change redraws, so an older autosave cannot undo the jump to a remark
function wireForm(v) {
  const { form: f } = FP;
  $('#msel').onchange = e => { location.hash = `#/form/${f.empId}/${e.target.value}`; };
  v.oninput = e => {
    const t = e.target;
    if (t.id === 'reviewDate') f.reviewDate = t.value;
    else if (t.dataset.kw) f.kras[t.dataset.kw].weight = +t.value;
    else if (t.dataset.k) { const r = f.kras[t.dataset.k].rows[+t.dataset.i]; r[t.dataset.f] = t.type === 'number' || t.tagName === 'SELECT' ? (t.value === '' ? null : +t.value) : t.value; }
    else if (t.dataset.qt) f.qa[t.dataset.qt] = t.value;
    else if (t.dataset.qr) { const a = f.qa[t.dataset.qr] ||= {}; a[t.dataset.f] = t.type === 'number' || t.tagName === 'SELECT' ? (t.value === '' ? null : +t.value) : t.value; }
  };
  // re-render on blur-ish changes so remark requirements update
  v.onchange = async e => {
    if (e.target.id === 'msel' || e.target.dataset.qt) return;
    // employees have no Save draft button, so their entries are saved as they type
    const mine = ++changeSeq;
    if (S.me.role === 'employee' && (FP.perms.editSelf || FP.perms.editManager)) { try { await save(); } catch (er) { toast(er.message, 'err'); } }
    if (mine !== changeSeq) return; // a newer change is in flight; it will redraw (and keep any remark focus)
    const y = window.scrollY; drawForm(v); window.scrollTo(0, y);
    // a rating of 5 needs a remark: move straight to it
    const t = e.target;
    if (t.tagName === 'SELECT' && t.value === '5') {
      const sel = t.dataset.k ? `textarea[data-k="${t.dataset.k}"][data-i="${t.dataset.i}"][data-f="${t.dataset.f === 'self' ? 'selfRemark' : 'mgrRemark'}"]`
        : t.dataset.qr ? `textarea[data-qr="${t.dataset.qr}"][data-f="remark"]` : null;
      const box = sel && v.querySelector(sel);
      if (box && !box.disabled && !box.value.trim()) { box.focus({ preventScroll: true }); box.scrollIntoView({ block: 'center' }); toast('Rating 5 given: please add a remark.'); }
    }
  };
  $('#tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) $('#sec-' + b.dataset.t).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const secs = ['operational', 'process', 'people', 'questionnaire'].map(k => $('#sec-' + k));
  window.onscroll = () => {
    if (!$('#tabs')) return;
    let cur = 0; secs.forEach((s, i) => { if (s.getBoundingClientRect().top < 140) cur = i; });
    document.querySelectorAll('#tabs button').forEach((b, i) => b.classList.toggle('on', i === cur));
  };
  const save = async () => { FP = await api('/form', { method: 'PUT', body: { empId: f.empId, month: f.month, reviewDate: f.reviewDate, kras: f.kras, qa: f.qa } }); };
  const redraw = () => { const y = window.scrollY; drawForm(v); window.scrollTo(0, y); };
  // question answers: the pencil opens a box; clicking away saves it and closes the box
  v.querySelectorAll('textarea[data-qt]').forEach(ta => {
    ta.onblur = async () => {
      await Promise.resolve();
      if (!ta.isConnected) return; // the box was replaced by a redraw, not left by the user
      const id = ta.dataset.qt;
      if (focusQ === id) focusQ = null;
      editingQ.delete(id);
      f.qa[id] = ta.value;
      if (ta.value === qOriginal[id]) return redraw();
      try { await save(); toast('Answer saved'); } catch (er) { editingQ.add(id); toast(er.message, 'err'); }
      redraw();
    };
  });
  if (focusQ) { const ta = v.querySelector(`textarea[data-qt="${focusQ}"]`); if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); } }
  if ($('#save')) $('#save').onclick = async () => { try { await save(); toast('Draft saved'); drawForm(v); } catch (e) { toast(e.message, 'err'); } };
  if ($('#submit')) $('#submit').onclick = async () => {
    attempted = true;
    try { await save(); FP = await api('/form/submit', { method: 'POST', body: { empId: f.empId, month: f.month } }); attempted = false; toast('Review submitted'); drawForm(v); }
    catch (e) { drawForm(v, e.data?.errors || [e.message]); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };
  v.onclick = async e => {
    const t = e.target, post = (u, b) => api(u, { method: 'POST', body: { empId: f.empId, month: f.month, ...b } });
    try {
      const qe = t.closest('[data-qedit]'); // the click usually lands on the pencil's svg, not the button
      if (qe) { const id = qe.dataset.qedit; editingQ.add(id); focusQ = id; qOriginal[id] = f.qa[id] || ''; redraw(); }
      else if (t.dataset.add) { const k = t.dataset.add; f.kras[k].rows.push({ id: k[0] + Date.now(), kpi: '', target: '', weight: 0, self: null, selfRemark: '', mgr: null, mgrRemark: '' }); drawForm(v); }
      else if (t.dataset.del) { const [k, i] = t.dataset.del.split(':'); f.kras[k].rows.splice(+i, 1); drawForm(v); }
      else if (t.dataset.savek) {
        const k = t.dataset.savek;
        try { await save(); FP = await api('/kras', { method: 'PUT', body: { empId: f.empId, month: f.month, kras: { [k]: f.kras[k] } } }); toast('KRA saved'); drawForm(v); }
        catch (er) { drawForm(v, er.data?.errors || [er.message]); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      }
      else if (t.id === 'copyk') {
        if (!confirm('Replace this month\'s KRAs with last month\'s KRAs? Ratings and remarks for this month will be cleared.')) return;
        FP = await post('/form/copy-kras'); toast('KRAs copied from last month'); drawForm(v);
      }
      else if (t.id === 'kreq') { FP = await post('/form/kra-request'); toast('Request sent to your manager'); drawForm(v); }
      else if (t.dataset.kapp) { FP = await post('/form/kra-approve', { approve: t.dataset.kapp === '1' }); toast(t.dataset.kapp === '1' ? 'Approved' : 'Declined'); drawForm(v); }
    } catch (er) { toast(er.message, 'err'); }
  };
  if ($('#req')) $('#req').onclick = async () => { await api('/form/request-edit', { method: 'POST', body: { empId: f.empId, month: f.month } }); toast('Edit access requested'); };
  if ($('#unlock')) $('#unlock').onclick = async () => { FP = await api('/form/unlock', { method: 'POST', body: { empId: f.empId, month: f.month } }); drawForm(v); };
}

// ---------- team reviews ----------
pages.team = async v => {
  const d = await api('/report?month=' + S.month);
  v.innerHTML = head('Team Reviews', 'PMS › Team Reviews') + `<div class="row">${monthSel()}</div>` + reportTable(d.rows);
  onMonth(() => pages.team(v));
};
const reportTable = rows => `<div class="tablewrap"><table><tr><th>Manager / team</th><th>Employee</th><th>Scheduled</th><th>Due</th><th>Actual</th><th>Status</th><th>Rating</th><th>Flags</th></tr>
  ${rows.map(r => `<tr><td>${esc(r.manager)} / ${esc(r.team)}</td><td>${nameLink(r.empId, r.name)}</td><td>${fmtD(r.scheduled)}</td><td>${fmtD(r.due)}</td><td>${fmtD(r.actual)}${r.actual ? `<br>${badge(r.dueStatus)}` : ''}</td><td>${badge(r.status)}</td><td>${r.rating ?? '–'}</td><td class="flag">${r.flags.map(esc).join('<br>') || '–'}</td></tr>`).join('') || '<tr><td colspan="8">No reviews in your access for this month.</td></tr>'}</table></div>`;

// ---------- review status report ----------
const RF = { view: null, team: '', manager: '', status: '' };
pages.report = async v => {
  const q = `month=${S.month}&team=${RF.team}&manager=${RF.manager}&status=${encodeURIComponent(RF.status)}`;
  const d = await api('/report?' + q);
  const full = ['director', 'admin'].includes(S.me.role);
  RF.view ||= full ? 'org' : 'team';
  const c = d.counts;
  v.innerHTML = head('Review status report', 'PMS › Review Status Report (one report, two views) · ' + d.scope) +
    `<div class="row">${monthSel()}
    ${full ? `<button class="btn ${RF.view === 'org' ? 'pri' : ''}" data-view="org">Organisation-wise</button>` : ''}<button class="btn ${RF.view === 'team' ? 'pri' : ''}" data-view="team">Team-wise</button>
    <select id="fteam"><option value="">All teams</option>${d.teams.map(t => `<option ${t === RF.team ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <select id="fmgr"><option value="">All managers</option>${d.managers.map(m => `<option value="${m.id}" ${String(m.id) === String(RF.manager) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
    <select id="fst"><option value="">All statuses</option>${['Completed and Submitted', 'Completed but Not Submitted', 'Review Not Completed', 'Pending'].map(s => `<option ${s === RF.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <span class="sp"></span><button class="btn yel" id="exp">Export (CSV)</button></div>
    <div class="tiles"><div class="tile"><b>${c.scheduled}</b><span>Scheduled</span></div><div class="tile g"><b>${c.submitted}</b><span>Completed and submitted</span></div><div class="tile a"><b>${c.notSubmitted}</b><span>Completed but not submitted</span></div><div class="tile r"><b>${c.notCompleted}</b><span>Not completed</span></div><div class="tile b"><b>${c.pending}</b><span>Pending</span></div></div>
    ${RF.view === 'team' ? `<h2>Team-wise</h2><div class="tablewrap"><table><tr><th>Manager / team</th><th>Scheduled</th><th>Submitted</th><th>Not submitted</th><th>Not completed</th><th>Pending</th></tr>${d.teamCounts.map(t => `<tr><td>${esc(t.name)}</td><td>${t.scheduled}</td><td>${t.submitted}</td><td>${t.notSubmitted}</td><td>${t.notCompleted}</td><td>${t.pending}</td></tr>`).join('')}</table></div>` : ''}
    <h2>${RF.view === 'org' ? 'Employee-wise (organisation)' : 'Employee-wise'}</h2>${reportTable(d.rows)}
    <p class="small">Directors see the whole organisation. Managers see their own team and everyone under them at every level. Employees do not see this report.</p>`;
  onMonth(() => pages.report(v));
  v.onclick = async e => {
    if (e.target.dataset.view) { RF.view = e.target.dataset.view; pages.report(v); }
    if (e.target.id === 'exp') { const r = await api('/report.csv?' + q); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' })); a.download = `PMS_status_${S.month}.csv`; a.click(); }
  };
  $('#fteam').onchange = e => { RF.team = e.target.value; pages.report(v); };
  $('#fmgr').onchange = e => { RF.manager = e.target.value; pages.report(v); };
  $('#fst').onchange = e => { RF.status = e.target.value; pages.report(v); };
};

// ---------- scheduling ----------
pages.scheduling = async v => {
  const d = await api('/scheduling?month=' + S.month);
  v.innerHTML = head('Review scheduling', 'PMS › Scheduling') + `<div class="row">${monthSel()}<span class="sp"></span><span class="small">Pick a review date for each team member. Use Reschedule to change a date that is already set.</span></div>
  <h2>Review windows</h2><div class="tablewrap"><table><tr><th>Team</th><th>Window</th><th>Dates collected on</th><th>Scheduled</th></tr>${d.windows.map(w => `<tr><td>${esc(w.team)}</td><td>${fmtD(w.start)} to ${fmtD(w.end)}</td><td>${fmtD(w.collectedOn)}</td><td><span class="badge ${w.collected === w.total ? 'b-green' : 'b-amber'}">${w.collected} of ${w.total}</span></td></tr>`).join('')}</table></div>
  <h2>Team members</h2><div class="tablewrap"><table><tr><th>Employee</th><th>Team</th><th>Schedule date</th><th>Rescheduled</th><th>Actual date (from form)</th><th>Status</th></tr>
  ${d.rows.map(r => `<tr><td>${nameLink(r.empId, r.name)}</td><td>${esc(r.team)}</td>
  <td>${r.scheduled ? `${fmtD(r.scheduled)} <button class="btn sm" data-resch="${r.empId}">Reschedule</button>` : `<input type="date" data-sch="${r.empId}">`}</td>
  <td>${r.reschedules ? `${r.reschedules}× <span class="small">${r.history.map(h => fmtD(h.from)).join(' → ')} → ${fmtD(r.scheduled)}</span>` : '–'}</td>
  <td>${r.actual ? `${fmtD(r.actual)} ${badge(r.dueStatus)}` : '<span class="small">Not held yet</span>'}</td><td>${badge(r.status)}</td></tr>`).join('')}</table></div>
  <p class="small">The actual date is the Review Date entered on the employee's monthly form. Reports use the scheduled (or rescheduled) date from this page and the actual date from the form.</p>`;
  onMonth(() => pages.scheduling(v));
  v.onchange = async e => {
    const id = e.target.dataset.sch; if (!id || !e.target.value) return;
    try { await api('/scheduling/schedule', { method: 'POST', body: { empId: id, month: S.month, date: e.target.value } }); toast('Review scheduled'); pages.scheduling(v); } catch (er) { toast(er.message, 'err'); }
  };
  v.onclick = e => {
    const id = e.target.dataset.resch; if (!id) return;
    const m = modal(`<h2>Reschedule review</h2><label class="f">New date <i>*</i></label><input type="date" id="nd"><div class="row" style="margin-top:14px"><button class="btn pri" id="ok">Save</button><button class="btn" id="no">Cancel</button></div>`);
    m.querySelector('#no').onclick = () => m.remove();
    m.querySelector('#ok').onclick = async () => { try { await api('/scheduling/reschedule', { method: 'POST', body: { empId: id, month: S.month, date: m.querySelector('#nd').value } }); m.remove(); pages.scheduling(v); } catch (er) { toast(er.message, 'err'); } };
  };
};

// ---------- emails ----------
pages.emails = async v => {
  const list = await api('/emails?month=' + S.month);
  v.innerHTML = head('Manager emails', 'PMS › Reports and Export › Email preview') + `<div class="row">${monthSel()}<button class="btn yel" id="gen">Generate emails</button><span class="small">Local demo: "Send now" records the email in the audit log; no real mail is sent. Emails are never sent automatically.</span></div>
  <div class="row" style="align-items:flex-start"><div class="card" style="min-width:230px">${list.map(m => `<div class="row" style="margin:0 0 6px"><a href="#/emails" data-m="${m.managerId}" style="color:var(--navy);font-weight:600;cursor:pointer">${esc(m.name)}</a><span class="small">${esc(m.team)}</span><span class="sp"></span><span class="badge ${m.state === 'sent' ? 'b-green' : m.state === 'draft' ? 'b-amber' : 'b-grey'}">${m.state}</span></div>`).join('') || 'No teams in your access.'}</div><div class="sp" id="prev" style="min-width:300px"></div></div>`;
  onMonth(() => pages.emails(v));
  const show = async id => {
    const e = await api(`/email?manager=${id}&month=${S.month}`);
    const sx = (t, arr) => `<h4>${t}</h4><ul>${arr.map(x => `<li class="${x.hot ? 'hot' : ''}">${esc(x.text)}</li>`).join('') || '<li>No issues.</li>'}</ul>`;
    const c = e.counts;
    $('#prev').innerHTML = `<div class="row"><b>Subject:</b> ${esc(e.subject)}<span class="sp"></span><button class="btn pri" id="send" ${e.state === 'sent' ? 'disabled' : ''}>${e.state === 'sent' ? 'Sent' : 'Send now'}</button></div>
    <div class="mail"><div class="small">To: ${esc(e.to)}</div><p>Hi ${esc(e.to.split(' ')[0])}, here is how the ${esc(S.me.months.find(x => x.key === S.month).label.split(' ')[0])} reviews went for your team. The full report is attached.</p>
    ${sx('Review completion', [{ text: e.sections.completion[0] }])}${sx('Form filling and Operational KRA', e.sections.form)}${sx('Process KRA', e.sections.process)}${sx('People KRA', e.sections.people)}${sx('Rating and weightage', e.sections.rating)}
    <p class="small">Counts: ${c.scheduled} scheduled · ${c.submitted} submitted · ${c.notSubmitted} not submitted · ${c.notCompleted} not completed · ${c.pending} pending<br>Attachment: ${esc(e.attachment)}</p></div>`;
    $('#send').onclick = async () => { await api('/emails/send', { method: 'POST', body: { managerId: id, month: S.month } }); toast('Marked as sent (demo)'); pages.emails(v); };
  };
  v.onclick = async e => {
    if (e.target.dataset.m) { e.preventDefault(); show(e.target.dataset.m); }
    if (e.target.id === 'gen') { const r = await api('/emails/generate', { method: 'POST', body: { month: S.month } }); toast(`${r.created} draft(s) created`); pages.emails(v); }
  };
  if (list[0]) show(list[0].managerId);
};

// ---------- annual ----------
pages.annual = async (v, emp) => {
  const d = await api('/annual?emp=' + (emp || S.me.id));
  const a = { ...d.annual }, p = d.perms;
  const list = ['manager', 'teamlead', 'director', 'admin'].includes(S.me.role) ? (await api('/report?month=' + S.me.currentMonth)).rows : [];
  v.innerHTML = head('Annual review', `PMS › Annual Review › ${esc(d.employee.name)} · ${d.fy}`) +
    `${list.length ? `<div class="row"><select id="who"><option value="${S.me.id}">Myself</option>${list.map(r => `<option value="${r.empId}" ${r.empId === d.employee.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>` : ''}
  <h2>One-page summary <span class="small">(${d.months.filter(m => m.filled).length} of 12 months filled; fills as each monthly review finishes)</span></h2>
  <div class="row"><b>${esc(d.employee.name)}</b> (${esc(d.employee.designation)}) · ${d.fy} (April 2026 to March 2027)<span class="sp"></span><button class="btn yel" onclick="window.print()">Download PDF (print)</button></div>
  <div class="tablewrap"><table><tr><th>Month</th><th>KRA weightage (Op / Pro / Peo)</th><th>Work summary</th><th>Self</th><th>Manager</th><th>Monthly rating</th><th>Learnings, SOPs</th><th>Highlights and gaps</th></tr>
  ${d.months.map(m => m.filled ? `<tr><td>${esc(m.label.split(' ')[0])}</td><td title="${esc(m.subKras.join(' | '))}">${m.weightage}</td><td>${esc(m.work)}<div class="small">${esc(m.selfRemarks[0] || '')}</div></td><td>${m.self ?? '–'}</td><td>${m.mgr ?? '–'}<div class="small">${esc(m.mgrRemarks[0] || '')}</div></td><td>${m.rating ?? '–'}</td><td class="small">${m.learn.length ? 'Learning: ' + esc(m.learn.join(', ')) + '<br>' : ''}${m.sop.length ? 'SOP: ' + esc(m.sop.join(', ')) : ''}</td><td class="flag">${m.highlights.map(esc).join('<br>') || '–'}</td></tr>` : `<tr><td>${esc(m.label.split(' ')[0])}</td><td colspan="7" class="small">Fills in automatically as each monthly review finishes.</td></tr>`).join('')}</table></div>
  <p class="small">The summary is a reference; it does not replace the annual review form below.</p>
  <h2>Annual review form</h2><div class="card" id="af">
  <div class="formhead">Annual Review ${d.fy} (April 2026 to March 2027)</div><div class="small" style="margin-top:6px">Fields are placeholders until the annual form format is supplied.</div>
  <div id="aerr"></div>
  <label class="f">Review Date <i>*</i></label><input type="date" id="ard" value="${esc(a.reviewDate)}" ${p.editSelf || p.editMgr ? '' : 'disabled'}>
  <label class="f">Key accomplishments this year</label><textarea id="aacc" ${p.editSelf ? '' : 'disabled'}>${esc(a.accomplishments)}</textarea>
  <label class="f">KRA-wise reflection (Operational, Process, People)</label><textarea id="akra" ${p.editSelf ? '' : 'disabled'}>${esc(a.kraReflection)}</textarea>
  <label class="f">Learnings and SOPs prepared</label><textarea id="alrn" ${p.editSelf ? '' : 'disabled'}>${esc(a.learnings)}</textarea>
  <div class="row"><div><label class="f">Self rating</label><input class="num" type="number" id="asr" value="${a.selfRating ?? ''}" ${p.editSelf ? '' : 'disabled'}></div><div><label class="f">Manager rating</label><input class="num" type="number" id="amr" value="${a.mgrRating ?? ''}" ${p.editMgr ? '' : 'disabled'}></div></div>
  <label class="f">Manager remark</label><textarea id="arm" ${p.editMgr ? '' : 'disabled'}>${esc(a.mgrRemark)}</textarea>
  ${a.submitted ? '<div class="ok">Annual review submitted.</div>' : `<div class="row" style="justify-content:flex-end;margin-top:10px">${p.editSelf || p.editMgr ? '<button class="btn" id="asave">Save draft</button>' : ''}<button class="btn pri" id="asub" ${p.submit ? '' : 'disabled title="Only managers and admins submit the form"'}>Submit annual review</button></div>`}</div>`;
  if ($('#who')) $('#who').onchange = e => { location.hash = '#/annual/' + e.target.value; };
  const body = sub => ({ empId: d.employee.id, reviewDate: $('#ard').value, accomplishments: $('#aacc').value, kraReflection: $('#akra').value, learnings: $('#alrn').value, selfRating: $('#asr').value, mgrRating: $('#amr').value, mgrRemark: $('#arm').value, submit: sub });
  const go = async sub => { try { await api('/annual', { method: 'PUT', body: body(sub) }); toast(sub ? 'Annual review submitted' : 'Draft saved'); pages.annual(v, d.employee.id); } catch (e) { $('#aerr').innerHTML = errBox(e); } };
  if ($('#asave')) $('#asave').onclick = () => go(false);
  if ($('#asub')) $('#asub').onclick = () => go(true);
};

// ---------- parameters summary ----------
pages.params = async v => {
  const admin = S.me.role === 'admin';
  const d = await api('/params?month=' + S.month);
  let P = JSON.parse(JSON.stringify(d.data));
  const draw = (dirty) => {
    v.innerHTML = head('Parameters Summary', 'PMS › Parameters Summary' + (admin ? ' (admin view)' : '')) + `<div class="row">${monthSel()}<span class="small">Version applying from ${esc(d.from)}</span><span class="sp"></span>${admin ? `<button class="btn yel" data-a="addsec">+ Add section</button>` : ''}</div>
    ${P.sections.map((s, si) => `<div class="card pcard"><div class="phead"><b>${esc(s.title)}:</b>${admin ? `<span class="acts"><button class="btn sm" data-a="editsec" data-s="${si}">Edit section</button><button class="btn sm dng" data-a="delsec" data-s="${si}">Delete section</button></span>` : ''}</div>
      ${s.items.map((it, ii) => `<div class="pitem"><span class="pn">${ii + 1}.</span><span class="pt">${esc(it)}</span>${admin ? `<span class="acts"><button class="btn sm" data-a="edit" data-s="${si}" data-i="${ii}">Edit</button><button class="btn sm dng" data-a="del" data-s="${si}" data-i="${ii}">Delete</button></span>` : ''}</div>`).join('')}
      ${admin ? `<div style="padding-top:10px"><button class="btn sm pri" data-a="add" data-s="${si}">+ Add item</button></div>` : ''}</div>`).join('')}
    <div class="card pcard"><div class="phead"><b>Rating scale (applies to the parameters above):</b>${admin ? '<span class="acts"><button class="btn sm" data-a="scale">Edit scale</button></span>' : ''}</div>${P.scale.map(x => `<div class="pitem"><span class="pt">${esc(x)}</span></div>`).join('')}</div>
    ${admin ? `<div class="row" style="justify-content:flex-end"><button class="btn pri" id="savep" ${dirty ? '' : 'disabled'}>Save changes…</button></div><p class="small">Soft parameters here are not part of the monthly rating calculation. Changes apply from the month you choose and are written to the audit log.</p>` : ''}`;
    onMonth(() => pages.params(v));
  };
  draw();
  const ask = (title, val, cb) => { const m = modal(`<h2>${title}</h2><textarea id="tv" style="min-height:80px">${esc(val)}</textarea><div class="row" style="margin-top:12px"><button class="btn pri" id="ok">OK</button><button class="btn" id="no">Cancel</button></div>`); m.querySelector('#no').onclick = () => m.remove(); m.querySelector('#ok').onclick = () => { const t = m.querySelector('#tv').value.trim(); if (t) { cb(t); m.remove(); draw(true); } }; };
  v.onclick = e => {
    const t = e.target, a = t.dataset.a, s = +t.dataset.s, i = +t.dataset.i;
    if (a === 'addsec') ask('New section title', '', x => P.sections.push({ id: 's' + Date.now(), title: x, items: [] }));
    if (a === 'editsec') ask('Edit section title', P.sections[s].title, x => P.sections[s].title = x);
    if (a === 'delsec' && confirm(`Delete section "${P.sections[s].title}"?`)) { P.sections.splice(s, 1); draw(true); }
    if (a === 'add') ask('New item', '', x => P.sections[s].items.push(x));
    if (a === 'edit') ask('Edit item', P.sections[s].items[i], x => P.sections[s].items[i] = x);
    if (a === 'del' && confirm('Delete this item?')) { P.sections[s].items.splice(i, 1); draw(true); }
    if (a === 'scale') ask('Rating scale (one line per level)', P.scale.join('\n'), x => P.scale = x.split('\n').map(z => z.trim()).filter(Boolean));
    if (t.id === 'savep') {
      const m = modal(`<h2>Apply from which review month?</h2><select id="eff">${S.me.months.map(x => `<option value="${x.key}" ${x.key === S.me.currentMonth ? 'selected' : ''}>${x.label}</option>`).join('')}</select><p class="small">Forms from this month onward (including future months) use the new wording. Submitted forms keep the earlier wording.</p><div class="row"><button class="btn pri" id="ok">Save</button><button class="btn" id="no">Cancel</button></div>`);
      m.querySelector('#no').onclick = () => m.remove();
      m.querySelector('#ok').onclick = async () => { await api('/params', { method: 'PUT', body: { from: m.querySelector('#eff').value, data: P } }); m.remove(); toast('Saved'); pages.params(v); };
    }
  };
};

// ---------- questions (admin) ----------
pages.questions = async v => {
  const qs = await api('/questions');
  const tab = S.qtab || 'text';
  const list = qs.filter(q => q.type === tab && !q.to).sort((a, b) => a.order - b.order);
  v.innerHTML = head('List of Questions (admin)', 'PMS › Questions') + `<div class="row"><button class="btn ${tab === 'text' ? 'pri' : ''}" data-tab="text">Questions 1 to 5 (text answers)</button><button class="btn ${tab === 'rating' ? 'pri' : ''}" data-tab="rating">Questions 6 to 12 (ratings)</button><span class="sp"></span><button class="btn yel" data-a="new">+ Add New Question</button></div>
  <div class="tablewrap"><table><tr><th>No.</th><th>Question</th><th>Answer type</th><th>Mandatory</th><th>Applies from</th><th>Actions</th></tr>${list.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.text)}</td><td>${q.type === 'text' ? 'Text answer' : 'Rating (0 to 5)'}</td><td>${q.mandatory ? 'Yes' : 'No'}</td><td>${esc(q.from)}</td><td><button class="btn sm" data-a="up" data-id="${q.id}">↑</button> <button class="btn sm" data-a="down" data-id="${q.id}">↓</button> <button class="btn sm" data-a="edit" data-id="${q.id}">Edit</button> <button class="btn sm dng" data-a="del" data-id="${q.id}">Delete</button></td></tr>`).join('')}</table></div>
  <p class="small">Changes apply from the review month you choose. Forms already submitted keep the question and answers as they were. No limit on the number of questions.</p>`;
  const monthSelHtml = (sel) => `<select id="eff">${S.me.months.map(x => `<option value="${x.key}" ${x.key === sel ? 'selected' : ''}>${x.label}</option>`).join('')}</select>`;
  const dialog = (title, q) => {
    const m = modal(`<h2>${title}</h2><label class="f">Question text <i>*</i></label><textarea id="qt">${esc(q?.text || '')}</textarea>
    <label class="f">Answer type</label><select id="qty" ${q ? 'disabled' : ''}><option value="text" ${tab === 'text' ? 'selected' : ''}>Text answer</option><option value="rating" ${tab === 'rating' ? 'selected' : ''}>Rating</option></select>
    <label class="f">Mandatory</label><select id="qm"><option value="true" ${q?.mandatory !== false ? 'selected' : ''}>Yes</option><option value="false" ${q?.mandatory === false ? 'selected' : ''}>No</option></select>
    <label class="f">Applies from <i>*</i></label>${monthSelHtml(S.me.currentMonth)}<div class="info">Forms already submitted keep the old wording.</div>
    <div class="row"><button class="btn pri" id="ok">Save question</button><button class="btn" id="no">Cancel</button></div>`);
    m.querySelector('#no').onclick = () => m.remove();
    m.querySelector('#ok').onclick = async () => {
      const body = { id: q?.id, text: m.querySelector('#qt').value.trim(), type: m.querySelector('#qty').value, mandatory: m.querySelector('#qm').value === 'true', from: m.querySelector('#eff').value };
      try { await api('/questions', { method: q ? 'PUT' : 'POST', body }); m.remove(); pages.questions(v); } catch (e) { toast(e.message, 'err'); }
    };
  };
  v.onclick = async e => {
    const t = e.target, a = t.dataset.a;
    if (t.dataset.tab) { S.qtab = t.dataset.tab; pages.questions(v); }
    if (a === 'new') dialog('Add New Question');
    if (a === 'edit') dialog('Edit question', qs.find(q => q.id === t.dataset.id));
    if (a === 'up' || a === 'down') { await api('/questions/move', { method: 'POST', body: { id: t.dataset.id, dir: a } }); pages.questions(v); }
    if (a === 'del') {
      const q = qs.find(x => x.id === t.dataset.id);
      const m = modal(`<h2>Delete question?</h2><p>${esc(q.text)}</p><div class="warn">New forms from the chosen month will no longer show this question. Answers already submitted are kept and stay visible in past forms.</div><label class="f">Delete from <i>*</i></label>${monthSelHtml(S.me.currentMonth)}<div class="row" style="margin-top:12px"><button class="btn dng" id="ok">Delete question</button><button class="btn" id="no">Cancel</button></div>`);
      m.querySelector('#no').onclick = () => m.remove();
      m.querySelector('#ok').onclick = async () => { await api('/questions/delete', { method: 'POST', body: { id: q.id, from: m.querySelector('#eff').value } }); m.remove(); pages.questions(v); };
    }
  };
};

// ---------- employees (admin) ----------
pages.employees = async v => {
  const d = await api('/employees');
  const tab = S.etab || 'active', q = (S.eq || '').toLowerCase(), fl = S.eteam || '';
  const rows = (tab === 'active' ? d.active : d.inactive).filter(e => (!q || e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q)) && (!fl || e.team === fl));
  v.innerHTML = head(`Employees: ${tab}`, 'PMS › Employees (admin view)') + `<div class="row"><button class="btn ${tab === 'active' ? 'pri' : ''}" data-tab="active">Active (${d.active.length})</button><button class="btn ${tab === 'inactive' ? 'pri' : ''}" data-tab="inactive">Inactive (${d.inactive.length})</button>
  <input id="eq" placeholder="Search by name or code…" value="${esc(S.eq || '')}"><select id="et"><option value="">All teams</option>${d.teams.map(t => `<option ${t === fl ? 'selected' : ''}>${t}</option>`).join('')}</select><span class="sp"></span><button class="btn yel" data-a="add">+ Add new member</button></div>
  <div class="tablewrap"><table><tr><th>Code</th><th>Employee</th><th>Designation</th><th>Team</th><th>Reporting manager</th><th>Joined</th><th>${tab === 'active' ? 'October review' : 'Inactive from'}</th>${tab === 'inactive' ? '<th>Reason</th>' : ''}<th>Actions</th></tr>
  ${rows.map(e => `<tr><td>${esc(e.code)}</td><td><a href="#/empforms/${e.id}" style="color:var(--navy);font-weight:600">${esc(e.name)}</a></td><td>${esc(e.designation)}</td><td>${esc(e.team)}</td><td>${esc(e.manager)}</td><td>${esc(e.joined)}</td><td>${tab === 'active' ? badge(e.reviewStatus) : esc(e.inactiveFrom)}</td>${tab === 'inactive' ? `<td>${esc(e.reason)}</td>` : ''}
  <td><a class="btn sm yel" href="#/empforms/${e.id}">${tab === 'active' ? 'Monthly forms' : 'Past forms'}</a> ${tab === 'active' ? `<button class="btn sm" data-a="off" data-id="${e.id}" data-n="${esc(e.name)}">Move to inactive</button>` : `<button class="btn sm pri" data-a="on" data-id="${e.id}">Reactivate</button>`}</td></tr>`).join('')}</table></div>
  <p class="small">Employee details would be synced from the HR tool; this demo keeps them in memory. Inactive employees are left out of schedules, counts, reports and emails; their past forms stay viewable.</p>`;
  v.oninput = e => { if (e.target.id === 'eq') { S.eq = e.target.value; const p = e.target.selectionStart; pages.employees(v).then(() => { const i = $('#eq'); i.focus(); i.setSelectionRange(p, p); }); } };
  v.onchange = e => { if (e.target.id === 'et') { S.eteam = e.target.value; pages.employees(v); } };
  v.onclick = async e => {
    const t = e.target, a = t.dataset.a;
    if (t.dataset.tab) { S.etab = t.dataset.tab; pages.employees(v); }
    if (a === 'add') {
      const m = modal(`<h2>Add new member</h2><div id="er"></div>${[['name', 'Full name'], ['code', 'Employee code'], ['email', 'Work email'], ['designation', 'Designation']].map(([k, l]) => `<label class="f">${l} <i>*</i></label><input id="n_${k}" style="width:100%">`).join('')}
      <label class="f">Team <i>*</i></label><select id="n_team">${d.teams.map(t => `<option>${t}</option>`).join('')}</select>
      <label class="f">Reporting manager <i>*</i></label><select id="n_managerId">${d.managers.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
      <label class="f">Date of joining <i>*</i></label><input type="date" id="n_joined"><label class="f">Access role <i>*</i></label><select id="n_role"><option value="employee">Employee</option><option value="teamlead">Team lead</option><option value="manager">Manager</option></select>
      <label class="f">Review window <i>*</i></label><select id="n_window"><option value="team">Same as team</option></select>
      <div class="info">New joiner: no KRAs are set yet, so only the questionnaire is checked. After 2 complete months the tool shows "need to set KRA of the month".</div><div class="row"><button class="btn pri" id="ok">Save member</button><button class="btn" id="no">Cancel</button></div>`);
      m.querySelector('#no').onclick = () => m.remove();
      m.querySelector('#ok').onclick = async () => { const b = {}; ['name', 'code', 'email', 'designation', 'team', 'managerId', 'joined', 'role', 'window'].forEach(k => b[k] = m.querySelector('#n_' + k).value); try { await api('/employees', { method: 'POST', body: b }); m.remove(); toast('Member added'); pages.employees(v); } catch (er) { m.querySelector('#er').innerHTML = errBox(er); } };
    }
    if (a === 'off') {
      const m = modal(`<h2>Move ${esc(t.dataset.n)} to inactive?</h2><div id="er"></div><p class="small">From the chosen date the employee is left out of review schedules, status counts, reports and manager emails. Past forms stay available.</p>
      <label class="f">Inactive from <i>*</i></label><input type="date" id="d"><label class="f">Reason <i>*</i></label><select id="r"><option>Resigned</option><option>Transferred out</option><option>Contract ended</option><option>Other</option></select><label class="f">Note (optional)</label><textarea id="note"></textarea>
      <div class="row"><button class="btn dng" id="ok">Move to inactive</button><button class="btn" id="no">Cancel</button></div>`);
      m.querySelector('#no').onclick = () => m.remove();
      const go = async confirmed => { try { const r = await api('/employees/inactive', { method: 'POST', body: { id: t.dataset.id, date: m.querySelector('#d').value, reason: m.querySelector('#r').value, note: m.querySelector('#note').value, confirm: confirmed } }); if (r.needsConfirm) { m.querySelector('#er').innerHTML = `<div class="warn">${esc(r.warning)} Click again to confirm.</div>`; m.querySelector('#ok').onclick = () => go(true); return; } m.remove(); pages.employees(v); } catch (er) { m.querySelector('#er').innerHTML = errBox(er); } };
      m.querySelector('#ok').onclick = () => go(false);
    }
    if (a === 'on') { await api('/employees/reactivate', { method: 'POST', body: { id: t.dataset.id } }); toast('Reactivated'); pages.employees(v); }
  };
};

pages.empforms = async (v, id) => {
  const d = await api('/employee-forms?emp=' + id), e = d.employee;
  v.innerHTML = head('Employee: monthly forms', `PMS › Employees › ${esc(e.name)}`) + `<div class="card"><b>${esc(e.name)}</b> (${esc(e.designation)}) · Code ${esc(e.code)} · Team ${esc(e.team)} · Manager ${esc(e.manager)} · Joined ${esc(e.joined)} <span class="badge ${e.active ? 'b-green' : 'b-grey'}">${e.active ? 'Active' : 'Inactive'}</span> · FY 2026-2027</div>
  <div class="tablewrap"><table><tr><th>Month</th><th>Review date</th><th>Status</th><th>Manager rating</th><th>Form</th></tr>${d.rows.map(r => `<tr style="${r.open ? '' : 'opacity:.55'}"><td>${esc(r.label)}</td><td>${fmtD(r.reviewDate)}</td><td>${badge(r.status)}</td><td>${r.rating ?? '–'}</td><td>${r.open ? `<a class="btn sm yel" href="#/form/${e.id}/${r.month}">Open form</a>` : '<button class="btn sm" disabled>Open form</button>'}</td></tr>`).join('')}
  <tr><td><b>Annual Review 2027</b></td><td>–</td><td>${badge(d.annual === 'Submitted' ? 'Completed and Submitted' : 'Not started')}</td><td>–</td><td><a class="btn sm yel" href="#/annual/${e.id}">Open form</a></td></tr></table></div>`;
};

// ---------- reporting manager (admin) ----------
pages.reporting = async (v, level) => {
  level = decodeURIComponent(level || 'Manager');
  const list = await api('/reporting?level=' + encodeURIComponent(level));
  v.innerHTML = head('Reporting Manager: ' + esc(level), 'PMS › Reporting Manager › ' + esc(level)) + `<div class="row">${['Directors', 'Senior Manager', 'Manager', 'Senior Executives'].map(l => `<a class="btn ${l === level ? 'pri' : ''}" href="#/reporting/${encodeURIComponent(l)}">${l}</a>`).join('')}</div>
  <div class="tablewrap"><table><tr><th></th><th>Name</th><th>Designation</th><th>Email</th><th>Employees (direct)</th><th>Director</th><th>Team report</th><th>MIS report</th></tr>
  ${list.map(p => `<tr><td><button class="btn sm" data-x="${p.id}">▸</button></td><td><a href="#/person/${p.id}" style="color:var(--navy);font-weight:600">${esc(p.name)}</a></td><td>${esc(p.designation)}</td><td>${esc(p.email)}</td><td>${p.employees}</td><td>${esc(p.director)}</td><td><a class="btn sm yel" href="#/report">Team report</a></td><td><button class="btn sm" data-mis="1">MIS report</button></td></tr>
  <tr class="sub" id="x${p.id}" hidden><td></td><td colspan="7">${p.team.map(t => `${nameLink(t.id, t.name)} <span class="small">${esc(t.designation)}</span> ${badge(t.status)} <a class="btn sm" href="#/empforms/${t.id}">Monthly forms</a>`).join('<br>') || '<span class="small">No team members.</span>'}</td></tr>`).join('') || '<tr><td colspan="8">No people at this level.</td></tr>'}</table></div>
  <p class="small">Open points: whether the Employees count includes indirect reports, and what the MIS report contains, are still to be confirmed. The count here is direct reports only.</p>`;
  v.onclick = e => { const x = e.target.dataset.x; if (x) { const r = $('#x' + x); r.hidden = !r.hidden; } if (e.target.dataset.mis) toast('MIS report contents are still to be defined'); };
};
pages.person = async (v, id) => {
  const d = await api('/reporting/person?id=' + id), p = d.person, c = d.counts;
  v.innerHTML = head('Details: ' + esc(p.name), `PMS › Reporting Manager › ${esc(p.name)}`) + `<div class="card"><b>${esc(p.name)}</b> (${esc(p.designation)}) · ${esc(p.email || '')} · Director: ${esc(p.director)} · Team of ${d.team.length} <span class="sp"></span> <a class="btn sm yel" href="#/form/${p.id}/${S.me.currentMonth}">Own forms</a></div>
  <div class="tiles"><div class="tile"><b>${c.scheduled}</b><span>Scheduled</span></div><div class="tile g"><b>${c.submitted}</b><span>Submitted</span></div><div class="tile a"><b>${c.notSubmitted}</b><span>Not submitted</span></div><div class="tile r"><b>${c.notCompleted}</b><span>Not completed</span></div><div class="tile b"><b>${c.pending}</b><span>Pending</span></div></div>
  <div class="tablewrap"><table><tr><th>Name</th><th>Designation</th><th>Review date</th><th>October review</th><th>Rating</th><th>Forms</th></tr>${d.team.map(t => `<tr><td>${nameLink(t.id, t.name)}</td><td>${esc(t.designation)}</td><td>${fmtD(t.reviewDate)}</td><td>${badge(t.status)}</td><td>${t.rating ?? '–'}</td><td><a class="btn sm yel" href="#/empforms/${t.id}">Monthly forms</a></td></tr>`).join('')}</table></div>`;
};

// ---------- audit & settings ----------
pages.audit = async v => {
  const rows = await api('/audit');
  v.innerHTML = head('Audit log', 'PMS › Audit Log') + `<div class="tablewrap"><table><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr>${rows.map(r => `<tr><td>${esc(new Date(r.at).toLocaleString())}</td><td>${esc(r.who)}</td><td>${esc(r.action)}</td><td>${esc(r.detail)}</td></tr>`).join('')}</table></div>`;
};
pages.config = async v => {
  const c = await api('/config');
  v.innerHTML = head('Settings', 'PMS › Settings · thresholds and review windows are configuration, not code') + `<div class="card">${[['operationalRange', 'Operational weightage range (min,max)'], ['peopleMin', 'People weightage minimum'], ['peopleMax', 'People weightage maximum'], ['clickupMin', 'ClickUp manager rating minimum'], ['learningMin', 'Learning manager rating minimum'], ['ratingGapFlag', 'Self vs manager gap flag'], ['emailGapFlag', 'Gap highlighted in the email']].map(([k, l]) => `<label class="f">${l}</label><input data-c="${k}" value="${esc([].concat(c[k]).join(','))}">`).join('')}
  <h2>Review windows (day of month)</h2>${Object.entries(c.windows).map(([t, w]) => `<div class="row"><b style="width:100px">${esc(t)}</b>from <input class="num" data-w="${t}" data-e="start" value="${w.start}"> to <input class="num" data-w="${t}" data-e="end" value="${w.end}"></div>`).join('')}
  <button class="btn pri" id="sc">Save settings</button></div>`;
  $('#sc').onclick = async () => {
    const b = { windows: JSON.parse(JSON.stringify(c.windows)) };
    document.querySelectorAll('[data-c]').forEach(i => { const k = i.dataset.c; b[k] = k === 'operationalRange' ? i.value.split(',').map(Number) : Number(i.value); });
    document.querySelectorAll('[data-w]').forEach(i => b.windows[i.dataset.w][i.dataset.e] = Number(i.value));
    await api('/config', { method: 'PUT', body: b }); toast('Settings saved');
  };
};

boot();

// ---------- annual appraisal form (6 steps) ----------
let AP = null, apStep = 1;
const AP_STEPS = ['Information', 'Yearly Recap', 'KRA Progress', 'KSA Setting', 'Self-KRA', 'Review & Submit'];
const apFilled = f => [f.recap.some(r => (r.expectation + r.achievements + r.improvement).trim()), f.kraProgress.some(r => (r.kra + r.progress).trim()), ...['strengths', 'improvements', 'operational', 'process', 'people'].map(k => f[k].trim())].filter(Boolean).length;
const apPct = f => Math.round(apFilled(f) / 7 * 100);
const apWhen = iso => new Date(iso).toLocaleString('en-GB');

async function drawAppraisal(v, emp) {
  AP = await api('/appraisal?emp=' + emp); apStep = 1;
  paintAppraisal(v);
}

function paintAppraisal(v) {
  const { employee: e, form: f, perms } = AP, ed = perms.edit, sub = !!f.submittedAt;
  const dis = ed ? '' : 'disabled';
  const field = (label, val) => `<div class="apf"><label>${label}</label><div class="apv">${esc(val)}</div></div>`;
  const ta = (k, rows = 8) => `<textarea class="aptext" rows="${rows}" data-ap="${k}" ${dis}>${esc(f[k])}</textarea>`;
  const block = (title, hint, body) => `<div class="apblock"><div class="apside"><b>${title}</b><span>${hint}</span></div><div class="apmain">${body}</div></div>`;
  const recapRows = () => f.recap.map((r, i) => `<tr><td>${i + 1}</td>${['expectation', 'achievements', 'improvement'].map(k => `<td><textarea rows="3" data-aprow="recap:${i}:${k}" ${dis}>${esc(r[k])}</textarea></td>`).join('')}<td>${ed ? `<button class="xdel" data-apdel="recap:${i}" title="Remove row">✖</button>` : ''}</td></tr>`).join('');
  const kraRows = () => f.kraProgress.map((r, i) => `<tr><td><textarea rows="3" data-aprow="kraProgress:${i}:kra" ${dis}>${esc(r.kra)}</textarea></td><td><textarea rows="3" data-aprow="kraProgress:${i}:progress" ${dis}>${esc(r.progress)}</textarea></td><td>${ed ? `<button class="xdel" data-apdel="kraProgress:${i}" title="Remove row">✖</button>` : ''}</td></tr>`).join('');
  const nl = t => esc(t).replace(/\n/g, '<br>') || '—';
  const sections = [
    ['Yearly Recap', `<table class="aptbl"><tr><th>#</th><th>Expectation (Year Beginning)</th><th>Achievements During the Year</th><th>Improvement</th></tr>${f.recap.map((r, i) => `<tr><td>${i + 1}</td><td>${nl(r.expectation)}</td><td>${nl(r.achievements)}</td><td>${nl(r.improvement)}</td></tr>`).join('')}</table>`],
    ['KRA Progress', `<table class="aptbl"><tr><th>KRA</th><th>Progress</th></tr>${f.kraProgress.map(r => `<tr><td><b>${nl(r.kra)}</b></td><td>${nl(r.progress)}</td></tr>`).join('')}</table>`],
    ['Key Strengths', `<div class="apbox">${nl(f.strengths)}</div>`], ['Area of Improvement', `<div class="apbox">${nl(f.improvements)}</div>`],
    ['Operational KRA', `<div class="apbox">${nl(f.operational)}</div>`], ['Process KRA', `<div class="apbox">${nl(f.process)}</div>`], ['People KRA', `<div class="apbox">${nl(f.people)}</div>`],
  ];
  const pct = apPct(f);
  const steps = [
    ['Information', 'Your details for this appraisal. They come from your employee record.', `<div class="apgrid">${field('Employee', e.name)}${field('Designation', e.designation)}${field('Department', e.department)}${field('Reviewer', e.reviewer)}</div>`],
    ['Yearly Recap', 'Set your expectations at year beginning, document achievements during the year, and note areas for improvement. Add more rows as needed.',
      `<table class="aptbl edit"><tr><th style="width:36px">#</th><th>Expectation (Year Beginning)</th><th>Achievements During the Year</th><th>Improvement</th><th style="width:36px"></th></tr>${recapRows()}</table>${ed ? '<button class="btn sm" data-apadd="recap">+ Add Row</button>' : ''}`],
    ['KRA Progress', 'Describe your progress against each key result area. Add more rows as needed.',
      `<table class="aptbl edit"><tr><th style="width:30%">KRA</th><th>Progress</th><th style="width:36px"></th></tr>${kraRows()}</table>${ed ? '<button class="btn sm" data-apadd="kraProgress">+ Add Row</button>' : ''}`],
    ['KSA Setting', 'Identify your key strengths and areas where you can grow to enhance your performance.',
      block('Key Strengths', 'Identify skills, attributes, and expertise that contributed significantly to your success. Focus on competencies that set you apart and provide specific instances of impact.', ta('strengths')) +
      block('Area of Improvement', 'Reflect on aspects where growth could enhance performance. Consider feedback, challenges faced, or new skills needed. Provide a real-life scenario to make it actionable.', ta('improvements'))],
    ['Self-KRA Setting', 'Set your own key result areas across three dimensions: Operational, Process, and People.',
      block('Operational', 'Define key responsibilities that drive efficiency and effectiveness. Identify tasks contributing to productivity, accuracy, and workflow improvements.', ta('operational')) +
      block('Process', 'Identify areas to optimize workflows, automate tasks, or enhance accuracy. Include best practices that drive operational excellence.', ta('process')) +
      block('People', 'Emphasize continuous learning, skill enhancement, and knowledge sharing. Set goals for new skills, training, and mentoring others.', ta('people'))],
    ['Review & Submit', '', `<div class="approg"><div class="row" style="margin:0"><b style="font-size:16px">Overall Completion</b><span class="sp"></span><b style="color:var(--blu);font-size:18px">${pct}%</b></div><div class="apbar"><i style="width:${pct}%"></i></div></div>
      <div class="apgrid" style="margin:14px 0">${field('Employee', e.name)}${field('Designation', e.designation)}${field('Department', e.department)}${field('Reviewer', e.reviewer)}</div>
      ${sections.map(([t, h]) => `<div class="aph">${t.toUpperCase()}</div>${h}`).join('')}
      ${sub ? `<div class="ok" style="font-weight:700;margin-top:14px">✔ Submitted on ${apWhen(f.submittedAt)}</div>` : ''}`],
  ];
  const [title, desc, body] = steps[apStep - 1];
  v.innerHTML = head('Appraisal Form ' + AP.fy, `PMS › ${esc(e.name)} › Annual Review`) +
    `<div class="row"><select id="msel">${S.me.months.map(m => `<option value="${m.key}">${m.label.split(" ")[0]}</option>`).join('')}<option value="annual" selected>Annual Review</option></select>${sub ? '<span class="badge b-green">Submitted</span>' : ''}</div>
    <div class="apcard"><div class="aphead"><b class="aplogo">Verve <small>Advisory</small></b><span><b>Appraisal ${AP.fy}</b><small>PERFORMANCE REVIEW FORM</small></span></div>
    <div class="apsteps">${AP_STEPS.map((s, i) => `<button class="apstep ${i + 1 < apStep ? 'done' : ''} ${i + 1 === apStep ? 'cur' : ''}" data-apgo="${i + 1}"><i>${i + 1 < apStep ? '✓' : i + 1}</i><span>${s}</span></button>`).join('')}</div>
    <div class="apbody"><h2 class="aptitle">${title.toUpperCase()}</h2>${desc ? `<p class="apdesc">${desc}</p>` : ''}${body}</div>
    <div class="apfoot"><button class="btn" data-apgo="${apStep - 1}" ${apStep === 1 ? 'disabled' : ''}>← Previous</button><span class="sp"></span>
      ${apStep === 6 ? '<button class="btn" id="apxls" style="background:#1d6f42;color:#fff;border-color:#1d6f42">Download Excel</button>' : `<button class="btn pri" data-apgo="${apStep + 1}">Next →</button>`}
      ${ed ? `<button class="btn" id="apsub" style="background:#c9a84c;border-color:#c9a84c;color:#fff;font-weight:600">${sub ? 'Edit &amp; Resubmit' : 'Submit'}</button>` : ''}</div></div>`;
  wireAppraisal(v);
}

function wireAppraisal(v) {
  const emp = AP.employee.id, saveAp = async submit => { AP = await api('/appraisal', { method: 'PUT', body: { empId: emp, form: AP.form, submit: !!submit } }); };
  $('#msel').onchange = e => { S.month = e.target.value === 'annual' ? S.month : e.target.value; location.hash = `#/form/${emp}/${e.target.value}`; };
  v.oninput = e => {
    const t = e.target, f = AP.form;
    if (t.dataset.ap) f[t.dataset.ap] = t.value;
    else if (t.dataset.aprow) { const [k, i, c] = t.dataset.aprow.split(':'); f[k][+i][c] = t.value; }
  };
  v.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.apgo) { const n = +b.dataset.apgo; if (n < 1 || n > 6) return; if (AP.perms.edit) await saveAp(); apStep = n; paintAppraisal(v); window.scrollTo({ top: 0 }); }
      else if (b.dataset.apadd) { AP.form[b.dataset.apadd].push(b.dataset.apadd === 'recap' ? { expectation: '', achievements: '', improvement: '' } : { kra: '', progress: '' }); paintAppraisal(v); }
      else if (b.dataset.apdel) { const [k, i] = b.dataset.apdel.split(':'); AP.form[k].splice(+i, 1); if (!AP.form[k].length) AP.form[k].push(k === 'recap' ? { expectation: '', achievements: '', improvement: '' } : { kra: '', progress: '' }); paintAppraisal(v); }
      else if (b.id === 'apsub') { await saveAp(true); toast('Appraisal submitted'); apStep = 6; paintAppraisal(v); }
      else if (b.id === 'apxls') apExcel();
    } catch (er) { toast(er.message, 'err'); }
  };
}

function apExcel() {
  const { employee: e, form: f } = AP, c = s => esc(s).replace(/\n/g, '<br>');
  const html = `<html><head><meta charset="utf-8"></head><body><h2>Appraisal ${AP.fy}</h2><table border="1"><tr><td>Employee</td><td>${c(e.name)}</td><td>Designation</td><td>${c(e.designation)}</td></tr><tr><td>Department</td><td>${c(e.department)}</td><td>Reviewer</td><td>${c(e.reviewer)}</td></tr></table>
  <h3>Yearly Recap</h3><table border="1"><tr><th>#</th><th>Expectation (Year Beginning)</th><th>Achievements During the Year</th><th>Improvement</th></tr>${f.recap.map((r, i) => `<tr><td>${i + 1}</td><td>${c(r.expectation)}</td><td>${c(r.achievements)}</td><td>${c(r.improvement)}</td></tr>`).join('')}</table>
  <h3>KRA Progress</h3><table border="1"><tr><th>KRA</th><th>Progress</th></tr>${f.kraProgress.map(r => `<tr><td>${c(r.kra)}</td><td>${c(r.progress)}</td></tr>`).join('')}</table>
  <h3>Key Strengths</h3><p>${c(f.strengths)}</p><h3>Area of Improvement</h3><p>${c(f.improvements)}</p><h3>Operational KRA</h3><p>${c(f.operational)}</p><h3>Process KRA</h3><p>${c(f.process)}</p><h3>People KRA</h3><p>${c(f.people)}</p></body></html>`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel' })); a.download = `Appraisal-${AP.fy}-${e.name.replace(/\s+/g, '-')}.xls`; a.click();
}
