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
- Personal passwords (Harish, 2026-11-17): everyone can also sign in with work email + their own PMS password, next to
  Google. The admin gives a temporary one from Employees › Active, "Password" button on the row (`passwordDialog`,
  `POST /api/password/set`; server-made, shown once; needs a work email; a reset ends the person's password sessions);
  the Edit dialog is unreachable since Vidya's clean-up (b8acc89), so it is not there. First sign-in with a temporary
  password: the server answers 403 `PASSWORD_CHANGE` to everything but `/api/me` and `/api/password/change` until
  the person picks their own (`passwordFirstPage`). Change password = top bar user menu (`changePassword`, not in View
  as). One form for both (`pwFormHtml` / `pwWire`). Rule: 8+ characters, a letter and a number (`passwordProblem` in
  `auth.js`, repeated in `pwWire`). Stored as scrypt hashes in `D.passwords` (own container in `KEYS`, never spread
  into employee objects or sent to the page); the session cookie carries `pv` (password version), so a change or
  reset signs out that person's other password sessions (Google sessions are not affected). 5 wrong tries lock that
  email for 15 minutes (in memory). No email sending yet, so "Forgot password?" (type the
  email first) calls `POST /api/auth/forgot` (open route, same answer for unknown emails, once per email per 10 min): the
  admins get a "Needs action" notification `pwreset|<id>` linking to `#/employees/pw/<id>`, which opens that person's
  Password dialog; `/api/password/set` resolves it (Harish 2026-11-18).
- Calendar: a reviewer connects their own Google Calendar (scope `calendar.events`, refresh token AES-GCM encrypted in
  `calendarLinks`). Schedule/Reschedule/Cancel on the Scheduling page create/move/delete the event with `sendUpdates=all`;
  Google emails the guests (employee + their manager when someone else schedules). Invite format (Harish 2026-11-23):
  title "Verve Advisory · Monthly Review: <name> (<month>)", description = simple HTML (`reviewNote` in `server.js`:
  logo from the Vercel address because sleeping Render made Gmail drop it, employee / reviewer / Zoom, a "before the
  meeting" list, form link); Google writes the rest (When, Organizer, Yes/No/Maybe, the green CHANGED marks on updates).
  Local testing only: `INVITE_TEST_GUEST=<any email>` in `pms/.env` (+ optional `INVITE_TEST_FOR=<employee name>`: that
  person's invites go to the test address instead) lets you receive the invite yourself; ignored on Render. Tested end
  to end locally 2026-11-23, then the test invites were cancelled and the test email swaps undone.
- Employees = the REAL company list (2026-11-12, from the "employee list" sheet: Name, Reporting Manager, Designation,
  Department (= team), Director; 76 rows + 4 top-level directors). Teams and reporting managers were replaced on
  2026-11-12 by Harish's team sheet ("Sheet4", the master for teams): 72 rows + 4 directors, 9 teams grouped by director
  (designations kept from the earlier list; the old file is `pms/private/employees.before-2026-11-12.tsv`). On 2026-11-13
  designations were corrected from the name/designation table of "Task_List_HRMS_Tool - Employee_List" (11 people, e.g.
  Consultants; specific titles like "Data Cloud Executive" kept), also on the `pms/employee-list` branch. Some team
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
  Review windows follow the departments (import and `migrate()` drop windows of teams no ACTIVE person is in, so old
  department names that only inactive people still carry, e.g. "HR & Admin" next to "HR", go; new ones get 25th to month end).
  Email, joining date and code are not in the sheet yet: blank / FY start / `V###`. Work emails were filled in the app
  on 2026-11-17 (Harish: firstname.lastname@verveadvisory.com, first + last word of the name; local data and staging),
  except Harish's own employee record, whose address the separate admin record already owned (local copy fixed
  2026-11-17: address moved to V011, admin record A078 switched off, ADMIN_EMAILS emptied in `pms/.env`; locally admin work
  uses the admin@ test login). Test logins manager@ / employee@ fall back to the first real manager / reviewed employee. The import keeps an
  existing email when the sheet has none. Admins use "View as". Admin dashboard starts with the "All stats" counts in the navy bar (Harish, 2026-11-13: the old review-progress bar with ring, window, dates, emails is gone for admins and managers; the five status cards below cover it)
  (`orgStats()` in `server.js`, `allStats()` in `app.js`).
  Dashboard card filters: Harish picked option A of the mock-ups (2026-11-17; he asked for "A + C", A first, C = a
  page-wide "Filters" drawer with removable chips is still to be decided). The panel's look (2026-11-19, Harish: "small
  premium Apple-like filter") = block "Compact filter panel" at the end of the styles: ~180px frosted popover with NO
  header (no "Filter · card" line; a small "Clear all" row only when a filter is on), rows = small icon + option name
  only (no current value text; the dot marks a filter that is on); the choice list (`.cfp-wide`, ~210px) has a back
  arrow + the option name, search, checkboxes / tick.
  A "Filter · N" pill on Review status (small
  header above the five status cards), Review quality and Team-wise progress opens a two-step panel (`cfOpen` / `cfDraw`
  in `app.js`, CSS `.cfpill` / `.cfp*`): Period (this month, last month, quarter so far, last 3 months, FY so far,
  counted back from the dashboard month), Team, Reporting manager, plus Compare (quality: the period before, shown as
  "Jul-Sep 0" next to each number) and Group by / Sort (progress). Each card filters on its own; choices are kept in
  `localStorage` `pms.cardFilters`; a period other than this month adds a tag ("Q3", "Oct") to the card title. A card with
  no filter shows `/api/home`; a filtered one reads `GET /api/home/card` (read-only, `server.js`; managers and admins
  only). If that call fails the card falls back to its unfiltered numbers with one toast.
  Plus a page-wide "Filter all cards" pill above Review status (Harish 2026-11-21, card `homeAll`, `all: true` = no fetch of
  its own): Period / Team / Reporting manager for the three cards AND "Needs your attention" (team / manager only, filtered
  in the browser; `/api/home` attention rows carry `managerId`). `cfFetch` merges it with the card's own filter: teams and
  managers must match both (none in common sends "-" = nothing), the card's own Period wins. "Needs your attention" runs
  the full width in two columns (`.attn-g`; Harish: no empty space beside it). Same pill on Analytics (`anAll`); the
  "what is on" line next to both = `cfSum`. The Employees page uses the SAME pill and panel
  (card `emp`, `local: true`: filters its list in the browser, no server call; Harish 2026-11-17): Designation (group from
  the master sheet), Role, Reporting manager, Work email, Work status; the dashboard's All stats tiles open it with only
  that Designation on (`empPreset`). While the admin's team tabs
  pick a team, the cards' Team field is hidden. After changing an API the page reads, restart the server.
- UI = the old PMS portal's look (Harish 2026-11-17: employees know that UI; layouts and functions stay, only the look):
  the "Old PMS portal look" block in `index.html` re-points the tokens to the portal's colours (navy `#23408b` = "the blue in
  My review", light blue `#cbdaff`, grey `#ececec` fields, yellow main buttons, plain dropdown lists and date picker). Side panel = one
  flat deep navy `--vr-navy-900` (Harish 2026-11-18: darker than the logo blue `#234788`, no glow orbs, no see-through
  white highlight; open page = logo blue `--vr-navy-800`). A panel-icon button at its top right (next to the logo; Harish picked it over an arrow) shrinks it to icons
  (`sideSet` / `navFly` in `app.js`, `#app.mini`, stored as `pms.sideMini`): names on hover, menu groups open as a pop-out.
  The count cards stay light-tinted (he rejected solid navy cards the same day). Yellow actions + soft page (Harish
  2026-11-19, managers like the navy look): every button / pill / dropdown button is the portal yellow (`--vr-pms-y`),
  delete stays red, switches green; dropdown fields pale yellow (`--vr-pms-y-50`), the chosen dropdown item yellow;
  selected tabs stay navy (blue = where you are, yellow = what you can do); page background `--vr-page` (soft
  blue-grey, not pure white), cards / tables / top bar stay white. Block "Yellow actions and a soft page" at the end of
  the styles in `index.html`. Tables = the portal's (Harish 2026-11-19, block "Portal tables", after it): only white,
  yellow and blue; navy head, white rows, dark text (no grey text or stripes), grid lines between all cells, light-blue
  hover; Team Report head row and average rows light blue `--vr-pms-blue`, Total soft yellow. The monthly form's
  tables (`.opf-t`) are left out. Review Report Team-wise = only the team table; "View people" on a row opens
  Organisation-wise (managers: "Employee-wise") filtered to that manager + team; Summary / Full details belong to the
  employee list only. Review Report search box right of the toolbar (`#rsearch`, `RF.q`): hides non-matching rows of the
  table on screen (reads only the chosen Final Status, not the whole list); counts and Export stay for the month. Final
  Status dropdown = each status once, no "(automatic)" option: picking the status the form gives on its own clears the
  hand-set one (server compares with `finalStatusAuto`). Performance Analytics redesign: three options (A Scorecard,
  B Heatmap, C Insights) shown to Harish 2026-11-19 as a private artifact, waiting for his pick.
  UI brief audit (Harish 2026-11-20; brief = `Downloads/VerviRecruit-UI-Brief.docx`, "our reference document"): PMS was
  built on it (base CSS in `index.html` up to the "Old PMS portal look" block), then deliberately overridden by the portal
  look, yellow actions, portal tables, green switches/toast/ratings and the Bklit analytics motion. Decision: KEEP the
  portal look; the brief stays the reference for structure and for anything not decided otherwise. Gaps fixed: PDF
  exports use the app's light tokens (`PRINT` / `printCss` in `app.js`, keep in step with the tokens; colours forced to
  print), `.alert-w` (orange) for warnings and `.warn` (red) only for errors, times in en-IN (`apWhen`, Audit Log too),
  and the brief's components page = `#/components` (admin, NOT in the menu: Harish removed the menu item 2026-11-20, open the address directly; `pages.components`: light and dark
  frames side by side with the app's own stylesheet, one note per item on where PMS differs and who asked). When a
  shared component changes, add it there. Loading (Harish 2026-11-20, from an image): a ring of 8 dots, one blue in
  steps of strength, turning in 8 steps (`ICON.loader`, `.spin`, `--vr-spin`; navy dots on yellow buttons, white on red);
  still no skeletons. Built
  on the VerviRecruit UI brief: all colours are `--vr-*` tokens in `public/index.html` (light on `:root`, dark on
  `html.dark`, stored as `pms.theme`); no raw hex; success = azure, green (`--vr-green-*`) only for on/off switches
  and the chart "submitted" colour (Harish asked for green switches, 2026-11-12), plus the success toast ("Answer saved"
  etc., `.toast.t-ok`, 2026-11-16). The monthly form (`drawForm`, CSS `.opf*`) keeps the old PMS portal's ORDER
  (managers' review meeting 2026-11-16) AND the old portal's LOOK (Harish 2026-11-17, with screenshots: "keep layout look and exact like this"; an app-style
  version was rejected), only more compact: `--vr-pms-*` tokens (yellow buttons, grey KRA band, cream section bars, navy
  table heads). Title "Monthly Reporting : <name link>", month / year / View Question-Answer, a card with a navy "KRA · FY | month" band and the employee details
  (review date, Copy KPI / Export KPI), then Operational / Process / People (heading + description, "Weightage of KRA"
  pill with pencil, fold arrow `folded`, table with Totals row (first column "S.No"; delete a sub-KRA = red trash in its
  own "Action" column at the row's end, only while KRAs are editable; the form's status badge is large, `.opf-top .badge`;
  Harish 2026-11-19), Add sub-KRA / Save; save asks "Are you sure? You want to
  add all these KPI?", then "Added! Your KPI has been added."), the Rating table (`ratingBox`: reviewers/admins see it once
  every rating is in, the employee only after submit), Question-Answers (Self/Manager/Remark heading only above the first
  rated question), Back to top, "Save Final Reporting" (= Submit review). KRA ratings (self and manager) get a solid fill by
  value (`rateCol`, `--vr-rate-g/y/r` tokens, white numbers): THREE dark colours only (Harish 2026-11-19: the bright
  orange / yellow looked light, never use light fills here): 75+ dark green, 50-74 dark amber, below 50 dark red. The
  employee's "Request KRA change" button is titled "Allow to add new KPI" (managers: only the title changes). Theme button and the user menu
  live in the top bar: clicking the name/avatar opens a small menu (same look as the other dropdowns) with Profile
  information and Sign out. Profile information is a page, not a popup (`#/profile`, `pages.profile`, `GET /api/profile`):
  hero + Work details card (code, email, designation, department, role, joining date, review window, reports) +
  Reporting line card (director down to the person), read-only, the admin keeps the details. Code and joining date from the list are placeholders (shown "Not set yet") until the
  admin sets them in Employees › Edit (`codeSet` / `joinedSet` flags). The page scrolls inside `#main`, not the window (`SC()`). No page footer (Harish
  removed it, 2026-11-12). Admins get a grouped menu (Reporting / Questions
  open as sub-menus). Settings › Questionnaire is its own page (`#/questions`, `pages.questions` → `questionsBox`);
  Parameters summary (`#/params`) shows only the parameters (Harish 2026-11-19; old `#/params/questions` redirects).
  The Questionnaire page manages only the text-answer questions: the rating questions (6-12) stay on the review form
  but are not listed, added, edited, deleted or reordered there (`editable` in `server.js`, Harish 2026-11-19). The "Reporting manager" group (5 lists by designation) was removed on 2026-11-13 (Harish: it
  duplicated the dashboard's All stats cards, which count by role = reporting line, and the Employees role filter). Who
  reports to whom is the "Reporting flow" (`#/reporting`, `pages.reporting`, `GET /api/org`): directors (no manager) →
  click to drill down; opened from the Employees page button and names, highlights Employees › Active in the menu (Employees is a menu group with Active / Inactive, 2026-11-16);
  old `#/reporting/<level>` links open the directors. Managers' "My team" is the same drill-down (a later merge candidate);
  it has no tabs since 2026-11-23 (Harish: the "My team" / "Reporting Manager" buttons repeated the heading, and the
  managers under you are already rows with their team one click away; `/api/myteam` no longer sends `managers`).
  Login page = split: navy left panel (dot grid, a floating sample monthly-review card with example numbers, rotating
  captions; `authBrand()` / `authBrandRun()` in `app.js`, Harish picked this design 2026-11-12), sign-in form on the right.
  There is no Settings page: review windows are on the Scheduling page (admin); admins can also edit a window from the
  dashboard. The review rules (thresholds) are NOT settings since 2026-11-19 (Harish): fixed in `RULES` in `data.js`
  (Operational 40-80, People 10-20, ClickUp 60, learning 60 = one value for the flag and "properly done", gap flag 20,
  email gap 15, 30% self / 70% manager, 15 words, 3 Operational sub-KRAs); no Review rules form, no `PUT /api/config`,
  `migrate()` drops older saved copies. Status names shown to users: "Review Not Completed" = "Form
  incomplete", "Pending" = "Overdue" (server keeps the old names). Teams = the list's departments. Top-level directors
  carry the team name "Directors" (was "Leadership") internally, but it is NOT a team (Harish 2026-11-19): left out of
  `teamNames()`, `/api/me` teams, the dashboard team tabs, Teams page and Employees chips (team shows "–"); the name
  cannot be used for a new team. The dashboard's "Review quality" card is now called "Review insights" and the All stats
  numbers are all plain white (role colour only in the dot), 2026-11-19. `migrate()` in `data.js` updates older saved state on boot.
- Small add-ons (Harish 2026-11-18): the dashboard's Filter pill + panel is also on Review status report (`report`),
  Team report (`yearly`), Scheduling team members (`sched`) and Audit log (`audit`): all `local` cards in `CF_CARDS`,
  page choices in `PF`, the page's own state (RF / YF) stays the truth; `cfClear` / `clearLink` for empty lists.
  Search = top bar button / Ctrl+K (`palOpen`: side menu links + `/api/report` rows; Enter opens the person's form).
  Side panel starts shrunk under 1100px (`sideNarrow`). Leaving the monthly form with an answer typed but not ticked
  asks first (`navGuard` / `formUnsaved`, also `beforeunload`). Every CSV goes through `csvSave` / `fileSave` (Export
  CSV on Employees and Team report too). Scheduling has a List / Calendar switch (`calView`, `pms.schView`). Its Team members cells (Harish 2026-11-23) use the app's own pieces: date + time as text with a yellow Schedule / Reschedule button at the right of every row (`.slotc`), Invite sent / Not sent / No work email / Moved N× = `.badge` (never class `ok` / `warn` on a chip: those are the big message boxes). Same pass on other pages: a toolbar's Filter pill is as tall as its buttons (`.row>.cfpill`; card pills stay small), Reporting flow's Monthly report = yellow `btn sm` "Open" (the purple `.sqbtn` is gone). Team
  report had a rating trend per person (small line + change vs the month before); Harish removed it 2026-11-20.
- People are added only through the employee list import (the sheet is the master): the Employees page's "Add new
  member" button and `POST /api/employees` were removed on 2026-11-13 (Harish). Admins still edit and move people.
- Reporting changes (2026-11-12) all go through `planMove` / `applyMove` in `server.js` (Employees table + Edit,
  Move to inactive). Move to inactive asks a new manager per direct report (2026-11-16: "Set all to" + one row each, so
  a team can be split, or one of them promoted to lead the others; `body.moves` = {reportId: managerId}, checked as one plan
  for loops, applied promoted-first). Checks: new manager active, not the admin account, no loops; "No manager" asks first (top-level
  director, not reviewed). If this month's review has started (`reviewProgress`: meeting set, sent to manager, manager
  ratings, KRA request) the admin picks "keep" (old manager finishes; `e.pendingManager` applies from next month via
  `applyPendingMoves()` on each request) or "move now" (old manager's invite cancelled, meeting date cleared, pending KRA
  request marked `movedFrom`). Roles are derived, never picked (`L.deriveRole` / `refreshRoles`, same rule as the import;
  only Admin is a choice in Edit); anyone active can be picked as a manager. People involved get notifications (see below). Submitted forms keep `f.reviewedBy` (manager at the time):
  the form header and Team report ("by <name>") use it. The employee sheet stays master: an import replaces app-made
  reporting changes (`managerSetInApp`) and lists them. Admins CAN schedule any review again (Fiza, 2026-11-19: a manager
  on leave or short of time shares the dates on WhatsApp / the sheet and the admin books them, invite from the admin's own
  calendar): `manageForm` only checks `canManage`, the admin's Scheduling page lists everyone (only directors get
  `directOnly`), `managerOnly` is always false (the 2026-11-17 "admins never schedule" rule is gone).
- Team follows the reporting manager (Harish, 2026-11-12): a new manager (Employees table/Edit, moving a manager to
  inactive, or a planned "keep" move when it takes effect) puts the person in that manager's team, and the people under
  them who were in their old team come along (`teamOfManager` / `moveTeam` in `server.js`). Exceptions: reporting to a
  top-level director keeps the person's own team (directors lead several departments); no manager = "Directors"; a team
  the admin picks by hand in the same save wins. The Edit dialog fills the Team field as soon as a manager is picked.
- Teams (2026-11-13): a team = the `team` name on each person + its window in `config.windows`. Admins add / rename /
  delete (only when nobody active is in it) teams on the Teams page in the admin menu (`#/teams`, `pages.teams` in `app.js`;
  `GET|POST|PUT /api/teams`, `POST /api/teams/delete` in `server.js`; the Window button reuses `windowDialog`). Vidya and
  Harish each built a Teams screen; they were merged into this one page (no Teams button on Employees). Shown names
  (Fiza 2026-11-19): "Team <short name>" everywhere (`teamLabel` in `server.js` -> `S.me.teamLabels` / `tl()`, Teams page
  via `label` from `/api/teams`): Team Accounts, Team HR, a person-named team uses the first name ("Team <first name>");
  stored names do not change. Because the sheet
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
  reporting changes, window / rules / questionnaire / parameters changes, list import (admins). "Remind not
  filled" on the dashboard's Review status header (`remindAll()`, `POST /api/remind`, dry run counts first; managers,
  directors, admins; not in View as): action item `remind|<emp>|<month>` to every Not Filled person in scope (leave /
  notice skipped), once per 12 h per sender (in memory), resolved by self-submit (Harish 2026-11-18). In View as the admin
  sees the person's list but never marks it read. No email yet (no sender; Google Calendar already emails invites).
- Reschedule count = distinct new dates (`rescheduleCount` in `logic.js`), not the number of edits. Scheduling's
  Rescheduled column shows it as "1 time" / "2 times" (was "Moved 1×"; Harish 2026-11-23), dates on hover.
- PMS report format (management's "PMS Reports Format" sheet, 2026-11-13) = the Review status report's "Full details"
  switch (`/api/report?detail=1`, `fullTable()` in `app.js`) and its CSV export (same columns, sheet order: `PMS_COLUMNS` in
  `server.js`), built by `pmsDetail()` in `logic.js`. No AI: the Operational/Process/People remark columns join each
  sub-KRA's self and manager remark. Scheduled Date = first date picked (`f.firstScheduledDate`, older forms: first
  reschedule's `from`). Actual Date (Fiza, 2026-11-19) = the day every KRA got its manager rating (`f.mgrRatedOn`, set by
  `L.trackReviewDay` after each `PUT /api/form`, also fills the form's Review Date; taking a rating out clears it), not the
  scheduled date or the save day; older forms / new joiners fall back to `f.reviewDate`. Final Status: automatic =
  Review Done / Questionnaire Done / Pending, "PMS form incomplete/errors/queries" (all
  ratings in but a blocker), "Employee on leave" / "Serving Notice" (admin sets `e.workStatus = {type, from}` in Employees ›
  Edit, from that review month on). Admins and the person's managers can pick it by hand in Full details (Fiza
  2026-11-19, dropdown `fsSelect`, `POST /api/report/final-status`, kept per month in `f.finalStatusSet`, "(automatic)"
  clears it): `L.FINAL_STATUSES` = Review Pending, Review Done, Questionnaire Pending, Questionnaire Done, PMS form
  incomplete/errors/queries, Employee on leave, Serving Notice, N/A ("Review not done" = Review Pending). Full details: first
  column "S.No" (also in the CSV), S.No / Employee Code / Name stick while scrolling sideways, even column spacing.
  Past reviews April-October 2026 (Harish 2026-11-20) come from the old portal's export "t1" (CSV in Downloads, kept as
  `pms/private/history-2026.csv`), written by `node private/import-history.js [--apply]` (git-ignored, same local /
  staging switches as the codes script): one form per person-month, KRA weight = sum of its sub-KRA weights, the
  sheet's Remark = self remark; every KRA with both ratings = submitted + locked, `reviewedBy` = the sheet's manager (old
  reviewers not in PMS keep only the name), else unfinished; `f.imported` = {from, on, manager} shows a note on the
  form; `qSnapshot` = that month's questions (shown "Not added"; the export has no answers; an empty list hid the
  whole Question-Answers section, repaired by the script). For imported forms `logic.js` does not flag the missing review
  date, question answers or manager remarks (not in the export), and `dueInfo` says "Not recorded" (Analytics skips
  them in Reviews held on time); an imported form counts as "Filled" when it has KRAs and every sub-KRA has a self
  rating (`importedFilled` in `logic.js`, Harish 2026-11-21); real gaps (SOP links, weights, rating gaps) are still flagged. People in the sheet not in PMS were added as inactive
  (`src: 'history'`, kept by list imports); 6 spelling fixes in `ALIAS`. Never touches a form that has KRAs; the current
  month is skipped. Applied to LOCAL data 2026-11-20 (backup `private/state.before-history-2026-11-20.json`); staging
  2026-11-23 (same 411 forms / 343 submitted / 4 added inactive; backup `private/staging-backup-2026-11-23.json`; Render
  redeployed right after with an empty commit). Three manager ratings above 100 in the sheet were kept as they are.
  Employee codes (2026-11-19) come from "Task_List_HRMS_Tool - Sheet5" (PDF): `pms/private/codes.tsv`, written by
  `node private/apply-codes.js [--apply]` (git-ignored, matches by name; 4 people have no code yet). Checked against the
  PDF in Downloads (82 codes, identical) and applied to the LOCAL data on 2026-11-19 (backup
  `private/state.before-codes-2026-11-19.json`) and to STAGING the same evening (already had them; backup
  `private/staging-backup-2026-11-19.json`). Re-checked 2026-11-27 on every page: all 72 sheet codes match; one inactive person
  added later by the history import got their sheet code locally. People with no sheet code show "Code not set yet" on
  Employees › Active (like the reports / Profile), never the V### placeholder; that page no longer shows "No work
  email" (banner and row text, Harish). A plain `node server.js` has no saved data, so it shows V### and no emails:
  run `npm run local`. Since 2026-11-27 the shared list (`pms/employee-list`) carries Employee Code and Work Email
  columns and the 4 directors as rows (no manager, team "Directors"), so a teammate's fresh local copy gets real codes
  and emails too (it showed "Code not set yet" for everyone before). Full details headings are centred, compact, at most
  two lines; every dropdown arrow uses `--vr-caret` (navy, yellow in dark mode).
  Departments (Harish 2026-11-19, "use department names properly"): the REAL department (Finance & Accounts, HR & Admin,
  Sales Team, Cloud Data, Social Media) from the Department column of "Task_List_HRMS_Tool - Employee_List" is its own
  field `e.department` (private/departments.tsv, `node private/apply-departments.js [--apply]`, same name matching as
  the codes; kept by list imports). Everything labelled "Department" shows it (Review Report Full details + CSV,
  Annual review, Profile › Work details); the TEAM (`e.team`, team sheet) is unchanged and still drives reporting lines,
  windows, team tabs and filters. Applied to LOCAL data 2026-11-19 (backup `private/state.before-departments-2026-11-19.json`),
  and STAGING (2026-11-19, 76 people incl. 5 inactive; Render redeployed with an empty commit right after so its
  in-memory copy did not save over it). No department in the PDF: the 4 directors and one consultant. DOJ and April-October
  history: Fiza / Vidya still to share. Escalations: new joiner KRA due since <month> (month after 2 complete questionnaires),
  KRAs / SOP / learning missing 2+ months, same SOP / learning topic (same link or remark) 2+ months running (the employee is warned first: orange note at the top of "What is left on my form", `L.topicRepeats` -> `/api/home` `own.repeats`, a warning not a blocker; Harish 2026-11-23 picked this over three new dashboard cards he judged repeats). Rules
  (fixed, `RULES` in `data.js`): `learningMin` 60, `qMinWords` 15, `opMinSubKras` 3.
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
  `hydrate` keeps `config` defaults from `data.js` that the saved copy lacks; the audit log keeps the latest 3000 entries.
