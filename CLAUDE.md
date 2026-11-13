# Verve HRMS: notes for Claude

Monorepo for Verve's internal HR tools. One folder per module; today only `pms/` (Performance Management System) has code.
The other module branches in the org repo (`feature/attendance`, `feature/reimbursement`, `feature/onboarding`,
`feature/exit-management`, `feature/vervefit`, `central-app`) were empty (README only) as of 2026-11-07.

## PMS app (`pms/`)
- Plain Node (>=20, deploy uses 22), no framework, one dependency (`pg`). `server.js` = HTTP server, route table and
  static file serving from `public/`; `logic.js` = business rules; `data.js` = seed data + shared config;
  `db.js` = Postgres persistence; `auth.js` = sign-in + session cookie; `calendar.js` = Google Calendar invites;
  `public/index.html` + `public/app.js` = the whole frontend (vanilla JS).
- Sign-in: "Sign in with Google", only verified accounts on the `verveadvisory.com` Workspace (`hd` claim) whose email
  matches an active employee record; `ADMIN_EMAILS` become admin on first sign-in. Session = HMAC-signed HttpOnly cookie
  `pms_session` (`SESSION_SECRET`). Without `GOOGLE_CLIENT_ID`/`SECRET` the old dummy-user picker is used (`POST /api/auth/demo`).
  Admins can "View as" anyone (real user stays in the session). All `/api/auth/*` routes live under `/api` so Vercel forwards them.
  On Render (`RENDER` env, set by Render) the app holds real data, so: no sign-in by id (`/api/auth/demo` = 403), the
  test-account password is never shown, and it must come from a `DEMO_PASSWORD` env var (no default; unset = password
  sign-in off). Local runs keep the default `Verve@123` and the id picker.
- Calendar: a reviewer connects their own Google Calendar (scope `calendar.events`, refresh token AES-GCM encrypted in
  `calendarLinks`). Schedule/Reschedule/Cancel on the Scheduling page create/move/delete the event with `sendUpdates=all`;
  Google emails the guests (employee + their manager when someone else schedules).
- Employees = the REAL company list (2026-11-12, from the "employee list" sheet: Name, Reporting Manager, Designation,
  Department (= team), Director; 76 rows + 4 top-level directors). Teams and reporting managers were replaced on
  2026-11-12 by Harish's team sheet ("Sheet4", the master for teams): 72 rows + 4 directors, 9 teams grouped by director
  (designations kept from the earlier list; the old file is `pms/private/employees.before-2026-11-12.tsv`). Some team
  names are people's names, so team names never go into code: `teamLook()` in `app.js` matches keywords and gives the
  other teams distinct spare icons by their place in `S.me.teams` (sent by `/api/me`).
  It lives in `pms/private/employees.tsv`, git-ignored on purpose: the staging repo is public, never commit it or put
  names in code. Shared with the team ONLY in the private org repo, on the separate branch `pms/employee-list`
  (one file, `employees.tsv`, no code; never merge it into a code branch, never push it to `personal`). Get it with
  `git fetch origin && mkdir -p pms/private && git show origin/pms/employee-list:employees.tsv > pms/private/employees.tsv`
  (a fresh clone has no `pms/private` folder). `employees.js` parses/checks it (`npm run employees -- private/employees.tsv`, add `--apply` to write
  into `DATABASE_URL` = staging); `data.js` also loads it on boot when the file exists. First import removed all demo
  people and demo records; later imports update by name, add new people, mark missing ones inactive, keep forms.
  Managers not on the list become top-level directors (not reviewed). Role is derived: no manager = director, has
  reports = manager, else employee (designation is shown, not used for permissions). The Director column is only
  cross-checked against the reporting chain (warning on mismatch); the app takes the director from the chain.
  Review windows follow the departments (import drops windows of teams nobody is in, new ones get 25th to month end).
  Email, joining date and code are not in the sheet yet: blank / FY start / `V###`. Without emails nobody but
  `ADMIN_EMAILS` can use Google sign-in (admins use "View as"). Admin dashboard starts with the "All stats" cards
  (`orgStats()` in `server.js`, `allStats()` in `app.js`).
