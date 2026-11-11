// Google Calendar invites for PMS reviews. A reviewer connects their own calendar once; events are created on it
// with the employee as a guest and Google emails the invite (and later updates / cancellations) to everyone.
const A = require('./auth');
const D = require('./data');

const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const access = new Map(); // empId -> { token, exp }: short-lived access tokens, memory only

const linked = empId => D.calendarLinks[empId] || null;
function link(empId, email, refreshToken, accessToken, expiresIn) {
  D.calendarLinks[empId] = { email, token: A.seal(refreshToken), connectedAt: new Date().toISOString() };
  if (accessToken) access.set(empId, { token: accessToken, exp: Date.now() + (expiresIn || 3000) * 1000 });
}
async function unlink(empId) {
  const l = linked(empId); if (!l) return;
  const rt = A.unseal(l.token);
  delete D.calendarLinks[empId]; access.delete(empId);
  if (rt) await A.revoke(rt);
}

async function accessToken(empId) {
  const l = linked(empId);
  if (!l) throw new Error('Connect your Google Calendar first (Scheduling page).');
  const c = access.get(empId);
  if (c && c.exp > Date.now() + 60e3) return c.token;
  const rt = A.unseal(l.token);
  if (!rt) { delete D.calendarLinks[empId]; throw new Error('Google Calendar needs to be connected again.'); }
  try {
    const t = await A.refresh(rt);
    access.set(empId, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  } catch (e) {
    if (e.code === 'invalid_grant') { delete D.calendarLinks[empId]; throw new Error('Google Calendar access was removed or expired. Please connect it again.'); }
    throw new Error('Could not reach Google Calendar: ' + e.message);
  }
}

async function call(empId, method, path, body) {
  const r = await fetch(EVENTS + path, { method, headers: { Authorization: 'Bearer ' + await accessToken(empId), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (method === 'DELETE' && (r.status === 404 || r.status === 410)) return null; // already gone
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Google Calendar: ' + (j.error && j.error.message || `error ${r.status}`));
  return j;
}

// "2026-11-27" + "11:00" + 30 -> "2026-11-27T11:30:00" (wall-clock time in the calendar's time zone)
function plus(date, time, mins) {
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi + mins)).toISOString().slice(0, 19);
}
const times = (s, tz) => ({ start: { dateTime: plus(s.date, s.time, 0), timeZone: tz }, end: { dateTime: plus(s.date, s.time, s.duration), timeZone: tz } });

// s = { date, time, duration, zoom, guests, summary, description, tz }; zoom is the link the manager pasted
async function create(empId, s) {
  const ev = await call(empId, 'POST', '?sendUpdates=all', {
    summary: s.summary, description: s.description, location: s.zoom || undefined, ...times(s, s.tz),
    attendees: s.guests.map(email => ({ email })), reminders: { useDefault: true }, guestsCanModify: false,
  });
  return { id: ev.id, link: ev.htmlLink };
}
const move = (empId, eventId, s) => call(empId, 'PATCH', `/${encodeURIComponent(eventId)}?sendUpdates=all`, { ...times(s, s.tz), location: s.zoom || '', description: s.description });
const cancel = (empId, eventId) => call(empId, 'DELETE', `/${encodeURIComponent(eventId)}?sendUpdates=all`);

module.exports = { linked, link, unlink, create, move, cancel };
