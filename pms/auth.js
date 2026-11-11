// Sign-in for PMS: Google accounts on the org domain only, kept in a signed session cookie.
// Without GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET the server falls back to the demo user picker.
const crypto = require('crypto');

const ORG_DOMAIN = (process.env.ORG_DOMAIN || 'verveadvisory.com').toLowerCase();
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const google = !!(CLIENT_ID && CLIENT_SECRET);
// demo picker: on by default only when Google sign-in is not set up; DEMO_LOGIN=1 / 0 forces it
const demo = process.env.DEMO_LOGIN ? process.env.DEMO_LOGIN === '1' : !google;
// addresses the app is served from; Google sends people back to one of these after sign-in
const ORIGINS = (process.env.APP_ORIGINS || `http://localhost:${process.env.PORT || 3000},https://verve-pms.onrender.com,https://verve-pms.vercel.app`)
  .split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
// people who become PMS admins the first time they sign in, even before HR adds them
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const CALLBACK = '/api/auth/google/callback';
const SESSION_DAYS = 7;

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  if (google) console.log('SESSION_SECRET not set: everyone is signed out (and calendars disconnected) when the server restarts');
}
// key for encrypting stored Google refresh tokens
const KEY = crypto.createHash('sha256').update('pms-token-key:' + SECRET).digest();

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ORG_RE = new RegExp(`^[^@\\s]+@${esc(ORG_DOMAIN)}$`, 'i');
const isOrgEmail = e => ORG_RE.test(String(e || '').trim());
const okOrigin = o => ORIGINS.includes(String(o || '').replace(/\/$/, '')) ? String(o).replace(/\/$/, '') : null;

// ---------- signed tokens (session cookie and OAuth state) ----------
const hmac = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function sign(obj) { const p = Buffer.from(JSON.stringify(obj)).toString('base64url'); return p + '.' + hmac(p); }
function unsign(tok) {
  if (typeof tok !== 'string') return null;
  const [p, s] = tok.split('.');
  if (!p || !s) return null;
  const want = Buffer.from(hmac(p)), got = Buffer.from(s);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}

// ---------- cookies ----------
const parseCookies = h => Object.fromEntries(String(h || '').split(';').map(x => x.trim()).filter(Boolean)
  .map(x => { const i = x.indexOf('='); return i < 0 ? [x, ''] : [x.slice(0, i), decodeURIComponent(x.slice(i + 1))]; }));
// maxAge null = a browser-session cookie (gone when the browser closes)
const cookie = (name, value, maxAge, secure) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${maxAge === null ? '' : `; Max-Age=${maxAge}`}${secure ? '; Secure' : ''}`;
const SESSION = 'pms_session', OAUTH = 'pms_oauth';
// as = the employee an admin is currently viewing the app as (testing other roles)
// keep = "Keep me signed in": 7 days; otherwise until the browser closes (at most 12 hours)
const sessionCookie = (uid, as, secure, keep = true) => cookie(SESSION, sign({ t: 'session', uid, as: as || null, keep, exp: Date.now() + (keep ? SESSION_DAYS * 864e5 : 12 * 36e5) }), keep ? SESSION_DAYS * 86400 : null, secure);

// ---------- test accounts (email + shared password), only while DEMO_LOGIN is on ----------
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Verve@123';
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const checkPassword = p => crypto.timingSafeEqual(sha(p), sha(DEMO_PASSWORD));
const clearSession = secure => cookie(SESSION, '', 0, secure);
const session = cookies => { const s = unsign(cookies[SESSION]); return s && s.t === 'session' ? s : null; };
const isSecure = req => /https/.test(req.headers['x-forwarded-proto'] || '') || !!req.socket.encrypted;

// ---------- Google OAuth ----------
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
// calendar: ask for permission to create events, with a refresh token so invites can be sent later
function authStart({ origin, calendar, uid, loginHint }) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = sign({ t: 'oauth', origin, calendar: !!calendar, uid: uid || null, nonce, exp: Date.now() + 10 * 60e3 });
  const p = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: origin + CALLBACK, response_type: 'code', hd: ORG_DOMAIN, state,
    scope: calendar ? `openid email ${CAL_SCOPE}` : 'openid email profile' });
  if (calendar) { p.set('access_type', 'offline'); p.set('prompt', 'consent'); p.set('include_granted_scopes', 'true'); }
  else p.set('prompt', 'select_account');
  if (loginHint) p.set('login_hint', loginHint);
  return { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + p, cookie: cookie(OAUTH, nonce, 600, origin.startsWith('https')) };
}
const clearOauth = secure => cookie(OAUTH, '', 0, secure);
// the state Google hands back: ours, not expired, for an allowed address
const oauthState = tok => { const s = unsign(tok); return s && s.t === 'oauth' && okOrigin(s.origin) ? s : null; };

async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }) });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(t.error_description || t.error || `Google returned ${r.status}`); e.code = t.error; throw e; }
  return t;
}
const exchange = (code, origin) => tokenRequest({ code, redirect_uri: origin + CALLBACK, grant_type: 'authorization_code' });
const refresh = refreshToken => tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });
async function revoke(token) { try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' }); } catch {} }

// the id_token comes straight from Google's token endpoint over TLS, so its claims can be read without re-checking the signature
function identity(idToken) {
  const c = JSON.parse(Buffer.from(String(idToken || '').split('.')[1] || '', 'base64url').toString() || '{}');
  if (c.aud !== CLIENT_ID || !['https://accounts.google.com', 'accounts.google.com'].includes(c.iss) || !(c.exp * 1000 > Date.now())) throw new Error('Unexpected Google token');
  const email = String(c.email || '').toLowerCase();
  return { email, name: c.name || '', verified: c.email_verified === true || c.email_verified === 'true', hd: String(c.hd || '').toLowerCase() };
}
// only verified accounts that belong to the org's Google Workspace may sign in
const orgAccount = id => id.verified && id.hd === ORG_DOMAIN && isOrgEmail(id.email);

// ---------- encrypted storage of refresh tokens ----------
function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64url')).join('.');
}
function unseal(s) {
  try {
    const [iv, tag, enc] = String(s).split('.').map(x => Buffer.from(x, 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
}

module.exports = { ORG_DOMAIN, google, demo, ORIGINS, ADMIN_EMAILS, DEMO_PASSWORD, checkPassword, isOrgEmail, okOrigin, parseCookies, sessionCookie, clearSession, session, isSecure,
  authStart, clearOauth, oauthState, exchange, refresh, revoke, identity, orgAccount, seal, unseal };