- UI follows the VerviRecruit UI brief: all colours are `--vr-*` tokens in `public/index.html` (light on `:root`, dark on
  `html.dark`, stored as `pms.theme`); no raw hex; success = azure, green (`--vr-green-*`) only for on/off switches
  and the chart "submitted" colour (Harish asked for green switches, 2026-11-12). Theme button and the user menu
  live in the top bar: clicking the name/avatar opens a small menu (same look as the other dropdowns) with Profile
  information and Sign out. Profile information is a page, not a popup (`#/profile`, `pages.profile`, `GET /api/profile`):
  hero + Work details card (code, email, designation, department, role, joining date, review window, reports) +
  Reporting line card (director down to the person), read-only, the admin keeps the details. Code and joining date from the list are placeholders (shown "Not set yet") until the
  admin sets them in Employees › Edit (`codeSet` / `joinedSet` flags). The page scrolls inside `#main`, not the window (`SC()`). No page footer (Harish
  removed it, 2026-11-12). Admins get a grouped menu (Reporting
  manager / Reporting / Questions open as sub-menus); its Reporting manager lists come from `designation`
  (`ORG_LEVELS` in `server.js`: directors, senior managers, managers + team leads, senior executives, everyone else).
  Login page = split: navy left panel (dot grid, a floating sample monthly-review card with example numbers, rotating
  captions; `authBrand()` / `authBrandRun()` in `app.js`, Harish picked this design 2026-11-12), sign-in form on the right.
  There is no Settings page: the thresholds ("Review rules") and review windows are on the Scheduling page (admin);
  admins can also edit a window from the dashboard. Status names shown to users: "Review Not Completed" = "Form
  incomplete", "Pending" = "Overdue" (server keeps the old names). Teams = the list's departments plus
  "Directors" (was "Leadership"); `migrate()` in `data.js` updates older saved state on boot.
- Reporting changes (2026-11-12) all go through `planMove` / `applyMove` in `server.js` (Employees table + Edit, Add member,
  Move to inactive). Checks: new manager active, not the admin account, no loops; "No manager" asks first (top-level
  director, not reviewed). If this month's review has started (`reviewProgress`: meeting set, sent to manager, manager
  ratings, KRA request) the admin picks "keep" (old manager finishes; `e.pendingManager` applies from next month via
  `applyPendingMoves()` on each request) or "move now" (old manager's invite cancelled, meeting date cleared, pending KRA
  request marked `movedFrom`). Roles are derived, never picked (`L.deriveRole` / `refreshRoles`, same rule as the import;
  only Admin is a choice in Edit); anyone active can be picked as a manager. People involved get notifications (see below). Submitted forms keep `f.reviewedBy` (manager at the time):
  the form header and Team report ("by <name>") use it. The employee sheet stays master: an import replaces app-made
  reporting changes (`managerSetInApp`) and lists them. Admins never schedule reviews (`manageForm` refuses when the
  real user is admin, also in View as); their Scheduling page is windows + rules + read-only status.
- Team follows the reporting manager (Harish, 2026-11-12): a new manager (Employees table/Edit, moving a manager to
  inactive, or a planned "keep" move when it takes effect) puts the person in that manager's team, and the people under
  them who were in their old team come along (`teamOfManager` / `moveTeam` in `server.js`). Exceptions: reporting to a
  top-level director keeps the person's own team (directors lead several departments); no manager = "Directors"; a team
  the admin picks by hand in the same save wins. The Edit dialog fills the Team field as soon as a manager is picked.
- Teams (2026-11-13): a team = the `team` name on each person + its window in `config.windows`. Admins add / rename /
  delete (only when nobody active is in it) teams on the Teams page in the admin menu (`#/teams`, `pages.teams` in `app.js`;
  `GET|POST|PUT /api/teams`, `POST /api/teams/delete` in `server.js`; the Window button reuses `windowDialog`). Vidya and
  Harish each built a Teams screen; they were merged into this one page (no Teams button on Employees). "Directors" is fixed. Because the sheet
  is master, a rename is stored in `config.teamRenames` (sheet name -> app name) and `importList` maps through it; teams
  added in the app (`config.teamsAdded`) are not dropped while empty. A team changed by hand (`moveTeam` sets
  `e.teamSetInApp`) is put back by the next import and listed with the replaced reporting changes.
- Notifications (2026-11-12): bell in the top bar (`#tbbell`, panel `#tbnotes` with "Needs action" / "All", polled every
  minute via `apiCall` so no spinner). Server side is `notify.js`: `push(to, {type, text, link, action, key}, by)` (no
  note for your own action; same `key` updates the earlier item), `resolve(key)` closes action items for everyone,
  `checks()` adds date reminders once a minute from the REAL date in India (`realToday()`, `PMS_TODAY` overrides it
  for tests): window open, closes in 2 days, overdue, meeting tomorrow, admin "no work email". State container
  `notifications` (empId -> list, last 100 / 60 days), in `KEYS`. Routes call `N.push` after their `audit(...)`:
  KRA request/decision/changes, send to manager / send back / submit, schedule / reschedule / invite cancelled,
  reporting changes, window / rules / questionnaire / parameters changes, list import (admins). In View as the admin
  sees the person's list but never marks it read. No email yet (no sender; Google Calendar already emails invites).