- Production check (Harish 2026-11-23, "check every component before production"):
  - Serving (`serveStatic` in `server.js`): files are cached in memory and compressed once (brotli/gzip; first visit
    ~120 KB instead of ~520 KB), JSON answers over 1.4 KB too. index.html loads `app.js?v=<hash>`, which is cached for a
    year. Only the file types in `MIME` are served (no dotfiles, the .docx or vercel.json). Requests are capped at 2 MB,
    a 500 shows a plain message (details only in the log), SIGTERM finishes the last save, keep-alive is 65 s (fewer proxy 502s).
  - Security headers on every answer: CSP (scripts only from the site + the hash of the ONE inline theme script in
    `<head>`, computed by the server; so NO inline `on*=` handlers and no new inline scripts), nosniff, DENY framing,
    HSTS over https, `X-Robots-Tag: noindex`. The Vercel mirror sends the same from `vercel.json` / `public/vercel.json`,
    where the theme-script hash is written out: change that script = update both files.
  - "SEO" for an internal tool = stay out of search engines (`robots.txt` Disallow, meta robots noindex) + description,
    theme-color and link-preview tags; `head()` in `app.js` names the browser tab after the page.
  - The app's date follows the real date in India (`syncClock()` in `server.js`, each request + boot; `PMS_TODAY`
    overrides it): `config.today` was stuck at 2026-11-04 and `currentMonth` would never have reached December.
  - Input checks: `PUT /api/form` / `PUT /api/kras` refuse bad shapes, texts over 5000 characters, ratings off the scale,
    weights outside 0-100, more than 30 sub-KRAs, a non-date review date; answers only for the form's own questions.
    Scheduling routes run one at a time per review (`oneAtATime`), so a double click sends one calendar invite.
  - `modal()` = a real dialog (role, focus in and back, Tab stays inside, Escape closes the top one, `m.onClose`); a
    global `unhandledrejection` toast; non-GET calls are not repeated on a 504; keyboard focus rings and phone fixes in
    the "Production check" block at the end of the styles.
