'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// "a · b" without stray dots when a part is empty
const dotJoin = (...parts) => parts.filter(x => x != null && x !== '').map(esc).join(' · ');
const S = { user: null, me: null, month: null, page: null };
// anything not served from this machine is the shared staging demo
const IS_STAGING = !['localhost', '127.0.0.1', ''].includes(location.hostname);
const ROLE_LABEL = { admin: 'Admin', director: 'Director', manager: 'Manager', teamlead: 'Team lead', employee: 'Employee' };

// the session lives in an HttpOnly cookie set by the server; the browser sends it with every call
// While a call runs: the button that started it shows a spinner, and after 250 ms the top bar says "Loading…"
// (after 4 s: the server is waking up). Brief: a spinning Loader icon, never a skeleton.
async function api(path, opts = {}) {
  const get = !opts.method || opts.method === 'GET';
  const btn = pressed && pressed.btn.isConnected && Date.now() - pressed.at < (get ? 1000 : 5000) ? pressed.btn : null;
  if (btn) btnBusy(btn);
  loadStart();
  try { return await apiCall(path, opts); } finally { loadEnd(); if (btn) btnIdle(btn); }
}
async function apiCall(path, opts) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET', credentials: 'same-origin',
    // tells the server who this tab was opened for, so a sign-in in another tab cannot act through this one
    headers: { 'Content-Type': 'application/json', ...(S.me && { 'X-PMS-User': `${S.me.id}:${S.me.real.id}` }) },
    body: opts.method && opts.method !== 'GET' ? JSON.stringify(opts.body || {}) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (res.status === 401 && S.me) { S.me = null; S.month = null; boot(); }
  if (res.status === 409 && data.code === 'SESSION_CHANGED') {
    // someone else signed in (or "View as" changed) in another tab: reload this tab for the current account
    try { sessionStorage.setItem('pmsSwitched', '1'); } catch {}
    location.hash = '#/home'; location.reload(); return new Promise(() => {});
  }
  if (res.status === 404 && data.code === 'NO_ROUTE') {
    // this page is older than the server (PMS was updated): load the new version, at most once a minute
    let last = 0; try { last = +sessionStorage.getItem('pmsReloadedAt') || 0; sessionStorage.setItem('pmsReloadedAt', String(Date.now())); } catch {}
    if (Date.now() - last > 60000) { location.reload(); return new Promise(() => {}); }
    data.error = 'PMS was just updated. Please reload the page (Ctrl+F5).';
  }
  if (!res.ok) { const e = new Error(data.error || 'Error'); e.data = data; throw e; }
  return data;
}
// the last button clicked, so the call it starts can show its spinner
let pressed = null;
document.addEventListener('click', e => { const b = e.target.closest?.('button.btn, button.ac-submit, button.pill'); if (b && !b.disabled) pressed = { btn: b, at: Date.now() }; }, true);
const busyBtns = new Map(); // button -> { c: calls running, sp: spinner element, dis: disabled before }
function btnBusy(b) {
  const n = busyBtns.get(b); if (n) { n.c++; return; }
  const sp = document.createElement('span'); sp.className = 'bspin spin'; sp.innerHTML = ico('loader'); b.prepend(sp);
  busyBtns.set(b, { c: 1, sp, dis: b.disabled }); b.disabled = true; b.classList.add('busy'); b.setAttribute('aria-busy', 'true');
}
function btnIdle(b) {
  const n = busyBtns.get(b); if (!n || --n.c > 0) return;
  busyBtns.delete(b); n.sp.remove(); b.classList.remove('busy'); b.removeAttribute('aria-busy'); b.disabled = n.dis;
}
// page-level indicator: shown only for calls slower than 250 ms, so quick loads never flicker
const LOAD_MSG = 'Loading…', WAKE_MSG = 'Starting PMS, this can take up to a minute…';
let inflight = 0, slowT = 0, wakeT = 0;
const loadMsg = t => document.querySelectorAll('.ld-msg').forEach(x => { x.textContent = t; });
function loadStart() {
  if (inflight++) return;
  slowT = setTimeout(() => document.documentElement.classList.add('is-loading'), 250);
  wakeT = setTimeout(() => loadMsg(WAKE_MSG), 4000); // the free server sleeps; its first answer can take a minute
}
function loadEnd() {
  if (--inflight) return;
  clearTimeout(slowT); clearTimeout(wakeT);
  document.documentElement.classList.remove('is-loading'); loadMsg(LOAD_MSG);
}
function toast(msg, kind = 'ok') { document.querySelectorAll('.toast').forEach(x => x.remove()); const t = document.createElement('div'); t.className = 'toast t-' + kind; t.setAttribute('role', kind === 'err' ? 'alert' : 'status'); t.innerHTML = `<span class="ti"><b>${kind === 'err' ? '!' : '✓'}</b></span><span></span>`; t.lastChild.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 4000 : 2800); }
// plain-language names for the two incomplete statuses (the server keeps the original status names)
const STATUS_TEXT = { 'Review Not Completed': 'Form incomplete', Pending: 'Overdue' };
const STATUS_HINT = { 'Review Not Completed': 'Form not fully rated yet; the review window is still open', Pending: 'Form not fully rated and the review window has closed' };
const badge = st => {
  const c = { 'Completed and Submitted': 'green', 'Completed but Not Submitted': 'amber', 'Review Not Completed': 'red', Pending: 'blue', 'Not started': 'grey', 'Within due date': 'green', 'After due date': 'red' }[st] || 'grey';
  const t = STATUS_TEXT[st];
  return `<span class="badge b-${c}"${t ? ` title="${esc(STATUS_HINT[st])}"` : ''}>${esc(t || st)}</span>`;
};
const fmtY = d => d ? new Date(d + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'; // 1 Apr 2018
const fmtD = d => { if (!d) return 'N/A'; const [y, m, dd] = d.split('-'); return `${+dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`; };
// months of a financial year (April to March); any year can be browsed, months after the current one are not open yet
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fyOf = key => { const [y, m] = key.split('-').map(Number); return m >= 4 ? y : y - 1; };
const fyMonthsOf = y => Array.from({ length: 12 }, (_, i) => { const m = (i + 3) % 12 + 1, yy = m >= 4 ? y : y + 1, key = `${yy}-${String(m).padStart(2, '0')}`; return { key, label: `${MONTHS[m - 1]} ${yy}`, started: key <= S.me.currentMonth }; });
const monthLabel = key => { const [y, m] = (key || '').split('-').map(Number); return m ? `${MONTHS[m - 1]} ${y}` : ''; };
const monthOpts = sel => fyMonthsOf(fyOf(sel || S.me.currentMonth)).filter(m => m.started).map(m => `<option value="${m.key}" ${m.key === sel ? 'selected' : ''}>${m.label.split(" ")[0]}</option>`).join('');
// ratings are 0-5 picked from a dropdown; a manager remark is needed when self and manager ratings differ
// KRA ratings are percentages (10% to 100%); questionnaire ratings use the 0-5 parameter scale
const RATINGS = [0, 1, 2, 3, 4, 5], KRA_RATINGS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const rateSel = (val, attrs, enabled, cls = '', scale = RATINGS, unit = '') => `<select class="num ${cls}" ${attrs} ${enabled ? '' : 'disabled'}><option value="">–</option>${scale.map(n => `<option value="${n}" ${val != null && val !== '' && +val === n ? 'selected' : ''}>${n}${unit}</option>`).join('')}</select>`;
// a percentage rating for display
const pc = x => x == null ? 'N/A' : `${x}%`;
const errBox = e => `<div class="warn">${(e.data?.errors || [e.message]).map(esc).join('<br>')}</div>`;
function askNote(title, label, optional) { return new Promise(res => { const m = modal(`<h3>${title}</h3><label class="f">${label}</label><textarea id="nt" rows="4" style="width:100%"></textarea><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="nc">Cancel</button><button class="btn pri" id="no">Send</button></div>`); const done = v => { m.remove(); res(v); }; m.querySelector('#nc').onclick = () => done(null); m.querySelector('#no').onclick = () => { const v = m.querySelector('#nt').value.trim(); if (!v && !optional) return toast('Please write a short note', 'err'); done(v); }; m.querySelector('#nt').focus(); }); }
function modal(html) { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="box">${html}</div>`; m.addEventListener('mousedown', ev => { if (ev.target === m) m.remove(); }); const esc = ev => { if (ev.key === 'Escape') { m.remove(); document.removeEventListener('keydown', esc); } }; document.addEventListener('keydown', esc); document.body.appendChild(m); return m; }
// the app's own yes/no popup, used instead of the browser's confirm box; resolves true when confirmed
function confirmBox(title, text, { ok = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    const m = modal(`<div class="ask ${danger ? 'danger' : ''}"><i>${ico(danger ? 'alert' : 'question')}</i><div><h2>${esc(title)}</h2><p>${esc(text)}</p></div></div><div class="row"><button class="btn ${danger ? 'dng solid' : 'pri'}" id="askyes">${esc(ok)}</button><button class="btn" id="askno">Cancel</button></div>`);
    m.querySelector('.box').classList.add('sm');
    const done = yes => { document.removeEventListener('keydown', key, true); m.remove(); resolve(yes); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    document.addEventListener('keydown', key, true);
    m.addEventListener('mousedown', e => { if (e.target === m) done(false); });
    m.querySelector('#askno').onclick = () => done(false);
    m.querySelector('#askyes').onclick = () => done(true);
    m.querySelector('#askyes').focus();
  });
}

// ---------- icons (inline SVG, stroke style) ----------
const ICON = {
  // department icons (teamLook)
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  briefcase: '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  review: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9z"/><path d="m9 13 2 2 4-4"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M17.5 14a6 6 0 0 1 4 5.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chart: '<path d="M3 21h18"/><path d="M6 17v-6M11 17V5M16 17v-9"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16a3 3 0 0 1 6 0M14 10h4M14 14h4"/>',
  sitemap: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><path d="M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  logout: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5"/><path d="m15 8 4 4-4 4M9 12h10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  tick: '<path d="m5 12 4.5 4.5L19 7"/>',
  left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3v4a5 5 0 0 0 10 0V3M7 21v-4a5 5 0 0 1 10 0v4"/>',
  draft: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14h6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 3.9M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="4" y="10.5" width="16" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M16 7l3 3M18 5l2 2"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  calcheck: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15.5 2 2 4-4"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.5 7 5-3 5 3-1.5-7"/>',
  shirt: '<path d="M20.4 3.5 16 2a4 4 0 0 1-8 0L3.6 3.5a2 2 0 0 0-1.3 2.2l.6 3.5a1 1 0 0 0 1 .8H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.1a1 1 0 0 0 1-.8l.6-3.5a2 2 0 0 0-1.3-2.2z"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/><path d="M3.2 12H9l1-2 2 4 1.5-2h7.3"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.2 6-5.5-3-5.5 3 1.2-6-4.5-4.2 6.1-.8z"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
// Parameters Summary: an icon that suits the section's title (admins can rename sections or add new ones)
const paramIcon = title => { const t = title.toLowerCase(); return /attend/.test(t) ? 'calcheck' : /skill|quality/.test(t) ? 'award' : /team/.test(t) ? 'team' : /conduct|ethic|value/.test(t) ? 'shield' : /initiative|motivat/.test(t) ? 'bolt' : /groom/.test(t) ? 'shirt' : /health|well/.test(t) ? 'heart' : 'list'; };
const ico = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
// teams / departments: one coloured icon each, matched by keyword so a new or renamed department still gets one
const TEAM_LOOK = [[/financ|account/i, 'wallet', '--vr-purple-600'], [/hr|admin|people/i, 'team', '--vr-success-600'], [/sales/i, 'trend', '--vr-warn-600'],
  [/cloud|data|tech/i, 'cloud', '--vr-navy-600'], [/social|media|market/i, 'megaphone', '--vr-danger-500'], [/director/i, 'sitemap', '--vr-accent-navy']];
const TEAM_SPARE = ['--vr-purple-500', '--vr-warn-500', '--vr-navy-700', '--vr-danger-600'];
function teamLook(t) {
  const m = TEAM_LOOK.find(([re]) => re.test(t || '')); if (m) return { icon: m[1], color: m[2] };
  let h = 0; for (const ch of String(t || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { icon: 'briefcase', color: TEAM_SPARE[h % TEAM_SPARE.length] };
}
const teamOpt = t => { const l = teamLook(t); return [t, t, l.color, l.icon]; }; // for ddSelect lists
const teamIco = t => { const l = teamLook(t); return `<span class="tico" style="color:var(${l.color})">${ico(l.icon)}</span>`; };
const spinner = text => `<div class="loading"><span class="spin" style="display:inline-flex">${ico('loader')}</span>${text ? esc(text) : '<span class="ld-msg">Loading…</span>'}</div>`;
// the scrolling area: the main column inside the app shell (the window itself does not scroll)
const SC = () => document.getElementById('main') || document.scrollingElement;
// search box with the leading magnifier
const searchBox = (id, ph, val, w) => `<span class="search">${ico('search')}<input id="${id}" type="search" placeholder="${esc(ph)}" value="${esc(val || '')}"${w ? ` style="width:${w}px"` : ''}></span>`;
// sidebar wordmark: "verve", a thin rule, "ADVISORY" right-aligned
const WORDMARK = '<div class="wordmark"><img class="logo-w" src="verve-advisory-logo.png" alt="Verve Advisory"><div class="wr"></div><span class="wa">Performance Management</span></div>';
// two soft radial orbs: the depth on every navy surface
const ORBS = '<i class="orb o1"></i><i class="orb o2"></i>';
const GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
// messages for the codes the Google sign-in round trip sends back (?auth_error=...)
const AUTH_MSG = {
  cancelled: 'Sign-in was cancelled.', expired: 'The sign-in took too long or was started in another tab. Please try again.',
  google: 'Google sign-in did not work. Please try again.', domain: d => `Please use your @${d} Google account.`,
  not_registered: () => 'Your account is not set up in PMS yet. Please ask HR to add you.', inactive: () => 'Your PMS access is inactive. Please contact HR.',
  calendar_mismatch: () => 'Connect the Google account that matches your PMS email.', calendar_norefresh: 'Google did not give calendar access. Please try connecting again.',
};
// read and remove ?auth_error / ?calendar from the address bar (they arrive once, after a Google redirect)
function takeRedirectParams() {
  const p = new URLSearchParams(location.search);
  if (!p.toString()) return {};
  history.replaceState(null, '', location.pathname + location.hash);
  return { error: p.get('auth_error'), email: p.get('email'), calendar: p.get('calendar') };
}
const authMsg = (code, email, domain) => { const m = AUTH_MSG[code]; if (!m) return code ? 'Sign-in did not work. Please try again.' : ''; const t = typeof m === 'function' ? m(domain) : m; return email && ['domain', 'not_registered', 'inactive', 'calendar_mismatch'].includes(code) ? `${t} (You signed in as ${email}.)` : t; };

// ---------- theme (light by default, choice remembered in this browser) ----------
// dark mode is a class on <html>; the choice is stored as pms.theme (set before first paint in index.html)
const isDark = () => document.documentElement.classList.contains('dark');
// 'side' = labelled button in the sidebar user card, otherwise a small icon button
const themeBtn = (kind = 'icon') => { const dark = isDark(), t = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return kind === 'side' ? `<button class="sbtn" id="themeBtn" data-k="side" title="${t}">${ico(dark ? 'sun' : 'moon')}<span>${dark ? 'Light' : 'Dark'}</span></button>`
    : `<button class="ibtn" id="themeBtn" data-k="icon" title="${t}" aria-label="${t}">${ico(dark ? 'sun' : 'moon')}</button>`; };
function toggleTheme() {
  const dark = !isDark();
  document.documentElement.classList.toggle('dark', dark);
  try { localStorage.setItem('pms.theme', dark ? 'dark' : 'light'); localStorage.removeItem('pmsTheme'); } catch {}
  document.querySelectorAll('#themeBtn').forEach(b => { b.outerHTML = themeBtn(b.dataset.k); });
}
document.addEventListener('click', e => { if (e.target.closest('#themeBtn')) toggleTheme(); });

// ---------- shell ----------
const roleBadge = r => `<span class="badge ${r === 'admin' ? 'b-amber' : r === 'director' ? 'b-blue' : r === 'manager' || r === 'teamlead' ? 'b-purple' : 'b-grey'}">${ROLE_LABEL[r]}</span>`; // green is kept for on/off switches (UI brief)
const userBtn = u => `<button class="user" data-u="${u.id}"><span class="avatar">${initials(u.name)}</span><span class="nm"><b>${esc(u.name)}</b><small>${esc(u.designation)}</small></span>${roleBadge(u.role)}</button>`;
let REDIRECT = null; // what the last Google redirect reported, shown once after boot
async function boot() {
  REDIRECT ??= takeRedirectParams();
  let st;
  try { st = await api('/auth/status'); } catch (e) { $('#root').innerHTML = `<div class="login">${errBox(e)}</div>`; return; }
  S.auth = st;
  if (st.signedIn) { try { return await start(); } catch {} }
  const err = REDIRECT.error ? authMsg(REDIRECT.error, REDIRECT.email, st.domain) : ''; REDIRECT = {};
  loginPage(st, err);
}

// ---------- login window: brand panel on the left, sign-in card on the right ----------
function loginPage(st, err) {
  const dom = '@' + st.domain;
  const alert = (msg, kind = 'err') => `<div class="ac-alert ${kind}" role="${kind === 'err' ? 'alert' : 'status'}">${ico(kind === 'err' ? 'alert' : 'info')}<span>${esc(msg)}</span></div>`;
  $('#root').innerHTML = `<div class="auth">
  <aside class="auth-brand"><div class="ab-in"><img class="logo-w ab-logo" src="verve-advisory-logo.png" alt="Verve Advisory">
    <div class="ab-mid"><div class="ab-eyebrow">Verve PMS</div><h2>Performance Management System</h2>
      <p>Monthly reviews, review meetings and reports for everyone at Verve Advisory, in one place.</p>
      <ul class="ab-list"><li>${ico('review')}<span>Fill in and follow your monthly KRA review</span></li><li>${ico('calendar')}<span>Review meetings go straight to your Google Calendar</span></li><li>${ico('chart')}<span>Team, MIS and yearly reports for managers</span></li></ul></div>
    <div class="ab-foot">© ${new Date().getFullYear()} Verve Advisory</div></div></aside>
  <main class="auth-main">${themeBtn()}
    <div class="auth-form">
      <img class="auth-logo" src="verve-advisory-logo.png" alt="Verve Advisory">
      <h1>Sign in</h1>
      <p class="auth-sub">Use your Verve Advisory work account.</p>
      <div id="aerr">${err ? alert(err) : ''}</div>
      <form id="lform" novalidate>
        <label class="fl" for="lemail"><span>Work email</span><span class="ac-field"><input id="lemail" type="email" autocomplete="username" placeholder="name${esc(dom)}" spellcheck="false"></span></label>
        <div class="ac-hint" id="lemailh"></div>
        <label class="fl" for="lpass"><span>Password<a href="#" id="lforgot">Forgot password?</a></span><span class="ac-field"><input id="lpass" type="password" autocomplete="current-password" placeholder="Enter your password"><button type="button" class="ac-eye" id="leye" aria-label="Show password" title="Show password">${ico('eye')}</button></span></label>
        <div class="ac-hint" id="lpassh"></div>
        <label class="ac-check"><input type="checkbox" id="lrem" checked><span>Keep me signed in</span></label>
        <button class="ac-submit" type="submit">Sign in</button>
      </form>
      <div class="ac-or"><span>or</span></div>
      <button class="gbtn" id="gsign" type="button" ${st.google ? '' : 'disabled title="Google sign-in is not set up on this server yet"'}>${GOOGLE_G}<span>Sign in with Google</span></button>
      <p class="ac-note">${ico('shield')}<span>Only <b>${esc(dom)}</b> accounts can sign in</span></p>
      ${st.demo && st.accounts && st.accounts.length ? `<div class="auth-demo"><div class="adm-h">${ico('key')}<b>Test accounts</b>${st.password ? `<span>Password <code>${esc(st.password)}</code></span>` : "<span>Ask the PMS admin for the password</span>"}</div>
        ${st.accounts.map(a => `<button type="button" class="adm-row" data-em="${esc(a.email)}" title="Sign in as ${esc(a.name)}"><span class="adm-l">${esc(a.label)}<small>${esc(a.name)}</small></span><span class="adm-e">${esc(a.email)}</span>${ico('right')}</button>`).join('')}
        <p>Dummy data for testing. Click an account to sign in.</p></div>` : ''}
      <div class="auth-legal">Need access or help signing in? Contact HR.</div>
    </div>
  </main></div>`;

  const email = $('#lemail'), pass = $('#lpass'), err$ = $('#aerr');
  const fieldErr = (input, hint, msg) => { input.closest('.ac-field').classList.toggle('bad', !!msg); $(hint).textContent = msg || ''; };
  const checkEmail = () => {
    const v = email.value.trim().toLowerCase();
    const msg = !v ? 'Enter your work email.' : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? 'Enter a valid email address.' : !v.endsWith(dom.toLowerCase()) ? `Use your ${dom} email.` : '';
    fieldErr(email, '#lemailh', msg); return !msg;
  };
  email.onblur = () => { if (email.value.trim()) checkEmail(); };
  email.oninput = () => { if (email.closest('.ac-field').classList.contains('bad')) checkEmail(); };
  pass.oninput = () => fieldErr(pass, '#lpassh', '');
  $('#leye').onclick = () => {
    const show = pass.type === 'password'; pass.type = show ? 'text' : 'password';
    $('#leye').innerHTML = ico(show ? 'eyeoff' : 'eye'); $('#leye').setAttribute('aria-label', show ? 'Hide password' : 'Show password'); $('#leye').title = show ? 'Hide password' : 'Show password'; pass.focus();
  };
  const submit = $('.ac-submit');
  $('#lform').onsubmit = async e => {
    e.preventDefault();
    const okE = checkEmail(), okP = !!pass.value;
    fieldErr(pass, '#lpassh', okP ? '' : 'Enter your password.');
    if (!okE) return email.focus();
    if (!okP) return pass.focus();
    if (!st.demo) { err$.innerHTML = alert('Password sign-in is not switched on. Please use Sign in with Google below.', 'info'); return; }
    err$.innerHTML = ''; submit.disabled = true; submit.textContent = 'Signing in…';
    try { await api('/auth/password', { method: 'POST', body: { email: email.value.trim(), password: pass.value, remember: $('#lrem').checked } }); await start(); }
    catch (er) { err$.innerHTML = alert(er.message); submit.disabled = false; submit.textContent = 'Sign in'; pass.select(); }
  };
  $('#lforgot').onclick = e => { e.preventDefault(); err$.innerHTML = alert(st.demo && st.password ? `Test accounts all use the password ${st.password}. For your Google account, use Sign in with Google.` : 'Your password is managed by your Verve Google account. To reset it, contact HR or IT.', 'info'); };
  $('#gsign').onclick = () => { if (st.google) location.href = `/api/auth/google/start?origin=${encodeURIComponent(location.origin)}`; };
  // a test account fills in its email and password and signs straight in
  document.querySelectorAll('.adm-row').forEach(b => b.onclick = () => {
    email.value = b.dataset.em; fieldErr(email, '#lemailh', ''); fieldErr(pass, '#lpassh', '');
    if (!st.password) return pass.focus(); // deployed: the password is not shown, so the person types it
    pass.value = st.password; $('#lform').requestSubmit();
  });
  if (!err) email.focus({ preventScroll: true });
}
async function signOut() { try { await api('/auth/logout', { method: 'POST' }); } catch {} S.me = null; S.month = null; location.hash = '#/home'; boot(); }
async function viewAs(id) { await api('/auth/view-as', { method: 'POST', body: { id } }); S.month = null; S.hteam = ''; location.hash = '#/home'; await start(); }
async function pickViewAs() {
  const people = await api('/auth/view-as');
  const m = modal(`<h2>View PMS as…</h2><p class="small">See exactly what this person sees and can do. Changes you make are saved for real. Use "Back to me" in the banner to return.</p>
    <span class="search" style="display:flex;margin:12px 0 8px">${ico('search')}<input id="vaq" type="search" placeholder="Search by name, team or role" style="width:100%"></span><div class="tablewrap" id="val" style="padding:4px;max-height:50vh;overflow:auto"></div>`);
  const draw = q => { q = q.toLowerCase(); m.querySelector('#val').innerHTML = people.filter(p => !q || `${p.name} ${p.team} ${p.role} ${p.designation}`.toLowerCase().includes(q)).map(userBtn).join('') || '<div class="empty">No one matches.</div>'; };
  draw(''); m.querySelector('#vaq').oninput = e => draw(e.target.value); m.querySelector('#vaq').focus();
  m.onclick = async e => { const b = e.target.closest('[data-u]'); if (b) { m.remove(); try { await viewAs(+b.dataset.u); } catch (er) { toast(er.message, 'err'); } } };
}

async function start() {
  S.me = await api('/me');
  S.month = S.month || S.me.currentMonth;
  let switched = false; try { switched = sessionStorage.getItem('pmsSwitched'); sessionStorage.removeItem('pmsSwitched'); } catch {}
  if (switched) setTimeout(() => toast(`The sign-in changed in another tab, so this tab now shows ${S.me.name}.`), 300);
  if (REDIRECT && (REDIRECT.error || REDIRECT.calendar)) { const r = REDIRECT; REDIRECT = {}; setTimeout(() => r.error ? toast(authMsg(r.error, r.email, S.me.domain), 'err') : toast('Google Calendar connected. You can now send review invites.'), 300); }
  const r = S.me.role, mgr = ['manager', 'teamlead', 'director', 'admin'].includes(r);
  // menu: [label, href, icon] = link, { label, icon, key, kids: [[label, href], ...] } = a group that opens, '--X' = eyebrow
  const items = r === 'admin' ? [
    ['Dashboard', '#/home', 'home'],
    ['All active employees', '#/employees/active', 'idcard'],
    ['All inactive employees', '#/employees/inactive', 'eyeoff'],
    { key: 'org', label: 'Reporting manager', icon: 'sitemap', kids: ORG_TABS.map(([, l, slug]) => [l, '#/reporting' + (slug ? '/' + slug : '')]) },
    { key: 'rep', label: 'Reporting', icon: 'chart', kids: [['Review status report', '#/report'], ['Team report', '#/yearly'], ['MIS report', '#/mis'], ['Scheduling', '#/scheduling'], ['Manager emails', '#/emails'], ['One pager document', `#/annual/${S.me.id}`]] },
    { key: 'qs', label: 'Questions', icon: 'question', kids: [['Parameters summary', '#/params'], ['Questionnaire', '#/params/questions']] },
    '--Admin',
    ['Audit log', '#/audit', 'clock'],
  ] : [
    ['Dashboard', '#/home', 'home'],
    ['My review', `#/form/${S.me.id}/${S.month}`, 'review'],
    mgr ? { key: 'myrep', label: 'Reports', icon: 'chart', kids: [['Team report', '#/yearly'], ['My report', '#/yearly/me']] } : ['My report', '#/yearly', 'chart'],
    mgr && ['My team', '#/team', 'team'],
    mgr && ['Scheduling', '#/scheduling', 'calendar'],
    mgr && ['Review status report', '#/report', 'chart'],
    r !== 'employee' && ['One pager document', `#/annual/${S.me.id}`, 'file'],
    ['Parameters summary', '#/params', 'list'],
  ].filter(Boolean);
  // nav links grouped under uppercase eyebrows
  const groups = [{ label: 'Workspace', links: [] }];
  items.forEach(i => typeof i === 'string' ? groups.push({ label: i.slice(2), links: [] }) : groups[groups.length - 1].links.push(i));
  const navItem = i => Array.isArray(i) ? `<a data-h="${i[1]}" href="${i[1]}">${ico(i[2])}<span>${i[0]}</span></a>`
    : `<div class="ngrp" data-g="${i.key}"><button type="button" class="ngrp-btn" aria-expanded="false">${ico(i.icon)}<span>${i.label}</span>${ico('right')}</button>
      <div class="nsub">${i.kids.map(([l, h]) => `<a data-h="${h}" href="${h}"><i></i><span>${l}</span></a>`).join('')}</div></div>`;
  $('#root').innerHTML = `<div id="app"><nav class="side">${ORBS}<div class="side-in">${WORDMARK}
    ${groups.map((g, gi) => `<div class="eyebrow">${esc(g.label)}${gi === 0 && IS_STAGING ? '<span class="badge b-amber" title="Staging: dummy data">Staging</span>' : ''}</div><div class="links">${g.links.map(navItem).join('')}</div>`).join('')}
    <div class="side-sp"></div></div></nav>
    <div class="col"><header class="topbar"><span class="tbc"><button type="button" class="tb-date" id="tbdate" aria-haspopup="dialog" aria-expanded="false" title="Open the calendar">${ico('calendar')}${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${CHEV}</button><div class="tbcal" id="tbcal" role="dialog" aria-label="Calendar" hidden></div></span><span class="tb-load" role="status">${spinner()}</span><span class="sp"></span>
      ${S.me.real.role === 'admin' && !S.me.viewingAs ? `<button class="btn sm" id="asbtn" title="See PMS exactly as another person sees it">${ico('eye')}View as…</button>` : ''}${themeBtn()}
      <span class="tb-div"></span>
      <div class="tb-user"><span class="tb-who"><b title="${esc(S.me.name)}">${esc(S.me.name)}</b><small>${(S.me.designation || '').toLowerCase() === ROLE_LABEL[S.me.role].toLowerCase() || !S.me.designation ? esc(ROLE_LABEL[S.me.role]) : dotJoin(S.me.designation, ROLE_LABEL[S.me.role])}</small></span><span class="avatar">${initials(S.me.name)}</span></div>
      <button class="ibtn" id="logout" title="Log out" aria-label="Log out">${ico('logout')}</button></header>
    <main id="main">${S.me.viewingAs ? `<div class="asbar">${ico('eye')}<span>You are viewing PMS as <b>${esc(S.me.name)}</b> (${ROLE_LABEL[S.me.role]}). What you change is saved for real.</span><span class="sp"></span><button class="btn sm" id="asback">Back to ${esc(S.me.real.name.split(' ')[0])}</button></div>` : ''}<div id="view"></div></main></div></div>`;
  $('#root').onclick = e => {
    const g = e.target.closest('.ngrp-btn'); if (g) navOpen(g.parentNode, !g.parentNode.classList.contains('open'));
    if (e.target.closest('#logout')) signOut();
    if (e.target.closest('#asbtn')) pickViewAs().catch(er => toast(er.message, 'err'));
    if (e.target.closest('#asback')) viewAs(null).catch(er => toast(er.message, 'err'));
  };
  window.onhashchange = route;
  route();
}

