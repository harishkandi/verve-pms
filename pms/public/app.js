'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = { user: null, me: null, month: null, page: null };
// anything not served from this machine is the shared staging demo
const IS_STAGING = !['localhost', '127.0.0.1', ''].includes(location.hostname);
const ROLE_LABEL = { admin: 'Admin', director: 'Director', manager: 'Manager', teamlead: 'Team lead', employee: 'Employee' };

// the session lives in an HttpOnly cookie set by the server; the browser sends it with every call
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: opts.method && opts.method !== 'GET' ? JSON.stringify(opts.body || {}) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (res.status === 401 && S.me) { S.me = null; S.month = null; boot(); }
  if (res.status === 404 && data.code === 'NO_ROUTE') {
    // this page is older than the server (PMS was updated): load the new version, at most once a minute
    let last = 0; try { last = +sessionStorage.getItem('pmsReloadedAt') || 0; sessionStorage.setItem('pmsReloadedAt', String(Date.now())); } catch {}
    if (Date.now() - last > 60000) { location.reload(); return new Promise(() => {}); }
    data.error = 'PMS was just updated. Please reload the page (Ctrl+F5).';
  }
  if (!res.ok) { const e = new Error(data.error || 'Error'); e.data = data; throw e; }
  return data;
}
function toast(msg, kind = 'ok') { document.querySelectorAll('.toast').forEach(x => x.remove()); const t = document.createElement('div'); t.className = 'toast t-' + kind; t.setAttribute('role', kind === 'err' ? 'alert' : 'status'); t.innerHTML = `<span class="ti">${kind === 'err' ? '!' : '✓'}</span><span></span>`; t.lastChild.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 4000 : 2800); }
const badge = st => {
  const c = { 'Completed and Submitted': 'green', 'Completed but Not Submitted': 'amber', 'Review Not Completed': 'red', Pending: 'blue', 'Not started': 'grey', 'Within due date': 'green', 'After due date': 'red' }[st] || 'grey';
  return `<span class="badge b-${c}">${esc(st)}</span>`;
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
const RATINGS = [0, 1, 2, 3, 4, 5];
const rateSel = (val, attrs, enabled, cls = '') => `<select class="num ${cls}" ${attrs} ${enabled ? '' : 'disabled'}><option value="">–</option>${RATINGS.map(n => `<option value="${n}" ${val != null && val !== '' && +val === n ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
const errBox = e => `<div class="warn">${(e.data?.errors || [e.message]).map(esc).join('<br>')}</div>`;
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
};
// Parameters Summary: an icon that suits the section's title (admins can rename sections or add new ones)
const paramIcon = title => { const t = title.toLowerCase(); return /attend/.test(t) ? 'calcheck' : /skill|quality/.test(t) ? 'award' : /team/.test(t) ? 'team' : /conduct|ethic|value/.test(t) ? 'shield' : /initiative|motivat/.test(t) ? 'bolt' : /groom/.test(t) ? 'shirt' : /health|well/.test(t) ? 'heart' : 'list'; };
const ico = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
// Verve mark (the V and the diamond, brand/verve-pms-mark.svg) drawn inline so its colours follow the theme
const MARK = (cls = '') => `<svg class="mark ${cls}" viewBox="0 0 64 64" role="img" aria-label="Verve"><polygon class="m1" points="5,22 19,22 38,58 25,58"/><polygon class="m2" points="45,22 59,22 38,58 25,58"/><polygon class="m3" points="32,4 39.5,11.5 32,19 24.5,11.5"/></svg>`;
const PMS_LOGO = text => `<span class="pmsmark">${MARK('onDark')}<span><b>Verve PMS</b><small>${text}</small></span></span>`;
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
const themeBtn = () => { const dark = document.documentElement.dataset.theme === 'dark'; return `<button class="theme-btn" id="themeBtn" title="${dark ? 'Switch to light mode' : 'Switch to dark mode'}" aria-label="Switch theme">${ico(dark ? 'sun' : 'moon')}</button>`; };
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('pmsTheme', t); } catch {}
  document.querySelectorAll('#themeBtn').forEach(b => { b.outerHTML = themeBtn(); });
}
document.addEventListener('click', e => { if (e.target.closest('#themeBtn')) toggleTheme(); });

// ---------- shell ----------
const roleBadge = r => `<span class="badge ${r === 'admin' ? 'b-amber' : r === 'director' ? 'b-blue' : r === 'manager' || r === 'teamlead' ? 'b-green' : 'b-grey'}">${ROLE_LABEL[r]}</span>`;
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
  const feat = (icon, title, text) => `<li><i>${ico(icon)}</i><span><b>${title}</b>${text}</span></li>`;
  const alert = (msg, kind = 'err') => `<div class="ac-alert ${kind}" role="${kind === 'err' ? 'alert' : 'status'}">${ico(kind === 'err' ? 'alert' : 'info')}<span>${esc(msg)}</span></div>`;
  $('#root').innerHTML = `<div class="auth">
  <aside class="auth-brand" aria-hidden="false">
    <svg class="ab-water" viewBox="0 0 64 64" aria-hidden="true"><polygon points="5,22 19,22 38,58 25,58"/><polygon points="45,22 59,22 38,58 25,58"/><polygon points="32,4 39.5,11.5 32,19 24.5,11.5"/></svg>
    <div class="ab-logo">${PMS_LOGO('Performance Management System')}</div>
    <div class="ab-mid">
      <div class="ab-kicker">Verve Advisory</div>
      <h2>Performance,<br>reviewed with <em>clarity</em>.</h2>
      <p>Monthly reviews, scheduled conversations and clear reports, in one place for every team.</p>
      <ul class="ab-feats">${feat('review', 'Monthly KRA reviews', 'Self and manager ratings, weighted by KRA')}${feat('calendar', 'Review meetings on the calendar', 'Invites with the Zoom link, sent from PMS')}${feat('chart', 'Status at a glance', 'Team and organisation reports, ready to share')}</ul>
    </div>
    <div class="ab-foot"><span>© ${new Date().getFullYear()} Verve Advisory</span></div>
  </aside>
  <main class="auth-main">${themeBtn()}
    <div class="auth-card">
      <div class="ac-logo"><img src="verve-advisory-logo.png" alt="Verve Advisory"></div>
      <h1>Welcome back</h1>
      <p class="ac-sub">Sign in to <b>Verve PMS</b> with your work account</p>
      <div id="aerr">${err ? alert(err) : ''}</div>
      <form id="lform" novalidate>
        <label class="ac-label" for="lemail">Work email</label>
        <div class="ac-field">${ico('mail')}<input id="lemail" type="email" autocomplete="username" placeholder="name${esc(dom)}" spellcheck="false"></div>
        <div class="ac-hint" id="lemailh"></div>
        <div class="ac-row"><label class="ac-label" for="lpass">Password</label><a href="#" class="ac-link" id="lforgot">Forgot password?</a></div>
        <div class="ac-field">${ico('lock')}<input id="lpass" type="password" autocomplete="current-password" placeholder="Enter your password"><button type="button" class="ac-eye" id="leye" aria-label="Show password" title="Show password">${ico('eye')}</button></div>
        <div class="ac-hint" id="lpassh"></div>
        <label class="ac-check"><input type="checkbox" id="lrem" checked><span>Keep me signed in</span></label>
        <button class="ac-submit" type="submit">Sign in</button>
      </form>
      <div class="ac-or"><span>or continue with</span></div>
      <button class="gbtn" id="gsign" type="button" ${st.google ? '' : 'disabled title="Google sign-in is not set up on this server yet"'}>${GOOGLE_G}<span>Sign in with Google</span></button>
      <p class="ac-note">${ico('shield')}<span>Only <b>${esc(dom)}</b> accounts can sign in</span></p>
    </div>
    ${st.demo && st.accounts && st.accounts.length ? `<div class="auth-demo"><div class="adm-h">${ico('key')}<b>Test accounts</b><span>Password <code>${esc(st.password)}</code></span></div>
      ${st.accounts.map(a => `<button type="button" class="adm-row" data-em="${esc(a.email)}" title="Sign in as ${esc(a.name)}"><span class="adm-l">${esc(a.label)}<small>${esc(a.name)}</small></span><span class="adm-e">${esc(a.email)}</span>${ico('right')}</button>`).join('')}
      <p>Dummy data for testing. Click an account to sign in.</p></div>` : ''}
    <div class="auth-legal">Need access or help signing in? Contact HR.</div>
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
  $('#lforgot').onclick = e => { e.preventDefault(); err$.innerHTML = alert(st.demo ? `Test accounts all use the password ${st.password}. For your Google account, use Sign in with Google.` : 'Your password is managed by your Verve Google account. To reset it, contact HR or IT.', 'info'); };
  $('#gsign').onclick = () => { if (st.google) location.href = `/api/auth/google/start?origin=${encodeURIComponent(location.origin)}`; };
  // a test account fills in its email and password and signs straight in
  document.querySelectorAll('.adm-row').forEach(b => b.onclick = () => {
    email.value = b.dataset.em; pass.value = st.password; fieldErr(email, '#lemailh', ''); fieldErr(pass, '#lpassh', '');
    $('#lform').requestSubmit();
  });
  if (!err) email.focus({ preventScroll: true });
}
async function signOut() { try { await api('/auth/logout', { method: 'POST' }); } catch {} S.me = null; S.month = null; location.hash = '#/home'; boot(); }
async function viewAs(id) { await api('/auth/view-as', { method: 'POST', body: { id } }); S.month = null; S.hteam = ''; location.hash = '#/home'; await start(); }
async function pickViewAs() {
  const people = await api('/auth/view-as');
  const m = modal(`<h2>View PMS as…</h2><p class="small">See exactly what this person sees and can do. Changes you make are saved for real. Use "Back to me" in the banner to return.</p>
    <input id="vaq" placeholder="Search by name, team or role…" style="width:100%;margin:8px 0"><div class="card" id="val" style="padding:6px;max-height:50vh;overflow:auto;margin:0"></div>`);
  const draw = q => { q = q.toLowerCase(); m.querySelector('#val').innerHTML = people.filter(p => !q || `${p.name} ${p.team} ${p.role} ${p.designation}`.toLowerCase().includes(q)).map(userBtn).join('') || '<div class="empty">No one matches.</div>'; };
  draw(''); m.querySelector('#vaq').oninput = e => draw(e.target.value); m.querySelector('#vaq').focus();
  m.onclick = async e => { const b = e.target.closest('[data-u]'); if (b) { m.remove(); try { await viewAs(+b.dataset.u); } catch (er) { toast(er.message, 'err'); } } };
}

async function start() {
  S.me = await api('/me');
  S.month = S.month || S.me.currentMonth;
  if (REDIRECT && (REDIRECT.error || REDIRECT.calendar)) { const r = REDIRECT; REDIRECT = {}; setTimeout(() => r.error ? toast(authMsg(r.error, r.email, S.me.domain), 'err') : toast('Google Calendar connected. You can now send review invites.'), 300); }
  const r = S.me.role, mgr = ['manager', 'teamlead', 'director', 'admin'].includes(r);
  const items = [
    ['Home', '#/home', 'home'],
    r !== 'admin' && ['My Review', `#/form/${S.me.id}/${S.month}`, 'review'],
    mgr && r !== 'admin' && ['Team Reviews', '#/team', 'team'],
    mgr && ['Scheduling', '#/scheduling', 'calendar'],
    mgr && ['Review Status Report', '#/report', 'chart'],
    mgr && ['Manager Emails', '#/emails', 'mail'],
    r !== 'employee' && ['One Pager Document', `#/annual/${S.me.id}`, 'file'],
    ['Parameters Summary', '#/params', 'list'],
    r === 'admin' && '--Admin',
    r === 'admin' && ['Employees', '#/employees', 'idcard'],
    r === 'admin' && ['Reporting Manager', '#/reporting', 'sitemap'],
    r === 'admin' && ['Audit Log', '#/audit', 'clock'],
    r === 'admin' && ['Settings', '#/config', 'sliders'],
  ].filter(Boolean);
  $('#root').innerHTML = `<div id="app"><nav><div class="logo">${PMS_LOGO('Performance Management')}${IS_STAGING ? `<span class="stage" title="Staging: dummy data, resets when the server restarts">STAGING</span>` : ''}</div>
    ${items.map(i => typeof i === 'string' ? `<div class="grp">${i.slice(2)}</div>` : `<a data-h="${i[1]}" href="${i[1]}">${ico(i[2])}<span>${i[0]}</span></a>`).join('')}
    <div class="foot"><a id="logout">${ico('logout')}<span>Sign out</span></a></div></nav>
    <main>${S.me.viewingAs ? `<div class="asbar">${ico('eye')}<span>You are viewing PMS as <b>${esc(S.me.name)}</b> (${ROLE_LABEL[S.me.role]}). What you change is saved for real.</span><span class="sp"></span><button class="btn sm" id="asback">Back to ${esc(S.me.real.name.split(' ')[0])}</button></div>` : ''}
    <header><img class="top-logo" src="verve-advisory-logo.png" alt="Verve Advisory">${S.me.real.role === 'admin' && !S.me.viewingAs ? `<button class="btn sm" id="asbtn" title="See PMS as another person">${ico('eye')}View as…</button>` : ''}${themeBtn()}<div class="who"><b>${esc(S.me.name)}</b><br><small>${esc(S.me.designation || ROLE_LABEL[S.me.role])}</small></div><div class="avatar">${initials(S.me.name)}</div></header><div id="view"></div></main></div>`;
  $('#root').onclick = e => {
    if (e.target.closest('#logout')) signOut();
    if (e.target.closest('#asbtn')) pickViewAs().catch(er => toast(er.message, 'err'));
    if (e.target.closest('#asback')) viewAs(null).catch(er => toast(er.message, 'err'));
  };
  window.onhashchange = route;
  route();
}

