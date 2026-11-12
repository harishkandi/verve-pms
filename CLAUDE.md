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
  Department (= team), Director; 76 rows + 4 top-level directors).
  It lives in `pms/private/employees.tsv`, git-ignored on purpose: the staging repo is public, never commit it or put
  names in code. Shared with the team ONLY in the private org repo, on the separate branch `pms/employee-list`
  (one file, `employees.tsv`, no code; never merge it into a code branch, never push it to `personal`). Get it with
  `git fetch origin && git show origin/pms/employee-list:employees.tsv > pms/private/employees.tsv`. `employees.js` parses/checks it (`npm run employees -- private/employees.tsv`, add `--apply` to write
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
  and the chart "submitted" colour (Harish asked for green switches, 2026-11-12). User name, theme and log out
  live in the top bar. The page scrolls inside `#main`, not the window (`SC()`). No page footer (Harish
  removed it, 2026-11-12). Admins get a grouped menu (Reporting
  manager / Reporting / Questions open as sub-menus); its Reporting manager lists come from `designation`
  (`ORG_LEVELS` in `server.js`: directors, senior managers, managers + team leads, senior executives, everyone else).
  There is no Settings page: the thresholds ("Review rules") and review windows are on the Scheduling page (admin);
  admins can also edit a window from the dashboard. Status names shown to users: "Review Not Completed" = "Form
  incomplete", "Pending" = "Overdue" (server keeps the old names). Teams = the list's departments plus
  "Directors" (was "Leadership"); `migrate()` in `data.js` updates older saved state on boot.
- Reschedule count = distinct new dates (`rescheduleCount` in `logic.js`), not the number of edits.
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
  Save draft; employees' entries also autosave. A manager remark is needed only when self and manager ratings differ; a submitted
  monthly form is locked for good (no reopen, no edit request, admins included). KRA changes by an employee need
  their manager's approval (Vidya, 2026-11-12: `POST /api/kra-request`, `/api/kra-request/decide`; an approval allows
  one KRA save, pending requests show on the manager's dashboard); copying last month's KRAs needs no approval; none
  of this is possible after "Submit to manager" (`selfSubmitted`). The One Pager Document is hidden from
  employees; monthly rating = per sub-KRA 30% self + 70% manager, weighted by
  sub-KRA then KRA weight; demo "today" is `config.today` in `data.js`.

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