async function route() {
  const [, page, ...args] = (location.hash || '#/home').split('/');
  markNav();
  const v = $('#view'); if (!v.firstElementChild) v.innerHTML = spinner();
  v.onclick = v.oninput = v.onchange = v.onkeydown = null; SC().onscroll = null;
  v.classList.add('routing');
  try { await (pages[page] || pages.home)(v, ...args); } catch (e) { v.innerHTML = head('Something went wrong', 'The page could not be loaded.') + errBox(e); }
  v.classList.remove('routing'); SC().scrollTop = 0;
}
const head = (t, c) => `<div class="phd"><h1>${t}</h1>${c ? `<div class="crumb">${c}</div>` : ''}</div>`;
// menu groups: open or close one (remembered for this visit)
const navOpenKeys = new Set();
function navOpen(g, open) {
  g.classList.toggle('open', open); g.querySelector('.ngrp-btn').setAttribute('aria-expanded', String(open));
  open ? navOpenKeys.add(g.dataset.g) : navOpenKeys.delete(g.dataset.g);
}
// highlight the one link that best matches the address (exact, then same page and first argument, then same page)
function markNav() {
  const h = location.hash || '#/home', [, page, arg] = h.split('/');
  let best = null, top = 0;
  document.querySelectorAll('.links a[data-h]').forEach(a => {
    const [, p2, a2] = a.dataset.h.split('/'), score = a.dataset.h === h ? 3 : p2 === page && a2 && a2 === arg ? 2 : p2 === page ? 1 : 0;
    if (score > top) { top = score; best = a; }
    a.classList.remove('on');
  });
  document.querySelectorAll('.ngrp').forEach(g => g.classList.remove('has-on'));
  if (best) { best.classList.add('on'); const g = best.closest('.ngrp'); if (g) { g.classList.add('has-on'); navOpen(g, true); } }
  document.querySelectorAll('.ngrp').forEach(g => { if (navOpenKeys.has(g.dataset.g) && !g.classList.contains('open')) navOpen(g, true); });
}
// month picker: a styled dropdown over a hidden native select, so pages keep listening to #msel change events
// o.heading: shown as the page heading (month name only, no box); click it to change the month
function monthSel(id = 'msel', o = {}) {
  S.fy ??= fyOf(S.month);
  const label = monthLabel(S.month) || 'Month';
  return `<div class="dd" data-dd><button type="button" class="dd-btn${o.heading ? ' h1-pick' : ''}" aria-haspopup="listbox" aria-expanded="false"${o.heading ? ' title="Change month"' : ''}>${o.heading ? '' : ico('calendar')}<span class="dd-val">${esc(o.heading ? label.split(' ')[0] : label)}</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
  <div class="dd-menu" role="listbox" hidden>${ddMonthList()}</div>
  <select id="${id}" hidden aria-hidden="true">${monthOpts(S.month)}</select></div>`;
}
// menu body: FY switcher + the 12 months of that FY (months not yet open are shown but disabled)
function ddMonthList() {
  const y = S.fy, cur = S.me.currentMonth;
  return `<div class="dd-head"><button type="button" class="dd-nav" data-fy="${y - 1}" title="Previous year" aria-label="Previous year">${ico('left')}</button><span>FY ${y}-${y + 1}</span><button type="button" class="dd-nav" data-fy="${y + 1}" title="Next year" aria-label="Next year" ${y + 1 > fyOf(cur) ? 'disabled' : ''}>${ico('right')}</button></div>
  ${fyMonthsOf(y).map(m => `<button type="button" role="option" class="dd-item ${m.key === S.month ? 'on' : ''}" data-v="${m.key}" aria-selected="${m.key === S.month}" ${m.started ? '' : 'disabled title="Not open yet"'}><span>${esc(m.label.split(' ')[0])}</span>${ico('tick')}</button>`).join('')}`;
}
const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
// any list as a styled dropdown over a hidden native select (pages listen to its change event)
// opts: [value, label, colour token?, icon?]; o.ph = button text when no option is chosen; o.btn = button text override; o.on = highlighted
function ddSelect(id, val, opts, o = {}) {
  const cur = opts.find(x => String(x[0]) === String(val ?? '')) || (o.ph ? null : opts[0]);
  const lead = x => x && x[3] ? `<span class="ddl-i" style="color:var(${x[2] || '--vr-n-500'})">${ico(x[3])}</span>` : x && x[2] ? `<i class="ddl-dot" style="background:var(${x[2]})"></i>` : '';
  return `<div class="dd${o.on ? ' on' : ''}" data-dd="list"><button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false">${o.icon ? ico(o.icon) : lead(cur)}<span class="dd-val">${esc(o.btn || (cur ? cur[1] : o.ph))}</span>${CHEV}</button>
  <div class="dd-menu" role="listbox" hidden>${opts.map(x => `<button type="button" role="option" class="dd-item ${x === cur ? 'on' : ''}" data-v="${esc(x[0])}" aria-selected="${x === cur}"><span class="ddl">${lead(x)}${esc(x[1])}</span>${ico('tick')}</button>`).join('')}</div>
  <select id="${id}" hidden aria-hidden="true">${cur ? '' : '<option value="__none" selected></option>'}${opts.map(x => `<option value="${esc(x[0])}" ${x === cur ? 'selected' : ''}></option>`).join('')}</select></div>`;
}
// admin: change a team's review window (day of month, applies to every month); w = { team, startDay, endDay }
function windowDialog(w, onSaved) {
  const m = modal(`<h2>Edit review window: ${esc(w.team)}</h2><div id="er"></div>
    <div class="row" style="align-items:flex-end;margin:0"><div><label class="f">From day <i>*</i></label><input class="num" type="number" min="1" max="31" id="ws" value="${w.startDay}"></div>
    <div><label class="f">To day <i>*</i></label><input class="num" type="number" min="1" max="31" id="we" value="${w.endDay}"></div></div>
    <p class="small">Day of the month, used for every month. In shorter months the window ends on the last day. Dates are collected 3 days before the window opens.</p>
    <div class="row"><button class="btn pri" id="ok">Save window</button><button class="btn" id="no">Cancel</button></div>`);
  m.querySelector('#no').onclick = () => m.remove();
  m.querySelector('#ws').focus();
  m.querySelector('#ok').onclick = async () => {
    try { await api('/windows', { method: 'PUT', body: { team: w.team, start: +m.querySelector('#ws').value, end: +m.querySelector('#we').value } }); m.remove(); toast(`${w.team} review window saved`); onSaved(); }
    catch (er) { m.querySelector('#er').innerHTML = errBox(er); }
  };
}
function onMonth(fn) { $('#msel').onchange = e => { S.month = e.target.value; fn(); }; }
// switch the review month from outside the page's own month picker (top-bar calendar, clickable month heading)
function pickMonth(key) {
  S.fy = fyOf(key);
  const sel = $('#msel');
  if (sel) { // the page listens to its month picker: set it and let the page redraw itself
    if (![...sel.options].some(o => o.value === key)) sel.insertAdjacentHTML('beforeend', `<option value="${key}"></option>`);
    sel.value = key; sel.dispatchEvent(new Event('change', { bubbles: true })); return;
  }
  S.month = key;
  const [, page, emp] = (location.hash || '').split('/');
  if (page === 'form' && emp) location.hash = `#/form/${emp}/${key}`; else route();
}
// ---------- top-bar calendar: today circled, the review month shaded; clicking a date opens that month's reviews ----------
const TBCAL = { y: 0, m: 0 }; // month on show (m = 0-11)
const tbPad = n => String(n).padStart(2, '0');
function tbCalDraw() {
  const { y, m } = TBCAL, key = `${y}-${tbPad(m + 1)}`, now = new Date(), open = key <= S.me.currentMonth;
  const lead = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
  const isToday = d => now.getFullYear() === y && now.getMonth() === m && now.getDate() === d;
  const cells = [...Array(lead).fill('<span></span>'), ...Array.from({ length: days }, (_, i) => i + 1).map(d =>
    `<button type="button" class="cd${isToday(d) ? ' today' : ''}${key === S.month ? ' sel' : ''}" data-calday="${key}" ${open ? `title="Open ${esc(monthLabel(key))} reviews"` : 'disabled title="Not open yet"'}>${d}</button>`)];
  $('#tbcal').innerHTML = `<div class="tbcal-h"><button type="button" class="tbcal-nav" data-calmove="-1" aria-label="Previous month">${ico('left')}</button><b>${MONTHS[m]} ${y}</b><button type="button" class="tbcal-nav" data-calmove="1" aria-label="Next month">${ico('right')}</button></div>
    <div class="tbcal-g">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => `<i>${d}</i>`).join('')}${cells.join('')}</div>
    <div class="tbcal-f"><span>Reviews shown: <b>${esc(monthLabel(S.month))}</b></span><button type="button" class="btn sm" data-caltoday>Today</button></div>`;
}
function tbCalOpen(show) {
  const c = $('#tbcal'), b = $('#tbdate'); if (!c) return;
  if (show) { const [y, m] = S.month.split('-').map(Number); Object.assign(TBCAL, { y, m: m - 1 }); tbCalDraw(); }
  c.hidden = !show; b.setAttribute('aria-expanded', String(show));
}
document.addEventListener('click', e => {
  if (e.target.closest('#tbdate')) return tbCalOpen($('#tbcal').hidden);
  const c = $('#tbcal'); if (!c || c.hidden) return;
  if (!c.contains(e.target)) return tbCalOpen(false);
  const mv = e.target.closest('[data-calmove]');
  if (mv) { const d = new Date(TBCAL.y, TBCAL.m + +mv.dataset.calmove, 1); Object.assign(TBCAL, { y: d.getFullYear(), m: d.getMonth() }); return tbCalDraw(); }
  if (e.target.closest('[data-caltoday]')) { const d = new Date(); Object.assign(TBCAL, { y: d.getFullYear(), m: d.getMonth() }); return tbCalDraw(); }
  const day = e.target.closest('[data-calday]');
  if (day && !day.disabled) { tbCalOpen(false); if (day.dataset.calday !== S.month) pickMonth(day.dataset.calday); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#tbcal') && !$('#tbcal').hidden) { tbCalOpen(false); $('#tbdate').focus(); } });
const ddClose = d => { d.classList.remove('open'); d.querySelector('.dd-menu').hidden = true; d.querySelector('.dd-btn').setAttribute('aria-expanded', 'false'); };
document.addEventListener('click', e => {
  const nav = e.target.closest('.dd-nav');
  if (nav && !nav.disabled) { S.fy = +nav.dataset.fy; const d = nav.closest('.dd'); d.querySelector('.dd-menu').innerHTML = ddMonthList(); d.querySelector('select').innerHTML = fyMonthsOf(S.fy).filter(m => m.started).map(m => `<option value="${m.key}">${m.label}</option>`).join('') + (fyOf(S.month) !== S.fy ? `<option value="${S.month}" selected>${monthLabel(S.month)}</option>` : ''); return; }
  const btn = e.target.closest('.dd-btn'), item = e.target.closest('.dd-item');
  document.querySelectorAll('.dd.open').forEach(d => { if (!d.contains(e.target) || item) ddClose(d); });
  if (btn) {
    const d = btn.closest('.dd'), open = !d.classList.contains('open');
    d.classList.toggle('open', open); d.querySelector('.dd-menu').hidden = !open; btn.setAttribute('aria-expanded', String(open));
    if (open) {
      const m = d.querySelector('.dd-menu'); // a button near the right edge opens its menu leftwards
      m.classList.toggle('flip', btn.getBoundingClientRect().left + m.offsetWidth > document.documentElement.clientWidth - 16);
      const cur = d.querySelector('.dd-item.on') || d.querySelector('.dd-item');
      if (cur) { m.scrollTop = cur.offsetTop - (m.clientHeight - cur.offsetHeight) / 2; cur.focus({ preventScroll: true }); }
    }
  }
  if (item && !item.disabled) {
    const d = item.closest('.dd'), sel = d.querySelector('select');
    if (sel.value !== item.dataset.v) { if (d.dataset.dd !== 'list') S.fy = fyOf(item.dataset.v); sel.value = item.dataset.v; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }
});
document.addEventListener('keydown', e => {
  const d = e.target.closest?.('.dd'); if (!d || !d.classList.contains('open')) return;
  const items = [...d.querySelectorAll('.dd-item')], i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Escape') { ddClose(d); d.querySelector('.dd-btn').focus(); }
});
// Every <select> opens this styled list instead of the browser's plain one. The real <select> keeps the value and
// fires the usual change event, so the pages need no changes. Touch screens keep their native picker.
const coarse = () => matchMedia('(pointer: coarse)').matches;
const fire = el => ['input', 'change'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
// open below the field, or above it when there is more room there
function popPlace(box, anchor, tallest = 480) {
  const r = anchor.getBoundingClientRect(), gap = 6, edge = 8, below = innerHeight - r.bottom - gap - edge, above = r.top - gap - edge;
  box.style.minWidth = r.width + 'px';
  const up = box.offsetHeight > below && above > below;
  box.style.maxHeight = Math.min(up ? above : below, tallest) + 'px';
  box.style.left = Math.max(edge, Math.min(r.left, document.documentElement.clientWidth - box.offsetWidth - edge)) + 'px';
  box.style.top = (up ? r.top - gap - box.offsetHeight : r.bottom + gap) + 'px';
}
let pick = null; // the open list: { sel, box, opts, items }
const pickable = s => s && !s.disabled && !s.multiple && s.size <= 1 && !coarse();
function pickClose(refocus = true) {
  if (!pick) return;
  const { sel, box } = pick; pick = null;
  box.remove(); sel.classList.remove('picking');
  if (refocus) sel.focus({ preventScroll: true });
}
function pickOpen(sel) {
  const opts = [...sel.options].filter(o => !o.hidden), box = document.createElement('div');
  const label = o => o.value === '' && !/\w/.test(o.text) ? (sel.classList.contains('num') ? 'Not rated' : 'None') : o.text;
  box.className = 'pick'; box.setAttribute('role', 'listbox');
  box.innerHTML = opts.map((o, i) => `<button type="button" role="option" tabindex="-1" class="pick-i ${o.selected ? 'on' : ''} ${o.value === '' ? 'blank' : ''}" data-i="${i}" aria-selected="${o.selected}" ${o.disabled ? 'disabled' : ''}><span>${esc(label(o))}</span>${ico('tick')}</button>`).join('');
  document.body.append(box);
  popPlace(box, sel, 220); // about 7 rows, then the list scrolls
  const items = [...box.querySelectorAll('.pick-i')], cur = items.find(b => b.classList.contains('on')) || items.find(b => !b.disabled);
  pick = { sel, box, opts, items };
  sel.classList.add('picking');
  if (cur) { box.scrollTop = cur.offsetTop - (box.clientHeight - cur.offsetHeight) / 2; cur.focus({ preventScroll: true }); }
  box.onclick = e => {
    const b = e.target.closest('.pick-i'); if (!b || b.disabled) return;
    const o = opts[+b.dataset.i];
    pickClose(); // first, so a page that moves focus on change (rating 5 -> remark) wins
    if (sel.selectedIndex !== o.index) { sel.selectedIndex = o.index; fire(sel); }
  };
}
document.addEventListener('mousedown', e => {
  if (pick && pick.box.contains(e.target)) return;
  const sel = e.target.closest?.('select'), own = e.button === 0 && pickable(sel), again = pick && pick.sel === sel;
  if (own) e.preventDefault();
  pickClose(again);
  if (own && !again) pickOpen(sel);
}, true);
document.addEventListener('keydown', e => {
  if (!pick) {
    if (e.target.tagName === 'SELECT' && pickable(e.target) && [' ', 'Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); pickOpen(e.target); }
    return;
  }
  const on = pick.items.filter(b => !b.disabled), i = on.indexOf(document.activeElement);
  const go = b => { if (b) { e.preventDefault(); b.focus({ preventScroll: true }); b.scrollIntoView({ block: 'nearest' }); } };
  if (e.key === 'ArrowDown') go(on[(i + 1) % on.length]);
  else if (e.key === 'ArrowUp') go(on[(i - 1 + on.length) % on.length]);
  else if (e.key === 'Home') go(on[0]);
  else if (e.key === 'End') go(on[on.length - 1]);
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pickClose(); }
  else if (e.key === 'Tab') pickClose();
  else if (e.key.length === 1 && e.key !== ' ') go([...on.slice(i + 1), ...on.slice(0, i + 1)].find(b => b.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase())));
}, true);
// Every date field opens this styled calendar. Focus stays in the field, so typing a date by hand still works.
let cal = null; // the open calendar: { input, box, y, m, view: 'days' | 'months' }
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const datable = i => !i.disabled && !i.readOnly && !coarse();
const calDate = v => v && +v.slice(0, 4) >= 1000 ? new Date(v + 'T00:00') : null; // null while a year is half typed
const calClose = () => { if (cal) { cal.box.remove(); cal.input.classList.remove('picking'); cal = null; } };
function calSet(iso) { const i = cal.input; calClose(); if (i.value !== iso) { i.value = iso; fire(i); } }
function calDraw() {
  const { input, box, y, m, view } = cal, today = isoDate(new Date());
  const ok = iso => !(input.min && iso < input.min) && !(input.max && iso > input.max);
  const title = view === 'days' ? new Date(y, m).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : y;
  const body = view === 'days'
    ? `<div class="cal-g">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(w => `<span class="cal-w">${w}</span>`).join('')}${Array.from({ length: 42 }, (_, i) => {
      const d = new Date(y, m, i + 1 - new Date(y, m).getDay()), iso = isoDate(d);
      return `<button type="button" class="cal-d ${d.getMonth() !== m ? 'out' : ''} ${iso === input.value ? 'sel' : ''} ${iso === today ? 'today' : ''}" data-d="${iso}" ${ok(iso) ? '' : 'disabled'}>${d.getDate()}</button>`;
    }).join('')}</div>`
    : `<div class="cal-m">${Array.from({ length: 12 }, (_, i) => `<button type="button" class="cal-mo ${i === m ? 'sel' : ''}" data-m="${i}">${new Date(2000, i).toLocaleDateString('en-IN', { month: 'short' })}</button>`).join('')}</div>`;
  box.innerHTML = `<div class="cal-h"><button type="button" class="cal-t" data-a="view" title="Pick a month or year">${title}<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><button type="button" class="cal-n" data-a="-1" aria-label="Previous">${ico('left')}</button><button type="button" class="cal-n" data-a="1" aria-label="Next">${ico('right')}</button></div>${body}
    <div class="cal-f"><button type="button" class="cal-a" data-a="clear">Clear</button><button type="button" class="cal-a" data-a="today" ${ok(today) ? '' : 'disabled'}>Today</button></div>`;
}
function calOpen(input) {
  const v = calDate(input.value) || new Date(), box = document.createElement('div');
  box.className = 'cal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Choose a date');
  cal = { input, box, y: v.getFullYear(), m: v.getMonth(), view: 'days' };
  calDraw(); document.body.append(box); popPlace(box, input); input.classList.add('picking');
  box.onmousedown = e => e.preventDefault(); // keep the cursor in the field
  box.onclick = e => {
    const b = e.target.closest('button'), a = b && b.dataset.a; if (!b || b.disabled) return;
    if (b.dataset.d) return calSet(b.dataset.d);
    if (a === 'clear') return calSet('');
    if (a === 'today') return calSet(isoDate(new Date()));
    if (a === 'view') cal.view = cal.view === 'days' ? 'months' : 'days';
    else if (b.dataset.m) { cal.m = +b.dataset.m; cal.view = 'days'; }
    else if (cal.view === 'months') cal.y += +a;
    else { const d = new Date(cal.y, cal.m + +a); cal.y = d.getFullYear(); cal.m = d.getMonth(); }
    calDraw();
  };
}
document.addEventListener('click', e => { const i = e.target.closest?.('input[type=date]'); if (i && !cal && datable(i)) calOpen(i); });
document.addEventListener('mousedown', e => { if (cal && !cal.box.contains(e.target) && e.target !== cal.input) calClose(); }, true);
document.addEventListener('input', e => { const d = cal && e.target === cal.input && calDate(e.target.value); if (d) { cal.y = d.getFullYear(); cal.m = d.getMonth(); cal.view = 'days'; calDraw(); } });
document.addEventListener('keydown', e => {
  const i = e.target.matches?.('input[type=date]') ? e.target : null;
  if (cal && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); calClose(); }
  else if (cal && e.key === 'Tab') calClose();
  else if (!cal && i && datable(i) && (e.key === ' ' || e.key === 'F4' || (e.altKey && e.key === 'ArrowDown'))) { e.preventDefault(); calOpen(i); }
}, true);
const popsClose = () => { pickClose(false); calClose(); };
addEventListener('scroll', e => { if ((pick && pick.box.contains(e.target)) || (cal && cal.box.contains(e.target))) return; popsClose(); }, true);
addEventListener('resize', popsClose);
addEventListener('hashchange', popsClose);
function nameLink(id, name, month) { return `<a href="#/form/${id}/${month || S.month}" style="color:var(--navy);font-weight:600">${esc(name)}</a>`; }

const pages = {};

// ---------- home ----------
// ring on the hero banner: share of scheduled reviews that are submitted (0..100)
// ring on the navy summary panel: share of scheduled reviews that are submitted (0..100); 10px ring at 112px
const ringSvg = pct => `<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="3.2"/>
  ${pct ? `<circle pathLength="100" cx="18" cy="18" r="15.5" fill="none" style="stroke:var(--vr-success-500)" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="${pct} 100" transform="rotate(-90 18 18)"/>` : ''}</svg>`;
// key in counts, chart colour token, short label, full status name used by the report filter
const STATUS_SEGS = [['submitted', '--vr-chart-cl', 'Submitted', 'Completed and Submitted'], ['notSubmitted', '--vr-chart-wd', 'Not submitted', 'Completed but Not Submitted'], ['pending', '--vr-chart-ip', 'Overdue', 'Pending'], ['notCompleted', '--vr-chart-rj', 'Form incomplete', 'Review Not Completed']];
// stacked status bar (2px gaps between segments); t has scheduled, submitted, notSubmitted, pending, notCompleted
const stackBar = (t, label) => `<div class="tbar" style="${label == null ? 'margin:0' : ''}">${label != null ? `<span class="n" title="${esc(label)}">${esc(label)}</span>` : ''}<div class="tr" title="${t.submitted} submitted, ${t.notSubmitted} not submitted, ${t.notCompleted} form incomplete, ${t.pending} overdue">${STATUS_SEGS.filter(([k]) => t[k]).map(([k, col]) => `<i style="width:${t[k] / t.scheduled * 100}%;background:var(${col})"></i>`).join('')}</div><b>${label != null ? `${t.submitted}/${t.scheduled}` : `${pctOf(t.submitted, t.scheduled)}%`}</b></div>`;
const statusLegend = () => `<div class="legend inline">${STATUS_SEGS.map(([, col, l]) => `<div><i style="background:var(${col})"></i>${l}</div>`).join('')}</div>`;
const TILE_HINT = { notCompleted: 'Form not fully rated yet; the review window is still open', pending: 'Form not fully rated and the review window has closed' };
// stat tiles for the five review counts (label on top, big number, tone stripe)
const countTiles = (c, labels = {}) => `<div class="tiles">${[['', 'scheduled', 'Scheduled', 'calendar'], ['g', 'submitted', labels.submitted || 'Submitted', 'check'], ['a', 'notSubmitted', labels.notSubmitted || 'Not submitted', 'draft'], ['r', 'notCompleted', 'Form incomplete', 'alert'], ['', 'pending', 'Overdue', 'hourglass']].map(([cls, k, l, icon]) => `<div class="tile ${cls}"${TILE_HINT[k] ? ` title="${TILE_HINT[k]}"` : ''}><small>${l}</small><b>${c[k]}</b><span>${k !== 'scheduled' && c.scheduled ? `${pctOf(c[k], c.scheduled)}% of scheduled` : k === 'scheduled' ? 'Reviews this month' : 'None scheduled'}</span><i class="wm">${ico(icon)}</i></div>`).join('')}</div>`;
// open the status report filtered to one status (and the team chosen on Home)
function openReport(status) { RF.status = status || ''; RF.team = S.hteam || ''; RF.manager = ''; location.hash = '#/report'; }
const pctOf = (n, tot) => tot ? Math.round(n / tot * 100) : 0;
const initials = n => esc(n.split(' ').map(x => x[0]).join('').slice(0, 2));
const winBadge = t => t.state === 'closed' ? '<span class="badge b-blue">Closed</span>'
  : t.collected === t.total && t.total ? `<span class="badge b-green">${t.collected} of ${t.total} dates</span>` : `<span class="badge b-amber">${t.collected} of ${t.total} dates</span>`;
const winText = w => w.state === 'open' ? `open until ${fmtD(w.end)}` : w.state === 'upcoming' ? `opens ${fmtD(w.start)} (in ${w.days} day${w.days === 1 ? '' : 's'})` : `closed on ${fmtD(w.end)}`;
const widget = (icon, title, extra, body, cls = '') => `<div class="m ${cls}"><div class="mh">${ico(icon)}<b>${title}</b>${extra || ''}</div>${body}</div>`;


let lastHome = {};
// decorative half circle at the right end of the navy banner
const HALO = '<i class="halo" aria-hidden="true"><i></i></i>';
// Review quality widget: facts the status cards do not show
function qualityBody(h, c) {
  const row = (icon, cls, label, n, sub) => `<div class="qrow ${cls}">${ico(icon)}<span>${label}<small>${sub}</small></span><b>${n}</b></div>`;
  return `<div class="mb quality"><div class="qbig"><b class="rt ${rateCls(h.avgRating)}">${pc(h.avgRating)}</b><span>Average monthly rating<small>${h.rated ? `${h.rated} submitted review${h.rated === 1 ? '' : 's'} · out of 100%` : 'Shows once reviews are submitted'}</small></span></div>
    ${row('calcheck', 'g', 'Held on time', h.onTime, `${pctOf(h.onTime, h.held)}% of ${h.held} held`)}
    ${row('clock', 'r', 'Held late', h.late, 'After the review window')}
    ${row('calendar', 'a', 'Rescheduled', h.rescheduled, h.moves ? `${h.moves} date change${h.moves === 1 ? '' : 's'} in all` : 'No date changes')}
    ${row('alert', 'b', 'Forms with flags', h.flagged, `of ${c.scheduled} scheduled`)}</div>`;
}
// employee home: how much of the person's own part of the form is filled in (fp = the /api/form payload)
function myProgress(fp) {
  if (!fp) return null;
  const f = fp.form, qs = fp.questions || [], has = x => x != null && x !== '';
  const blank = x => !x || !String(x).trim(), noAnswer = x => blank(x) || /^(n\/a|not added)$/i.test(String(x).trim());
  const text = qs.filter(q => q.type === 'text' && q.mandatory), rate = qs.filter(q => q.type === 'rating');
  const rows = ['operational', 'process', 'people'].flatMap(k => f.kras[k].rows);
  const g = (label, icon, total, done, none) => ({ label, icon, total, done, note: !total ? none : done >= total ? 'All done' : `${total - done} left` });
  const groups = [
    g('Questions answered', 'question', text.length, text.filter(q => !noAnswer(f.qa[q.id])).length, 'No questions'),
    g('Question self ratings', 'star', rate.length, rate.filter(q => f.qa[q.id] && has(f.qa[q.id].self)).length, 'No rated questions'),
  ];
  // KRAs: each sub-KRA needs a self rating and a self remark; no KRAs yet counts as one open item (new joiners have none)
  if (!fp.newJoiner) groups.push(rows.length ? g('KRA self ratings', 'award', rows.length, rows.filter(r => has(r.self) && !blank(r.selfRemark)).length) : { label: 'KRA self ratings', icon: 'award', total: 1, done: 0, note: 'Add your KRAs first' });
  return { groups, total: groups.reduce((a, x) => a + x.total, 0), done: groups.reduce((a, x) => a + x.done, 0) };
}
// the server's "what is left" lines, grouped by part of the form; the text after the first colon is shown, the full line on hover
function groupTodo(list) {
  const G = [['Questions to answer', 'question', /^answer question/i], ['Question self ratings', 'star', /^self rating for question/i], ['KRAs', 'award', /kra/i], ['Other', 'alert', /./]];
  const out = G.map(([label, icon]) => ({ label, icon, items: [] }));
  list.forEach(t => { const i = G.findIndex(([, , re]) => re.test(t)); out[i].items.push({ full: t, text: i < 2 ? t.replace(/^[^:]*?question\s+(\d+):\s*/i, 'Q$1 · ') : t }); });
  return out.filter(x => x.items.length);
}
// employee dashboard: where their KRA change request stands, and which manager it is with
function kraAccessCard(o) {
  const a = o && o.kraAccess; if (!a) return '';
  const txt = { pending: `KRA change request is waiting for approval from <b>${esc(a.manager)}</b>.`, approved: `<b>${esc(a.decidedBy)}</b> gave you access to change your KRAs. Open your review to make the change.`, rejected: `<b>${esc(a.decidedBy)}</b> rejected your KRA change request.` }[a.status];
  return txt ? `<div class="kreq"><div class="kh">${ico('alert')}<b>KRA change</b><small>${a.status === 'pending' ? 'Pending' : a.status === 'approved' ? 'Access given' : 'Rejected'}</small></div><div class="kr"><span>${txt}</span><span class="sp"></span><a class="btn sm" href="#/form/${S.me.id}/${S.month}">Open my review</a></div></div>` : '';
}

pages.home = async (v, opts = {}) => {
  if (typeof opts !== 'object') opts = {};
  const mgr = S.me.role !== 'employee';
  const d = await api(`/home?month=${S.month}&team=${encodeURIComponent(mgr ? S.hteam || '' : '')}`);
  const c = d.counts, pct = pctOf(c.submitted, c.scheduled), month = d.label.split(' ')[0];
  lastHome = d;
  let html = null;
  if (mgr) {
    const q = d.quick, teams = d.teams, att = d.attention, SHOW = 8;
    const quick = [
      ['calendar', '', 'Scheduling', '#/scheduling', `${q.datesCollected} of ${q.datesTotal} dates collected`],
      ['chart', 'y', 'Status report', '#/report', 'Org and team views'],
      S.me.role !== 'admin' ? ['chart', 'g', 'Team report', '#/yearly', 'KRA scores month by month'] : ['mail', 'g', 'Manager emails', '#/emails', q.emails.sent ? `${q.emails.sent} sent · ${q.emails.drafts} draft${q.emails.drafts === 1 ? '' : 's'}` : q.emails.drafts ? `${q.emails.drafts} draft${q.emails.drafts === 1 ? '' : 's'} ready` : 'No drafts yet'],
      S.me.role === 'admin' ? ['idcard', 'r', 'Employees', '#/employees', `${q.employees.active} active · ${q.employees.inactive} inactive`] : ['team', 'r', 'My team', '#/team', `${q.teamReviews} review${q.teamReviews === 1 ? '' : 's'} in your scope`],
    ];
    const nw = d.nextWindow, windowFact = nw.state === 'open' ? `${esc(nw.team)} · closes ${fmtD(nw.date)}` : nw.state === 'upcoming' ? `${esc(nw.team)} · opens ${fmtD(nw.date)}` : 'All windows closed';
    const hero = `<div class="hero">${ORBS}${HALO}<div class="ring">${ringSvg(pct)}<b>${c.submitted}<small>OF ${c.scheduled} DONE</small></b></div>
      <div><div class="hm">Review progress · ${esc(S.hteam || 'All teams')}</div><div class="ht">${pct}% of ${esc(month)} reviews submitted</div><div class="facts">
        <div><small>Review window</small><b>${windowFact}</b></div>
        <div><small>Dates collected</small><b>${q.datesCollected} / ${q.datesTotal}</b></div>
        <div><small>Past due</small><b>${c.pending}</b></div>
        <div><small>Manager emails</small><b>${q.emails.sent} of ${q.emails.total} sent</b></div></div></div></div>`;
    const chips = `<div class="chips"><div class="seg" id="seg"><button class="chip ${S.hteam ? '' : 'on'}" data-team="">All teams</button>${teams.map(t => `<button class="chip ${S.hteam === t.team ? 'on' : ''}" data-team="${esc(t.team)}">${teamIco(t.team)}${esc(t.team)}</button>`).join('')}</div></div>`;
    const kpi = (cls, st, icon, label, n, sub) => `<div class="stat ${cls}" data-st="${st}" role="button" tabindex="0" title="Open the status report"><small>${label}</small><b>${n}</b><span>${sub}</span><i class="wm">${ico(icon)}</i></div>`;
    const share = n => `${pctOf(n, c.scheduled)}% of scheduled`;
    const kreq = d.kraRequests && d.kraRequests.length ? `<div class="kreq"><div class="kh">${ico('alert')}<b>KRA change requests</b><span class="cnt">${d.kraRequests.length}</span><small>Waiting for your approval</small></div>${d.kraRequests.map(r => `<div class="kr"><span class="avatar">${initials(r.name)}</span><div class="who"><b>${esc(r.name)}</b><small>${esc(r.designation)} · ${esc(r.team || '')} · ${esc(r.label)}</small></div><span class="sp"></span><a class="btn sm" href="#/form/${r.empId}/${r.month}">View KRAs</a><button class="btn sm" data-kdash="0" data-emp="${r.empId}" data-mon="${r.month}">Reject</button><button class="btn pri sm" data-kdash="1" data-emp="${r.empId}" data-mon="${r.month}">Give access</button></div>`).join('')}</div>` : '';
    const body = `<div class="stats">${kpi('n', '', 'calendar', 'Scheduled', c.scheduled, `Across ${S.hteam ? '1 team' : `${teams.length} team${teams.length === 1 ? '' : 's'}`}`)}${kpi('g', 'Completed and Submitted', 'check', 'Submitted', c.submitted, share(c.submitted))}${kpi('a', 'Completed but Not Submitted', 'draft', 'Not submitted', c.notSubmitted, share(c.notSubmitted))}${kpi('r', 'Review Not Completed', 'alert', 'Not completed', c.notCompleted, share(c.notCompleted))}${kpi('b', 'Pending', 'hourglass', 'Pending', c.pending, share(c.pending))}</div>
    <div class="wgrid">
      ${widget('award', 'Review quality', '<a class="more" href="#/report">Report</a>', qualityBody(d.health, c))}
      ${widget('chart', 'Team-wise progress', '<a class="more" href="#/report">Team view</a>', `<div class="mb">${teams.length ? teams.map(t => t.scheduled ? stackBar(t, t.team) : `<div class="tbar"><span class="n" title="${esc(t.team)}">${esc(t.team)}</span><div class="tr"></div><b>0/0</b></div>`).join('') + statusLegend() : '<div class="empty">No teams in your scope.</div>'}</div>`)}
      ${widget('bolt', 'Quick actions', '', `<div class="mb quick">${quick.map(([i, cls, t, h, s]) => `<a class="${cls}" href="${h}">${ico(i)}${t}<span title="${esc(s)}">${esc(s)}</span></a>`).join('')}</div>`)}
    </div>
    <div class="wgrid">
      ${widget('alert', 'Needs your attention', `<span class="cnt">${att.length}</span>${att.length > SHOW ? '<a class="more" href="#/report">See all</a>' : ''}`, att.length ? `<div class="mb flush">${att.slice(0, SHOW).map(a => `<div class="lrow"><span class="avatar s">${initials(a.name)}</span><div class="t"><b>${esc(a.name)}</b><span>${esc(a.team)} · ${esc(a.issue)}${a.more ? ` · +${a.more} more` : ''}${a.reschedules ? ` · rescheduled ${a.reschedules}×` : ''}</span></div>${badge(a.status)}<a class="btn sm" href="#/form/${a.empId}/${S.month}">Open form</a></div>`).join('')}</div>` : `<div class="mb"><div class="ok" style="margin:0">Nothing needs attention${S.hteam ? ' in ' + esc(S.hteam) : ''}.</div></div>`, 'w8')}
      <div class="m bare">
             ${widget('calendar', 'Review windows', '', `<div class="mb" style="padding-top:6px">${teams.map(t => d.canEditWindows ? `<button type="button" class="win ed" data-win="${esc(t.team)}" title="Edit the ${esc(t.team)} review window"><b>${esc(t.team)}</b><span>${fmtD(t.window.start)} to ${fmtD(t.window.end)}${ico('pencil')}</span>${winBadge(t)}</button>` : `<div class="win"><b title="${esc(t.team)}">${esc(t.team)}</b><span>${fmtD(t.window.start)} to ${fmtD(t.window.end)}</span>${winBadge(t)}</div>`).join('') || '<div class="empty">No review windows.</div>'}${d.tips.map(t => `<div class="tip"><b>Tip</b> ${esc(t)}</div>`).join('')}</div>`, 'w12')}
      </div>
    </div>`;
    if (v.querySelector('#hShell') && opts.partial) {
      $('#hReq').innerHTML = kreq;
      $('#hHero').innerHTML = hero;
      $('#hBody').innerHTML = body;
    } else {
      v.innerHTML = `<div id="hShell">${head(`${monthSel('msel', { heading: true })} reviews`)}<div id="hReq">${kreq}</div>${d.orgStats ? allStats(d.orgStats) : ''}<div id="hChips">${chips}</div><div id="hHero">${hero}</div><div id="hBody">${body}</div></div>`;
    }
  } else {
    // employee: navy progress banner, progress cards, what is left (grouped), review steps and recent ratings
    const o = d.own, w = d.window, issues = o ? o.issues : [];
    // the person's own form (they can always read it) gives the totals behind the progress; only fetched when the form exists
    const [fp, yr] = await Promise.all([o ? api(`/form?emp=${S.me.id}&month=${S.month}`).catch(() => null) : null, api('/yearly?self=1').catch(() => null)]);
    const pr = myProgress(fp), done = pr ? pr.done : 0, total = pr ? pr.total : 0, left = Math.max(total - done, 0);
    const finished = o && (o.submitted || o.selfSubmitted), partPct = finished ? 100 : pctOf(done, total);
    const ringMain = !o ? '–' : o.submitted ? '✓' : `${partPct}%`, ringSub = !o ? 'NO FORM' : o.submitted ? 'SUBMITTED' : o.selfSubmitted ? 'SENT' : 'FILLED IN';
    const headline = !o ? 'No review form this month' : o.submitted ? 'Review completed' : o.selfSubmitted ? 'Sent to your manager'
      : issues.length ? `${issues.length} item${issues.length === 1 ? '' : 's'} left to fill in` : 'Your part is complete';
    const sub = !o ? 'Your form appears here once your review month opens.'
      : o.submitted ? `Your manager has submitted this review${o.rating != null ? ` with a monthly rating of ${pc(o.rating)}` : ''}. The form is now locked.`
      : o.selfSubmitted ? `You sent your part${o.selfSubmittedAt ? ` on ${fmtD(o.selfSubmittedAt.slice(0, 10))}` : ''}. Your manager adds their ratings and submits the review.`
      : issues.length ? 'Fill in your self ratings, remarks and answers, then click Submit to manager.' : 'Open your review and click Submit to manager.';
    const meeting = o && o.scheduled ? `${fmtD(o.scheduled)}${o.time ? ', ' + fmtT(o.time) : ''}` : 'Not scheduled yet';
    const hero = `<div class="hero ed-hero">${ORBS}${HALO}<div class="ring">${ringSvg(partPct)}<b>${ringMain}<small>${ringSub}</small></b></div>
      <div class="ed-hx"><div class="hm">My review · ${esc(d.label)}</div><div class="ht">${headline}</div><p>${sub}</p>
        <div class="facts"><div><small>Reporting manager</small><b>${esc(o && o.manager || 'Not assigned')}</b></div>
          <div><small>Review window</small><b>${fmtD(w.start)} to ${fmtD(w.end)}</b></div>
          <div><small>My part</small><b>${!o ? 'No form' : finished ? 'Done' : pr ? `${done} of ${total} filled in` : 'Not started'}</b></div></div></div>
      <div class="acts">${o && o.zoom ? `<a class="btn" href="${esc(o.zoom)}" target="_blank" rel="noopener">${ico('video')}Join Zoom</a>` : ''}${o ? `<a class="btn yel" href="#/form/${S.me.id}/${S.month}">${o.submitted ? 'View my review' : 'Open my review'}</a>` : ''}</div></div>`;
    // four plain cards, one fact each: review status, review meeting, review date, monthly rating
    const kcard = (cls, icon, label, value, note, href) => `<${href ? `a href="${href}"` : 'div'} class="stat ${cls} ed-k"><small>${label}</small><b>${value}</b><span>${note}</span><i class="wm">${ico(icon)}</i></${href ? 'a' : 'div'}>`;
    const stText = !o ? 'No form' : o.submitted ? 'Submitted' : o.selfSubmitted ? 'Sent to manager' : o.status === 'Pending' ? 'Overdue' : issues.length ? 'Form incomplete' : 'Ready to send';
    const stCls = !o ? 'n' : o.submitted ? 'g' : o.selfSubmitted ? 'n' : o.status === 'Pending' ? 'r' : 'a';
    const stNote = !o ? 'No review this month' : o.submitted ? 'Your manager submitted it' : o.selfSubmitted ? 'Waiting for your manager' : issues.length ? `${issues.length} item${issues.length === 1 ? '' : 's'} left to fill in` : 'Click Submit to manager';
    const dateCls = o && o.reviewDate && o.due === 'After due date' ? 'r' : 'ed-dt'; // blue, red when held after the window
    const rv = o ? o.rating ?? o.preview : null;
    const stats = `<div class="stats ed-stats">
      ${kcard(stCls, 'review', 'Review status', stText, stNote, o ? `#/form/${S.me.id}/${S.month}` : '')}
      ${kcard('ed-mt', 'calendar', 'Review meeting', o && o.scheduled ? fmtD(o.scheduled) : 'Not set', o && o.scheduled ? [o.time ? fmtT(o.time) : '', o.invite ? 'invite sent' : 'set by your manager'].filter(Boolean).join(' · ') : 'Your manager sets the date')}
      ${kcard(dateCls, 'clock', 'Review date', o && o.reviewDate ? fmtD(o.reviewDate) : 'Not held yet', o && o.reviewDate ? esc(o.due) : 'Entered on the form')}
      ${kcard(rv != null ? rateCls(rv) || 'n' : 'n', 'chart', 'Monthly rating', rv != null ? pc(rv) : 'N/A', o && o.rating != null ? 'Final' : rv != null ? 'Preview until submitted' : 'Shows once all ratings are in')}</div>`;
    // what is left: the server's list, grouped by the part of the form it belongs to
    const groups = groupTodo(issues), SHOWN = 4;
    const todoBody = !o ? '<div class="mb"><div class="empty">No review form for this month.</div></div>'
      : o.submitted ? `<div class="mb"><div class="ok" style="margin:0">Your manager has submitted this review. Nothing left to do.</div></div>`
      : o.selfSubmitted ? `<div class="mb"><div class="ok" style="margin:0">You have sent your part to your manager. Nothing left for you unless they send it back.</div></div>`
      : !issues.length ? `<div class="mb"><div class="ok" style="margin:0">Everything is filled in. Open your review and click <b>Submit to manager</b>.</div></div>`
      : `<div class="mb"><div class="ed-prog"><span><b>${done} of ${total}</b> filled in</span><span>${partPct}%</span></div>
        ${groups.map(g => `<div class="ed-grp"><h3>${ico(g.icon)}${g.label}<span class="cnt">${g.items.length}</span></h3>
          ${g.items.slice(0, SHOWN).map(t => `<a class="ed-item" href="#/form/${S.me.id}/${S.month}" title="${esc(t.full)}"><i></i><span>${esc(t.text)}</span>${ico('right')}</a>`).join('')}
          ${g.items.length > SHOWN ? `<a class="ed-more" href="#/form/${S.me.id}/${S.month}">+${g.items.length - SHOWN} more in your review</a>` : ''}</div>`).join('')}</div>`;
    // review steps, each marked done / now / next from the review's state
    const st = [
      ['Fill in your part', pr ? `${done} of ${total} filled in` : 'Self ratings, remarks and answers', finished || (o && !issues.length)],
      ['Submit to manager', o && o.selfSubmitted ? `Sent${o.selfSubmittedAt ? ` on ${fmtD(o.selfSubmittedAt.slice(0, 10))}` : ''}` : 'Your manager can send it back if something needs changing', !!finished],
      ['Review meeting', o && o.reviewDate ? `Held on ${fmtD(o.reviewDate)}` : o && o.scheduled ? `${meeting}${o.invite ? ' · invite in your Google Calendar' : ''}${o.reschedules ? ` · rescheduled ${o.reschedules}×` : ''}` : 'Your manager sets the date', !!(o && (o.reviewDate || o.submitted))],
      ['Manager submits', o && o.submitted ? 'Done. The form is locked' : 'Their ratings count 70%, yours 30%', !!(o && o.submitted)],
    ];
    const cur = st.findIndex(x => !x[2]);
    const steps = `<ol class="ed-steps">${st.map(([t, s2, ok], i) => `<li class="${ok ? 'done' : i === cur ? 'now' : ''}"><i>${ok ? ico('tick') : i + 1}</i><div><b>${t}</b><span>${esc(s2)}</span></div></li>`).join('')}</ol>`;
    // recent monthly ratings (submitted months), newest first
    const recent = yr && yr.people[0] ? yr.months.map((m, i) => ({ m, t: yr.people[0].cells[i] && yr.people[0].cells[i].total })).filter(x => x.t != null).slice(-5).reverse() : [];
    const recentBody = recent.length ? `<div class="mb">${recent.map(x => `<div class="ed-rate"><span>${esc(x.m.label.split(' ')[0].slice(0, 3))} ${x.m.label.split(' ')[1].slice(2)}</span><div class="ed-bar"><i class="${rateCls(x.t)}" style="width:${x.t}%"></i></div><b class="rt ${rateCls(x.t)}">${x.t.toFixed(1)}%</b></div>`).join('')}
      <a class="more ed-link" href="#/yearly">${ico('chart')}See my full report</a></div>` : '<div class="mb"><div class="empty">No submitted reviews yet this year.</div></div>';
    html = `${head(`My ${monthSel('msel', { heading: true })} review`, `Welcome back, ${esc(S.me.name.split(' ')[0])} · ${esc(S.me.designation || ROLE_LABEL[S.me.role])}${S.me.team ? ` · ${esc(S.me.team)} team` : ''}`)}
    ${hero}${stats}
    ${kraAccessCard(o)}
    <div class="wgrid">
      ${widget(o && o.submitted ? 'check' : 'review', o && o.submitted ? 'Review submitted' : o && o.selfSubmitted ? 'Sent to your manager' : 'What is left on my form', issues.length && !finished ? `<span class="cnt">${issues.length}</span><a class="more" href="#/form/${S.me.id}/${S.month}">Open review</a>` : '', todoBody, 'w8')}
      <div class="m bare">
        ${widget('list', 'Review steps', '', `<div class="mb">${steps}<p class="ed-note">Monthly rating = 30% your rating + 70% your manager's, weighted by sub-KRA and then by KRA.</p></div>`)}
        ${widget('award', 'My recent ratings', '', recentBody)}
      </div>
    </div>`;
  }
  if (html != null) v.innerHTML = html;
  onMonth(() => pages.home(v));
  v.onclick = async e => {
    const kd = e.target.closest('[data-kdash]');
    if (kd) {
      try { await api('/kra-request/decide', { method: 'POST', body: { empId: +kd.dataset.emp, month: kd.dataset.mon, approve: kd.dataset.kdash === '1' } }); toast(kd.dataset.kdash === '1' ? 'Access given' : 'Request rejected'); pages.home(v, { partial: true }); }
      catch (er) { toast(er.message, 'err'); }
      return;
    }
    // All stats cards: the Employees page remembers its role filter in S.erole; set it so the list matches the card
    const sc = e.target.closest('a[data-role]'); if (sc) { S.erole = sc.dataset.role; S.eq = ''; S.eteam = ''; return; }
    const b = e.target.closest('[data-team]');
    if (b) {
      if (b.classList.contains('on')) return;
      const chips = [...v.querySelectorAll('.chip')], from = chips.findIndex(x => x.classList.contains('on')), to = chips.indexOf(b);
      chips.forEach(x => x.classList.toggle('on', x === b));
      S.hteam = b.dataset.team; return pages.home(v, { partial: true, dir: to > from ? 1 : -1 });
    }
    const w = e.target.closest('[data-win]');
    if (w) { const t = (lastHome.teams || []).find(x => x.team === w.dataset.win); if (t) windowDialog(t, () => pages.home(v, { partial: true })); return; }
    const s = e.target.closest('[data-st]'); if (s) openReport(s.dataset.st);
  };
  v.onkeydown = e => { const s = e.target.closest?.('.stat[data-st]'); if (s && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openReport(s.dataset.st); } };
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
    const t = formSummary(f).kras.find(x => x.key === k), sr = t.self ?? 0, mr = t.mgr ?? 0, calc = t.score ?? Math.round((0.3 * sr + 0.7 * mr) * 10) / 10;
    const head = `<div class="kra" id="sec-${k}">${label} KRA<span>${desc}</span></div>
      <div class="row" style="margin:0 0 12px"><span class="small" style="font-weight:600;letter-spacing:.1em;text-transform:uppercase">KRA weightage</span> ${ed ? `<input class="num" type="number" data-kw="${k}" value="${kr.weight}">` : kr.weight}</div>`;
    const btns = ed ? `<div class="row" style="margin-top:10px"><button class="btn sm" data-add="${k}" title="Add sub-KRA">${ico('plus')}Add sub-KRA</button><button class="btn pri sm" data-savek="${k}">Save ${label} KRA</button></div>` : '';
    if (!rows.length) return head + `<div class="${FP.newJoiner ? 'info' : 'warn'}">${FP.newJoiner ? 'New joiner: no KRAs set yet. Only the questionnaire is checked.' : `${label} KRA is not set.`}</div>` + btns;
    return head + `<div class="tablewrap"><table class="krat"><colgroup><col style="width:56px"><col><col style="width:110px"><col style="width:96px"><col style="width:100px"><col style="width:112px"><col style="width:21%"><col style="width:21%"></colgroup><tr><th>Sr. no</th><th>Key performance indicator</th><th>Target</th><th>Weightage</th><th>Self rating (30%)</th><th>Manager rating (70%)</th><th>Remark</th><th>Manager remark</th></tr>
    ${rows.map((r, i) => {
      const diff = r.self != null && r.mgr != null && +r.self !== +r.mgr, needRemark = diff && !(r.mgrRemark || '').trim();
      const needSelf = attempted && (r.self == null || !(r.selfRemark || '').trim());
      return `<tr><td>${ed ? `<button class="xdel" data-del="${k}:${i}" title="Remove sub-KRA" aria-label="Remove sub-KRA" style="vertical-align:middle">${ico('trash')}</button> ` : ''}${i + 1}</td>
      <td>${ed ? `<textarea rows="2" data-k="${k}" data-i="${i}" data-f="kpi">${esc(r.kpi)}</textarea>` : esc(r.kpi)}</td>
      <td>${ed ? `<textarea rows="2" data-k="${k}" data-i="${i}" data-f="target">${esc(r.target)}</textarea>` : esc(r.target)}</td>
      <td>${ed ? `<input class="num" type="number" data-k="${k}" data-i="${i}" data-f="weight" value="${r.weight}">` : r.weight}</td>
      <td>${rateSel(r.self, `data-k="${k}" data-i="${i}" data-f="self"`, p.editSelf, `${r.self != null ? 'filled' : ''} ${needSelf && r.self == null ? 'err' : ''}`, KRA_RATINGS)}</td>
      <td>${rateSel(r.mgr, `data-k="${k}" data-i="${i}" data-f="mgr"`, p.editManager, r.mgr != null ? 'filled' : '', KRA_RATINGS)}</td>
      <td><textarea class="${needSelf && !(r.selfRemark || '').trim() ? 'err' : ''}" rows="2" data-k="${k}" data-i="${i}" data-f="selfRemark" ${p.editSelf ? '' : 'disabled'}>${esc(r.selfRemark)}</textarea></td>
      <td><textarea class="${needRemark ? 'err' : ''}" rows="2" data-k="${k}" data-i="${i}" data-f="mgrRemark" ${p.editManager ? '' : 'disabled'}>${esc(r.mgrRemark)}</textarea>
      ${needRemark ? '<div class="flag">Manager remarks are required because there is a difference between the employee\'s self-rating and the manager\'s rating.</div>' : ''}</td></tr>`;
    }).join('')}
    <tr class="sub"><td></td><td></td><td><b>Totals</b></td><td>Weightage: <b>${sum}</b></td><td>Total SR: <b>${sr}%</b></td><td>Total MR: <b>${mr}%</b></td><td colspan="2">Total calculation: <b>${calc}%</b>${t.points != null ? ` <span class="small">· ${t.points} of ${kr.weight} points</span>` : ''}</td></tr></table></div>` + btns;
  };
  const qs = FP.questions;
  const text = qs.filter(q => q.type === 'text'), rate = qs.filter(q => q.type === 'rating');
  const noDate = !f.reviewDate && attempted;
  const sum = formSummary(f);
  const pi = sum.rating != null ? `Monthly rating${f.submitted ? '' : ' (preview until submitted)'}: <b>${pc(sum.rating)}</b>` : `Monthly rating: shows once every self and manager rating is in`;
  v.innerHTML = head('Monthly review form', `PMS › ${e.id === S.me.id ? 'My Review' : esc(e.name)} › ${esc(monthLabel(S.month))}`) +
    `<div class="row"><select id="msel">${S.me.months.map(m => `<option value="${m.key}" ${m.key === S.month ? 'selected' : ''}>${m.label.split(" ")[0]}</option>`).join('')}<option value="annual">Annual review</option></select>${p.copyKras ? '<button class="btn kcopy" id="copyk">Copy KRAs from last month</button>' : ''}<button class="btn" id="expk" title="Download this month's KRAs, ratings, remarks and questionnaire as a CSV file (opens in Excel)">${ico('download')}Export KPI</button><span class="sp"></span>${badge(FP.status)} ${f.locked ? '<span class="badge b-grey">Locked</span>' : f.selfSubmitted ? '<span class="badge b-blue">Sent to manager</span>' : ''}</div>
    ${kraBanner(p)}
    ${f.locked ? '<div class="info">This review is completed and submitted. The form is locked and can no longer be changed by anyone.</div>'
      : f.selfSubmitted ? `<div class="info">${e.id === S.me.id ? 'You sent' : `${esc(e.name)} sent`} this form to the manager${f.selfSubmittedAt ? ` on ${fmtD(f.selfSubmittedAt.slice(0, 10))}` : ''}. ${p.canSubmit ? 'Add your ratings (and a remark where they differ), then Submit review. Use Send back to employee if they need to change something.' : 'Your part is now read-only. Your manager adds their ratings and submits the review; they can send it back to you if something needs changing.'}</div>` : ''}
    <div class="formhead">KRA · ${FP.fy} · ${esc(monthLabel(S.month))}</div>
    <div class="card" style="margin-top:12px"><div class="row" style="margin:0;align-items:flex-end"><div class="empmeta"><div><b>Employee Name :</b> ${esc(e.name)}${e.designation ? ` ( ${esc(e.designation)} )` : ''}</div><div><b>Reporting Manager :</b> ${m ? esc(m.name) : 'Not assigned yet'}</div></div>
<span class="sp"></span>
    <div><label class="f" style="margin:0 0 4px">Review date <i>*</i></label><input type="date" id="reviewDate" class="${noDate ? 'err' : ''}" value="${esc(f.reviewDate)}" ${p.editSelf || p.editManager ? '' : 'disabled'}></div></div>
    ${noDate ? '<div class="warn">Review date is required. Enter it before submitting the form.</div>' : ''}
    ${errors ? `<div class="warn">${errors.map(esc).join('<br>')}</div>` : ''}
    <div class="small" style="margin-top:12px">${pi}</div></div>
    <div class="tabs" id="tabs">${[['operational', 'Operational'], ['process', 'Process'], ['people', 'People'], ['questionnaire', 'Questionnaire']].map(([k, l], i) => `<button data-t="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</div>
    ${sec('operational', 'Operational', '(Our value addition to the client via quality/financially)')}
    ${sec('process', 'Process', '(SOP and ClickUp)')}
    ${sec('people', 'People', '(Learning)')}
    ${ratingBox(f)}
    <div class="kra qa" id="sec-questionnaire">Questionnaire<span>Text answers and rated questions</span></div>
    <div class="tablewrap"><table style="table-layout:fixed"><colgroup><col style="width:90px"><col style="width:38%"><col></colgroup><tr><th>Sr. no</th><th>Question</th><th>Answer</th></tr>${text.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.text)}</td><td>${editingQ.has(q.id) ? `<textarea data-qt="${q.id}" rows="3" placeholder="Type your answer">${esc(f.qa[q.id] || '')}</textarea><div class="row" style="margin:8px 0 0"><button class="btn pri sm" data-qsave="${q.id}">Save</button><button class="btn sm" data-qcancel="${q.id}">Cancel</button></div>`
      : `<span style="white-space:pre-wrap">${f.qa[q.id] ? esc(f.qa[q.id]) : '<span class="muted">Not added</span>'}</span> ${p.editSelf || p.editManager ? `<button class="ibtn" data-qedit="${q.id}" title="Edit answer" aria-label="Edit answer" style="vertical-align:middle">${ico('pencil')}</button>` : ''}`}</td></tr>`).join('')}${rate.map((q, i) => {
      const a = f.qa[q.id] || {}, diff = a.self != null && a.mgr != null && +a.self !== +a.mgr, need = diff && !(a.remark || '').trim();
      return `<tr><td>${text.length + i + 1}</td><td>${esc(q.text)} (Rate out of 5)</td><td><table style="table-layout:fixed"><tr><th style="width:104px">Self rating</th><th style="width:118px">Manager rating</th><th>Remark</th></tr><tr>
        <td>${rateSel(a.self, `data-qr="${q.id}" data-f="self"`, p.editSelf, a.self != null ? 'filled' : '')}</td>
        <td>${rateSel(a.mgr, `data-qr="${q.id}" data-f="mgr"`, p.editManager, a.mgr != null ? 'filled' : '')}</td>
        <td><textarea class="${need ? 'err' : ''}" rows="1" data-qr="${q.id}" data-f="remark" ${p.editManager ? '' : 'disabled'}>${esc(a.remark || '')}</textarea>${need ? '<div class="flag">Manager remark required: ratings differ.</div>' : ''}</td></tr></table></td></tr>`;
    }).join('')}</table></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px">
    ${p.canReturn ? '<button class="btn" id="giveback" title="Let the employee change their self ratings, remarks and answers again">Send back to employee</button>' : ''}
    ${p.canSubmit ? '<button class="btn pri" id="submit">Submit review</button>' : ''}
    </div>`;
  wireForm(v);
}

// the monthly rating worked out KRA by KRA from the form as it is on screen (same sums as the server: 30% self + 70% manager,
// weighted by sub-KRA, then by KRA weight)
function formSummary(f) {
  const has = x => x != null && x !== '', r1 = x => x == null ? null : Math.round(x * 10) / 10;
  const wavg = (rows, key) => { const w = rows.filter(r => has(r[key])), tw = w.reduce((a, r) => a + (+r.weight || 0), 0); return tw ? w.reduce((a, r) => a + r.weight * r[key], 0) / tw : null; };
  const kras = [['operational', 'Operational'], ['process', 'Process'], ['people', 'People']].map(([k, label]) => {
    const { rows, weight } = f.kras[k], sv = wavg(rows, 'self'), mv = wavg(rows, 'mgr');
    const score = sv != null && mv != null && rows.every(r => has(r.self) && has(r.mgr)) ? 0.3 * sv + 0.7 * mv : null;
    return { key: k, label, weight: +weight, subKras: rows.length, self: r1(sv), mgr: r1(mv), score: r1(score), points: score == null ? null : r1(weight * score / 100) };
  });
  const set = kras.filter(x => x.subKras), done = set.length && set.every(x => x.score != null);
  const tw = set.reduce((a, x) => a + x.weight, 0);
  const rating = done && tw ? r1(set.reduce((a, x) => a + x.weight * x.score, 0) / tw) : null;
  const qa = (FP.questions || []).filter(q => q.type === 'rating').map(q => f.qa[q.id] || {});
  const qavg = key => { const v = qa.map(a => a[key]).filter(has); return v.length ? r1(v.reduce((a, b) => a + +b, 0) / v.length) : null; };
  return { kras, rating, points: done ? r1(set.reduce((a, x) => a + x.points, 0)) : null, weightTotal: tw, final: !!f.submitted, newJoiner: FP.newJoiner, q: { self: qavg('self'), mgr: qavg('mgr'), n: qa.length } };
}
// Rating table below the People KRA: shown to everyone, only once the review is submitted (average of the KRA ratings by KRA weightage,
// monthly rating = 30% self + 70% manager)
function ratingBox(f) {
  const has = x => x != null && x !== '';
  if (!f.submitted) return ''; // only once the manager has submitted the review
  const set = ['operational', 'process', 'people'].map(k => f.kras[k]).filter(k => k.rows.length);
  if (!set.length || !set.every(k => k.rows.every(r => has(r.self) && has(r.mgr)))) return '';
  const tw = set.reduce((a, k) => a + (+k.weight || 0), 0); if (!tw) return '';
  const avg = key => set.reduce((a, k) => { const rw = k.rows.reduce((x, r) => x + (+r.weight || 0), 0); return a + k.weight * (rw ? k.rows.reduce((x, r) => x + r.weight * r[key], 0) / rw : 0); }, 0) / tw;
  const sr = avg('self'), mr = avg('mgr'), r2 = x => +x.toFixed(2);
  return `<div class="tablewrap" style="margin-top:20px"><table class="ratebox"><tr><th>Rating</th><th>Self Rating</th><th>Management Rating</th></tr>
    <tr><td>Average Rating</td><td>${r2(sr)}</td><td>${r2(mr)}</td></tr>
    <tr class="mon"><td>Monthly Rating</td><td colspan="2"><b>${r2(0.3 * sr + 0.7 * mr)}%</b></td></tr></table></div>`;
}
// Export KPI: the monthly form as it is on screen, as a CSV file Excel opens directly (UTF-8 with BOM)
function exportKpi() {
  const { form: f, employee: e, manager: m } = FP, sum = formSummary(f), q = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const lines = [['Employee', e.name], ['Designation', e.designation], ['Reporting manager', m ? m.name : ''], ['Month', monthLabel(f.month)], ['Review date', f.reviewDate || ''],
    ['Status', STATUS_TEXT[FP.status] || FP.status], ['Monthly rating (%)', sum.rating ?? ''], [], ['KRA', 'KRA weightage', 'Sr. no', 'Key performance indicator', 'Target', 'Weightage', 'Self rating (30%)', 'Manager rating (70%)', 'Remark', 'Manager remark']];
  sum.kras.forEach(k => {
    f.kras[k.key].rows.forEach((r, i) => lines.push([k.label, k.weight, i + 1, r.kpi, r.target, r.weight, r.self != null ? r.self + '%' : '', r.mgr != null ? r.mgr + '%' : '', r.selfRemark, r.mgrRemark]));
    lines.push([`${k.label} total`, k.weight, '', '', '', '', k.self != null ? k.self + '%' : '', k.mgr != null ? k.mgr + '%' : '', `KRA score ${k.score != null ? k.score + '%' : '-'}`, `Points ${k.points ?? '-'}`]);
  });
  lines.push([], ['Questionnaire'], ['Sr. no', 'Question', 'Answer', 'Self rating (of 5)', 'Manager rating (of 5)', 'Manager remark']);
  (FP.questions || []).forEach((x, i) => { const a = f.qa[x.id]; lines.push(x.type === 'text' ? [i + 1, x.text, a || ''] : [i + 1, x.text, '', a && a.self != null ? a.self : '', a && a.mgr != null ? a.mgr : '', a ? a.remark || '' : '']); });
  const csv = '\ufeff' + lines.map(l => l.map(q).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `KPI_${e.name.replace(/\s+/g, '_')}_${f.month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// KRA change requests: employees ask, the manager approves, then the employee can edit once
function kraBanner(p) {
  const r = FP.kraRequest; let h = '';
  if (r && r.status === 'pending') h = p.decideKra
    ? `<div class="warn"><b>${esc(r.by)} asked to change their KRAs.</b><div class="row" style="margin:10px 0 0"><button class="btn pri sm" data-kdec="1">Approve</button><button class="btn sm" data-kdec="0">Reject</button></div></div>`
    : `<div class="info">KRA change request sent to <b>${esc(FP.manager ? FP.manager.name : 'your manager')}</b>. You can edit the KRAs once it is approved.</div>`;
  else if (r && r.status === 'approved') h = p.editKras && S.me.id === FP.employee.id ? `<div class="info"><b>${esc(r.decidedBy)}</b> gave you access to change the KRAs. Edit the KRAs below and save. After you save, a new request is needed for further changes.</div>` : `<div class="info">KRA change approved by <b>${esc(r.decidedBy)}</b>. ${esc(FP.employee.name)} can now edit the KRAs.</div>`;
  else if (r && r.status === 'rejected') h = `<div class="warn">KRA change request was rejected by ${esc(r.decidedBy)}.${r.reply ? '<br>' + esc(r.reply) : ''}</div>`;
  if (p.requestKra) h += `<div class="row" style="margin:0 0 12px"><button class="btn kask" data-kreq="1">Request KRA change</button><span class="small">KRAs can only be changed with approval from ${esc(FP.manager ? FP.manager.name : 'your manager')}.</span></div>`;
  return h;
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
    if (e.target.id === 'reviewDate' && e.target.value && +e.target.value.slice(0, 4) < 1000) return; // still typing the year
    // employees' entries are also saved as they type (Save draft just confirms and shows the summary)
    const mine = ++changeSeq;
    if (FP.perms.editSelf || FP.perms.editManager) { try { await save(); } catch (er) { toast(er.message, 'err'); } }
    if (mine !== changeSeq) return; // a newer change is in flight; it will redraw (and keep any remark focus)
    // a typed date fires change after every digit, and a redraw would throw the cursor out of the field
    if (e.target.id === 'reviewDate' && e.target.value && !e.target.classList.contains('err')) return;
    const y = SC().scrollTop; drawForm(v); SC().scrollTop = y;
    // self and manager ratings now differ: move straight to the manager remark
    const t = e.target;
    if (t.tagName === 'SELECT' && (t.dataset.f === 'self' || t.dataset.f === 'mgr')) {
      const a = t.dataset.k ? f.kras[t.dataset.k].rows[+t.dataset.i] : t.dataset.qr ? f.qa[t.dataset.qr] : null;
      const sel = t.dataset.k ? `textarea[data-k="${t.dataset.k}"][data-i="${t.dataset.i}"][data-f="mgrRemark"]` : `textarea[data-qr="${t.dataset.qr}"][data-f="remark"]`;
      const box = a && a.self != null && a.mgr != null && +a.self !== +a.mgr && v.querySelector(sel);
      if (box && !box.disabled && !box.value.trim()) { box.focus({ preventScroll: true }); box.scrollIntoView({ block: 'center' }); toast('Ratings differ: please add a manager remark.'); }
    }
  };
  const lightTab = cur => document.querySelectorAll('#tabs button').forEach((b, i) => b.classList.toggle('on', i === cur));
  let tabHold = 0; // right after a tab is clicked, keep that tab lit even if its section cannot reach the top
  $('#tabs').onclick = e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    tabHold = Date.now() + 300; lightTab([...b.parentNode.children].indexOf(b));
    $('#sec-' + b.dataset.t).scrollIntoView({ block: 'start' });
  };
  const secs = ['operational', 'process', 'people', 'questionnaire'].map(k => $('#sec-' + k));
  SC().onscroll = () => {
    if (!$('#tabs') || Date.now() < tabHold) return;
    let cur = 0; secs.forEach((s, i) => { if (s.getBoundingClientRect().top < 140) cur = i; });
    lightTab(cur);
  };
  const save = async () => { FP = await api('/form', { method: 'PUT', body: { empId: f.empId, month: f.month, reviewDate: f.reviewDate, kras: f.kras, qa: f.qa } }); };
  const redraw = () => { const y = SC().scrollTop; drawForm(v); SC().scrollTop = y; };
  // question answers: the pencil opens a box; the Save button stores the answer (ratings and remarks still save automatically)
  if (focusQ) { const ta = v.querySelector(`textarea[data-qt="${focusQ}"]`); if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); } }
  $('#expk').onclick = () => exportKpi();
  const showErrors = e => { drawForm(v, e.data?.errors ? [e.message, ...e.data.errors] : [e.message]); SC().scrollTo({ top: 0, behavior: 'smooth' }); };
  // step 2 (manager/admin): final submit, locks the form for good
  if ($('#submit')) $('#submit').onclick = async () => {
    attempted = true;
    try { await save(); } catch (e) { return showErrors(e); }
    if (!await confirmBox('Submit this review?', 'After submitting, the form is locked for good. Nobody can change it, admins included.', { ok: 'Submit review' })) return;
    try { FP = await api('/form/submit', { method: 'POST', body: { empId: f.empId, month: f.month } }); attempted = false; toast('Review submitted'); drawForm(v); }
    catch (e) { showErrors(e); }
  };
  // step 1 (employee): send self ratings, remarks and answers to the manager
  if ($('#selfsub')) $('#selfsub').onclick = async () => {
    attempted = true;
    try { await save(); } catch (e) { return showErrors(e); }
    if (!await confirmBox('Submit to your manager?', 'Your self ratings, remarks and answers will be sent to your manager and become read-only. Your manager can send the form back if something needs changing.', { ok: 'Submit to manager' })) return;
    try { FP = await api('/form/self-submit', { method: 'POST', body: { empId: f.empId, month: f.month } }); attempted = false; toast('Sent to your manager'); drawForm(v); }
    catch (e) { showErrors(e); }
  };
  if ($('#giveback')) $('#giveback').onclick = async () => {
    if (!await confirmBox('Send back to the employee?', 'They can change their self ratings, remarks and answers again, and then submit it to you once more.', { ok: 'Send back' })) return;
    try { await save(); FP = await api('/form/return', { method: 'POST', body: { empId: f.empId, month: f.month } }); toast('Form sent back to the employee'); drawForm(v); }
    catch (e) { showErrors(e); }
  };
  v.onclick = async e => {
    const t = e.target, post = (u, b) => api(u, { method: 'POST', body: { empId: f.empId, month: f.month, ...b } });
    try {
      const qs = t.closest('[data-qsave]'), qc = t.closest('[data-qcancel]');
      if (qs) {
        const id = qs.dataset.qsave, ta = v.querySelector(`textarea[data-qt="${id}"]`);
        f.qa[id] = ta.value;
        try { await save(); editingQ.delete(id); toast('Answer saved'); } catch (er) { toast(er.message, 'err'); }
        return redraw();
      }
      if (qc) { const id = qc.dataset.qcancel; f.qa[id] = qOriginal[id] || ''; editingQ.delete(id); focusQ = null; return redraw(); }
      const qe = t.closest('[data-qedit]'); // the click usually lands on the pencil's svg, not the button
      if (qe) { const id = qe.dataset.qedit; editingQ.add(id); focusQ = id; qOriginal[id] = f.qa[id] || ''; redraw(); }
      else if (t.dataset.kreq) {
        FP = await post('/kra-request', {}); toast('Request sent to your manager'); drawForm(v);
      }
      else if (t.dataset.kdec) {
        const approve = t.dataset.kdec === '1';
        const reply = approve ? '' : await askNote('Reject KRA change', 'Reason (optional)', true);
        if (reply === null) return;
        FP = await post('/kra-request/decide', { approve, reply }); toast(approve ? 'Approved' : 'Rejected'); drawForm(v);
      }
      else if (t.dataset.add) { const k = t.dataset.add; f.kras[k].rows.push({ id: k[0] + Date.now(), kpi: '', target: '', weight: 0, self: null, selfRemark: '', mgr: null, mgrRemark: '' }); drawForm(v); }
      else if (t.dataset.del) { const [k, i] = t.dataset.del.split(':'); f.kras[k].rows.splice(+i, 1); drawForm(v); }
      else if (t.dataset.savek) {
        const k = t.dataset.savek;
        try { await save(); FP = await api('/kras', { method: 'PUT', body: { empId: f.empId, month: f.month, kras: { [k]: f.kras[k] } } }); toast('KRA saved'); drawForm(v); }
        catch (er) { drawForm(v, er.data?.errors || [er.message]); SC().scrollTo({ top: 0, behavior: 'smooth' }); }
      }
      else if (t.id === 'copyk') {
        if (!await confirmBox('Copy KRAs from last month?', 'This replaces this month\'s KRAs with last month\'s. Ratings and remarks for this month will be cleared.', { ok: 'Copy KRAs', danger: true })) return;
        FP = await post('/form/copy-kras'); toast('KRAs copied from last month'); drawForm(v);
      }
    } catch (er) { toast(er.message, 'err'); }
  };
}

// ---------- manager pages: My Team, My Team Report, My MIS Report, My KPI Report ----------
// Each opens for the signed-in person, or for a manager under them (#/team/<id>, #/yearly/<id>; admins also #/mis/<id>, #/kpi/<id>).
const monShort = () => esc(monthLabel(S.month).split(' ')[0]);
const rateCls = x => x == null ? '' : x >= 80 ? 'g' : x >= 60 ? 'a' : 'r'; // percentage ratings
// where a person's name leads back to: admins use the Reporting Manager page, everyone else My Team
const personHref = id => S.me.role === 'admin' ? `#/reporting/${id}` : `#/team/${id}`;
const reportLinks = (r, opts = {}) => `<span class="acts">${r.direct ? `<a class="btn sm" href="#/yearly/${r.id}" title="Team report: everyone under ${esc(r.name)}">${ico('check')}Team report</a>${S.me.role === 'admin' ? `<a class="btn sm" href="#/mis/${r.id}" title="Month-by-month figures for ${esc(r.name)}'s team">${ico('grid')}MIS report</a>` : ''}` : ''}${opts.kpi === false || S.me.role !== 'admin' ? '' : `<a class="btn sm" href="#/kpi/${r.id}" title="${esc(r.name)}'s own KRA scores by month">${ico('award')}KPI report</a>`}</span>`;
const reportHead = (d, title, crumbLabel) => head(d.me ? `My ${title}` : `${title[0].toUpperCase() + title.slice(1)}: ${esc(d.person.name)}`,
  d.me ? `PMS › My ${title}` : `PMS › <a href="${personHref(d.person.id)}">${esc(d.person.name)}</a> › ${crumbLabel || title}`);

// My Team: my people (drill into anyone who has a team), and the list of every manager under me
pages.team = async (v, arg) => {
  arg = String(arg || '').toLowerCase();
  const id = /^\d+$/.test(arg) ? arg : '', list = arg === 'managers';
  const d = await api(`/myteam?month=${S.month}${id ? '&id=' + id : ''}`), p = d.person, c = d.counts, mon = monShort();
  const crumbs = d.me ? `PMS › My team${list ? ' › Reporting manager list' : ''}`
    : ['<a href="#/team">My team</a>', ...d.path.filter(x => x.id !== S.me.id).map(x => `<a href="#/team/${x.id}">${esc(x.name)}</a>`), `<b>${esc(p.name)}</b>`].join(' › ');
  const up = d.path.filter(x => x.id !== S.me.id), back = up.length ? `#/team/${up[up.length - 1].id}` : '#/team';
  const review = r => r.review ? `<a href="#/form/${r.id}/${S.month}" title="Open the ${mon} form">${badge(r.review.status)}</a>` : '<span class="small">No form</span>';
  const count = r => r.direct ? `<a class="btn sm" href="#/team/${r.id}" title="Open ${esc(r.name)}'s team">${ico('eye')}${r.direct}</a>` : '<span class="small">0</span>';
  const who = r => `<div class="orgname"><span class="avatar s">${initials(r.name)}</span><div>${r.direct ? `<a class="nm" href="#/team/${r.id}">${esc(r.name)}</a>` : `<b>${esc(r.name)}</b>`}<div class="small">${dotJoin(r.designation, r.team)}</div></div></div>`;
  const rows = list ? d.managers : d.members;
  const table = list
    ? `<tr><th>Sr. no</th><th>Name</th><th>Email</th><th>Designation</th><th>Reports to</th><th>Employees</th><th>Team report</th></tr>
      ${rows.map((r, i) => `<tr data-s="${esc(`${r.name} ${r.email} ${r.designation} ${r.team}`.toLowerCase())}"><td>${i + 1}</td><td>${who(r)}</td><td class="small">${esc(r.email) || 'N/A'}</td><td>${esc(r.designation)}</td><td>${r.manager ? esc(r.manager.name) : 'N/A'}</td><td>${count(r)}</td>
        <td><a class="btn sm" href="#/yearly/${r.id}" title="Team report: everyone under ${esc(r.name)}">${ico('check')}Open</a></td></tr>`).join('')
        || '<tr><td colspan="7" class="small">No managers under you. Everyone in your team reports to you directly.</td></tr>'}`
    : `<tr><th>Sr. no</th><th>Name</th><th>Employees</th><th>${mon} review</th><th>Rating</th><th>Reports</th></tr>
      ${rows.map((r, i) => `<tr data-s="${esc(`${r.name} ${r.email} ${r.designation} ${r.team}`.toLowerCase())}"><td>${i + 1}</td><td>${who(r)}</td><td>${count(r)}</td><td>${review(r)}</td><td>${r.review && r.review.rating != null ? `<b class="rt ${rateCls(r.review.rating)}">${pc(r.review.rating)}</b>` : 'N/A'}</td><td>${reportLinks(r)}</td></tr>`).join('')
        || `<tr><td colspan="6" class="small">Nobody reports to ${d.me ? 'you' : esc(p.name)}.</td></tr>`}`;
  v.innerHTML = head('My team', crumbs) + `<div class="seg" role="tablist"><a role="tab" href="#/team" class="${d.me && !list ? 'on' : ''}">My team <span class="cnt">${d.members.length}</span></a><a role="tab" href="#/team/managers" class="${list ? 'on' : ''}">Reporting manager list <span class="cnt">${d.managers.length}</span></a></div>
  <div class="row">${monthSel()}${searchBox('tq', 'Search name, team or email', S.tq)}<span class="sp"></span>${d.me ? '' : `<a class="btn" href="${back}">← Back</a>`}</div>
  ${d.me ? '' : `<div class="card orghead"><span class="avatar">${initials(p.name)}</span><div><b class="on">${esc(p.name)}</b><div class="small">${dotJoin(p.designation, p.team)}${p.email ? ' · ' + esc(p.email) : ''}</div><div class="small">Reports to ${p.manager ? esc(p.manager.name) : 'nobody'} · ${p.direct} direct report${p.direct === 1 ? '' : 's'}</div></div><span class="sp"></span>${reportLinks(p)}</div>`}
  <div class="small" style="margin:0 0 12px">${mon} reviews of everyone under ${d.me ? 'you' : esc(p.name)} (all levels)</div>
  ${countTiles(c)}
  <h2>${list ? `Reporting manager list (${rows.length})` : `${d.me ? 'My team' : `${esc(p.name)}'s team`} (${rows.length})`}</h2>
  <div class="tablewrap"><table>${table}<tr id="tnone" hidden><td colspan="9" class="small">No one here matches your search.</td></tr></table></div>
  <p class="small">${list ? 'Every manager and team lead under you, at every level. Click the Employees count to open their team.' : 'Click a name or the Employees count to open that person\'s team; click a review status to open the form.'}</p>`;
  onMonth(() => pages.team(v, arg));
  const filter = () => {
    const s = (S.tq || '').trim().toLowerCase(); let n = 0;
    v.querySelectorAll('tr[data-s]').forEach(tr => { const hit = !s || tr.dataset.s.includes(s); tr.hidden = !hit; n += hit; });
    $('#tnone').hidden = !(s && rows.length && !n);
  };
  $('#tq').oninput = e => { S.tq = e.target.value; filter(); };
  filter();
};

// My Team Report: every review under the person this month, with the flags
pages.teamreport = (v, id) => location.replace('#/yearly' + (id ? '/' + id : '')); // merged into the Team report (status cards on top)

// My MIS Report: month-by-month figures for the whole team, and each person's monthly rating
pages.mis = async (v, id) => {
  if (S.me.role !== 'admin') return pages.home(v); // MIS, KPI and manager emails are admin-only
  const d = await api(`/mis${id ? '?id=' + id : ''}`), short = m => esc(m.label.split(' ')[0].slice(0, 3));
  const cell = x => !x ? '<span class="small" title="No form">–</span>' : x.rating != null ? `<b class="rt ${rateCls(x.rating)}" title="${esc(x.status)}">${pc(x.rating)}</b>` : `<span class="small" title="${esc(x.status)}">${{ 'Completed but Not Submitted': 'Not sub.', 'Review Not Completed': 'Open', Pending: 'Overdue' }[x.status] || '–'}</span>`;
  v.innerHTML = (d.org ? head('MIS report', 'PMS › MIS report · whole organisation') : reportHead(d, 'MIS report', 'MIS report')) + `<div class="row"><span class="small">${esc(S.me.fy || '')} so far, for ${d.org ? 'everyone in the organisation' : `everyone under ${d.me ? 'you' : esc(d.person.name)} (all levels)`}</span><span class="sp"></span>${d.org ? '' : `<a class="btn" href="#/teamreport${id ? '/' + id : ''}">${ico('check')}Team report</a>`}<button class="btn pri" id="misx">Download CSV</button></div>
  <div id="mgraph"></div>
  <h2>Month by month</h2>
  <div class="tablewrap"><table><tr><th>Month</th><th class="nr">Scheduled</th><th class="nr">Submitted</th><th class="nr">Not submitted</th><th class="nr">Form incomplete</th><th class="nr">Overdue</th><th class="nr" title="Review held within the window">On time</th><th class="nr" title="Review held after the window">Late</th><th class="nr">Avg rating</th><th>Completion</th></tr>
  ${d.byMonth.map(m => `<tr><td style="white-space:nowrap"><b>${esc(m.label.replace(/^([A-Za-z]{3})[A-Za-z]*/, '$1'))}</b></td><td class="nr">${m.scheduled}</td><td class="nr">${m.submitted}</td><td class="nr">${m.notSubmitted}</td><td class="nr">${m.notCompleted}</td><td class="nr">${m.pending}</td><td class="nr">${m.onTime}</td><td class="nr">${m.late}</td><td class="nr">${m.avgRating != null ? `<b class="rt ${rateCls(m.avgRating)}">${pc(m.avgRating)}</b>` : 'N/A'}</td>
    <td style="min-width:150px">${m.scheduled ? stackBar(m) : '<span class="small">No reviews</span>'}</td></tr>`).join('')}</table></div>${statusLegend()}
  <h2>Monthly rating by person</h2>
  <div class="tablewrap"><table><tr><th>Employee</th><th>Reports to</th>${d.months.map(m => `<th>${short(m)}</th>`).join('')}<th>Average</th><th></th></tr>
  ${d.grid.map(r => `<tr><td><b>${esc(r.name)}</b><div class="small">${esc(r.designation)}</div></td><td>${esc(r.manager)}</td>${r.cells.map(x => `<td>${cell(x)}</td>`).join('')}<td>${r.avg != null ? `<b class="rt ${rateCls(r.avg)}">${pc(r.avg)}</b>` : 'N/A'}</td><td><a class="btn sm" href="#/kpi/${r.id}">${ico('award')}KPI</a></td></tr>`).join('') || `<tr><td colspan="${d.months.length + 4}" class="small">Nobody reports to ${d.me ? 'you' : esc(d.person.name)}.</td></tr>`}</table></div>
  <p class="small">Ratings appear once a review is submitted. "Not sub." = completed but not submitted, "Open" = review not completed yet, – = no form that month. Ratings are percentages: blue is 80% and above, orange 60% to 79%, red below 60%.</p>`;
  misGraph($('#mgraph'), id).catch(er => { $('#mgraph').innerHTML = errBox(er); });
  $('#misx').onclick = () => {
    const q = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const lines = [['Employee', 'Designation', 'Reports to', ...d.months.map(m => m.label), 'Average'].map(q).join(','),
      ...d.grid.map(r => [r.name, r.designation, r.manager, ...r.cells.map(x => !x ? '' : x.rating ?? x.status), r.avg ?? ''].map(q).join(','))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = `MIS-${d.person.name.replace(/\s+/g, '-')}.csv`; a.click();
  };
};

// MIS Reporting graph: average KRA score per month (submitted reviews) as columns, with the old portal's filters
// (quarter, financial year, director, KRA). One series, so one colour and no legend; hover or focus a month for its value.
const GF = { q: '', fy: '', director: '', kra: 'total' };
const GKRA = [['total', 'Total (monthly rating)'], ['operational', 'Average Operational'], ['process', 'Average Process'], ['people', 'Average People']];
async function misGraph(box, id) {
  const g = await api(`/mis/graph?fy=${GF.fy}&kra=${GF.kra}&director=${GF.director}${id ? '&id=' + id : ''}`);
  GF.fy = g.fy;
  const qi = GF.q === '' ? null : +GF.q, ms = qi == null ? g.months : g.months.slice(qi * 3, qi * 3 + 3);
  const kraName = GKRA.find(k => k[0] === g.kra)[1], vals = ms.filter(m => m.value != null);
  const avg = vals.length ? Math.round(vals.reduce((a, m) => a + m.value, 0) / vals.length * 100) / 100 : null;
  const period = `${qi == null ? 'the year' : ['Quarter I', 'Quarter II', 'Quarter III', 'Quarter IV'][qi]} · FY ${g.fy}-${g.fy + 1}`;
  const mon = m => m.label.split(' ')[0].slice(0, 3);
  const tip = m => m.value != null ? `${m.label} · ${kraName}: ${m.value.toFixed(2)}% (${m.n} submitted review${m.n === 1 ? '' : 's'})` : `${m.label} · ${m.open ? 'no submitted reviews' : 'not open yet'}`;
  box.innerHTML = `<h2>Reporting graph</h2><div class="card gcard">
    <div class="row" style="margin:0 0 16px">${ddSelect('gq', GF.q, [['', 'All'], ['0', 'Quarter I (Apr-Jun)'], ['1', 'Quarter II (Jul-Sep)'], ['2', 'Quarter III (Oct-Dec)'], ['3', 'Quarter IV (Jan-Mar)']], { icon: 'filter' })}
      ${ddSelect('gfy', String(g.fy), g.fys.map(y => [String(y), `FY ${y}-${y + 1}`]), { icon: 'calendar' })}
      ${g.directors.length ? ddSelect('gdir', String(g.director), [['', 'All directors'], ...g.directors.map(x => [String(x.id), `All employees - ${x.name}`])], { icon: 'sitemap' }) : ''}
      ${ddSelect('gkra', g.kra, GKRA, { icon: 'chart' })}</div>
    <div class="ghead"><b class="rt ${rateCls(avg)}">${avg != null ? avg.toFixed(2) + '%' : 'N/A'}</b><span>${esc(kraName)}, average for ${period}<small>${g.people} ${g.people === 1 ? 'person' : 'people'} in scope · months with a submitted review only</small></span></div>
    <div class="gchart" role="img" aria-label="${esc(kraName)} by month, ${esc(period)}">
      <div class="gy" aria-hidden="true">${[100, 75, 50, 25, 0].map(t => `<span style="bottom:${t}%">${t}%</span>`).join('')}</div>
      <div class="gplot">${[100, 75, 50, 25].map(t => `<i class="gl" style="bottom:${t}%"></i>`).join('')}<i class="gl base"></i>
        ${ms.map((m, i) => `<div class="gcol" tabindex="0" data-i="${i}" aria-label="${esc(tip(m))}">${m.value != null ? `<div class="gbar" style="height:${Math.max(m.value, 1)}%"></div>` : ''}</div>`).join('')}</div>
      <div class="gx" aria-hidden="true">${ms.map(m => `<span class="${m.open ? '' : 'off'}">${mon(m)}</span>`).join('')}</div>
      <div class="gtip" hidden></div></div>
    <details class="gtable"><summary>Show as table</summary><div class="tablewrap" style="margin-top:10px"><table><tr><th>Month</th><th class="nr">${esc(kraName)}</th><th class="nr">Submitted reviews</th></tr>
      ${ms.map(m => `<tr><td>${esc(m.label)}</td><td class="nr">${m.value != null ? m.value.toFixed(2) + '%' : '–'}</td><td class="nr">${m.n}</td></tr>`).join('')}</table></div></details></div>`;
  const redraw = () => misGraph(box, id).catch(er => { box.innerHTML = errBox(er); });
  box.querySelector('#gq').onchange = e => { GF.q = e.target.value; redraw(); };
  box.querySelector('#gfy').onchange = e => { GF.fy = +e.target.value; redraw(); };
  box.querySelector('#gkra').onchange = e => { GF.kra = e.target.value; redraw(); };
  if (box.querySelector('#gdir')) box.querySelector('#gdir').onchange = e => { GF.director = e.target.value; redraw(); };
  // tooltip: on hover or keyboard focus, above the column
  const chart = box.querySelector('.gchart'), tipEl = box.querySelector('.gtip');
  const show = col => {
    const m = ms[+col.dataset.i], cr = chart.getBoundingClientRect(), r = col.getBoundingClientRect(), bar = col.querySelector('.gbar');
    tipEl.textContent = tip(m); tipEl.hidden = false;
    const top = (bar ? bar.getBoundingClientRect().top : r.bottom) - cr.top;
    tipEl.style.left = Math.min(Math.max(r.left - cr.left + r.width / 2, tipEl.offsetWidth / 2), cr.width - tipEl.offsetWidth / 2) + 'px';
    tipEl.style.top = Math.max(top - 8, 0) + 'px';
    box.querySelectorAll('.gcol.on').forEach(x => x.classList.remove('on')); col.classList.add('on');
  };
  const hide = () => { tipEl.hidden = true; box.querySelectorAll('.gcol.on').forEach(x => x.classList.remove('on')); };
  box.querySelectorAll('.gcol').forEach(c => { c.onmouseenter = () => show(c); c.onfocus = () => show(c); c.onmouseleave = hide; c.onblur = hide; });
}

// My KPI Report: one person's KRA scores month by month
pages.kpi = async (v, id) => {
  if (S.me.role !== 'admin') return pages.home(v);
  const d = await api(`/kpi${id ? '?id=' + id : ''}`), done = d.rows.filter(r => r.submitted).length;
  const kra = x => !x.subKras ? '<span class="small">Not set</span>' : `${x.score != null ? `<b class="rt ${rateCls(x.score)}">${pc(x.score)}</b>` : '<b>N/A</b>'}<div class="small">self ${x.self != null ? pc(x.self) : '–'} · mgr ${x.mgr != null ? pc(x.mgr) : '–'} · weight ${x.weight}</div>`;
  v.innerHTML = reportHead(d, 'KPI report', 'KPI report') + `<div class="tiles"><div class="tile ${rateCls(d.avg)}"><small>Average monthly rating</small><b>${pc(d.avg)}</b><span>Submitted months only</span></div><div class="tile g"><small>Months submitted</small><b>${done}</b><span>of ${d.rows.length} so far</span></div><div class="tile"><small>Months so far</small><b>${d.rows.length}</b><span>This financial year</span></div></div>
  <div class="tablewrap"><table><tr><th>Month</th><th>Operational</th><th>Process</th><th>People</th><th>Monthly rating</th><th>Status</th><th>Review date</th><th>Form</th></tr>
  ${d.rows.map(r => r.none ? `<tr><td><b>${esc(r.label)}</b></td><td colspan="6" class="small">No form for this month.</td><td><a class="btn sm" href="#/form/${d.person.id}/${r.month}">Open</a></td></tr>`
    : `<tr><td><b>${esc(r.label)}</b></td><td>${kra(r.kra.operational)}</td><td>${kra(r.kra.process)}</td><td>${kra(r.kra.people)}</td><td>${r.rating != null ? `<b class="rt ${rateCls(r.rating)}" style="font-size:16px">${pc(r.rating)}</b>` : '<span class="small">After submit</span>'}</td><td>${badge(r.status)}</td><td>${fmtD(r.reviewDate)}</td><td><a class="btn sm" href="#/form/${d.person.id}/${r.month}">Open</a></td></tr>`).join('') || '<tr><td colspan="8" class="small">No months yet.</td></tr>'}</table></div>
  <p class="small">Each KRA score is 30% self + 70% manager rating, weighted by sub-KRA. The monthly rating combines the three KRAs by their weight and shows once the review is submitted.</p>`;
};
const reportTable = rows => `<div class="tablewrap"><table><tr><th>Manager / team</th><th>Employee</th><th>Scheduled</th><th>Due</th><th>Actual</th><th>Status</th><th>Rating</th><th>Flags</th></tr>
  ${rows.map(r => `<tr><td>${esc(r.manager)} / ${esc(r.team)}</td><td>${nameLink(r.empId, r.name)}</td><td>${fmtD(r.scheduled)}</td><td>${fmtD(r.due)}</td><td>${fmtD(r.actual)}${r.actual ? `<br>${badge(r.dueStatus)}` : ''}</td><td>${badge(r.status)}</td><td>${pc(r.rating)}</td>${flagCell(r.flags)}</tr>`).join('') || '<tr><td colspan="8">No reviews in your access for this month.</td></tr>'}</table></div>`;
// a review's flags: the first one, the rest behind "+N more" (click to open), so one row stays one line tall
const flagCell = flags => !flags.length ? '<td class="small">None</td>'
  : flags.length === 1 ? `<td class="flag">${esc(flags[0])}</td>`
  : `<td class="flag"><details class="flags"><summary title="Show all ${flags.length} flags">${esc(flags[0])} <b>+${flags.length - 1} more</b></summary>${flags.slice(1).map(x => `<div>${esc(x)}</div>`).join('')}</details></td>`;

// ---------- Team report / My report (KRA scores month by month for the year) ----------
// #/yearly = me and everyone under me (admins and directors: everyone), #/yearly/me = only me, #/yearly/<id> = that person and their team
// KRA scores per month for a financial year, one table per person: an employee sees their own, a manager sees themselves
// and everyone under them, admins and directors see everyone. Scores come from submitted reviews (30% self + 70% manager).
const YF = { key: null, person: '', team: '', q: '' }; // q: '' = whole year, '0'..'3' = Quarter I..IV
pages.yearly = async (v, id) => {
  const self = id === 'me';
  const d = await api(`/yearly?fy=${S.yfy || ''}&month=${S.month}${self ? '&self=1' : id ? '&id=' + id : ''}`);
  S.yfy = d.fy;
  const key = id || 'me';
  if (YF.key !== key) Object.assign(YF, { key, person: '', team: '' });
  const pool = d.people.filter(p => !YF.team || p.team === YF.team);
  if (YF.person && !pool.some(p => String(p.id) === YF.person)) YF.person = '';
  const list = pool.filter(p => !YF.person || String(p.id) === YF.person);
  const n2 = x => x == null ? '' : x.toFixed(2);
  const mh = m => { const [mo, y] = m.label.split(' '); return `${mo}<br>${y}`; };
  // the months shown: the whole year, or the three months of the chosen quarter (Quarter I = Apr-Jun)
  const qi = YF.q === '' ? null : +YF.q, cols = qi == null ? d.months.map((_, i) => i) : [qi * 3, qi * 3 + 1, qi * 3 + 2];
  const pick = arr => cols.map(i => arr[i]);
  const block = p => `<div class="yblock"><div class="yb-h"><span class="avatar s">${initials(p.name)}</span><div><b>${esc(p.name)}</b><span>${dotJoin(p.designation, p.team)}${p.manager ? ` · reports to ${esc(p.manager)}` : ''}</span></div>
      ${S.me.role === 'admin' ? `<a class="yb-eye" href="#/kpi/${p.id}" title="Open ${esc(p.name)}'s KPI report (self and manager ratings by month)" aria-label="Open ${esc(p.name)}'s KPI report">${ico('eye')}</a>` : ''}<span class="sp"></span>
      ${p.hasTeam && (!root || p.id !== root.id) ? `<a class="btn sm" href="#/yearly/${p.id}">${ico('team')}Their team</a>` : ''}</div>
    <div class="tablewrap"><table class="ytab"><tr><th>KRA name</th>${pick(d.months).map(m => `<th class="nr ${m.open ? '' : 'off'}">${mh(m)}</th>`).join('')}</tr>
    ${[['operational', 'Operational'], ['process', 'Process'], ['people', 'People']].map(([k, l]) => `<tr><td>${l}</td>${pick(p.cells).map(c => `<td class="nr">${c && c[k] != null ? n2(c[k]) : ''}</td>`).join('')}</tr>`).join('')}
    <tr class="ytot"><td>Total</td>${pick(p.cells).map(c => `<td class="nr">${c && c.total != null ? `<b class="rt ${rateCls(c.total)}">${n2(c.total)}</b>` : ''}</td>`).join('')}</tr>
    <tr class="yavg"><td>Quarterly average</td>${(qi == null ? p.quarters.map((a, i) => [a, i]) : [[p.quarters[qi], qi]]).map(([a, i]) => `<td colspan="3" class="c"><small>Q${i + 1}</small> <b class="rt ${rateCls(a)}">${a != null ? n2(a) : '–'}</b></td>`).join('')}</tr>
    ${qi != null ? '' : `<tr class="yavg"><td>Year average</td><td colspan="12" class="c"><b class="rt ${rateCls(p.year)}">${p.year != null ? n2(p.year) : '–'}</b></td></tr>`}</table></div></div>`;
  const root = d.person, mgrView = root && d.teamView;
  v.innerHTML = head(d.me ? (mgrView ? 'Team report' : 'My report') : root ? (mgrView ? `Team report: ${esc(root.name)}` : `Report: ${esc(root.name)}`) : 'Team report',
      root && mgrView ? `Reporting manager: <b>${esc(root.name)}</b> · ${esc(d.fyLabel)}` : `KRA scores month by month · ${esc(d.fyLabel)}`) +
    `<div class="row">${d.org ? ddSelect('yteam', YF.team, [['', 'All teams'], ...d.teams.map(teamOpt)], { icon: 'sitemap' }) : ''}
    ${d.people.length > 1 ? ddSelect('yper', YF.person, [['', 'All people'], ...pool.map(p => [String(p.id), p.name])], { icon: 'team' }) : ''}
    ${ddSelect('yq', YF.q, [['', 'All'], ['0', 'Quarter I (Apr-Jun)'], ['1', 'Quarter II (Jul-Sep)'], ['2', 'Quarter III (Oct-Dec)'], ['3', 'Quarter IV (Jan-Mar)']], { icon: 'filter' })}
    ${ddSelect('yfy', String(d.fy), d.fys.map(y => [String(y), `FY ${y}-${y + 1}`]), { icon: 'calendar' })}
    <span class="sp"></span>${id && !self ? `<a class="btn" href="#/yearly">← Team report</a>` : ''}</div>
    ${mgrView ? `<div class="ymgr">${ico('idcard')}<span>Manager name: <b>${esc(root.name)}</b> · ${d.people.length} ${d.people.length === 1 ? 'person' : 'people'} under them</span></div>` : ''}
    ${mgrView || d.org ? `<div class="small" style="margin:0 0 12px">${esc(monthLabel(d.cardMonth))} reviews of ${d.org ? 'everyone in the organisation' : 'the people in this report'} (pick another month in the calendar at the top)</div>${countTiles(d.counts)}` : ''}
    ${list.map(block).join('') || '<div class="empty card">No one to show for this filter.</div>'}
    <p class="small">Scores are percentages from submitted reviews: each KRA is 30% self + 70% manager rating, weighted by sub-KRA; Total weighs the three KRAs by their weightage. Empty months have no submitted review yet. Quarter and year averages use the months that have a Total.</p>`;
  $('#yfy').onchange = e => { S.yfy = +e.target.value; pages.yearly(v, id); };
  $('#yq').onchange = e => { YF.q = e.target.value; pages.yearly(v, id); };
  if ($('#yper')) $('#yper').onchange = e => { YF.person = e.target.value; pages.yearly(v, id); };
  if ($('#yteam')) $('#yteam').onchange = e => { YF.team = e.target.value; YF.person = ''; pages.yearly(v, id); };
};

// ---------- review status report ----------
const RF = { view: null, team: '', manager: '', status: '' };
const REPORT_STATUSES = [['', 'All statuses', '', 'filter'], ['Completed and Submitted', 'Submitted', '--vr-chart-cl', 'check'], ['Completed but Not Submitted', 'Completed, not submitted', '--vr-chart-wd', 'draft'],
  ['Review Not Completed', 'Form incomplete', '--vr-chart-rj', 'alert'], ['Pending', 'Overdue', '--vr-chart-ip', 'hourglass']];
// Export button: a small menu with CSV and PDF (the page listens to the hidden select)
const exportMenu = () => `<div class="dd" data-dd="list"><button type="button" class="dd-btn exp" aria-haspopup="listbox" aria-expanded="false">${ico('download')}<span class="dd-val">Export</span>${CHEV}</button>
  <div class="dd-menu flip" role="listbox" hidden><button type="button" role="option" class="dd-item" data-v="csv"><span class="ddl"><span class="ddl-i">${ico('grid')}</span>CSV (Excel)</span></button><button type="button" role="option" class="dd-item" data-v="pdf"><span class="ddl"><span class="ddl-i">${ico('file')}</span>PDF</span></button></div>
  <select id="fexp" hidden aria-hidden="true"><option value="" selected></option><option value="csv"></option><option value="pdf"></option></select></div>`;
// PDF: the report laid out for print in a hidden frame; the browser's print dialog saves it as PDF
function reportPdf(d, c) {
  const filt = [RF.view === 'org' ? 'Organisation-wise' : `Team-wise · ${RF.team || 'All teams'}`, RF.manager && (d.managers.find(m => String(m.id) === String(RF.manager)) || {}).name, RF.status && (REPORT_STATUSES.find(x => x[0] === RF.status) || [])[1]].filter(Boolean).join(' · ');
  const st = r => STATUS_TEXT[r.status] || r.status;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>PMS review status ${esc(monthLabel(S.month))}</title><style>
    body{font:12px/1.4 system-ui,sans-serif;color:#232b3b;margin:24px}h1{font-size:18px;margin:0 0 2px}p{margin:0 0 14px;color:#5a6475}
    .k{display:flex;gap:8px;margin:0 0 16px}.k div{flex:1;border:1px solid #ebe7df;border-radius:8px;padding:8px 10px}.k small{display:block;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7a8494}.k b{font-size:18px}
    table{width:100%;border-collapse:collapse}th{background:#0c1f4a;color:#fff;text-align:left;font-size:10px;padding:6px}td{padding:6px;border-bottom:1px solid #ebe7df;vertical-align:top}tr{page-break-inside:avoid}
    footer{margin-top:16px;font-size:10px;color:#7a8494}@page{size:A4 landscape;margin:12mm}</style></head><body>
    <h1>Review status report · ${esc(monthLabel(S.month))}</h1><p>${esc(d.scope)} · ${esc(filt)} · printed ${esc(new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))}</p>
    <div class="k">${[['Scheduled', c.scheduled], ['Submitted', c.submitted], ['Completed, not submitted', c.notSubmitted], ['Form incomplete', c.notCompleted], ['Overdue', c.pending]].map(([l, n]) => `<div><small>${l}</small><b>${n}</b></div>`).join('')}</div>
    <table><tr><th>Manager / team</th><th>Employee</th><th>Scheduled</th><th>Due</th><th>Actual</th><th>Rescheduled</th><th>Status</th><th>Rating</th><th>Flags</th></tr>
    ${d.rows.map(r => `<tr><td>${esc(r.manager)} / ${esc(r.team)}</td><td>${esc(r.name)}</td><td>${fmtD(r.scheduled)}</td><td>${fmtD(r.due)}</td><td>${fmtD(r.actual)}</td><td>${r.reschedules || 0}</td><td>${esc(st(r))}</td><td>${pc(r.rating)}</td><td>${r.flags.map(esc).join('<br>') || 'N/A'}</td></tr>`).join('') || '<tr><td colspan="9">No reviews.</td></tr>'}</table>
    <footer>Verve Advisory · Performance Management System</footer></body></html>`;
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1000); }, 200);
}
pages.report = async v => {
  const q = `month=${S.month}&team=${RF.team}&manager=${RF.manager}&status=${encodeURIComponent(RF.status)}`;
  const d = await api('/report?' + q);
  const full = ['director', 'admin'].includes(S.me.role);
  RF.view ||= full ? 'org' : 'team';
  const c = d.counts;
  v.innerHTML = head('Review status report', 'One report, two views · ' + d.scope) +
    `<div class="row">${monthSel()}
    ${full ? `<button class="chip vchip ${RF.view === 'org' ? 'on' : ''}" data-view="org">${ico('sitemap')}Organisation-wise</button>` : ''}
    ${ddSelect('fteam', RF.view === 'team' ? RF.team : null, [['', 'All teams'], ...d.teams.map(teamOpt)], { icon: 'team', ph: 'Team-wise', btn: RF.view === 'team' ? `Team-wise · ${RF.team || 'All teams'}` : 'Team-wise', on: RF.view === 'team' })}
    ${ddSelect('fmgr', RF.manager, [['', 'All managers'], ...d.managers.map(m => [String(m.id), m.name])], { icon: 'idcard' })}
    ${ddSelect('fst', RF.status, REPORT_STATUSES)}
    <span class="sp"></span>${exportMenu()}</div>
    ${countTiles(c)}
    ${RF.view === 'team' ? `<h2>Team-wise</h2><div class="tablewrap"><table><tr><th>Manager / team</th><th class="nr">Scheduled</th><th class="nr">Submitted</th><th class="nr">Not submitted</th><th class="nr">Form incomplete</th><th class="nr">Overdue</th></tr>${d.teamCounts.map(t => `<tr><td>${esc(t.name)}</td><td class="nr">${t.scheduled}</td><td class="nr">${t.submitted}</td><td class="nr">${t.notSubmitted}</td><td class="nr">${t.notCompleted}</td><td class="nr">${t.pending}</td></tr>`).join('')}</table></div>` : ''}
    <h2>${RF.view === 'org' ? 'Employee-wise (organisation)' : 'Employee-wise'}</h2>${reportTable(d.rows)}
    <p class="small">Directors see the whole organisation. Managers see their own team and everyone under them at every level. Employees do not see this report.</p>`;
  onMonth(() => pages.report(v));
  v.onclick = async e => {
    const b = e.target.closest('[data-view]');
    if (b && RF.view !== b.dataset.view) { RF.view = b.dataset.view; RF.team = ''; pages.report(v); }
  };
  $('#fexp').onchange = async e => {
    const kind = e.target.value; e.target.value = '';
    try {
      if (kind === 'csv') { const r = await api('/report.csv?' + q); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' })); a.download = `PMS_status_${S.month}.csv`; a.click(); }
      if (kind === 'pdf') reportPdf(d, c);
    } catch (er) { toast(er.message, 'err'); }
  };
  $('#fteam').onchange = e => { RF.view = 'team'; RF.team = e.target.value; pages.report(v); };
  $('#fmgr').onchange = e => { RF.manager = e.target.value; pages.report(v); };
  $('#fst').onchange = e => { RF.status = e.target.value; pages.report(v); };
};

// ---------- scheduling ----------
// "11:00" -> "11:00 am"
const fmtT = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const calStart = () => { location.href = `/api/auth/google/start?calendar=1&origin=${encodeURIComponent(location.origin)}`; };
// the thresholds that used to sit on a separate Settings page (admin), shown on the Scheduling page under the review windows
const RULES = [['operationalRange', 'Operational weightage range (min,max)'], ['peopleMin', 'People weightage minimum'], ['peopleMax', 'People weightage maximum'], ['clickupMin', 'ClickUp manager rating minimum (%)'],
  ['learningMin', 'Learning manager rating minimum (%)'], ['ratingGapFlag', 'Self vs manager gap flag (points)'], ['emailGapFlag', 'Gap highlighted in the email (points)']];
// dates a review was moved to, without repeats: first date, then each new date once
const reschedDates = r => { const out = []; [r.history[0] && r.history[0].from, ...r.history.map(h => h.to)].forEach(x => { if (x && !out.includes(x)) out.push(x); }); return out; };
pages.scheduling = async v => {
  const d = await api('/scheduling?month=' + S.month), cal = d.calendar;
  const rules = d.canEditWindows ? await api('/config') : null;
  const calCard = !cal.google ? `<div class="info">Calendar invites are off on this server: Google sign-in is not set up yet. Reviews can still be scheduled here.</div>`
    : cal.connected ? `<div class="calcard on">${ico('calendar')}<div><b>Google Calendar connected</b><span>Invites go out from ${esc(cal.email)}, with the Zoom link you add. Google emails the employee, and their manager if someone else schedules.</span></div><span class="sp"></span><button class="btn sm" id="caloff">Disconnect</button></div>`
    : cal.canConnect ? `<div class="calcard">${ico('calendar')}<div><b>Send review invites to Google Calendar</b><span>Connect your calendar once. Each review you schedule then lands in the employee's calendar with the Zoom link you add.</span></div><span class="sp"></span><button class="btn pri" id="calon">Connect Google Calendar</button></div>`
    : `<div class="info">To send calendar invites, sign in with your @${esc(S.me.domain)} Google account${S.me.viewingAs ? ' (invites always come from your own calendar, not the person you are viewing as)' : ''}.</div>`;
  const inviteCell = r => r.invite
    ? `<span class="badge b-green" title="Sent by ${esc(r.invite.owner)} to ${esc(r.invite.guests.join(', '))}">Invite sent</span><div class="small">${r.invite.link ? `<a href="${esc(r.invite.link)}" target="_blank" rel="noopener">Event</a>` : ''}${r.canManage ? ` · <a href="#" data-cancel="${r.empId}">Cancel</a>` : ''}</div>`
    : !r.hasEmail ? `<span class="small" title="Add a @${esc(S.me.domain)} email on the Employees page">No work email</span>`
    : r.scheduled && r.canManage && cal.connected ? `<button class="btn sm" data-inv="${r.empId}">${ico('send')}Send invite</button>` : '<span class="small">N/A</span>';
  v.innerHTML = head('Review scheduling', 'Pick a date and time for each review. Rescheduling moves the calendar invite too.') + `<div class="row">${monthSel()}</div>
  ${calCard}
  <h2>Review windows</h2><div class="tablewrap"><table><tr><th>Team</th><th>Window</th><th>Dates collected on</th><th>Scheduled</th>${d.canEditWindows ? '<th></th>' : ''}</tr>${d.windows.map(w => `<tr><td>${esc(w.team)}</td><td>${fmtD(w.start)} to ${fmtD(w.end)}</td><td>${fmtD(w.collectedOn)}</td><td><span class="badge ${w.collected === w.total ? 'b-green' : 'b-amber'}">${w.collected} of ${w.total}</span></td>${d.canEditWindows ? `<td style="text-align:right"><button class="btn sm" data-win="${esc(w.team)}">Edit</button></td>` : ''}</tr>`).join('')}</table></div>
  ${rules ? `<h2>Review rules</h2><div class="card"><div class="setgrid">${RULES.map(([k, l]) => `<div><label class="f">${l}</label><input data-c="${k}" value="${esc([].concat(rules[k]).join(','))}"></div>`).join('')}</div>
  <div style="margin-top:16px"><button class="btn pri" id="sc">Save review rules</button></div></div>` : ''}
  <h2>Team members</h2><div class="tablewrap"><table><tr><th>Employee</th><th>Team</th><th>Review slot</th><th>Calendar invite</th><th>Rescheduled</th><th>Actual date (from form)</th><th>Status</th></tr>
  ${d.rows.map(r => `<tr><td>${nameLink(r.empId, r.name)}</td><td>${esc(r.team)}</td>
  <td>${r.scheduled ? `<b>${fmtD(r.scheduled)}</b>${r.time ? ` <span class="small">${fmtT(r.time)}</span>` : ''}${r.canManage ? ` <button class="btn sm" data-resch="${r.empId}">Reschedule</button>` : ''}${r.zoom ? `<div class="small"><a href="${esc(r.zoom)}" target="_blank" rel="noopener">Zoom link</a></div>` : ''}` : r.canManage ? `<button class="btn sm pri" data-sch="${r.empId}">${ico('calendar')}Schedule</button>` : '<span class="small">Not scheduled</span>'}</td>
  <td>${inviteCell(r)}</td>
  <td>${r.reschedules ? `<span class="rcount" title="Counted once per new date">${r.reschedules}</span> <span class="small">time${r.reschedules === 1 ? '' : 's'}</span><div class="small">${reschedDates(r).map(fmtD).join(' → ')}</div>` : '<span class="rcount z">0</span>'}</td>
  <td>${r.actual ? `${fmtD(r.actual)} ${badge(r.dueStatus)}` : '<span class="small">Not held yet</span>'}</td><td>${badge(r.status)}</td></tr>`).join('') || '<tr><td colspan="7">No reviews in your access for this month.</td></tr>'}</table></div>
  <p class="small">The actual date is the Review Date entered on the employee's monthly form. Reports use the scheduled (or rescheduled) date from this page and the actual date from the form. Rescheduled counts each new date once: moving a review twice to the same day, or changing only the time, counts as one.</p>`;
  onMonth(() => pages.scheduling(v));
  const row = id => d.rows.find(r => String(r.empId) === String(id));
  const win = r => d.windows.find(w => w.team === r.team);
  // one dialog for schedule, reschedule and send-invite
  const slotDialog = (r, mode) => {
    const w = win(r), inv = r.invite, canInvite = cal.connected && r.hasEmail && !inv;
    const date = mode === 'schedule' ? (w ? w.start : '') : r.scheduled, time = r.time || (inv && inv.time) || '11:00', dur = (inv && inv.duration) || 30;
    const title = mode === 'schedule' ? 'Schedule review' : mode === 'invite' ? 'Send calendar invite' : 'Reschedule review';
    const m = modal(`<h2>${title}</h2><p class="small">${esc(r.name)} · ${esc(r.team)}${w ? ` · review window ${fmtD(w.start)} to ${fmtD(w.end)}` : ''}</p><div id="er"></div>
      <div class="row" style="align-items:flex-end;margin:0"><div><label class="f">Date <i>*</i></label><input type="date" id="sd" value="${esc(date || '')}" ${mode === 'invite' ? 'disabled' : ''}></div>
      <div><label class="f">Time <i>*</i></label><input type="time" id="st" value="${esc(time)}" step="900"></div>
      <div><label class="f">Length</label><select id="sl">${[15, 30, 45, 60, 90].map(n => `<option value="${n}" ${n === dur ? 'selected' : ''}>${n} min</option>`).join('')}</select></div></div>
      <label class="f" style="margin-top:12px">Zoom meeting link</label><input type="url" id="sz" value="${esc(r.zoom || '')}" placeholder="https://zoom.us/j/123456789" style="width:100%">
      ${inv ? `<div class="info">The Google Calendar invite moves too; ${esc(inv.guests.join(' and '))} ${inv.guests.length > 1 ? 'are' : 'is'} told by Google.</div>`
        : canInvite ? `<label class="chk"><input type="checkbox" id="si" checked ${mode === 'invite' ? 'disabled' : ''}> Send a Google Calendar invite to ${esc(r.name)}</label>`
        : !r.hasEmail ? `<div class="info">No calendar invite: ${esc(r.name)} has no @${esc(S.me.domain)} email in PMS yet.</div>`
        : cal.google ? '<div class="info">Connect Google Calendar at the top of this page to also send an invite.</div>' : ''}
      <div class="row"><button class="btn pri" id="ok">${mode === 'invite' ? 'Send invite' : mode === 'schedule' ? 'Schedule' : 'Save'}</button><button class="btn" id="no">Cancel</button></div>`);
    m.querySelector('#no').onclick = () => m.remove();
    const ok = m.querySelector('#ok');
    ok.onclick = async () => {
      const send = m.querySelector('#si') ? m.querySelector('#si').checked : false;
      const body = { empId: r.empId, month: S.month, date: m.querySelector('#sd').value, time: m.querySelector('#st').value, duration: +m.querySelector('#sl').value, invite: send, zoom: m.querySelector('#sz').value.trim(), origin: location.origin };
      ok.disabled = true; ok.textContent = send || inv ? 'Talking to Google…' : 'Saving…';
      try {
        const res = await api('/scheduling/' + (mode === 'invite' ? 'invite' : mode), { method: 'POST', body });
        m.remove(); toast(mode === 'invite' ? 'Invite sent' : res.invite ? (inv ? 'Rescheduled. Invite updated.' : 'Scheduled. Invite sent.') : mode === 'schedule' ? 'Review scheduled' : 'Review rescheduled'); pages.scheduling(v);
      } catch (er) { m.querySelector('#er').innerHTML = errBox(er); ok.disabled = false; ok.textContent = 'Try again'; }
    };
  };
  v.onclick = async e => {
    const t = e.target.closest('button, a'); if (!t) return;
    try {
      if (t.dataset.win) windowDialog(d.windows.find(w => w.team === t.dataset.win), () => pages.scheduling(v));
      else if (t.id === 'sc') {
        const b = {};
        v.querySelectorAll('[data-c]').forEach(i => { const k = i.dataset.c; b[k] = k === 'operationalRange' ? i.value.split(',').map(Number) : Number(i.value); });
        btnBusy(t); try { await api('/config', { method: 'PUT', body: b }); toast('Review rules saved'); } finally { btnIdle(t); }
      }
      else if (t.id === 'calon') calStart();
      else if (t.id === 'caloff') { if (await confirmBox('Disconnect Google Calendar?', 'Invites already sent stay in calendars, but you cannot move or cancel them from PMS until you connect again.', { ok: 'Disconnect', danger: true })) { await api('/calendar/disconnect', { method: 'POST' }); toast('Google Calendar disconnected'); pages.scheduling(v); } }
      else if (t.dataset.sch) slotDialog(row(t.dataset.sch), 'schedule');
      else if (t.dataset.resch) slotDialog(row(t.dataset.resch), 'reschedule');
      else if (t.dataset.inv) slotDialog(row(t.dataset.inv), 'invite');
      else if (t.dataset.cancel) {
        e.preventDefault();
        const r = row(t.dataset.cancel);
        if (!await confirmBox(`Cancel the invite for ${r.name}?`, 'Google tells the guests it is cancelled. The scheduled date stays in PMS.', { ok: 'Cancel invite', danger: true })) return;
        await api('/scheduling/cancel-invite', { method: 'POST', body: { empId: r.empId, month: S.month } }); toast('Invite cancelled'); pages.scheduling(v);
      }
    } catch (er) { toast(er.message, 'err'); }
  };
};

// ---------- emails ----------
pages.emails = async v => {
  if (S.me.role !== 'admin') return pages.home(v);
  const list = await api('/emails?month=' + S.month);
  v.innerHTML = head('Manager emails', 'Preview and send the monthly summary to each manager') + `<div class="row">${monthSel()}<button class="btn pri" id="gen">Generate emails</button><span class="small">Local demo: "Send now" records the email in the audit log; no real mail is sent. Emails are never sent automatically.</span></div>
  <div class="row" style="align-items:flex-start;gap:16px"><div class="card" style="min-width:240px;margin:0">${list.map(m => `<div class="row" style="margin:0 0 6px"><a href="#/emails" data-m="${m.managerId}" style="color:var(--navy);font-weight:600;cursor:pointer">${esc(m.name)}</a><span class="small">${esc(m.team)}</span><span class="sp"></span><span class="badge ${m.state === 'sent' ? 'b-green' : m.state === 'draft' ? 'b-amber' : 'b-grey'}">${m.state}</span></div>`).join('') || 'No teams in your access.'}</div><div class="sp" id="prev" style="min-width:300px"></div></div>`;
  onMonth(() => pages.emails(v));
  const show = async id => {
    const e = await api(`/email?manager=${id}&month=${S.month}`);
    const sx = (t, arr) => `<h4>${t}</h4><ul>${arr.map(x => `<li class="${x.hot ? 'hot' : ''}">${esc(x.text)}</li>`).join('') || '<li>No issues.</li>'}</ul>`;
    const c = e.counts;
    $('#prev').innerHTML = `<div class="row"><b>Subject:</b> ${esc(e.subject)}<span class="sp"></span><button class="btn pri" id="send" ${e.state === 'sent' ? 'disabled' : ''}>${e.state === 'sent' ? 'Sent' : 'Send now'}</button></div>
    <div class="mail"><div class="small">To: ${esc(e.to)}</div><p>Hi ${esc(e.to.split(' ')[0])}, here is how the ${esc(monthLabel(S.month).split(' ')[0])} reviews went for your team. The full report is attached.</p>
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
  const list = ['manager', 'teamlead', 'director', 'admin'].includes(S.me.role) ? (await api('/report?month=' + S.me.currentMonth)).rows : [];
  v.innerHTML = head('One pager document', `${esc(d.employee.name)} · ${d.fy}`) +
    `${list.length ? `<div class="row"><select id="who"><option value="${S.me.id}">Myself</option>${list.map(r => `<option value="${r.empId}" ${r.empId === d.employee.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>` : ''}
  <h2>One-page summary <span class="small">(${d.months.filter(m => m.filled).length} of 12 months filled; fills as each monthly review finishes)</span></h2>
  <div class="row"><b>${esc(d.employee.name)}</b> (${esc(d.employee.designation)}) · ${d.fy} (April 2026 to March 2027)<span class="sp"></span><button class="btn pri" onclick="window.print()">Download PDF (print)</button></div>
  <div class="tablewrap"><table><tr><th>Month</th><th>KRA weightage (Op / Pro / Peo)</th><th>Work summary</th><th>Self</th><th>Manager</th><th>Monthly rating</th><th>Learnings, SOPs</th><th>Highlights and gaps</th></tr>
  ${d.months.map(m => m.filled ? `<tr><td>${esc(m.label.split(' ')[0])}</td><td title="${esc(m.subKras.join(' | '))}">${m.weightage}</td><td>${esc(m.work)}<div class="small">${esc(m.selfRemarks[0] || '')}</div></td><td>${pc(m.self)}</td><td>${pc(m.mgr)}<div class="small">${esc(m.mgrRemarks[0] || '')}</div></td><td>${pc(m.rating)}</td><td class="small">${m.learn.length ? 'Learning: ' + esc(m.learn.join(', ')) + '<br>' : ''}${m.sop.length ? 'SOP: ' + esc(m.sop.join(', ')) : ''}</td><td class="flag">${m.highlights.map(esc).join('<br>') || 'N/A'}</td></tr>` : `<tr><td>${esc(m.label.split(' ')[0])}</td><td colspan="7" class="small">Fills in automatically as each monthly review finishes.</td></tr>`).join('')}</table></div>
  <p class="small">This page is the one-page summary only. The annual review itself is under My review › Annual review: <a href="#/form/${d.employee.id}/annual">open ${d.employee.id === S.me.id ? 'my' : esc(d.employee.name.split(' ')[0]) + "'s"} annual review</a>.</p>`;
  if ($('#who')) $('#who').onchange = e => { location.hash = '#/annual/' + e.target.value; };
};

// ---------- parameters summary ----------
pages.params = async (v, arg) => {
  const admin = S.me.role === 'admin';
  const d = await api('/params?month=' + S.month);
  let P = JSON.parse(JSON.stringify(d.data));
  // admins also get the questionnaire editor below the parameters (own box, so a question save keeps unsaved parameter edits)
  v.innerHTML = '<div id="pbox"></div>' + (admin ? '<div id="qbox"></div>' : '');
  const pb = $('#pbox');
  const draw = (dirty) => {
    pb.innerHTML = head('Parameters summary', 'Soft parameters reviewed alongside the KRAs' + (admin ? ' · admin view' : '')) + `<div class="row">${monthSel()}<span class="small">Version applying from ${esc(monthLabel(d.from) || d.from)}</span><span class="sp"></span>${admin ? `<button class="btn pri" data-a="addsec">${ico('plus')}Add section</button>` : ''}</div>
    ${P.sections.map((s, si) => `<div class="card pcard"><div class="phead"><b class="ptitle"><i class="pico">${ico(paramIcon(s.title))}</i>${esc(s.title)}:</b>${admin ? `<span class="acts"><button class="btn sm" data-a="editsec" data-s="${si}">Edit section</button><button class="btn sm dng" data-a="delsec" data-s="${si}">Delete section</button></span>` : ''}</div>
      ${s.items.map((it, ii) => `<div class="pitem"><span class="pn">${ii + 1}.</span><span class="pt">${esc(it)}</span>${admin ? `<span class="acts"><button class="btn sm" data-a="edit" data-s="${si}" data-i="${ii}">Edit</button><button class="btn sm dng" data-a="del" data-s="${si}" data-i="${ii}">Delete</button></span>` : ''}</div>`).join('')}
      ${admin ? `<div style="padding-top:10px"><button class="btn sm pri" data-a="add" data-s="${si}">${ico('plus')}Add item</button></div>` : ''}</div>`).join('')}
    <div class="card pcard"><div class="phead"><b class="ptitle"><i class="pico">${ico('star')}</i>Rating scale (applies to the parameters above):</b>${admin ? '<span class="acts"><button class="btn sm" data-a="scale">Edit scale</button></span>' : ''}</div>${P.scale.map(x => `<div class="pitem"><span class="pt">${esc(x)}</span></div>`).join('')}</div>
    ${admin ? `<div class="row" style="justify-content:flex-end"><button class="btn pri" id="savep" ${dirty ? '' : 'disabled'}>Save changes…</button></div><p class="small">Soft parameters here are not part of the monthly rating calculation. Changes apply from the month you choose and are written to the audit log.</p>` : ''}`;
    onMonth(() => pages.params(v));
  };
  draw();
  const ask = (title, val, cb) => { const m = modal(`<h2>${title}</h2><textarea id="tv" style="min-height:80px">${esc(val)}</textarea><div class="row" style="margin-top:12px"><button class="btn pri" id="ok">OK</button><button class="btn" id="no">Cancel</button></div>`); m.querySelector('#no').onclick = () => m.remove(); m.querySelector('#ok').onclick = () => { const t = m.querySelector('#tv').value.trim(); if (t) { cb(t); m.remove(); draw(true); } }; };
  pb.onclick = async e => {
    const t = e.target, a = t.dataset.a, s = +t.dataset.s, i = +t.dataset.i;
    if (a === 'addsec') ask('New section title', '', x => P.sections.push({ id: 's' + Date.now(), title: x, items: [] }));
    if (a === 'editsec') ask('Edit section title', P.sections[s].title, x => P.sections[s].title = x);
    if (a === 'delsec' && await confirmBox(`Delete "${P.sections[s].title}"?`, 'This section and all its items will be removed.', { ok: 'Delete section', danger: true })) { P.sections.splice(s, 1); draw(true); }
    if (a === 'add') ask('New item', '', x => P.sections[s].items.push(x));
    if (a === 'edit') ask('Edit item', P.sections[s].items[i], x => P.sections[s].items[i] = x);
    if (a === 'del' && await confirmBox('Delete this item?', P.sections[s].items[i], { ok: 'Delete item', danger: true })) { P.sections[s].items.splice(i, 1); draw(true); }
    if (a === 'scale') ask('Rating scale (one line per level)', P.scale.join('\n'), x => P.scale = x.split('\n').map(z => z.trim()).filter(Boolean));
    if (t.id === 'savep') {
      const m = modal(`<h2>Apply from which review month?</h2><select id="eff">${S.me.months.map(x => `<option value="${x.key}" ${x.key === S.me.currentMonth ? 'selected' : ''}>${x.label}</option>`).join('')}</select><p class="small">Forms from this month onward (including future months) use the new wording. Submitted forms keep the earlier wording.</p><div class="row"><button class="btn pri" id="ok">Save</button><button class="btn" id="no">Cancel</button></div>`);
      m.querySelector('#no').onclick = () => m.remove();
      m.querySelector('#ok').onclick = async () => { await api('/params', { method: 'PUT', body: { from: m.querySelector('#eff').value, data: P } }); m.remove(); toast('Saved'); pages.params(v); };
    }
  };
  // the page may have been left while the questions loaded, so look the box up again before scrolling to it
  if (admin) { await questionsBox($('#qbox')); if (arg === 'questions') requestAnimationFrame(() => { const b = $('#qbox'); if (b) SC().scrollTop = b.offsetTop - 24; }); }
};

// ---------- questionnaire (admin, shown inside Parameters Summary) ----------
pages.questions = () => location.replace('#/params'); // old link
async function questionsBox(v) {
  const qs = await api('/questions');
  const tab = S.qtab || 'text';
  const list = qs.filter(q => q.type === tab && !q.to).sort((a, b) => a.order - b.order);
  v.innerHTML = `<div class="card pcard"><div class="phead"><b class="ptitle"><i class="pico">${ico('question')}</i>Questionnaire (monthly review form):</b><span class="acts"><button class="btn sm pri" data-a="new">${ico('plus')}Add new question</button></span></div>
  <div class="row"><div class="seg" style="margin:0"><button class="chip ${tab === 'text' ? 'on' : ''}" data-tab="text">Questions 1 to 5 (text answers)</button><button class="chip ${tab === 'rating' ? 'on' : ''}" data-tab="rating">Questions 6 to 12 (ratings)</button></div></div>
  <div class="tablewrap"><table class="qtab"><tr><th>No.</th><th>Question</th><th>Answer type</th><th>Mandatory</th><th>Applies from</th><th>Actions</th></tr>${list.map((q, i) => `<tr data-q="${q.id}" draggable="true"><td class="qno"><button type="button" class="grip" data-grip="${q.id}" title="Drag to reorder (or focus and use the arrow keys)" aria-label="Reorder question ${i + 1}: drag, or press the up and down arrow keys">${ico('grip')}</button><span>${i + 1}</span></td><td>${esc(q.text)}</td><td>${q.type === 'text' ? 'Text answer' : 'Rating (0 to 5)'}</td><td>${q.mandatory ? 'Yes' : 'No'}</td><td>${esc(monthLabel(q.from) || q.from)}</td><td><span class="acts"><button class="btn sm" data-a="edit" data-id="${q.id}">Edit</button><button class="btn sm dng" data-a="del" data-id="${q.id}">Delete</button></span></td></tr>`).join('')}</table></div>
  <p class="small">Changes apply from the review month you choose. Forms already submitted keep the question and answers as they were. No limit on the number of questions.</p></div>`;
  // reorder by drag-and-drop (the row moves live under the mouse) or, on the grip, with the arrow keys; saved when dropped
  const tbl = v.querySelector('table.qtab'), order = () => [...tbl.querySelectorAll('tr[data-q]')].map(r => r.dataset.q), start = order();
  const renum = () => tbl.querySelectorAll('tr[data-q] .qno span').forEach((x, i) => { x.textContent = i + 1; });
  const saveOrder = async () => {
    const ids = order(); if (ids.join() === start.join()) return;
    try { await api('/questions/reorder', { method: 'POST', body: { type: tab, ids } }); toast('Question order saved'); }
    catch (er) { toast(er.message, 'err'); }
    const f = document.activeElement && document.activeElement.dataset.grip; await questionsBox(v);
    if (f) { const g = v.querySelector(`[data-grip="${f}"]`); if (g) g.focus(); }
  };
  let dragRow = null;
  tbl.addEventListener('dragstart', e => { dragRow = e.target.closest && e.target.closest('tr[data-q]'); if (!dragRow) return; dragRow.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragRow.dataset.q); });
  tbl.addEventListener('dragover', e => {
    if (!dragRow) return; e.preventDefault();
    const tr = e.target.closest('tr[data-q]'); if (!tr || tr === dragRow) return;
    const r = tr.getBoundingClientRect(); tr.parentNode.insertBefore(dragRow, e.clientY > r.top + r.height / 2 ? tr.nextSibling : tr); renum();
  });
  tbl.addEventListener('drop', e => e.preventDefault());
  tbl.addEventListener('dragend', () => { if (!dragRow) return; dragRow.classList.remove('dragging'); dragRow = null; saveOrder(); });
  tbl.addEventListener('keydown', e => {
    const g = e.target.closest('[data-grip]'); if (!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault(); const tr = g.closest('tr'), sib = e.key === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling;
    if (!sib || !sib.dataset.q) return;
    e.key === 'ArrowUp' ? tr.parentNode.insertBefore(tr, sib) : tr.parentNode.insertBefore(sib, tr); renum(); g.focus(); saveOrder();
  });
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
      try { await api('/questions', { method: q ? 'PUT' : 'POST', body }); m.remove(); questionsBox(v); } catch (e) { toast(e.message, 'err'); }
    };
  };
  v.onclick = async e => {
    const t = e.target, a = t.dataset.a;
    if (t.dataset.tab) { S.qtab = t.dataset.tab; questionsBox(v); }
    if (a === 'new') dialog('Add new question');
    if (a === 'edit') dialog('Edit question', qs.find(q => q.id === t.dataset.id));
    if (a === 'del') {
      const q = qs.find(x => x.id === t.dataset.id);
      const m = modal(`<h2>Delete question?</h2><p>${esc(q.text)}</p><div class="warn">New forms from the chosen month will no longer show this question. Answers already submitted are kept and stay visible in past forms.</div><label class="f">Delete from <i>*</i></label>${monthSelHtml(S.me.currentMonth)}<div class="row" style="margin-top:12px"><button class="btn dng solid" id="ok">Delete question</button><button class="btn" id="no">Cancel</button></div>`);
      m.querySelector('#no').onclick = () => m.remove();
      m.querySelector('#ok').onclick = async () => { await api('/questions/delete', { method: 'POST', body: { id: q.id, from: m.querySelector('#eff').value } }); m.remove(); questionsBox(v); };
    }
  };
};

// ---------- all stats (admin dashboard): the old portal's "All Stats" overview; each card opens its list ----------
pages.stats = () => location.replace('#/home'); // was a separate page; the cards now sit on the dashboard
function allStats(st) {
  // [icon, label, number, sub line, filter: [tab, role] for the Employees page, or a link]
  const cards = [
    ['team', 'Total organisation members', st.members, 'Active people in PMS', ['active', '']],
    ['sitemap', 'Total directors', st.directors, 'Top level, not reviewed', ['active', 'director']],
    ['idcard', 'Total managers', st.managers, 'Managers and team leads', ['active', 'manager']],
    ['review', 'Total executives / interns', st.executives, 'Everyone else who is reviewed', ['active', 'employee']],
    ['eyeoff', 'Total inactive members', st.inactive, 'Moved out of PMS', ['inactive', '']],
  ];
  return `<section class="allstats" aria-label="All stats"><h2>All stats <span>Organisation at a glance</span></h2><div class="bigstats">${cards.map(([ic, label, n, sub, to], i) =>
    `<a class="bstat ${i % 2 ? '' : 't'}" href="${Array.isArray(to) ? '#/employees/' + to[0] : to}" ${Array.isArray(to) ? `data-role="${to[1]}"` : ''} title="Open: ${esc(label.replace(/^Total /, ''))}">
      <span class="bi">${ico(ic)}</span><span class="bl">${esc(label)}</span><b class="bn">${n}</b><span class="bs">${esc(sub)}</span></a>`).join('')}</div></section>`;
}

// ---------- employees (admin) ----------
pages.employees = async (v, arg) => {
  if (arg === 'active' || arg === 'inactive') S.etab = arg;
  const d = await api('/employees');
  // the stat tiles on top double as filters: active/inactive and, for active people, the kind of role
  const ROLEF = { director: ['director'], manager: ['manager', 'teamlead'], employee: ['employee'] };
  const tab = S.etab || 'active', q = (S.eq || '').toLowerCase(), fl = S.eteam || '', rf = tab === 'active' && ROLEF[S.erole] ? S.erole : '';
  const rows = (tab === 'active' ? d.active : d.inactive).filter(e => (!q || e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q) || (e.email || '').includes(q)) && (!fl || e.team === fl) && (!rf || ROLEF[rf].includes(e.role)));
  const dom = '@' + S.me.domain, noEmail = d.active.filter(e => !e.email).length, ed = tab === 'active';
  // department chips with counts: people in this tab (and role tile), per team; a chip filters the table
  const inScope = (tab === 'active' ? d.active : d.inactive).filter(e => !rf || ROLEF[rf].includes(e.role));
  const teamN = inScope.reduce((a, e) => (a[e.team] = (a[e.team] || 0) + 1, a), {});
  const teamChips = `<div class="chips"><div class="seg" id="eteams" role="group" aria-label="Filter by department"><button type="button" class="chip ${fl ? '' : 'on'}" data-et="">All departments <span class="cnt">${inScope.length}</span></button>${Object.keys(teamN).sort((a, b) => teamN[b] - teamN[a] || a.localeCompare(b)).map(t => `<button type="button" class="chip ${t === fl ? 'on' : ''}" data-et="${esc(t)}">${teamIco(t)}${esc(t)} <span class="cnt">${teamN[t]}</span></button>`).join('')}</div></div>`;
  const shown = tab === 'inactive' ? 'Inactive members' : { director: 'Directors', manager: 'Managers and team leads', employee: 'Executives and interns' }[rf] || 'All active members';
  const opts = (list, cur) => [...new Set([...list, cur])].filter(Boolean).map(x => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const mgrOpts = e => {
    const list = d.managers.filter(x => x.id !== e.id);
    if (e.managerId && !list.some(x => x.id === e.managerId)) list.push({ id: e.managerId, name: e.manager }); // keep a current manager who is no longer in the list
    return '<option value="">No manager</option>' + list.map(x => `<option value="${x.id}" ${x.id === e.managerId ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  };
  const cell = (e, f, html, text) => ed ? `<select class="cell" data-f="${f}" data-id="${e.id}" aria-label="${f === 'managerId' ? 'Reporting manager' : f} for ${esc(e.name)}">${html}</select>` : esc(text);
  v.innerHTML = head('Employees', 'Change team, designation or manager right in the table') + `
  <div class="row"><b style="font-size:16px;color:var(--vr-n-900)">${shown} (${rows.length})</b>${searchBox('eq', 'Search by name, code or email', S.eq, 270)}<span class="sp"></span><a class="btn" href="#/reporting${{ manager: '/managers', employee: '/employees' }[rf] || ''}" title="See who reports to whom: directors, then their managers, then their employees">${ico('sitemap')}Reporting flow</a><button class="btn pri" data-a="add">${ico('plus')}Add new member</button></div>
  ${teamChips}
  ${tab === 'active' && noEmail ? `<div class="info">${noEmail} active ${noEmail === 1 ? 'person has' : 'people have'} no work email yet. People sign in with their ${esc(dom)} Google account, and calendar invites go to that address, so add it with Edit.</div>` : ''}
  <div class="tablewrap"><table><tr><th>Employee</th><th>Role</th><th>Team</th><th>Designation</th><th>Reporting manager</th>${tab === 'active' ? '' : '<th>Inactive from</th>'}<th>Active</th><th>Actions</th></tr>
  ${rows.map(e => `<tr><td><a href="#/empforms/${e.id}" style="color:var(--navy);font-weight:600;white-space:nowrap">${esc(e.name)}</a><div class="small" style="max-width:220px;overflow-wrap:anywhere">${esc(e.code)} · ${e.email ? esc(e.email) : 'No work email'}</div></td>
  <td title="${e.role === 'director' ? 'Top level, not reviewed' : e.role === 'employee' ? 'Is reviewed by their reporting manager' : 'Has people reporting to them: reviews their team'}">${roleBadge(e.role)}</td>
  <td>${cell(e, 'team', opts(d.teams, e.team), e.team)}</td>
  <td>${cell(e, 'designation', opts(d.designations, e.designation) + '<option value="__new">Other…</option>', e.designation)}</td>
  <td>${cell(e, 'managerId', mgrOpts(e), e.manager || 'No manager')}</td>
  ${tab === 'active' ? '' : `<td><span style="white-space:nowrap">${fmtY(e.inactiveFrom)}</span><div class="small">${esc(e.reason || '')}</div></td>`}
  <td><button class="sw ${e.active ? 'on' : ''}" role="switch" aria-checked="${e.active}" aria-label="${esc(e.name)} active" data-a="${e.active ? 'off' : 'on'}" data-id="${e.id}" data-n="${esc(e.name)}" title="${e.active ? 'Active. Click to move to inactive.' : 'Inactive. Click to reactivate.'}"><i></i></button></td>
  <td><span class="acts"><a class="btn sm" href="#/empforms/${e.id}">${tab === 'active' ? 'Monthly report' : 'Past forms'}</a><button class="btn sm" data-a="edit" data-id="${e.id}">Edit</button></span></td></tr>`).join('') || `<tr><td colspan="${tab === 'active' ? 7 : 8}">No one matches.</td></tr>`}</table></div>
  <p class="small">Changes in the Team, Designation and Reporting manager columns save straight away and are written to the audit log. Only people listed here with a ${esc(dom)} email can sign in. Inactive employees cannot sign in and are left out of schedules, counts, reports and emails; their past forms stay viewable.</p>`;
  v.oninput = e => { if (e.target.id === 'eq') { S.eq = e.target.value; const p = e.target.selectionStart; pages.employees(v).then(() => { const i = $('#eq'); i.focus(); i.setSelectionRange(p, p); }); } };
  const emailOk = s => !s || s.toLowerCase().endsWith(dom.toLowerCase()) && /^[^@\s]+@[^@\s]+$/.test(s);
  const LABEL = { team: 'team', designation: 'designation', managerId: 'reporting manager' };
  // a new designation typed in when "Other…" is picked
  const askText = (title, val) => new Promise(res => {
    const m = modal(`<h2>${title}</h2><input id="tv" style="width:100%" value="${esc(val)}"><div class="row" style="margin-top:12px"><button class="btn pri" id="ok">OK</button><button class="btn" id="no">Cancel</button></div>`);
    const done = x => { m.remove(); res(x); };
    m.querySelector('#no').onclick = () => done('');
    m.querySelector('#ok').onclick = () => done(m.querySelector('#tv').value.trim());
    m.querySelector('#tv').onkeydown = e => { if (e.key === 'Enter') done(e.target.value.trim()); };
    m.querySelector('#tv').focus();
  });
  v.onchange = async e => {
    if (e.target.id === 'et') { S.eteam = e.target.value; return pages.employees(v); }
    const sel = e.target.closest('select[data-f]'); if (!sel) return;
    const p = d.active.find(x => String(x.id) === sel.dataset.id), f = sel.dataset.f;
    let val = sel.value;
    if (f === 'designation' && val === '__new') { val = await askText('New designation for ' + esc(p.name), ''); if (!val) { sel.value = p.designation; return; } }
    // the edit route takes the whole record, so send the current values with the one change
    const b = { id: p.id, name: p.name, email: p.email || '', designation: p.designation, team: p.team, role: p.role, managerId: p.managerId ?? '', [f]: val };
    sel.disabled = true;
    try { await api('/employees', { method: 'PUT', body: b }); toast(`${p.name}: ${LABEL[f]} updated`); }
    catch (er) { toast(er.message, 'err'); }
    pages.employees(v);
  };
  v.onclick = async e => {
    const dep = e.target.closest('[data-et]'); if (dep) { S.eteam = dep.dataset.et; return pages.employees(v); }
    const t = e.target.closest('[data-a], [data-stat]') || e.target, a = t.dataset.a;
    if (t.dataset.stat) {
      const k = t.dataset.stat;
      if (k === 'questions') { location.hash = '#/params'; return; }
      S.etab = k === 'inactive' ? 'inactive' : 'active'; S.erole = ['director', 'manager', 'employee'].includes(k) ? k : '';
      const h = '#/employees/' + S.etab; // keep the address (and the menu highlight) in step with the tile
      if (location.hash !== h) { location.hash = h; return; }
      return pages.employees(v);
    }
    if (a === 'add') {
      const m = modal(`<h2>Add new member</h2><div id="er"></div>${[['name', 'Full name', ''], ['code', 'Employee code', ''], ['email', 'Work email', 'name' + dom], ['designation', 'Designation', '']].map(([k, l, ph]) => `<label class="f">${l} <i>*</i></label><input id="n_${k}" style="width:100%" placeholder="${esc(ph)}" ${k === 'email' ? 'type="email" autocomplete="off"' : ''}>`).join('')}
      <div class="small">They sign in with this Google account. It must end with ${esc(dom)}.</div>
      <label class="f">Team <i>*</i></label><select id="n_team">${d.teams.map(t => `<option>${t}</option>`).join('')}</select>
      <label class="f">Reporting manager <i>*</i></label><select id="n_managerId">${d.managers.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
      <label class="f">Date of joining <i>*</i></label><input type="date" id="n_joined"><label class="f">Access role <i>*</i></label><select id="n_role"><option value="employee">Employee</option><option value="teamlead">Team lead</option><option value="manager">Manager</option></select>
      <label class="f">Review window <i>*</i></label><select id="n_window"><option value="team">Same as team</option></select>
      <div class="info">New joiner: no KRAs are set yet, so only the questionnaire is checked. After 2 complete months the tool shows "need to set KRA of the month".</div><div class="row"><button class="btn pri" id="ok">Save member</button><button class="btn" id="no">Cancel</button></div>`);
      m.querySelector('#no').onclick = () => m.remove();
      m.querySelector('#ok').onclick = async () => {
        const b = {}; ['name', 'code', 'email', 'designation', 'team', 'managerId', 'joined', 'role', 'window'].forEach(k => b[k] = m.querySelector('#n_' + k).value.trim());
        if (b.email && !emailOk(b.email)) { m.querySelector('#er').innerHTML = `<div class="warn">Work email must end with ${esc(dom)}.</div>`; m.querySelector('#n_email').classList.add('err'); return; }
        try { await api('/employees', { method: 'POST', body: b }); m.remove(); toast('Member added'); pages.employees(v); } catch (er) { m.querySelector('#er').innerHTML = errBox(er); }
      };
    }
    if (a === 'edit') {
      const p = [...d.active, ...d.inactive].find(x => String(x.id) === t.dataset.id);
      const roles = [['employee', 'Employee'], ['teamlead', 'Team lead'], ['manager', 'Manager'], ['director', 'Director'], ['admin', 'Admin']];
      const m = modal(`<h2>Edit ${esc(p.name)}</h2><p class="small">Code ${esc(p.code)} · joined ${esc(p.joined)}</p><div id="er"></div>
      <label class="f">Full name <i>*</i></label><input id="u_name" style="width:100%" value="${esc(p.name)}">
      <label class="f">Work email</label><input id="u_email" type="email" autocomplete="off" style="width:100%" placeholder="name${esc(dom)}" value="${esc(p.email || '')}">
      <div class="small">Used to sign in with Google and to receive review invites. Must end with ${esc(dom)}.</div>
      <label class="f">Designation <i>*</i></label><input id="u_designation" style="width:100%" value="${esc(p.designation)}">
      <div class="row" style="margin:0;align-items:flex-end"><div><label class="f">Team</label><select id="u_team">${[...new Set([...d.teams, p.team])].map(x => `<option ${x === p.team ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div><label class="f">Access role</label><select id="u_role">${roles.map(([k, l]) => `<option value="${k}" ${k === p.role ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <label class="f">Reporting manager</label><select id="u_managerId">${mgrOpts(p)}</select>
      <div class="row"><button class="btn pri" id="ok">Save changes</button><button class="btn" id="no">Cancel</button></div>`);
      m.querySelector('#no').onclick = () => m.remove();
      m.querySelector('#ok').onclick = async () => {
        const b = { id: p.id }; ['name', 'email', 'designation', 'team', 'role', 'managerId'].forEach(k => b[k] = m.querySelector('#u_' + k).value.trim());
        if (!emailOk(b.email)) { m.querySelector('#er').innerHTML = `<div class="warn">Work email must end with ${esc(dom)}.</div>`; m.querySelector('#u_email').classList.add('err'); return; }
        try { await api('/employees', { method: 'PUT', body: b }); m.remove(); toast('Saved'); pages.employees(v); } catch (er) { m.querySelector('#er').innerHTML = errBox(er); }
      };
    }
    if (a === 'off') {
      // the inactive-from date is today and the person moves to All inactive employees; anyone reporting to them is moved to someone else first
      const id = t.dataset.id, name = t.dataset.n, done = () => { toast(`${name} moved to inactive`); pages.employees(v); };
      try {
        const chk = await api('/employees/inactive', { method: 'POST', body: { id, check: true } });
        if (!chk.reports.length) {
          if (!await confirmBox(`Move ${name} to inactive?`, 'They are left out of review schedules, status counts, reports and manager emails from today. Past forms stay available.', { ok: 'Move to inactive', danger: true })) return;
          await api('/employees/inactive', { method: 'POST', body: { id, confirm: true } }); return done();
        }
        const m = modal(`<h2>Move ${esc(name)} to inactive?</h2><div id="er"></div>
          <p class="small"><b>${chk.reports.length} ${chk.reports.length === 1 ? 'person reports' : 'people report'} to ${esc(name)}:</b> ${chk.reports.map(r => esc(r.name)).join(', ')}. Choose who they should report to from now on. Then ${esc(name)} is moved to inactive.</p>
          <label class="f">New reporting manager <i>*</i></label><select id="nm">${chk.candidates.map(c => `<option value="${c.id}" ${c.id === chk.suggested ? 'selected' : ''}>${esc(c.name)} (${esc(c.designation)})</option>`).join('')}</select>
          <div class="row"><button class="btn dng solid" id="ok">Shift and move to inactive</button><button class="btn" id="no">Cancel</button></div>`);
        m.querySelector('#no').onclick = () => m.remove();
        m.querySelector('#ok').onclick = async () => {
          try { await api('/employees/inactive', { method: 'POST', body: { id, confirm: true, newManagerId: +m.querySelector('#nm').value } }); m.remove(); done(); }
          catch (er) { m.querySelector('#er').innerHTML = errBox(er); }
        };
      } catch (er) { toast(er.message, 'err'); }
    }
    if (a === 'on' && await confirmBox(`Reactivate ${t.dataset.n}?`, 'They can sign in again and are counted in schedules, reports and emails from today.', { ok: 'Reactivate' })) { await api('/employees/reactivate', { method: 'POST', body: { id: t.dataset.id } }); toast('Reactivated'); pages.employees(v); }
  };
};

pages.empforms = async (v, id) => {
  const d = await api('/employee-forms?emp=' + id), e = d.employee;
  v.innerHTML = head('Monthly forms', `<a href="#/employees">Employees</a> › ${esc(e.name)}`) + `<div class="card"><b>${esc(e.name)}</b> (${esc(e.designation)}) · Code ${esc(e.code)} · Team ${esc(e.team)} · Manager ${esc(e.manager)} · Joined ${esc(e.joined)} <span class="badge ${e.active ? 'b-green' : 'b-grey'}">${e.active ? 'Active' : 'Inactive'}</span> · FY 2026-2027</div>
  <div class="tablewrap"><table><tr><th>Month</th><th>Review date</th><th>Status</th><th>Manager rating</th><th>Form</th></tr>${d.rows.map(r => `<tr style="${r.open ? '' : 'opacity:.55'}"><td>${esc(r.label)}</td><td>${fmtD(r.reviewDate)}</td><td>${r.beforeJoining ? '<span class="small">Before joining</span>' : badge(r.status)}</td><td>${pc(r.rating)}</td><td>${r.open ? `<a class="btn sm pri" href="#/form/${e.id}/${r.month}">Open form</a>` : '<button class="btn sm" disabled title="No form: this month is before the joining date">Open form</button>'}</td></tr>`).join('')}
  <tr><td><b>Annual review 2027</b></td><td>N/A</td><td>${badge(d.annual === 'Submitted' ? 'Completed and Submitted' : 'Not started')}</td><td>N/A</td><td><a class="btn sm pri" href="#/annual/${e.id}">Open form</a></td></tr></table></div>`;
};

// ---------- reporting hierarchy (admin) ----------
// Five lists by designation (the admin menu's Reporting manager group), and a drill-down:
// director -> their managers -> a manager's employees. #/reporting = directors, #/reporting/<slug> = a list,
// #/reporting/<id> = who reports to that person. [server level, label, url slug, columns]
const ORG_TABS = [['director', 'Directors', '', 'director'], ['srmanager', 'Senior managers', 'senior-managers', 'manager'], ['manager', 'Managers', 'managers', 'manager'],
  ['srexec', 'Senior executives', 'senior-executives', 'employee'], ['other', 'Executives and others', 'executives', 'employee']];
pages.reporting = async (v, arg) => {
  arg = String(arg || '').toLowerCase();
  const slug = arg === 'employees' ? 'executives' : arg; // older link
  const id = /^\d+$/.test(arg) ? arg : '', level = id ? '' : (ORG_TABS.find(t => t[2] && t[2] === slug) || ORG_TABS[0])[0];
  const d = await api(`/org?month=${S.month}${id ? '&id=' + id : '&level=' + level}`), p = d.person, c = d.counts;
  const mon = esc(monthLabel(S.month).split(' ')[0]), tabOf = k => ORG_TABS.find(t => t[0] === k);
  const tabHref = k => '#/reporting' + (tabOf(k)[2] ? '/' + tabOf(k)[2] : '');
  const pname = x => x ? `<a class="lk" href="#/reporting/${x.id}">${esc(x.name)}</a>` : '<span class="small">None</span>';
  const up = d.path.length ? `#/reporting/${d.path[d.path.length - 1].id}` : '#/reporting';
  const crumbs = p ? ['<a href="#/reporting">Directors</a>', ...d.path.map(x => `<a href="#/reporting/${x.id}">${esc(x.name)}</a>`), `<b>${esc(p.name)}</b>`].join(' › ')
    : `PMS › Reporting manager › ${tabOf(level)[1]}`;
  const prog = t => t.scheduled ? `<div style="min-width:150px">${stackBar(t)}</div>` : '<span class="small">No reviews</span>';
  const progCell = r => r.total ? prog(r.teamCounts) : '<span class="small">N/A</span>';
  const own = r => r ? `${badge(r.status)}${r.rating != null ? ` <b title="Monthly rating">${pc(r.rating)}</b>` : ''}` : '<span class="small">No form this month</span>';
  const forms = r => `<span class="acts"><a class="btn sm" href="#/form/${r.id}/${S.month}" title="${mon} review form">${ico('file')}View report</a><a class="btn sm" href="#/empforms/${r.id}" title="Every month's review">${ico('chart')}Monthly report</a></span>`;
  // square icon buttons for the table rows: View report = this month's form, Monthly report = every month
  const viewBtn = r => `<a class="sqbtn" href="#/form/${r.id}/${S.month}" title="View ${mon} report: ${esc(r.name)}" aria-label="View ${mon} report for ${esc(r.name)}">${ico('file')}</a>`;
  const monthBtn = r => `<a class="sqbtn" href="#/empforms/${r.id}" title="Monthly report: ${esc(r.name)}, every month" aria-label="Monthly report for ${esc(r.name)}">${ico('chart')}</a>`;
  const team = r => r.direct ? `<a class="btn sm" href="#/reporting/${r.id}" title="Open the people who report to ${esc(r.name)}">${ico('eye')}${r.direct}</a>` : '<span class="small">0</span>';
  const nameCell = r => `<div class="orgname"><span class="avatar s">${initials(r.name)}</span><div>${r.direct ? `<a class="nm" href="#/reporting/${r.id}">${esc(r.name)}</a>` : `<b>${esc(r.name)}</b>`}<div class="small">${esc(r.team)}</div></div></div>`;
  const emailCell = r => r.email ? `<span class="small em">${esc(r.email)}</span>` : '<span class="small">N/A</span>';
  // the columns depend on what is listed: [header, cell, class]; every list starts Sr. no, Name, Email, Designation and ends View report, Monthly report
  const lead = [['Sr. no', (r, i) => i + 1, 'sr'], ['Name', nameCell], ['Email', emailCell], ['Designation', r => esc(r.designation)]];
  const tail = [['View report', viewBtn, 'c'], ['Monthly report', monthBtn, 'c']];
  const COLS = [...lead, ...{
    director: [['Managers', team], [`Team progress (${mon})`, progCell], [`Own review (${mon})`, r => own(r.review)]],
    manager: [['Director', r => pname(r.director)], ['Employees', team], [`Team progress (${mon})`, progCell], [`Own review (${mon})`, r => own(r.review)]],
    employee: [['Reporting manager', r => pname(r.manager)], ['Director', r => pname(r.director)], [`Review (${mon})`, r => own(r.review)]],
    drill: [['Team members', team], [`Team progress (${mon})`, progCell], [`Own review (${mon})`, r => own(r.review)]],
    // a team with no managers in it: just the employees and their reviews
    team: [[`Review (${mon})`, r => own(r.review)], ['Review date', r => r.review && r.review.reviewDate ? fmtD(r.review.reviewDate) : '<span class="small">Not held yet</span>']],
  }[p ? (d.rows.some(r => r.direct) ? 'drill' : 'team') : tabOf(level)[3]], ...tail];
  const title = p ? `Reporting to ${esc(p.name)} (${d.rows.length})` : `${tabOf(level)[1]} (${d.rows.length})`;
  const scope = p ? `${mon} reviews of everyone under ${esc(p.name)} (all levels)` : tabOf(level)[3] === 'employee' ? `${mon} reviews of the people in this list` : `${mon} reviews across the organisation`;
  v.innerHTML = head('Reporting manager', crumbs) + `<div class="seg" role="tablist">${ORG_TABS.map(([k, l]) => `<a role="tab" href="${tabHref(k)}" class="${k === level ? 'on' : ''}" aria-selected="${k === level}">${l} <span class="cnt">${d.levelCounts[k]}</span></a>`).join('')}</div>
  <div class="row">${monthSel()}${searchBox('orgq', 'Search name, team or email', S.orgq)}<span class="sp"></span>${p ? `<a class="btn" href="${up}">← Back</a>` : ''}<a class="btn" href="#/employees">Edit people on Employees</a></div>
  ${p ? `<div class="card orghead"><span class="avatar">${initials(p.name)}</span><div><b class="on">${esc(p.name)}</b><div class="small">${dotJoin(p.designation, p.team)}${p.email ? ' · ' + esc(p.email) : ''}</div><div class="small">Reports to ${p.manager ? pname(p.manager) : 'nobody (top level)'}${p.director && (!p.manager || p.director.id !== p.manager.id) ? ` · Director ${pname(p.director)}` : ''} · ${p.direct} direct report${p.direct === 1 ? '' : 's'}</div></div><span class="sp"></span><div class="row" style="margin:0">${own(p.review)}${forms(p)}</div><div class="row" style="margin:0;flex-basis:100%;justify-content:flex-end">${reportLinks(p)}</div></div>` : ''}
  <div class="small" style="margin:0 0 12px">${scope}</div>
  ${countTiles(c)}
  <h2>${title}</h2>
  <div class="tablewrap"><table class="orgt"><tr>${COLS.map(([h, , c]) => `<th class="${c || ''}">${h}</th>`).join('')}</tr>
  ${d.rows.map((r, i) => `<tr data-s="${esc(`${r.name} ${r.designation} ${r.team} ${r.email} ${r.manager ? r.manager.name : ''} ${r.director ? r.director.name : ''}`.toLowerCase())}">${COLS.map(([, cell, c]) => `<td class="${c || ''}">${cell(r, i)}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${COLS.length}" class="small">${p ? `Nobody reports to ${esc(p.name)}.` : 'No one at this level.'}</td></tr>`}
  <tr id="orgnone" hidden><td colspan="${COLS.length}" class="small">No one here matches your search.</td></tr></table></div>
  <p class="small">Flow: Directors → click a director to see their managers → click a manager to see their employees. The path at the top takes you back up. Team progress counts everyone under that person, at every level.</p>`;
  onMonth(() => pages.reporting(v, arg));
  const filter = () => {
    const s = (S.orgq || '').trim().toLowerCase(); let n = 0;
    v.querySelectorAll('tr[data-s]').forEach(tr => { const hit = !s || tr.dataset.s.includes(s); tr.hidden = !hit; n += hit; });
    $('#orgnone').hidden = !(s && d.rows.length && !n);
  };
  $('#orgq').oninput = e => { S.orgq = e.target.value; filter(); };
  filter();
};

// ---------- audit ----------
pages.audit = async v => {
  const rows = await api('/audit');
  v.innerHTML = head('Audit log', 'Every change made in PMS, newest first') + `<div class="tablewrap"><table><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr>${rows.map(r => `<tr><td>${esc(new Date(r.at).toLocaleString())}</td><td>${esc(r.who)}</td><td>${esc(r.action)}</td><td>${esc(r.detail)}</td></tr>`).join('')}</table></div>`;
};
pages.config = () => location.replace('#/scheduling'); // Settings now live on the Scheduling page (Review rules)

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
  const recapRows = () => f.recap.map((r, i) => `<tr><td>${i + 1}</td>${['expectation', 'achievements', 'improvement'].map(k => `<td><textarea rows="3" data-aprow="recap:${i}:${k}" ${dis}>${esc(r[k])}</textarea></td>`).join('')}<td>${ed ? `<button class="xdel" data-apdel="recap:${i}" title="Remove row" aria-label="Remove row">${ico('trash')}</button>` : ''}</td></tr>`).join('');
  const kraRows = () => f.kraProgress.map((r, i) => `<tr><td><textarea rows="3" data-aprow="kraProgress:${i}:kra" ${dis}>${esc(r.kra)}</textarea></td><td><textarea rows="3" data-aprow="kraProgress:${i}:progress" ${dis}>${esc(r.progress)}</textarea></td><td>${ed ? `<button class="xdel" data-apdel="kraProgress:${i}" title="Remove row" aria-label="Remove row">${ico('trash')}</button>` : ''}</td></tr>`).join('');
  const nl = t => esc(t).replace(/\n/g, '<br>') || 'Not added';
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
      `<table class="aptbl edit"><tr><th style="width:36px">#</th><th>Expectation (Year Beginning)</th><th>Achievements During the Year</th><th>Improvement</th><th style="width:36px"></th></tr>${recapRows()}</table>${ed ? `<button class="btn sm" data-apadd="recap">${ico('plus')}Add row</button>` : ''}`],
    ['KRA Progress', 'Describe your progress against each key result area. Add more rows as needed.',
      `<table class="aptbl edit"><tr><th style="width:30%">KRA</th><th>Progress</th><th style="width:36px"></th></tr>${kraRows()}</table>${ed ? `<button class="btn sm" data-apadd="kraProgress">${ico('plus')}Add row</button>` : ''}`],
    ['KSA Setting', 'Identify your key strengths and areas where you can grow to enhance your performance.',
      block('Key Strengths', 'Identify skills, attributes, and expertise that contributed significantly to your success. Focus on competencies that set you apart and provide specific instances of impact.', ta('strengths')) +
      block('Area of Improvement', 'Reflect on aspects where growth could enhance performance. Consider feedback, challenges faced, or new skills needed. Provide a real-life scenario to make it actionable.', ta('improvements'))],
    ['Self-KRA Setting', 'Set your own key result areas across three dimensions: Operational, Process, and People.',
      block('Operational', 'Define key responsibilities that drive efficiency and effectiveness. Identify tasks contributing to productivity, accuracy, and workflow improvements.', ta('operational')) +
      block('Process', 'Identify areas to optimize workflows, automate tasks, or enhance accuracy. Include best practices that drive operational excellence.', ta('process')) +
      block('People', 'Emphasize continuous learning, skill enhancement, and knowledge sharing. Set goals for new skills, training, and mentoring others.', ta('people'))],
    ['Review & Submit', '', `<div class="approg"><div class="row" style="margin:0"><b style="font-size:16px;color:var(--vr-n-900)">Overall completion</b><span class="sp"></span><b style="color:var(--vr-brand-text);font-size:18px;font-variant-numeric:tabular-nums">${pct}%</b></div><div class="apbar"><i style="width:${pct}%"></i></div></div>
      <div class="apgrid" style="margin:14px 0">${field('Employee', e.name)}${field('Designation', e.designation)}${field('Department', e.department)}${field('Reviewer', e.reviewer)}</div>
      ${sections.map(([t, h]) => `<div class="aph">${t.toUpperCase()}</div>${h}`).join('')}
      ${sub ? `<div class="ok" style="font-weight:600;margin-top:16px">Submitted on ${apWhen(f.submittedAt)}</div>` : ''}`],
  ];
  const [title, desc, body] = steps[apStep - 1];
  v.innerHTML = head('Appraisal form ' + AP.fy, `${esc(e.name)} · annual review`) +
    `<div class="row"><select id="msel">${S.me.months.map(m => `<option value="${m.key}">${m.label.split(" ")[0]}</option>`).join('')}<option value="annual" selected>Annual review</option></select>${sub ? '<span class="badge b-green">Submitted</span>' : ''}</div>
    <div class="apcard"><div class="aphead"><i class="orb o1"></i><span class="aplogo"><img src="verve-advisory-logo.png" alt="Verve Advisory"></span><span><b>Appraisal ${AP.fy}</b><small>PERFORMANCE REVIEW FORM</small></span></div>
    <div class="apsteps">${AP_STEPS.map((s, i) => `<button class="apstep ${i + 1 < apStep ? 'done' : ''} ${i + 1 === apStep ? 'cur' : ''}" data-apgo="${i + 1}"><i>${i + 1 < apStep ? '✓' : i + 1}</i><span>${s}</span></button>`).join('')}</div>
    <div class="apbody"><h2 class="aptitle">${title.toUpperCase()}</h2>${desc ? `<p class="apdesc">${desc}</p>` : ''}${body}</div>
    <div class="apfoot"><button class="btn" data-apgo="${apStep - 1}" ${apStep === 1 ? 'disabled' : ''}>← Previous</button><span class="sp"></span>
      ${apStep === 6 ? '<button class="btn" id="apxls">Download Excel</button>' : `<button class="btn pri" data-apgo="${apStep + 1}">Next →</button>`}
      ${ed ? `<button class="btn pri" id="apsub">${sub ? 'Edit and resubmit' : 'Submit'}</button>` : ''}</div></div>`;
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
      if (b.dataset.apgo) { const n = +b.dataset.apgo; if (n < 1 || n > 6) return; if (AP.perms.edit) await saveAp(); apStep = n; paintAppraisal(v); SC().scrollTo({ top: 0 }); }
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