- Reschedule count = distinct new dates (`rescheduleCount` in `logic.js`), not the number of edits.
- PMS report format (management's "PMS Reports Format" sheet, 2026-11-13) = the Review status report's "Full details"
  switch (`/api/report?detail=1`, `fullTable()` in `app.js`) and its CSV export (same columns, sheet order: `PMS_COLUMNS` in
  `server.js`), built by `pmsDetail()` in `logic.js`. No AI: the Operational/Process/People remark columns join each
  sub-KRA's self and manager remark. Scheduled Date = first date picked (`f.firstScheduledDate`, older forms: first
  reschedule's `from`). Final Status: Review Done / Questionnaire Done / Pending, "PMS form incomplete/errors/queries" (all
  ratings in but a blocker), "Employee on leave" / "Serving Notice" (admin sets `e.workStatus = {type, from}` in Employees ›
  Edit, from that review month on). Escalations: new joiner KRA due since <month> (month after 2 complete questionnaires),
  KRAs / SOP / learning missing 2+ months, same SOP / learning topic (same link or remark) 2+ months running. Rules in
  Review rules: `learningDoneMin` 60, `qMinWords` 15, `opMinSubKras` 3 (defaults filled by `migrate()`).
- Only people with a reporting manager are reviewed: top-level directors get no form and are left out of counts
  (`ensureMonthForms`, `/api/scheduling`, `reportRows`).
- Reports ported from the old portal (pms.verveadvisory.com): Team report / My report (`#/yearly`, `/api/yearly`,
  quarter + FY filters) = the old "Yearly Reporting"; the MIS report's Reporting graph (`/api/mis/graph`) = the old
  "Reporting Graph" (quarter, FY, director, KRA); Export KPI on the monthly form = CSV download.
- Settings live in env vars, listed in `pms/.env.example`; `npm run dev` / `npm run local` read `pms/.env`.
- Persistence: all state lives in the in-memory objects exported by `data.js`. With `DATABASE_URL` set, `db.js` loads
  them from one jsonb row (`pms_state`, id 1) on boot (seeding it when empty) and saves after any request that changed
  state; the server answers only after the save. No `DATABASE_URL` → in memory, resets on restart.
  New state containers must be added to `KEYS` in `db.js` and mutated in place (never reassigned).
- Domain rules: KRA ratings are percentages, 10-100 in steps of 10 (`KRA_SCALE`; were 0-5 until 2026-11-12, `migrate()`
  converts old saved data x20 and marks `config.ratingScale = 100`); questionnaire ratings stay 0-5; thresholds
  `clickupMin`/`learningMin` are % and the gap flags are percentage points. Employees' "What is left on my form" lists
  only what they fill in (`employeeTodo` in `logic.js`); KRA set-up and review-date alerts are for managers only. The
  form shows a Review summary (`kraSummary` / `formSummary`), also in a dialog after Save draft / Submit; hidden from
  employees (`showSummary()` in `app.js`, Harish's call 2026-11-12), reviewers and admins see it.
  Monthly form is two steps: the employee clicks "Submit to manager" (`POST /api/form/self-submit`, blocked until
  `employeeTodo` is empty; sets `form.selfSubmitted`, their part is then read-only), the manager can "Send back to
  employee" (`POST /api/form/return`) or "Submit review" (`POST /api/form/submit`, final). Everyone who can edit gets
  Save draft; employees' entries also autosave. Autosave sends only the fields that person changed (`formDirty` in
  `app.js`) and `PUT /api/form` changes only the fields it is sent, so the employee and the manager can have the form
  open together without wiping each other's entries (found in testing, 2026-11-12; never send the whole form back).
  Top-level directors (no manager) get no new form (`mustForm`) and no My review / My report menu items. Since 2026-11-13
  (management meeting) Submit review needs all five on every sub-KRA: self rating, self remark, manager rating, manager remark
  (always, not only when ratings differ: `MGR_REMARK`), and the SOP / learning document link in the self remark (`SOP_LINK` /
  `LEARN_LINK` are now `block`); `managerGaps()` lists missing manager ratings. Rows are found by name (/sop/ in Process,
  /learn/ in People). Questionnaire text answers under `config.qMinWords` (15) words are flagged (`Q_SHORT`), not blocked; a submitted
  monthly form is locked for good (no reopen, no edit request, admins included). KRA changes by an employee need
  their manager's approval (Vidya, 2026-11-12: `POST /api/kra-request`, `/api/kra-request/decide`; an approval allows
  one KRA save, pending requests show on the manager's dashboard); copying last month's KRAs needs no approval; none
  of this is possible after "Submit to manager" (`selfSubmitted`). The One Pager Document is hidden from
  employees; monthly rating = per sub-KRA 30% self + 70% manager, weighted by
  sub-KRA then KRA weight; demo "today" is `config.today` in `data.js`.
