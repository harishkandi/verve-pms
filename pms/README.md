# Verve PMS (local demo)

Performance Management System built from the PMS review spec. Dummy data, in-memory, no dependencies.

    cd pms
    node server.js        # or: npm start
    open http://localhost:3000

Pick a user on the login screen (no passwords in the demo). Data resets on restart.

Good users to try: Anita Verma (Director), Rohan Shah (Manager), Aarav Mehta / Neha Rao (Employee), Priya Menon (Admin).

Assumptions where the spec was open: monthly rating = per sub-KRA 30% self + 70% manager, weighted by sub-KRA weight, then by KRA weight;
rating questions (6-12) use a 0-5 scale; "Pending" = due date (end of the team window) has passed and the review is not completed; emails are drafted then sent manually (logged only).

## Database (Neon Postgres)

When `DATABASE_URL` is set, all PMS data is stored in Postgres (`db.js`, one `pms_state` row) and survives restarts and deploys.
The first start against an empty database saves the seeded demo data. Without `DATABASE_URL` it runs in memory as before.

    npm install
    npm run dev           # reads DATABASE_URL from ../.env.local (created by `neon init`)
    npm run db:reset      # wipe the stored state; the next start seeds fresh demo data

## Staging

One staging environment per HRMS module, each deploying from its own branch of `adminsoftware-alt/verve-hrms`.
For PMS: branch `feature/pms`, Neon project `verve-pms` (Singapore).

- **Render** hosts the whole app (pages + API) from `render.yaml` at the repo root: render.com -> New -> Blueprint ->
  this repo; paste the Neon pooled connection string when asked for `DATABASE_URL`.
  Free tier sleeps after 15 minutes idle (first visit ~1 minute).
- Workflow: work on your own branch (e.g. `pms/harish`), open a pull request into `feature/pms`; merging it redeploys staging.
- The hosted site shows a STAGING badge.