- Domain rules: KRA ratings are percentages, 10-100 in steps of 10 (`KRA_SCALE`; were 0-5 until 2026-11-12, `migrate()`
  converts old saved data x20 and marks `config.ratingScale = 100`); questionnaire ratings stay 0-5; thresholds
  `clickupMin`/`learningMin` are % and the gap flags are percentage points. Employees' "What is left on my form" lists
  only what they fill in (`employeeTodo` in `logic.js`); the employee dashboard is one navy bar (what to do now, days left in the window, the four review steps incl. meeting, review date and rating; since 2026-11-23 a slim segmented track `.eh-seg`: Self review / Submit to manager / Review meeting / Manager review, no numbered circles) above that list and My recent ratings (2026-11-13: ring, facts, four cards and the Review steps box removed as repeats); KRA set-up and review-date alerts are for managers only. The
  form shows a Review summary (`kraSummary` / `formSummary`), also in a dialog after Save draft / Submit; hidden from
  employees (`showSummary()` in `app.js`, Harish's call 2026-11-12), reviewers and admins see it.
  Monthly form is two steps: the employee clicks "Submit to manager" (`POST /api/form/self-submit`, blocked until
  `employeeTodo` is empty; sets `form.selfSubmitted`, their part is then read-only), the manager can "Send back to
  employee" (`POST /api/form/return`) or "Submit review" (`POST /api/form/submit`, final). Everyone who can edit gets
  Save draft; employees' entries also autosave. Question answers have no Save button (2026-11-17): they save after a
  short pause in typing and when the box is left, showing "Saved automatically". Autosave sends only the fields that person changed (`formDirty` in
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
- Meeting with Fiza, 2026-11-19 (recording): menu names in Title Case: Review Report (was "Review status report": it
  shows more than status), Performance Analytics (new, between Review Report and Team Report), Team Report, My Report,
  One Pager Document, Parameters Summary, My Review, My Team, Audit Log. Performance Analytics (`#/analytics`,
  `pages.analytics` / `anDraw`, `GET /api/analytics`; admins = everyone, directors / managers = the people under them)
  is charts only. Layout = "C2 command centre" (Harish picked it 2026-11-19 from three rounds of mock-ups, private
  artifact claude.ai/artifact/S7ZGYd2y1BTUxJaAwRu2kp): `.anx` with `--vr-anx-*` tokens: LIGHT by default (white cards on
  the page, like the rest of PMS), the dark command-centre panel only in the app's dark mode (`.dark` tokens; Harish
  2026-11-19: "light look, dark only when I switch globally"). 12 cards: Average rating (notched gauge, 75 mark), Strong performers (month bars),
  Who is moving (dot per person up / steady / down), Review cycle funnel for this month (layered bands, %
  pills; due → meeting booked → filled → ratings in → submitted; Remind button = `remindAll()`), KRA scores (rings),
  Reviews held on time (on time / late / missed per finished month, from `dueInfo`), Rating bands (tick donut),
  Parameters = ONE pie card (`anPar`): the parameter (Attendance, General conduct, ...) is picked with tabs ON THE CARD
  (`.antab`, short names, navy = selected; Harish 2026-11-19: hidden in the Filter nobody finds it; he also rejected a
  radar and one card per parameter). The pick is kept in `CF.anPar.xpar`, hidden from the panel (`PF.hide.anPar`); pie of the
  manager's 1-2 / 3 / 4 / 5 ratings, full marks yellow, average in the middle. Team race (squares), Review meetings
  calendar (this month, held up to `config.today`, booked after), Needs attention. Card order (Harish 2026-11-23,
  card-by-card review): top block `.anx-top` = Review meetings calendar on the left, a compact Review cycle funnel on the
  right with Average rating, Strong performers and Who is moving under it (`.anx-3`); the separate Parameter rating card
  was removed (empty on the old-portal data and a repeat of the Parameters pie card). Every row below fills the 12
  columns (order = the `anx-grid` line at the end of `anDraw`). Average rating also shows the
  lowest / highest team under the gauge and has Reporting manager in its Filter. Review meetings (same day) = a
  summary that leads into Scheduling, not a second scheduling calendar: booked / to book / windows closed on top, each
  person's review window shaded (`cycle.win` from `/api/analytics`), a count badge per day (navy held, yellow booked),
  days run to the last window day and stretch to the card height; closed windows with reviews not booked = an
  orange warning symbol after "N windows closed", the teams on hover (no warning lines: Harish wanted it smaller); a day
  or the Scheduling button opens Scheduling › Calendar (`data-ansched`). The three cards under the funnel are compact
  (`.anx-3` rules: smaller padding / numbers / charts, icon-only Filter pill). History cards (Harish 2026-11-20, on the old portal's
  April-October data): Rating trend (overall + KRA lines per month, review count bars), Self vs manager (gap per month,
  people 15+ above / 10+ below), People (tabs Top / Needs support / Most improved / Dropped most, `AF.rank`), Ratings by
  reviewer (`scores[m].by` = `f.reviewedBy` at the time; manager rating given vs the average of all reviewers, self
  gap). Card period defaults to the financial year (`xper: 'fy'`; saved "6" moved once, `pms.anPerV`). The API also
  sends people who LEFT (`left: true`) for the months they were reviewed (aggregates count them; Who is moving, People,
  Needs attention use `now()` = without them), and `tracked` = first month with a review date kept in PMS: on time /
  late / missed only from then (old-portal months are not "missed"). Checked 2026-11-20 against the CSV: all 343
  scores, monthly counts and averages identical. EVERY card has its own Filter pill =
  the shared card filter panel (`CF_CARDS` an*, local, keys `xper` period 3 / 6 / FY, `xteam`, `xdesig`, `xmgr`, `xpar`;
  `free: true` keeps a saved pick whose choices only load later). Plus ONE page-wide "Filter all cards" pill above the
  cards (Harish 2026-11-21, card `anAll`, same panel, `pill` label in `CF_CARDS`): Period / Team / Designation / Reporting
  manager for every card (`G` in `anDraw`); a card's own team / designation / manager narrows it further (both must
  match), a card's own Period wins over the page's; what is on is listed next to the pill with "Clear filters". Filter
  panels of pills on the left half of the screen open to the right (`cfPlace`). API rows per person:
  team, group, managerId / manager, `scores[month]` (submitted only: total, KRAs, self, mgr, params), `timing[month]`
  (on / late / missed, finished months), `cycle` (this month). Scores end at the latest finished month with data. Hover
  numbers: `#antip` (`anTipWire`). FY kept in `localStorage` `pms.analytics`.
  Bklit UI look and motion (Harish 2026-11-20, screen recording of bklit.com charts; Bklit is React/shadcn, so it is
  rebuilt by hand in vanilla SVG/CSS, never installed): he wants Bar, Funnel, Pie, Ring, Sparkline, Heatmap and the
  tooltip; NOT radar, scatter, sunburst, background patterns / grid, choropleth map. Entrance plays only on cards whose
  HTML changed (`AN_LAST` vs `out` in `anDraw` adds `.anin`; CSS keyframes `an-*`, off under reduced motion; `num()` +
  `anCount()` count numbers up). Bars spring up (`.grow`), funnel steps curve into each other and wipe in (`.wipe` /
  `.fin`), pie and band donut sweep in clockwise (`sweepMask`), rings sweep (`.ringa`, pathLength 100),
  Rating trend lines draw in (`.sp-l`, crosshair on hover), calendar days pop in as a diagonal wave. Hover sync: marks and legend rows
  sharing `data-hk` light up together, the rest of the card dims (`.hot`, `[data-hot]`); month labels turn into a pill
  (`xlab`); pie slices pop out (`.pslice`); ring centre shows the hovered KRA (`.an-ctr`, `data-cv` / `data-cl`).
  Tooltip = Bklit card (`tipH(title, [[colourVar, label, value]], footer)`). The "Sample data" switch (made-up ratings) was REMOVED
  2026-11-23 (Harish: the real April-October data is in); the page shows real submitted reviews only, and an old saved
  `sample` choice in `pms.analytics` is dropped. Checked that day: all 343 scores (total, KRAs, self, manager, reviewer)
  identical to the old portal's CSV, card numbers recomputed by hand for admin / manager / director. Team Report: Export menu
  with CSV and PDF like Review Report (`exportMenu`, `yearlyPdf` / `printHtml`), Total row soft yellow.
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
    npm run employees -- private/employees.tsv [--apply]   # check / write the real employee list (staging; restart Render after)
    node employees.js private/employees.tsv --apply --local-state   # same into npm run local's data (stop the local server first)