async function route() {
  const [, page, ...args] = (location.hash || '#/home').split('/');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', !!a.dataset.h && a.dataset.h.split('/')[1] === page));
  const v = $('#view'); v.innerHTML = '<p class="small">Loading…</p>';
  v.onclick = v.oninput = v.onchange = null; window.onscroll = null;
  try { await (pages[page] || pages.home)(v, ...args); } catch (e) { v.innerHTML = `<h1>Something went wrong</h1>${errBox(e)}`; }
}
const head = (t, c) => `<h1>${t}</h1><div class="crumb">${c || ''}</div>`;
// month picker: a styled dropdown over a hidden native select, so pages keep listening to #msel change events
function monthSel(id = 'msel') {
  S.fy ??= fyOf(S.month);
  return `<div class="dd" data-dd><button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false">${ico('calendar')}<span class="dd-val">${esc(monthLabel(S.month) || 'Month')}</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
  <div class="dd-menu" role="listbox" hidden>${ddMonthList()}</div>
  <select id="${id}" hidden aria-hidden="true">${monthOpts(S.month)}</select></div>`;
}
// menu body: FY switcher + the 12 months of that FY (months not yet open are shown but disabled)
function ddMonthList() {
  const y = S.fy, cur = S.me.currentMonth;
  return `<div class="dd-head"><button type="button" class="dd-nav" data-fy="${y - 1}" title="Previous year" aria-label="Previous year">${ico('left')}</button><span>FY ${y}-${y + 1}</span><button type="button" class="dd-nav" data-fy="${y + 1}" title="Next year" aria-label="Next year" ${y + 1 > fyOf(cur) ? 'disabled' : ''}>${ico('right')}</button></div>
  ${fyMonthsOf(y).map(m => `<button type="button" role="option" class="dd-item ${m.key === S.month ? 'on' : ''}" data-v="${m.key}" aria-selected="${m.key === S.month}" ${m.started ? '' : 'disabled title="Not open yet"'}><span>${esc(m.label.split(' ')[0])}</span>${ico('tick')}</button>`).join('')}`;
}
function onMonth(fn) { $('#msel').onchange = e => { S.month = e.target.value; fn(); }; }
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
    if (sel.value !== item.dataset.v) { S.fy = fyOf(item.dataset.v); sel.value = item.dataset.v; sel.dispatchEvent(new Event('change', { bubbles: true })); }
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
const ringSvg = pct => `<svg viewBox="0 0 36 36" aria-hidden="true"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd54a"/><stop offset="1" stop-color="#f0a500"/></linearGradient></defs>
  <circle cx="18" cy="18" r="13.2" fill="rgba(255,255,255,.08)"/><circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="2.6"/>
  ${pct ? `<circle pathLength="100" cx="18" cy="18" r="15.5" fill="none" stroke="url(#ringGrad)" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="${pct} 100" transform="rotate(-90 18 18)"/>` : ''}</svg>`;
// completion donut: one arc per status, drawn clockwise from the top
// key in counts, colour token, short label, full status name used by the report filter
const STATUS_SEGS = [['submitted', 'grn', 'Submitted', 'Completed and Submitted'], ['notSubmitted', 'amb', 'Not submitted', 'Completed but Not Submitted'], ['pending', 'blu', 'Pending', 'Pending'], ['notCompleted', 'red', 'Not completed', 'Review Not Completed']];
function donutSvg(c) {
  const tot = c.scheduled || 0, pct = tot ? Math.round(c.submitted / tot * 100) : 0;
  let off = 0;
  const arcs = tot ? STATUS_SEGS.map(([k, col, l, st]) => { const p = c[k] / tot * 100; const s = p ? `<circle class="arc" pathLength="100" cx="18" cy="18" r="15.5" fill="none" style="stroke:var(--${col})" stroke-width="4.2" stroke-dasharray="${p} ${100 - p}" stroke-dashoffset="${-off}" transform="rotate(-90 18 18)" data-st="${st}"><title>${l}: ${c[k]} (${Math.round(p)}%)</title></circle>` : ''; off += p; return s; }).join('') : '';
  return `<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" style="stroke:var(--line2)" stroke-width="4.2"/>${arcs}<circle cx="18" cy="18" r="12.4" style="fill:var(--bg)"/><text x="18" y="17.6" text-anchor="middle" font-size="7.5" font-weight="700" style="fill:var(--ink)">${pct}%</text><text x="18" y="23" text-anchor="middle" font-size="3" letter-spacing=".3" style="fill:var(--mut)">SUBMITTED</text></svg>`;
}
// open the status report filtered to one status (and the team chosen on Home)
function openReport(status) { RF.status = status || ''; RF.team = S.hteam || ''; RF.manager = ''; location.hash = '#/report'; }
const pctOf = (n, tot) => tot ? Math.round(n / tot * 100) : 0;
const initials = n => esc(n.split(' ').map(x => x[0]).join('').slice(0, 2));
const winBadge = t => t.state === 'closed' ? '<span class="badge b-blue">Closed</span>'
  : t.collected === t.total && t.total ? `<span class="badge b-green">${t.collected} of ${t.total} dates</span>` : `<span class="badge b-amber">${t.collected} of ${t.total} dates</span>`;
