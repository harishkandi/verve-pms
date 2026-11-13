// Runs before `npm run local` / `npm run dev`: keeps this machine's copy of the real employee list
// (pms/private/employees.tsv) up to date. The list is never in a code branch (the staging repo is public); the private
// org repo keeps it on its own branch, pms/employee-list, so `git pull` does not bring it. This copies it from there when
// the file is missing, or when the file is an unchanged copy of an older version of that branch (a file edited by hand
// is left alone). After an update the old saved local state (private/state.json) is set aside, because it holds the
// people of the old list.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const DIR = path.join(__dirname, 'private'), FILE = path.join(DIR, 'employees.tsv'), STATE = path.join(DIR, 'state.json');
const BRANCH = 'pms/employee-list';
const git = args => execFileSync('git', args, { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 24 });
const norm = s => s.replace(/^﻿/, '').replace(/\r\n/g, '\n');

try {
  // the remote that is the org repo (usually "origin"); the personal staging repo has no list branch
  const remote = git(['remote', '-v']).split('\n').find(l => /adminsoftware-alt\/verve-hrms/.test(l));
  const ref = `${remote ? remote.split(/\s+/)[0] : 'origin'}/${BRANCH}`;
  try { git(['fetch', ref.split('/')[0], BRANCH]); } catch { /* offline: use what was fetched before */ }
  const latest = git(['show', `${ref}:employees.tsv`]);
  const have = fs.existsSync(FILE) ? norm(fs.readFileSync(FILE, 'utf8')) : null;
  if (have === norm(latest)) return;
  if (have !== null) {
    const older = git(['log', '--format=%H', ref, '--', ':(top)employees.tsv']).split('\n').filter(Boolean).slice(1)
      .some(c => { try { return norm(git(['show', `${c}:employees.tsv`])) === have; } catch { return false; } });
    if (!older) { console.log(`private/employees.tsv differs from ${ref} (edited here?): left as it is`); return; }
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, latest);
  console.log(`Employee list ${have === null ? 'copied' : 'updated'} from ${ref} to private/employees.tsv`);
  if (have !== null && fs.existsSync(STATE)) {
    fs.renameSync(STATE, path.join(DIR, 'state.before-list-update.json'));
    console.log('Old local data set aside as private/state.before-list-update.json: the app starts from the new list');
  }
} catch (e) {
  if (!fs.existsSync(FILE)) console.warn(`No employee list (${e.message.split('\n')[0]}). The app starts with no people.`);
}