- Admin-only (menu, pages and API, Harish 2026-11-12): Manager emails, MIS report, KPI report. Managers' "Reports" group =
  Team report (`#/yearly`: only the people under them, with the month's status cards on top; the old "My team report"
  page is merged into it and `#/teamreport` redirects there) + My report (`#/yearly/me`: their own table), so nobody is
  shown twice. Harish: no duplicate pages or components anywhere; merge instead of adding a second one. The annual
  review lives only in My review › Annual review (`#/form/<id>/annual`); the One pager document page is the summary
  table only and links there.

## Commands (run in `pms/`)
    npm install
    npm run dev        # server on :3000, DATABASE_URL from ../.env.local (Neon), same DB as staging!
    npm start          # no .env loading; in-memory unless DATABASE_URL is set
    npm run db:reset   # drop pms_state; next start starts empty (no demo data any more), then re-import the list
    npm run employees -- private/employees.tsv [--apply]   # check / write the real employee list
Smoke test (demo sign-in, i.e. no Google env): `curl -c j -H 'Content-Type: application/json' -d '{"id":1}' localhost:3000/api/auth/demo`
then `curl -b j localhost:3000/api/me` (ids follow the list order; the test admin "Verve Admin" A900 is the highest id). Non-GET calls must send `Content-Type: application/json`.

## Staging (live)
| Piece | Where | Notes |
|---|---|---|
| Source | personal repo `harishkandi/verve-pms` (git remote `personal`), branch `main` | public repo; push here to deploy |
| App (pages + API) | Render web service `verve-pms` → https://verve-pms.onrender.com | Singapore, root `pms`, `npm ci`, `node server.js`, env `DATABASE_URL`, `NODE_VERSION=22`; free tier sleeps after 15 min (first hit ~1 min) |
| Frontend mirror | Vercel project `verve-pms` → https://verve-pms.vercel.app | static `pms/public` only; `/api/*` rewritten to Render via `pms/vercel.json` (root = `pms`) or `pms/public/vercel.json` (root = `pms/public`). Must never run `server.js` itself, or it keeps a separate copy of the data |
| Database | Neon org "Verve" `org-super-credit-06911774`, project `verve-pms` `winter-truth-42259263`, branch `production`, Singapore | use the pooled URL (`-pooler` host). Local copy in repo-root `.env.local` (git-ignored, written by `neon init`) |

`render.yaml` describes the planned org-repo Blueprint (`verve-pms-staging`, branch `feature/pms`); the live Render
service was created by hand from the personal repo and does not use it.

Check Vercel really forwards to Render: change a value on Render (`PUT /api/config {"clickupMin":4}` signed in as admin),
read it back through Vercel, then restore it. Different values = Vercel is running its own copy.

## Git workflow
- Remotes: `personal` = harishkandi/verve-pms (staging), `origin` = adminsoftware-alt/verve-hrms (official, private).
- Harish works on local `pms/harish` and deploys with `git push personal HEAD:main`.
- Vidya works on `origin/feature/pms`. To take her changes: `git fetch origin && git merge origin/feature/pms`,
  test locally, then push to `personal`.
- Push to `origin` only after Harish confirms staging is good: push `pms/harish` and open/update the PR into
  `feature/pms` (PR #1). Never push directly to `feature/pms` again.
- Vercel Hobby blocks deploys of non-owner commits from private repos, which is why staging runs from the personal repo.
  The org admin login (adminsoftware-1151) is not available.

## Gotchas
- Windows: shell is PowerShell by default; Git Bash also available. Git's "LF will be replaced by CRLF" warnings are harmless.
- `pg` warns about `sslmode=require`; `db.js` rewrites it to `verify-full` (same behaviour, no warning).
- Root `package.json`, `package-lock.json` and `neon.ts` were created by `neon init` (Neon config tooling); the app does
  not use them and they are not committed.
- Working style: give setup/deploy steps one at a time and wait for confirmation; one clear recommendation, simple wording.