Smoke test (demo sign-in, i.e. no Google env): `curl -c j -H 'Content-Type: application/json' -d '{"id":1}' localhost:3000/api/auth/demo`
then `curl -b j localhost:3000/api/me` (ids follow the list order; the test admin "Verve Admin" A900 is the highest id). Non-GET calls must send `Content-Type: application/json`.

## Staging (live)
| Piece | Where | Notes |
|---|---|---|
| Source | personal repo `harishkandi/verve-pms` (git remote `personal`), branch `main` | public repo; push here to deploy |
| App (pages + API) | Render web service `verve-pms` → https://verve-pms.onrender.com | Singapore, root `pms`, `npm ci`, `node server.js`, env `DATABASE_URL`, `NODE_VERSION=22`; free tier sleeps after 15 min (first hit ~1 min) |
| Frontend mirror | Vercel project `verve-pms` → https://verve-pms.vercel.app | static `pms/public` only; `/api/*` rewritten to Render via `pms/vercel.json` (root = `pms`) or `pms/public/vercel.json` (root = `pms/public`). Must never run `server.js` itself, or it keeps a separate copy of the data |
| Database | Neon org "Verve" `org-super-credit-06911774`, project `verve-pms` `winter-truth-42259263`, branch `production`, Singapore | use the pooled URL (`-pooler` host). Local copy in repo-root `.env.local` (git-ignored, written by `neon init`) |

