// Optional Postgres persistence for the PMS demo.
// All app state lives in the in-memory objects exported by data.js. When DATABASE_URL is set, that state is stored
// as one JSON snapshot row: loaded on boot (or seeded from data.js when the table is empty) and saved after any
// request that changed it. Without DATABASE_URL the app runs purely in memory, as before.
const D = require('./data');

// the in-memory containers that make up the app state; they are refilled in place so every module keeps its references
const KEYS = ['config', 'employees', 'questions', 'paramsVersions', 'forms', 'annualForms', 'auditLog', 'emailsOutbox', 'appraisals', 'calendarLinks'];
const ROW_ID = 1;
// pg 8 already treats sslmode=require as verify-full; say so explicitly to keep that behaviour and silence its warning
const URL = process.env.DATABASE_URL && process.env.DATABASE_URL.replace(/sslmode=(prefer|require|verify-ca)\b/, 'sslmode=verify-full');

// `npm run local` keeps the state in a file (git-ignored) so changes such as moving someone to inactive survive a restart
const fs = require('fs'), path = require('path');
const LOCAL_FILE = process.argv.includes('--local-state') && !URL ? path.join(__dirname, 'private', 'state.json') : null;

let pool = null;
let lastSaved = null;         // JSON of the last snapshot written, so unchanged state is not written again
let queue = Promise.resolve(); // writes run one at a time, in order

const snapshot = () => JSON.stringify(Object.fromEntries(KEYS.map(k => [k, D[k]])));

function hydrate(data) {
  for (const k of KEYS) {
    if (data[k] === undefined) continue;
    const target = D[k];
    if (Array.isArray(target)) target.splice(0, target.length, ...data[k]);
    else { for (const key of Object.keys(target)) delete target[key]; Object.assign(target, data[k]); }
  }
}

async function init() {
  if (!URL && LOCAL_FILE) {
    try { if (fs.existsSync(LOCAL_FILE)) { hydrate(JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'))); lastSaved = snapshot(); console.log(`Loaded saved state from ${LOCAL_FILE} (delete the file to start fresh)`); } }
    catch (e) { console.error('Could not read the saved state, starting fresh:', e.message); }
    return;
  }
  if (!URL) { console.log('DATABASE_URL not set: running in memory, data resets on restart'); return; }
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: URL, max: 3 });
  pool.on('error', e => console.error('Postgres pool error:', e.message));
  await pool.query(`create table if not exists pms_state (
    id int primary key, data jsonb not null, updated_at timestamptz not null default now())`);
  const { rows } = await pool.query('select data from pms_state where id = $1', [ROW_ID]);
  if (rows.length) { hydrate(rows[0].data); lastSaved = snapshot(); console.log('Loaded PMS state from Postgres'); }
  else { await write(snapshot()); console.log('Postgres was empty: saved the seeded demo data'); }
}

async function write(json) {
  await pool.query(`insert into pms_state (id, data, updated_at) values ($1, $2, now())
    on conflict (id) do update set data = excluded.data, updated_at = now()`, [ROW_ID, json]);
  lastSaved = json;
}

// save the current state if it changed since the last write; resolves once it is stored
function save() {
  if (LOCAL_FILE) {
    const json = snapshot();
    if (json !== lastSaved) { fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true }); fs.writeFileSync(LOCAL_FILE, json); lastSaved = json; }
    return Promise.resolve();
  }
  if (!pool) return Promise.resolve();
  const json = snapshot();
  if (json === lastSaved) return queue;
  queue = queue.catch(() => {}).then(() => json === lastSaved ? undefined : write(json));
  return queue;
}

// delete the stored state so the next start seeds fresh demo data
async function reset() {
  if (!URL) throw new Error('DATABASE_URL is not set');
  const { Pool } = require('pg');
  const p = new Pool({ connectionString: URL, max: 1 });
  await p.query('drop table if exists pms_state');
  await p.end();
}

module.exports = { init, save, reset, enabled: () => !!pool };

if (require.main === module && process.argv[2] === '--reset') {
  reset().then(() => console.log('PMS state deleted; the next start seeds fresh demo data.'), e => { console.error(e.message); process.exit(1); });
}