const winText = w => w.state === 'open' ? `open until ${fmtD(w.end)}` : w.state === 'upcoming' ? `opens ${fmtD(w.start)} (in ${w.days} day${w.days === 1 ? '' : 's'})` : `closed on ${fmtD(w.end)}`;
const widget = (icon, title, extra, body, cls = '') => `<div class="m ${cls}"><div class="mh">${ico(icon)}<b>${title}</b>${extra || ''}</div>${body}</div>`;

// segmented control: the navy pill slides to the active chip
function placeInd() { const seg = $('#seg'); if (!seg) return; const on = seg.querySelector('.chip.on'), ind = seg.querySelector('.seg-ind'); if (on && ind) { ind.style.left = on.offsetLeft + 'px'; ind.style.width = on.offsetWidth + 'px'; } }
window.addEventListener('resize', placeInd);

pages.home = async (v, opts = {}) => {
  if (typeof opts !== 'object') opts = {};
  const mgr = S.me.role !== 'employee';
  const d = await api(`/home?month=${S.month}&team=${encodeURIComponent(mgr ? S.hteam || '' : '')}`);
  const c = d.counts, pct = pctOf(c.submitted, c.scheduled), month = d.label.split(' ')[0];
  let html = null;
  if (mgr) {
    const q = d.quick, teams = d.teams, att = d.attention, SHOW = 8;
    const quick = [
      ['calendar', '', 'Scheduling', '#/scheduling', `${q.datesCollected} of ${q.datesTotal} dates collected`],
      ['chart', 'y', 'Status report', '#/report', 'Org and team views'],
      ['mail', 'g', 'Manager emails', '#/emails', q.emails.sent ? `${q.emails.sent} sent · ${q.emails.drafts} draft${q.emails.drafts === 1 ? '' : 's'}` : q.emails.drafts ? `${q.emails.drafts} draft${q.emails.drafts === 1 ? '' : 's'} ready` : 'No drafts yet'],
      S.me.role === 'admin' ? ['idcard', 'r', 'Employees', '#/employees', `${q.employees.active} active · ${q.employees.inactive} inactive`] : ['team', 'r', 'Team reviews', '#/team', `${q.teamReviews} review${q.teamReviews === 1 ? '' : 's'} in your scope`],
    ];
    const nw = d.nextWindow, windowFact = nw.state === 'open' ? `${esc(nw.team)} · closes ${fmtD(nw.date)}` : nw.state === 'upcoming' ? `${esc(nw.team)} · opens ${fmtD(nw.date)}` : 'All windows closed';
    const hero = `<div class="hero"><div class="ring">${ringSvg(pct)}<b>${c.submitted}<small>OF ${c.scheduled} DONE</small></b></div>
      <div><div class="hm">${esc(d.label)}${S.hteam ? ' · ' + esc(S.hteam) : ''}</div><div class="ht">${esc(month)} reviews</div><div class="facts">
        <div><small>Review window</small><b>${windowFact}</b></div>
        <div><small>Dates collected</small><b>${q.datesCollected} / ${q.datesTotal}</b></div>
        <div><small>Past due</small><b>${c.pending}</b></div>
        <div><small>Manager emails</small><b>${q.emails.sent} of ${q.emails.total} sent</b></div></div></div></div>`;
    const chips = `<div class="chips"><div class="seg noanim" id="seg"><i class="seg-ind"></i><button class="chip ${S.hteam ? '' : 'on'}" data-team="">All teams</button>${teams.map(t => `<button class="chip ${S.hteam === t.team ? 'on' : ''}" data-team="${esc(t.team)}">${esc(t.team)}</button>`).join('')}</div><span class="sp"></span>${monthSel()}</div>`;
    const kpi = (cls, st, icon, label, n, sub) => `<div class="stat ${cls}" data-st="${st}" role="button" tabindex="0" title="Open the status report"><small>${label}</small><b>${n}</b><span>${sub}</span><i class="wm">${ico(icon)}</i></div>`;
    const share = n => `${pctOf(n, c.scheduled)}% of scheduled`;
    const body = `<div class="stats">${kpi('n', '', 'calendar', 'Scheduled', c.scheduled, `Across ${S.hteam ? '1 team' : `${teams.length} team${teams.length === 1 ? '' : 's'}`}`)}${kpi('g', 'Completed and Submitted', 'check', 'Submitted', c.submitted, share(c.submitted))}${kpi('a', 'Completed but Not Submitted', 'draft', 'Not submitted', c.notSubmitted, share(c.notSubmitted))}${kpi('r', 'Review Not Completed', 'alert', 'Not completed', c.notCompleted, share(c.notCompleted))}${kpi('b', 'Pending', 'hourglass', 'Pending', c.pending, share(c.pending))}</div>
    <div class="wgrid">
      ${widget('clock', 'Review completion', '<a class="more" href="#/report">Report</a>', `<div class="mb donut">${donutSvg(c)}<div class="legend">${STATUS_SEGS.map(([k, col, l, st]) => `<button type="button" class="lg" data-st="${st}" title="Show ${l.toLowerCase()} reviews"><i style="background:var(--${col})"></i>${l}<b>${c[k]}</b><span class="p">${pctOf(c[k], c.scheduled)}%</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>`).join('')}</div></div>`)}
      ${widget('chart', 'Team-wise progress', '<a class="more" href="#/report">Team view</a>', `<div class="mb">${teams.length ? teams.map(t => `<div class="tbar"><span class="n" title="${esc(t.team)}">${esc(t.team)}</span><div class="tr" title="${t.submitted} submitted, ${t.notSubmitted} not submitted, ${t.pending} pending, ${t.notCompleted} not completed"><i style="width:${pctOf(t.submitted, t.scheduled)}%;background:var(--grn)"></i><i style="width:${pctOf(t.notSubmitted, t.scheduled)}%;background:var(--amb)"></i><i style="width:${pctOf(t.pending, t.scheduled)}%;background:var(--blu)"></i></div><b>${t.submitted}/${t.scheduled}</b></div>`).join('') + `<div class="legend inline"><div><i style="background:var(--grn)"></i>Submitted</div><div><i style="background:var(--amb)"></i>Not submitted</div><div><i style="background:var(--blu)"></i>Pending</div><div><i style="background:var(--navybg);border:1px solid var(--line)"></i>Not completed</div></div>` : '<div class="empty">No teams in your scope.</div>'}</div>`)}
      ${widget('bolt', 'Quick actions', '', `<div class="mb quick">${quick.map(([i, cls, t, h, s]) => `<a class="${cls}" href="${h}">${ico(i)}${t}<span title="${esc(s)}">${esc(s)}</span></a>`).join('')}</div>`)}
    </div>
    <div class="wgrid">
      ${widget('alert', 'Needs your attention', `<span class="cnt">${att.length}</span>${att.length > SHOW ? '<a class="more" href="#/report">See all</a>' : ''}`, att.length ? `<div class="mb flush">${att.slice(0, SHOW).map(a => `<div class="lrow"><span class="avatar s">${initials(a.name)}</span><div class="t"><b>${esc(a.name)}</b><span>${esc(a.team)} · ${esc(a.issue)}${a.more ? ` · +${a.more} more` : ''}${a.reschedules ? ` · rescheduled ${a.reschedules}×` : ''}</span></div>${badge(a.status)}<a class="btn sm" href="#/form/${a.empId}/${S.month}">Open form</a></div>`).join('')}</div>` : `<div class="mb"><div class="ok" style="margin:0">Nothing needs attention${S.hteam ? ' in ' + esc(S.hteam) : ''}.</div></div>`, 'w8')}
      <div class="m" style="box-shadow:none;background:none;gap:14px">
             ${widget('calendar', 'Review windows', '', `<div class="mb" style="padding-top:6px">${teams.map(t => `<div class="win"><b title="${esc(t.team)}">${esc(t.team)}</b><span>${fmtD(t.window.start)} to ${fmtD(t.window.end)}</span>${winBadge(t)}</div>`).join('') || '<div class="empty">No review windows.</div>'}${d.tips.map(t => `<div class="tip"><b>Tip</b> ${esc(t)}</div>`).join('')}</div>`, 'w12')}
      </div>
    </div>`;
    if (v.querySelector('#hShell') && opts.partial) {
      $('#hHero').innerHTML = hero;
      $('#hBody').innerHTML = body;
    } else {
      v.innerHTML = `<div id="hShell"><div id="hHero">${hero}</div><div id="hChips">${chips}</div><div id="hBody">${body}</div></div>`;
      placeInd(); requestAnimationFrame(() => $('#seg')?.classList.remove('noanim')); document.fonts?.ready.then(placeInd);
    }
  } else {
    const o = d.own, w = d.window;
    const issues = o ? o.issues : [];
    html = `<div class="hero"><div class="ring">${ringSvg(o && o.submitted ? 100 : 0)}<b>${o ? (o.submitted ? '✓' : issues.length) : '0'}<small>${o ? (o.submitted ? 'SUBMITTED' : `OPEN ITEM${issues.length === 1 ? '' : 'S'}`) : 'NO FORM'}</small></b></div>
      <div><div class="hm">${esc(d.label)} · ${esc(S.me.team || '')}</div><div class="ht">My ${esc(month)} review</div><p>${o && o.scheduled ? `Scheduled ${fmtD(o.scheduled)}${o.time ? ', ' + fmtT(o.time) : ''}${o.invite ? ' · invite in your Google Calendar' : ''}` : 'Not scheduled yet'} · ${esc(S.me.team || 'Review')} window ${winText(w)}</p></div>
      <div class="acts">${o && o.zoom ? `<a class="btn ghost" href="${esc(o.zoom)}" target="_blank" rel="noopener">${ico('video')}Join Zoom</a>` : ''}<a class="btn yel" href="#/form/${S.me.id}/${S.month}">Open my review</a></div></div>
    <div class="chips"><span class="sp"></span>${monthSel()}</div>
    <div class="stats"><div class="stat ${o ? ({ 'Completed and Submitted': 'g', 'Completed but Not Submitted': 'a', 'Review Not Completed': 'r', Pending: 'b' }[o.status] || 'n') : 'n'}"><small>Review status</small><b class="bd">${o ? badge(o.status) : 'N/A'}</b><span>${o && o.submitted ? 'Submitted by your manager' : 'Updates as the form is filled'}</span><i class="wm">${ico('review')}</i></div><div class="stat n"><small>Scheduled date</small><b>${o && o.scheduled ? fmtD(o.scheduled) : 'N/A'}</b><span>${o && o.reschedules ? `Rescheduled ${o.reschedules}×` : o && o.time ? fmtT(o.time) + ' · set by your manager' : o && o.scheduled ? 'Set by your manager' : 'Not scheduled yet'}</span><i class="wm">${ico('calendar')}</i></div><div class="stat t"><small>Review date</small><b>${o && o.reviewDate ? fmtD(o.reviewDate) : 'N/A'}</b><span>${o && o.reviewDate ? esc(o.due) : 'Entered on the form'}</span><i class="wm">${ico('clock')}</i></div><div class="stat v"><small>Monthly rating</small><b>${o ? (o.rating ?? o.preview ?? 'N/A') : 'N/A'}</b><span>${o && o.rating != null ? 'Final' : o && o.preview != null ? 'Preview until submitted' : 'Needs all ratings'}</span><i class="wm">${ico('chart')}</i></div></div>
    <div class="wgrid">
      ${widget(o && o.submitted ? 'check' : 'alert', o && o.submitted ? 'Review submitted' : 'What is left on my form', issues.length ? `<span class="cnt">${issues.length}</span>` : '', `<div class="mb">${o ? (issues.length ? `<ul class="issues">${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : `<div class="ok" style="margin:0">${o.submitted ? 'Your manager has submitted this review. Nothing left to do.' : 'Everything is filled in. Your manager can now submit the review.'}</div>`) : '<div class="empty">No review form for this month.</div>'}${o && !o.submitted ? `<div style="margin-top:14px"><a class="btn pri" href="#/form/${S.me.id}/${S.month}">Open my review</a></div>` : ''}</div>`, 'w8')}
      ${widget('calendar', 'Review window', '', `<div class="mb"><div style="font-size:22px;font-weight:700;letter-spacing:-.02em">${fmtD(w.start)} to ${fmtD(w.end)}</div><div class="small" style="margin-top:2px">${esc(S.me.team || '')} team · ${winText(w)}</div><div class="tip"><b>Tip</b> Ratings count 30% self and 70% manager, weighted by sub-KRA then KRA. When your manager's rating differs from yours, they add a remark.</div></div>`)}
    </div>`;
  }
  if (html != null) v.innerHTML = html;
  onMonth(() => pages.home(v));
  v.onclick = e => {
    const b = e.target.closest('[data-team]');
    if (b) {
      if (b.classList.contains('on')) return;
      const chips = [...v.querySelectorAll('.chip')], from = chips.findIndex(x => x.classList.contains('on')), to = chips.indexOf(b);
      chips.forEach(x => x.classList.toggle('on', x === b)); placeInd();
      S.hteam = b.dataset.team; return pages.home(v, { partial: true, dir: to > from ? 1 : -1 });
    }
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
    const wavg = key => { const w = rows.filter(r => r[key] != null); const tw = w.reduce((a, r) => a + (+r.weight || 0), 0); return tw ? Math.round(w.reduce((a, r) => a + r.weight * r[key], 0) / tw * 10) / 10 : 0; };
    const sr = wavg('self'), mr = wavg('mgr'), calc = Math.round((0.3 * sr + 0.7 * mr) * 10) / 10;
    const head = `<div class="kra" id="sec-${k}">${label} : ${desc}</div>
      <div class="row" style="margin:10px 0 6px"><b>Weightage Of KRA:</b> ${ed ? `<input class="num" type="number" data-kw="${k}" value="${kr.weight}"> <span title="editable">✎</span>` : kr.weight}
      ${ed && rows.length ? `<span class="badge ${sum === +kr.weight ? 'b-green' : 'b-red'}">Sub-KRA total ${sum} / ${kr.weight}</span>` : ''}</div>`;
    const btns = ed ? `<div class="row" style="margin-top:10px"><button class="btn sm" data-add="${k}" title="Add sub-KRA">+ Add sub-KRA</button><button class="btn pri sm" data-savek="${k}">Save ${label} KRA</button></div>` : '';
    if (!rows.length) return head + `<div class="${FP.newJoiner ? 'info' : 'warn'}">${FP.newJoiner ? 'New joiner: no KRAs set yet. Only the questionnaire is checked.' : `${label} KRA is not set.`}</div>` + btns;
    return head + `<div class="tablewrap"><table class="krat"><colgroup><col style="width:56px"><col><col style="width:110px"><col style="width:96px"><col style="width:100px"><col style="width:112px"><col style="width:21%"><col style="width:21%"></colgroup><tr><th>Sr.No</th><th>Key Performance Indicator</th><th>Target</th><th>Weightage</th><th>Self Rating (30%)</th><th>Management Rating (70%)</th><th>Remark</th><th>Manager Remark</th></tr>
    ${rows.map((r, i) => {
      const diff = r.self != null && r.mgr != null && +r.self !== +r.mgr, needRemark = diff && !(r.mgrRemark || '').trim();
      const needSelf = attempted && (r.self == null || !(r.selfRemark || '').trim());
      return `<tr><td>${ed ? `<button class="xdel" data-del="${k}:${i}" title="Remove sub-KRA">✖</button> ` : ''}${i + 1}</td>
      <td>${ed ? `<textarea rows="2" data-k="${k}" data-i="${i}" data-f="kpi">${esc(r.kpi)}</textarea>` : esc(r.kpi)}</td>
      <td>${ed ? `<textarea rows="2" data-k="${k}" data-i="${i}" data-f="target">${esc(r.target)}</textarea>` : esc(r.target)}</td>
      <td>${ed ? `<input class="num" type="number" data-k="${k}" data-i="${i}" data-f="weight" value="${r.weight}">` : r.weight}</td>
      <td>${rateSel(r.self, `data-k="${k}" data-i="${i}" data-f="self"`, p.editSelf, `${r.self != null ? 'filled' : ''} ${needSelf && r.self == null ? 'err' : ''}`)}</td>
      <td>${rateSel(r.mgr, `data-k="${k}" data-i="${i}" data-f="mgr"`, p.editManager, r.mgr != null ? 'filled' : '')}</td>
      <td><textarea class="${needSelf && !(r.selfRemark || '').trim() ? 'err' : ''}" rows="2" data-k="${k}" data-i="${i}" data-f="selfRemark" ${p.editSelf ? '' : 'disabled'}>${esc(r.selfRemark)}</textarea></td>
      <td><textarea class="${needRemark ? 'err' : ''}" rows="2" data-k="${k}" data-i="${i}" data-f="mgrRemark" ${p.editManager ? '' : 'disabled'}>${esc(r.mgrRemark)}</textarea>
      ${needRemark ? '<div class="flag">Manager remarks are required because there is a difference between the employee\'s self-rating and the manager\'s rating.</div>' : ''}</td></tr>`;
    }).join('')}
    <tr class="sub"><td></td><td></td><td><b>Totals</b></td><td>Weightage : ${sum}</td><td>Total SR : ${sr}</td><td>Total MR : ${mr}</td><td colspan="2">Total Calculation : ${calc}</td></tr></table></div>` + btns;
  };
  const qs = FP.questions;
  const text = qs.filter(q => q.type === 'text'), rate = qs.filter(q => q.type === 'rating');
  const noDate = !f.reviewDate && attempted;
  const pi = (FP.previewRating != null) ? `Monthly rating${FP.rating == null ? ' (preview, shown after submit)' : ''}: <b>${FP.previewRating}</b>` : 'Monthly rating: not available until all ratings are in';
  v.innerHTML = head('Monthly review form', `PMS › ${e.id === S.me.id ? 'My Review' : esc(e.name)} › ${esc(monthLabel(S.month))}`) +
    `<div class="row"><select id="msel">${S.me.months.map(m => `<option value="${m.key}" ${m.key === S.month ? 'selected' : ''}>${m.label.split(" ")[0]}</option>`).join('')}<option value="annual">Annual Review</option></select>${p.copyKras ? '<button class="btn" id="copyk">Copy KRAs from last month</button>' : ''}<span class="sp"></span>${badge(FP.status)} ${f.locked ? '<span class="badge b-grey">Locked</span>' : ''}</div>
    ${f.locked ? '<div class="info">This review is completed and submitted. The form is locked and can no longer be changed by anyone.</div>' : ''}
    <div class="formhead">KRA : ${FP.fy} ${esc(monthLabel(S.month).replace(' ', ', '))}</div>
    <div class="card" style="margin-top:8px"><div class="row" style="margin:0"><div><b>Employee Name:</b> ${esc(e.name)} (${esc(e.designation)})<br><b>Reporting Manager:</b> ${m ? esc(m.name) : 'Not assigned'}</div>
<span class="sp"></span>
    <div><label class="f" style="margin:0">Review Date <i>*</i></label><input type="date" id="reviewDate" class="${noDate ? 'err' : ''}" value="${esc(f.reviewDate)}" ${p.editSelf || p.editManager ? '' : 'disabled'}></div></div>
    ${noDate ? '<div class="warn">Review Date is mandatory. Please enter the review date before submitting the form.</div>' : ''}
    ${errors ? `<div class="warn">${errors.map(esc).join('<br>')}</div>` : ''}
    <div class="small">${pi}</div></div>
    <div class="tabs" id="tabs">${[['operational', 'Operational'], ['process', 'Process'], ['people', 'People'], ['questionnaire', 'Questionnaire']].map(([k, l], i) => `<button data-t="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</div>
    ${sec('operational', 'Operational', '(Our value addition to the client via quality/financially)')}
    ${sec('process', 'Process', '(SOP and ClickUp)')}
    ${sec('people', 'People', '(Learning)')}
    <div class="kra qa" id="sec-questionnaire">Question-Answers</div>
    <div class="tablewrap"><table style="table-layout:fixed"><colgroup><col style="width:90px"><col style="width:38%"><col></colgroup><tr><th>Serial No</th><th>Question Title</th><th>Question Answer</th></tr>${text.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.text)}</td><td>${editingQ.has(q.id) ? `<textarea data-qt="${q.id}" rows="3" placeholder="Type your answer" style="background:var(--bg)">${esc(f.qa[q.id] || '')}</textarea><div class="small">Saves automatically when you click away.</div>`
      : `<span style="white-space:pre-wrap">${f.qa[q.id] ? esc(f.qa[q.id]) : 'Not Added'}</span> ${p.editSelf || p.editManager ? `<button class="xdel" data-qedit="${q.id}" title="Edit" style="color:var(--ink)"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4"/><path d="M11 2l3 3-6 6H5V8z"/></svg></button>` : ''}`}</td></tr>`).join('')}${rate.map((q, i) => {
      const a = f.qa[q.id] || {}, diff = a.self != null && a.mgr != null && +a.self !== +a.mgr, need = diff && !(a.remark || '').trim();
      return `<tr><td>${text.length + i + 1}</td><td>${esc(q.text)} (Rate out of 5)</td><td style="padding:6px"><table style="table-layout:fixed"><tr><th style="width:104px">Self rating</th><th style="width:118px">Manager rating</th><th>Remark</th></tr><tr>
        <td>${rateSel(a.self, `data-qr="${q.id}" data-f="self"`, p.editSelf, a.self != null ? 'filled' : '')}</td>
        <td>${rateSel(a.mgr, `data-qr="${q.id}" data-f="mgr"`, p.editManager, a.mgr != null ? 'filled' : '')}</td>
        <td><textarea class="${need ? 'err' : ''}" rows="1" data-qr="${q.id}" data-f="remark" ${p.editManager ? '' : 'disabled'}>${esc(a.remark || '')}</textarea>${need ? '<div class="flag">Manager remark required: ratings differ.</div>' : ''}</td></tr></table></td></tr>`;
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
    if (e.target.id === 'reviewDate' && e.target.value && +e.target.value.slice(0, 4) < 1000) return; // still typing the year
    // employees have no Save draft button, so their entries are saved as they type
    const mine = ++changeSeq;
    if (S.me.role === 'employee' && (FP.perms.editSelf || FP.perms.editManager)) { try { await save(); } catch (er) { toast(er.message, 'err'); } }
    if (mine !== changeSeq) return; // a newer change is in flight; it will redraw (and keep any remark focus)
    // a typed date fires change after every digit, and a redraw would throw the cursor out of the field
    if (e.target.id === 'reviewDate' && e.target.value && !e.target.classList.contains('err')) return;
    const y = window.scrollY; drawForm(v); window.scrollTo(0, y);
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
  window.onscroll = () => {
    if (!$('#tabs') || Date.now() < tabHold) return;
    let cur = 0; secs.forEach((s, i) => { if (s.getBoundingClientRect().top < 140) cur = i; });
    lightTab(cur);
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
        if (!await confirmBox('Copy KRAs from last month?', 'This replaces this month\'s KRAs with last month\'s. Ratings and remarks for this month will be cleared.', { ok: 'Copy KRAs', danger: true })) return;
        FP = await post('/form/copy-kras'); toast('KRAs copied from last month'); drawForm(v);
      }
    } catch (er) { toast(er.message, 'err'); }
  };
}

// ---------- team reviews ----------
pages.team = async v => {
  const d = await api('/report?month=' + S.month);
  v.innerHTML = head('Team Reviews', 'PMS › Team Reviews') + `<div class="row">${monthSel()}</div>` + reportTable(d.rows);
  onMonth(() => pages.team(v));
};
const reportTable = rows => `<div class="tablewrap"><table><tr><th>Manager / team</th><th>Employee</th><th>Scheduled</th><th>Due</th><th>Actual</th><th>Status</th><th>Rating</th><th>Flags</th></tr>
  ${rows.map(r => `<tr><td>${esc(r.manager)} / ${esc(r.team)}</td><td>${nameLink(r.empId, r.name)}</td><td>${fmtD(r.scheduled)}</td><td>${fmtD(r.due)}</td><td>${fmtD(r.actual)}${r.actual ? `<br>${badge(r.dueStatus)}` : ''}</td><td>${badge(r.status)}</td><td>${r.rating ?? 'N/A'}</td><td class="${r.flags.length ? 'flag' : 'small'}">${r.flags.map(esc).join('<br>') || 'N/A'}</td></tr>`).join('') || '<tr><td colspan="8">No reviews in your access for this month.</td></tr>'}</table></div>`;

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
// "11:00" -> "11:00 am"
const fmtT = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const calStart = () => { location.href = `/api/auth/google/start?calendar=1&origin=${encodeURIComponent(location.origin)}`; };
pages.scheduling = async v => {
  const d = await api('/scheduling?month=' + S.month), cal = d.calendar;
  const calCard = !cal.google ? `<div class="info">Calendar invites are off on this server: Google sign-in is not set up yet. Reviews can still be scheduled here.</div>`
    : cal.connected ? `<div class="calcard on">${ico('calendar')}<div><b>Google Calendar connected</b><span>Invites go out from ${esc(cal.email)}, with the Zoom link you add. Google emails the employee, and their manager if someone else schedules.</span></div><span class="sp"></span><button class="btn sm" id="caloff">Disconnect</button></div>`
    : cal.canConnect ? `<div class="calcard">${ico('calendar')}<div><b>Send review invites to Google Calendar</b><span>Connect your calendar once. Each review you schedule then lands in the employee's calendar with the Zoom link you add.</span></div><span class="sp"></span><button class="btn pri" id="calon">Connect Google Calendar</button></div>`
    : `<div class="info">To send calendar invites, sign in with your @${esc(S.me.domain)} Google account${S.me.viewingAs ? ' (invites always come from your own calendar, not the person you are viewing as)' : ''}.</div>`;
  const inviteCell = r => r.invite
    ? `<span class="badge b-green" title="Sent by ${esc(r.invite.owner)} to ${esc(r.invite.guests.join(', '))}">Invite sent</span><div class="small">${r.invite.link ? `<a href="${esc(r.invite.link)}" target="_blank" rel="noopener">Event</a>` : ''}${r.canManage ? ` · <a href="#" data-cancel="${r.empId}">Cancel</a>` : ''}</div>`
    : !r.hasEmail ? `<span class="small" title="Add a @${esc(S.me.domain)} email on the Employees page">No work email</span>`
    : r.scheduled && r.canManage && cal.connected ? `<button class="btn sm" data-inv="${r.empId}">${ico('send')}Send invite</button>` : '<span class="small">N/A</span>';
  v.innerHTML = head('Review scheduling', 'PMS › Scheduling') + `<div class="row">${monthSel()}<span class="sp"></span><span class="small">Pick a date and time for each review. Rescheduling moves the calendar invite too.</span></div>
  ${calCard}
  <h2>Review windows</h2><div class="tablewrap"><table><tr><th>Team</th><th>Window</th><th>Dates collected on</th><th>Scheduled</th>${d.canEditWindows ? '<th></th>' : ''}</tr>${d.windows.map(w => `<tr><td>${esc(w.team)}</td><td>${fmtD(w.start)} to ${fmtD(w.end)}</td><td>${fmtD(w.collectedOn)}</td><td><span class="badge ${w.collected === w.total ? 'b-green' : 'b-amber'}">${w.collected} of ${w.total}</span></td>${d.canEditWindows ? `<td style="text-align:right"><button class="btn sm" data-win="${esc(w.team)}">Edit</button></td>` : ''}</tr>`).join('')}</table></div>
  <h2>Team members</h2><div class="tablewrap"><table><tr><th>Employee</th><th>Team</th><th>Review slot</th><th>Calendar invite</th><th>Rescheduled</th><th>Actual date (from form)</th><th>Status</th></tr>
  ${d.rows.map(r => `<tr><td>${nameLink(r.empId, r.name)}</td><td>${esc(r.team)}</td>
  <td>${r.scheduled ? `<b>${fmtD(r.scheduled)}</b>${r.time ? ` <span class="small">${fmtT(r.time)}</span>` : ''}${r.canManage ? ` <button class="btn sm" data-resch="${r.empId}">Reschedule</button>` : ''}${r.zoom ? `<div class="small"><a href="${esc(r.zoom)}" target="_blank" rel="noopener">Zoom link</a></div>` : ''}` : r.canManage ? `<button class="btn sm pri" data-sch="${r.empId}">${ico('calendar')}Schedule</button>` : '<span class="small">Not scheduled</span>'}</td>
  <td>${inviteCell(r)}</td>
  <td>${r.reschedules ? `${r.reschedules}× <span class="small">${r.history.map(h => fmtD(h.from)).join(' → ')} → ${fmtD(r.scheduled)}</span>` : 'N/A'}</td>
  <td>${r.actual ? `${fmtD(r.actual)} ${badge(r.dueStatus)}` : '<span class="small">Not held yet</span>'}</td><td>${badge(r.status)}</td></tr>`).join('') || '<tr><td colspan="7">No reviews in your access for this month.</td></tr>'}</table></div>
  <p class="small">The actual date is the Review Date entered on the employee's monthly form. Reports use the scheduled (or rescheduled) date from this page and the actual date from the form.</p>`;
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
  // admin: change a team's review window (day of month, applies to every month)
  const winDialog = w => {
    const m = modal(`<h2>Edit review window: ${esc(w.team)}</h2><div id="er"></div>
      <div class="row" style="align-items:flex-end;margin:0"><div><label class="f">From day <i>*</i></label><input class="num" type="number" min="1" max="31" id="ws" value="${w.startDay}"></div>
      <div><label class="f">To day <i>*</i></label><input class="num" type="number" min="1" max="31" id="we" value="${w.endDay}"></div></div>
      <p class="small">Day of the month, used for every month. In shorter months the window ends on the last day. Dates are collected 3 days before the window opens.</p>
      <div class="row"><button class="btn pri" id="ok">Save window</button><button class="btn" id="no">Cancel</button></div>`);
    m.querySelector('#no').onclick = () => m.remove();
    m.querySelector('#ok').onclick = async () => {
      try { await api('/windows', { method: 'PUT', body: { team: w.team, start: +m.querySelector('#ws').value, end: +m.querySelector('#we').value } }); m.remove(); toast('Review window saved'); pages.scheduling(v); }
      catch (er) { m.querySelector('#er').innerHTML = errBox(er); }
    };
  };
  v.onclick = async e => {
    const t = e.target.closest('button, a'); if (!t) return;
    try {
      if (t.dataset.win) winDialog(d.windows.find(w => w.team === t.dataset.win));
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
  const list = await api('/emails?month=' + S.month);
  v.innerHTML = head('Manager emails', 'PMS › Reports and Export › Email preview') + `<div class="row">${monthSel()}<button class="btn yel" id="gen">Generate emails</button><span class="small">Local demo: "Send now" records the email in the audit log; no real mail is sent. Emails are never sent automatically.</span></div>
  <div class="row" style="align-items:flex-start"><div class="card" style="min-width:230px">${list.map(m => `<div class="row" style="margin:0 0 6px"><a href="#/emails" data-m="${m.managerId}" style="color:var(--navy);font-weight:600;cursor:pointer">${esc(m.name)}</a><span class="small">${esc(m.team)}</span><span class="sp"></span><span class="badge ${m.state === 'sent' ? 'b-green' : m.state === 'draft' ? 'b-amber' : 'b-grey'}">${m.state}</span></div>`).join('') || 'No teams in your access.'}</div><div class="sp" id="prev" style="min-width:300px"></div></div>`;
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
  const a = { ...d.annual }, p = d.perms;
  const list = ['manager', 'teamlead', 'director', 'admin'].includes(S.me.role) ? (await api('/report?month=' + S.me.currentMonth)).rows : [];
  v.innerHTML = head('Annual review', `PMS › Annual Review › ${esc(d.employee.name)} · ${d.fy}`) +
    `${list.length ? `<div class="row"><select id="who"><option value="${S.me.id}">Myself</option>${list.map(r => `<option value="${r.empId}" ${r.empId === d.employee.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>` : ''}
  <h2>One-page summary <span class="small">(${d.months.filter(m => m.filled).length} of 12 months filled; fills as each monthly review finishes)</span></h2>
  <div class="row"><b>${esc(d.employee.name)}</b> (${esc(d.employee.designation)}) · ${d.fy} (April 2026 to March 2027)<span class="sp"></span><button class="btn yel" onclick="window.print()">Download PDF (print)</button></div>
  <div class="tablewrap"><table><tr><th>Month</th><th>KRA weightage (Op / Pro / Peo)</th><th>Work summary</th><th>Self</th><th>Manager</th><th>Monthly rating</th><th>Learnings, SOPs</th><th>Highlights and gaps</th></tr>
  ${d.months.map(m => m.filled ? `<tr><td>${esc(m.label.split(' ')[0])}</td><td title="${esc(m.subKras.join(' | '))}">${m.weightage}</td><td>${esc(m.work)}<div class="small">${esc(m.selfRemarks[0] || '')}</div></td><td>${m.self ?? 'N/A'}</td><td>${m.mgr ?? 'N/A'}<div class="small">${esc(m.mgrRemarks[0] || '')}</div></td><td>${m.rating ?? 'N/A'}</td><td class="small">${m.learn.length ? 'Learning: ' + esc(m.learn.join(', ')) + '<br>' : ''}${m.sop.length ? 'SOP: ' + esc(m.sop.join(', ')) : ''}</td><td class="flag">${m.highlights.map(esc).join('<br>') || 'N/A'}</td></tr>` : `<tr><td>${esc(m.label.split(' ')[0])}</td><td colspan="7" class="small">Fills in automatically as each monthly review finishes.</td></tr>`).join('')}</table></div>
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
  // admins also get the questionnaire editor below the parameters (own box, so a question save keeps unsaved parameter edits)
  v.innerHTML = '<div id="pbox"></div>' + (admin ? '<div id="qbox"></div>' : '');
  const pb = $('#pbox');
  const draw = (dirty) => {
    pb.innerHTML = head('Parameters Summary', 'PMS › Parameters Summary' + (admin ? ' (admin view)' : '')) + `<div class="row">${monthSel()}<span class="small">Version applying from ${esc(monthLabel(d.from) || d.from)}</span><span class="sp"></span>${admin ? `<button class="btn yel" data-a="addsec">+ Add section</button>` : ''}</div>
    ${P.sections.map((s, si) => `<div class="card pcard"><div class="phead"><b class="ptitle"><i class="pico">${ico(paramIcon(s.title))}</i>${esc(s.title)}:</b>${admin ? `<span class="acts"><button class="btn sm" data-a="editsec" data-s="${si}">Edit section</button><button class="btn sm dng" data-a="delsec" data-s="${si}">Delete section</button></span>` : ''}</div>
      ${s.items.map((it, ii) => `<div class="pitem"><span class="pn">${ii + 1}.</span><span class="pt">${esc(it)}</span>${admin ? `<span class="acts"><button class="btn sm" data-a="edit" data-s="${si}" data-i="${ii}">Edit</button><button class="btn sm dng" data-a="del" data-s="${si}" data-i="${ii}">Delete</button></span>` : ''}</div>`).join('')}
      ${admin ? `<div style="padding-top:10px"><button class="btn sm pri" data-a="add" data-s="${si}">+ Add item</button></div>` : ''}</div>`).join('')}
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
  if (admin) await questionsBox($('#qbox'));
};

// ---------- questionnaire (admin, shown inside Parameters Summary) ----------
pages.questions = () => location.replace('#/params'); // old link
async function questionsBox(v) {
  const qs = await api('/questions');
  const tab = S.qtab || 'text';
  const list = qs.filter(q => q.type === tab && !q.to).sort((a, b) => a.order - b.order);
  v.innerHTML = `<div class="card pcard"><div class="phead"><b class="ptitle"><i class="pico">${ico('question')}</i>Questionnaire (monthly review form):</b><span class="acts"><button class="btn sm yel" data-a="new">+ Add New Question</button></span></div>
  <div class="row"><button class="btn ${tab === 'text' ? 'pri' : ''}" data-tab="text">Questions 1 to 5 (text answers)</button><button class="btn ${tab === 'rating' ? 'pri' : ''}" data-tab="rating">Questions 6 to 12 (ratings)</button></div>
  <div class="tablewrap"><table><tr><th>No.</th><th>Question</th><th>Answer type</th><th>Mandatory</th><th>Applies from</th><th>Actions</th></tr>${list.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.text)}</td><td>${q.type === 'text' ? 'Text answer' : 'Rating (0 to 5)'}</td><td>${q.mandatory ? 'Yes' : 'No'}</td><td>${esc(monthLabel(q.from) || q.from)}</td><td><span class="acts"><button class="btn sm" data-a="up" data-id="${q.id}" title="Move up">↑</button><button class="btn sm" data-a="down" data-id="${q.id}" title="Move down">↓</button><button class="btn sm" data-a="edit" data-id="${q.id}">Edit</button><button class="btn sm dng" data-a="del" data-id="${q.id}">Delete</button></span></td></tr>`).join('')}</table></div>
  <p class="small">Changes apply from the review month you choose. Forms already submitted keep the question and answers as they were. No limit on the number of questions.</p></div>`;
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
    if (a === 'new') dialog('Add New Question');
    if (a === 'edit') dialog('Edit question', qs.find(q => q.id === t.dataset.id));
    if (a === 'up' || a === 'down') { await api('/questions/move', { method: 'POST', body: { id: t.dataset.id, dir: a } }); questionsBox(v); }
    if (a === 'del') {
      const q = qs.find(x => x.id === t.dataset.id);
      const m = modal(`<h2>Delete question?</h2><p>${esc(q.text)}</p><div class="warn">New forms from the chosen month will no longer show this question. Answers already submitted are kept and stay visible in past forms.</div><label class="f">Delete from <i>*</i></label>${monthSelHtml(S.me.currentMonth)}<div class="row" style="margin-top:12px"><button class="btn dng" id="ok">Delete question</button><button class="btn" id="no">Cancel</button></div>`);
      m.querySelector('#no').onclick = () => m.remove();
      m.querySelector('#ok').onclick = async () => { await api('/questions/delete', { method: 'POST', body: { id: q.id, from: m.querySelector('#eff').value } }); m.remove(); questionsBox(v); };
    }
  };
};

// ---------- employees (admin) ----------
pages.employees = async v => {
  const d = await api('/employees'), st = d.stats;
  // the stat tiles on top double as filters: active/inactive and, for active people, the kind of role
  const ROLEF = { director: ['director'], manager: ['manager', 'teamlead'], employee: ['employee'] };
  const tab = S.etab || 'active', q = (S.eq || '').toLowerCase(), fl = S.eteam || '', rf = tab === 'active' && ROLEF[S.erole] ? S.erole : '';
  const rows = (tab === 'active' ? d.active : d.inactive).filter(e => (!q || e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q) || (e.email || '').includes(q)) && (!fl || e.team === fl) && (!rf || ROLEF[rf].includes(e.role)));
  const dom = '@' + S.me.domain, noEmail = d.active.filter(e => !e.email).length, ed = tab === 'active';
  const tile = (key, cls, n, label, on, hint) => `<button class="tile stat ${cls} ${on ? 'on' : ''}" data-stat="${key}" title="${hint}"><b>${n}</b><span>${label}</span></button>`;
  const shown = tab === 'inactive' ? 'Inactive members' : { director: 'Directors', manager: 'Managers and team leads', employee: 'Executives and interns' }[rf] || 'All active members';
  const opts = (list, cur) => [...new Set([...list, cur])].filter(Boolean).map(x => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const mgrOpts = e => {
    const list = d.managers.filter(x => x.id !== e.id);
    if (e.managerId && !list.some(x => x.id === e.managerId)) list.push({ id: e.managerId, name: e.manager }); // keep a current manager who is no longer in the list
    return '<option value="">No manager</option>' + list.map(x => `<option value="${x.id}" ${x.id === e.managerId ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  };
  const cell = (e, f, html, text) => ed ? `<select class="cell" data-f="${f}" data-id="${e.id}" aria-label="${f === 'managerId' ? 'Reporting manager' : f} for ${esc(e.name)}">${html}</select>` : esc(text);
  v.innerHTML = head('Employees', 'PMS › Employees (admin view) · change team, designation or manager right in the table') + `<div class="tiles stats">
    ${tile('all', '', st.members, 'Active members', tab === 'active' && !rf, 'Show all active members')}
    ${tile('director', 'b', st.directors, 'Directors', rf === 'director', 'Show directors')}
    ${tile('manager', 'g', st.managers, 'Managers and team leads', rf === 'manager', 'Show managers and team leads')}
    ${tile('employee', 'a', st.executives, 'Executives and interns', rf === 'employee', 'Show executives and interns')}
    ${tile('inactive', 'r', st.inactive, 'Inactive', tab === 'inactive', 'Show inactive members')}
    ${tile('questions', '', st.questions, 'Review questions', false, 'Open the questionnaire in Parameters Summary')}</div>
  <div class="row"><b>${shown} (${rows.length})</b><input id="eq" placeholder="Search by name, code or email…" value="${esc(S.eq || '')}" style="width:270px"><select id="et"><option value="">All teams</option>${d.teams.map(t => `<option ${t === fl ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><span class="sp"></span><a class="btn" href="#/reporting${{ manager: '/managers', employee: '/employees' }[rf] || ''}" title="See who reports to whom: directors, then their managers, then their employees">${ico('sitemap')}Reporting flow</a><button class="btn yel" data-a="add">+ Add new member</button></div>
  ${tab === 'active' && noEmail ? `<div class="info">${noEmail} active ${noEmail === 1 ? 'person has' : 'people have'} no work email yet. People sign in with their ${esc(dom)} Google account, and calendar invites go to that address, so add it with Edit.</div>` : ''}
  <div class="tablewrap"><table><tr><th>Employee</th><th>Team</th><th>Designation</th><th>Reporting manager</th>${tab === 'active' ? '' : '<th>Inactive from</th>'}<th>Active</th><th>Actions</th></tr>
  ${rows.map(e => `<tr><td><a href="#/empforms/${e.id}" style="color:var(--navy);font-weight:600;white-space:nowrap">${esc(e.name)}</a><div class="small" style="max-width:220px;overflow-wrap:anywhere">${esc(e.code)} · ${e.email ? esc(e.email) : 'No work email'}</div></td>
  <td>${cell(e, 'team', opts(d.teams, e.team), e.team)}</td>
  <td>${cell(e, 'designation', opts(d.designations, e.designation) + '<option value="__new">Other…</option>', e.designation)}</td>
  <td>${cell(e, 'managerId', mgrOpts(e), e.manager || 'No manager')}</td>
  ${tab === 'active' ? '' : `<td><span style="white-space:nowrap">${fmtY(e.inactiveFrom)}</span><div class="small">${esc(e.reason || '')}</div></td>`}
  <td><button class="sw ${e.active ? 'on' : ''}" role="switch" aria-checked="${e.active}" aria-label="${esc(e.name)} active" data-a="${e.active ? 'off' : 'on'}" data-id="${e.id}" data-n="${esc(e.name)}" title="${e.active ? 'Active. Click to move to inactive.' : 'Inactive. Click to reactivate.'}"><i></i></button></td>
  <td><span class="acts"><a class="btn sm" href="#/empforms/${e.id}">${tab === 'active' ? 'Monthly report' : 'Past forms'}</a><button class="btn sm" data-a="edit" data-id="${e.id}">Edit</button></span></td></tr>`).join('') || `<tr><td colspan="${tab === 'active' ? 6 : 7}">No one matches.</td></tr>`}</table></div>
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
    const t = e.target.closest('[data-a], [data-stat]') || e.target, a = t.dataset.a;
    if (t.dataset.stat) {
      const k = t.dataset.stat;
      if (k === 'questions') { location.hash = '#/params'; return; }
      S.etab = k === 'inactive' ? 'inactive' : 'active'; S.erole = ['director', 'manager', 'employee'].includes(k) ? k : '';
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
      const m = modal(`<h2>Move ${esc(t.dataset.n)} to inactive?</h2><div id="er"></div><p class="small">From the chosen date the employee is left out of review schedules, status counts, reports and manager emails. Past forms stay available.</p>
      <label class="f">Inactive from <i>*</i></label><input type="date" id="d"><label class="f">Reason <i>*</i></label><select id="r"><option>Resigned</option><option>Transferred out</option><option>Contract ended</option><option>Other</option></select><label class="f">Note (optional)</label><textarea id="note"></textarea>
      <div class="row"><button class="btn dng" id="ok">Move to inactive</button><button class="btn" id="no">Cancel</button></div>`);
      m.querySelector('#no').onclick = () => m.remove();
      const go = async confirmed => { try { const r = await api('/employees/inactive', { method: 'POST', body: { id: t.dataset.id, date: m.querySelector('#d').value, reason: m.querySelector('#r').value, note: m.querySelector('#note').value, confirm: confirmed } }); if (r.needsConfirm) { m.querySelector('#er').innerHTML = `<div class="warn">${esc(r.warning)} Click again to confirm.</div>`; m.querySelector('#ok').onclick = () => go(true); return; } m.remove(); pages.employees(v); } catch (er) { m.querySelector('#er').innerHTML = errBox(er); } };
      m.querySelector('#ok').onclick = () => go(false);
    }
    if (a === 'on' && await confirmBox(`Reactivate ${t.dataset.n}?`, 'They can sign in again and are counted in schedules, reports and emails from today.', { ok: 'Reactivate' })) { await api('/employees/reactivate', { method: 'POST', body: { id: t.dataset.id } }); toast('Reactivated'); pages.employees(v); }
  };
};

pages.empforms = async (v, id) => {
  const d = await api('/employee-forms?emp=' + id), e = d.employee;
  v.innerHTML = head('Employee: monthly forms', `PMS › Employees › ${esc(e.name)}`) + `<div class="card"><b>${esc(e.name)}</b> (${esc(e.designation)}) · Code ${esc(e.code)} · Team ${esc(e.team)} · Manager ${esc(e.manager)} · Joined ${esc(e.joined)} <span class="badge ${e.active ? 'b-green' : 'b-grey'}">${e.active ? 'Active' : 'Inactive'}</span> · FY 2026-2027</div>
  <div class="tablewrap"><table><tr><th>Month</th><th>Review date</th><th>Status</th><th>Manager rating</th><th>Form</th></tr>${d.rows.map(r => `<tr style="${r.open ? '' : 'opacity:.55'}"><td>${esc(r.label)}</td><td>${fmtD(r.reviewDate)}</td><td>${badge(r.status)}</td><td>${r.rating ?? 'N/A'}</td><td>${r.open ? `<a class="btn sm yel" href="#/form/${e.id}/${r.month}">Open form</a>` : '<button class="btn sm" disabled>Open form</button>'}</td></tr>`).join('')}
  <tr><td><b>Annual Review 2027</b></td><td>N/A</td><td>${badge(d.annual === 'Submitted' ? 'Completed and Submitted' : 'Not started')}</td><td>N/A</td><td><a class="btn sm yel" href="#/annual/${e.id}">Open form</a></td></tr></table></div>`;
};

// ---------- reporting hierarchy (admin) ----------
// Directors | Managers | Employees lists, and a drill-down: director -> their managers -> a manager's employees.
// #/reporting = directors, #/reporting/managers, #/reporting/employees, #/reporting/<id> = who reports to that person
const ORG_TABS = [['director', 'Directors', ''], ['manager', 'Managers', 'managers'], ['employee', 'Employees', 'employees']];
pages.reporting = async (v, arg) => {
  arg = String(arg || '').toLowerCase();
  const id = /^\d+$/.test(arg) ? arg : '', level = id ? '' : ({ managers: 'manager', employees: 'employee' }[arg] || 'director');
  const d = await api(`/org?month=${S.month}${id ? '&id=' + id : '&level=' + level}`), p = d.person, c = d.counts;
  const mon = esc(monthLabel(S.month).split(' ')[0]), tabOf = k => ORG_TABS.find(t => t[0] === k);
  const tabHref = k => '#/reporting' + (tabOf(k)[2] ? '/' + tabOf(k)[2] : '');
  const pname = x => x ? `<a class="lk" href="#/reporting/${x.id}">${esc(x.name)}</a>` : '<span class="small">None</span>';
  const up = d.path.length ? `#/reporting/${d.path[d.path.length - 1].id}` : '#/reporting';
  const crumbs = p ? ['<a href="#/reporting">Directors</a>', ...d.path.map(x => `<a href="#/reporting/${x.id}">${esc(x.name)}</a>`), `<b>${esc(p.name)}</b>`].join(' › ')
    : `PMS › Reporting Manager › ${tabOf(level)[1]}`;
  const prog = t => t.scheduled ? `<div class="tbar" style="margin:0"><div class="tr" title="${t.submitted} submitted, ${t.notSubmitted} not submitted, ${t.pending} pending, ${t.notCompleted} not completed"><i style="width:${pctOf(t.submitted, t.scheduled)}%;background:var(--grn)"></i><i style="width:${pctOf(t.notSubmitted, t.scheduled)}%;background:var(--amb)"></i><i style="width:${pctOf(t.pending, t.scheduled)}%;background:var(--blu)"></i></div><b>${t.submitted}/${t.scheduled}</b></div>` : '<span class="small">No reviews</span>';
  const progCell = r => r.total ? prog(r.teamCounts) : '<span class="small">N/A</span>';
  const own = r => r ? `${badge(r.status)}${r.rating != null ? ` <b title="Monthly rating">${r.rating}</b>` : ''}` : '<span class="small">No form this month</span>';
  const forms = r => `<span class="acts"><a class="btn sm" href="#/form/${r.id}/${S.month}" title="${mon} monthly review form">${mon.slice(0, 3)} form</a><a class="btn sm" href="#/empforms/${r.id}">All months</a></span>`;
  const team = r => r.direct ? `<a class="btn sm" href="#/reporting/${r.id}" title="Open the people who report to ${esc(r.name)}">${ico('eye')}${r.direct}</a>` : '<span class="small">0</span>';
  const nameCell = r => `<div class="orgname"><span class="avatar s">${initials(r.name)}</span><div>${r.direct ? `<a class="nm" href="#/reporting/${r.id}">${esc(r.name)}</a>` : `<b>${esc(r.name)}</b>`}<div class="small">${esc(r.designation)} · ${esc(r.team)}</div>${r.email ? `<div class="small">${esc(r.email)}</div>` : ''}</div></div>`;
  // the columns depend on what is listed: [header, cell]
  const COLS = {
    director: [['Director', nameCell], ['Managers', team], [`Team progress (${mon})`, progCell], [`Own review (${mon})`, r => own(r.review)], ['Reports', forms]],
    manager: [['Manager', nameCell], ['Director', r => pname(r.director)], ['Employees', team], [`Team progress (${mon})`, progCell], [`Own review (${mon})`, r => own(r.review)], ['Reports', forms]],
    employee: [['Employee', nameCell], ['Reporting manager', r => pname(r.manager)], ['Director', r => pname(r.director)], [`Review (${mon})`, r => own(r.review)], ['Reports', forms]],
    drill: [['Name', nameCell], ['Team members', team], [`Team progress (${mon})`, progCell], [`Own review (${mon})`, r => own(r.review)], ['Reports', forms]],
    // a team with no managers in it: just the employees and their reviews
    team: [['Employee', nameCell], [`Review (${mon})`, r => own(r.review)], ['Review date', r => r.review && r.review.reviewDate ? fmtD(r.review.reviewDate) : '<span class="small">Not held yet</span>'], ['Reports', forms]],
  }[p ? (d.rows.some(r => r.direct) ? 'drill' : 'team') : level];
  const title = p ? `Reporting to ${esc(p.name)} (${d.rows.length})` : `${tabOf(level)[1]} (${d.rows.length})`;
  const scope = p ? `${mon} reviews of everyone under ${esc(p.name)} (all levels)` : level === 'employee' ? `${mon} reviews of all employees` : `${mon} reviews across the organisation`;
  v.innerHTML = head('Reporting Manager', crumbs) + `<div class="seg" role="tablist">${ORG_TABS.map(([k, l]) => `<a role="tab" href="${tabHref(k)}" class="${k === level ? 'on' : ''}" aria-selected="${k === level}">${l} <span class="cnt">${d.levelCounts[k]}</span></a>`).join('')}</div>
  <div class="row">${monthSel()}<input id="orgq" type="search" placeholder="Search name, team or email" value="${esc(S.orgq || '')}" style="max-width:260px"><span class="sp"></span>${p ? `<a class="btn" href="${up}">← Back</a>` : ''}<a class="btn" href="#/employees">Edit people on Employees</a></div>
  ${p ? `<div class="card orghead"><span class="avatar">${initials(p.name)}</span><div><b class="on">${esc(p.name)}</b><div class="small">${esc(p.designation)} · ${esc(p.team)}${p.email ? ' · ' + esc(p.email) : ''}</div><div class="small">Reports to ${p.manager ? pname(p.manager) : 'nobody (top level)'}${p.director && (!p.manager || p.director.id !== p.manager.id) ? ` · Director ${pname(p.director)}` : ''} · ${p.direct} direct report${p.direct === 1 ? '' : 's'}</div></div><span class="sp"></span><div class="row" style="margin:0">${own(p.review)}${forms(p)}</div></div>` : ''}
  <div class="small" style="margin:4px 0 8px">${scope}</div>
  <div class="tiles"><div class="tile"><b>${c.scheduled}</b><span>Scheduled</span></div><div class="tile g"><b>${c.submitted}</b><span>Submitted</span></div><div class="tile a"><b>${c.notSubmitted}</b><span>Not submitted</span></div><div class="tile r"><b>${c.notCompleted}</b><span>Not completed</span></div><div class="tile b"><b>${c.pending}</b><span>Pending</span></div></div>
  <h2>${title}</h2>
  <div class="tablewrap"><table><tr>${COLS.map(([h]) => `<th>${h}</th>`).join('')}</tr>
  ${d.rows.map(r => `<tr data-s="${esc(`${r.name} ${r.designation} ${r.team} ${r.email} ${r.manager ? r.manager.name : ''} ${r.director ? r.director.name : ''}`.toLowerCase())}">${COLS.map(([, cell]) => `<td>${cell(r)}</td>`).join('')}</tr>`).join('')
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

// ---------- audit & settings ----------
pages.audit = async v => {
  const rows = await api('/audit');
  v.innerHTML = head('Audit log', 'PMS › Audit Log') + `<div class="tablewrap"><table><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr>${rows.map(r => `<tr><td>${esc(new Date(r.at).toLocaleString())}</td><td>${esc(r.who)}</td><td>${esc(r.action)}</td><td>${esc(r.detail)}</td></tr>`).join('')}</table></div>`;
};
pages.config = async v => {
  const c = await api('/config');
  v.innerHTML = head('Settings', 'PMS › Settings · thresholds are configuration, not code') +`<div class="card"><div class="setgrid">${[['operationalRange', 'Operational weightage range (min,max)'], ['peopleMin', 'People weightage minimum'], ['peopleMax', 'People weightage maximum'], ['clickupMin', 'ClickUp manager rating minimum'], ['learningMin', 'Learning manager rating minimum'], ['ratingGapFlag', 'Self vs manager gap flag'], ['emailGapFlag', 'Gap highlighted in the email']].map(([k, l]) => `<div><label class="f">${l}</label><input data-c="${k}" value="${esc([].concat(c[k]).join(','))}"></div>`).join('')}</div>
  <p class="small">Review windows are edited on the <a href="#/scheduling">Scheduling</a> page.</p>
  <button class="btn pri" id="sc">Save settings</button></div>`;
  $('#sc').onclick = async () => {
    const b = {};
    document.querySelectorAll('[data-c]').forEach(i => { const k = i.dataset.c; b[k] = k === 'operationalRange' ? i.value.split(',').map(Number) : Number(i.value); });
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
    <div class="apcard"><div class="aphead"><span class="aplogo">${MARK('onDark')}<b>Verve PMS</b></span><span><b>Appraisal ${AP.fy}</b><small>PERFORMANCE REVIEW FORM</small></span></div>
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