502s (2026-11-19): the free Render service sleeps after 15 idle minutes; the first call after that (every morning)
waits for it to start, and Vercel's `/api` forwarder or Render answers 502/503/504 meanwhile. `apiCall` in `app.js`
repeats such calls (non-JSON 502/503/504 = never reached PMS) every 4 s for up to 2 min. `GET|HEAD /api/health`
(no sign-in, no DB) is for an uptime pinger every 10 min to keep Render awake (one always-on free service fits the
750 free hours a month).

`render.yaml` describes the planned org-repo Blueprint (`verve-pms-staging`, branch `feature/pms`); the live Render
service was created by hand from the personal repo and does not use it.

Check Vercel really forwards to Render: change something on Render (e.g. a team's review window, signed in as admin),
read it back through Vercel, then restore it. Different values = Vercel is running its own copy.

## Git workflow
- Remotes: `personal` = harishkandi/verve-pms (staging), `origin` = adminsoftware-alt/verve-hrms (official, private).
- Harish works on local `pms/harish` and deploys with `git push personal HEAD:main`.
- Vidya works on `origin/feature/pms`. To take her changes: `git fetch origin && git merge origin/feature/pms`,
  test locally, then push to `personal`.
- Every finished update goes to BOTH (Harish, 2026-11-17): `git push personal HEAD:main` (staging) and
  `git push origin pms/harish` (updates PR #1 into `feature/pms`). Vidya also pushes to `origin/pms/harish`: fetch and
  merge it first. Never push directly to `feature/pms`. Several Claude sessions may share this folder: check
  `git status` before committing and tell the others.
- Staging data changes (e.g. the work emails, 2026-11-17) can be written straight into the Neon `pms_state` row, but
  Render keeps the state in memory and saves its whole copy back: restart/redeploy Render right after, or it is overwritten.
- Vercel Hobby blocks deploys of non-owner commits from private repos, which is why staging runs from the personal repo.
  The org admin login (adminsoftware-1151) is not available.

## Gotchas
- Windows: shell is PowerShell by default; Git Bash also available. Git's "LF will be replaced by CRLF" warnings are harmless.
- `pg` warns about `sslmode=require`; `db.js` rewrites it to `verify-full` (same behaviour, no warning).
- Root `package.json`, `package-lock.json` and `neon.ts` were created by `neon init` (Neon config tooling); the app does
  not use them and they are not committed.
- Working style: give setup/deploy steps one at a time and wait for confirmation; one clear recommendation, simple wording.
