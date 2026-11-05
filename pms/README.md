# Verve PMS (local demo)

Performance Management System built from the PMS review spec. Dummy data, in-memory, no dependencies.

    cd pms
    node server.js        # or: npm start
    open http://localhost:3000

Pick a user on the login screen (no passwords in the demo). Data resets on restart.

Good users to try: Anita Verma (Director), Rohan Shah (Manager), Aarav Mehta / Neha Rao (Employee), Priya Menon (Admin).

Assumptions where the spec was open: monthly rating = per sub-KRA 30% self + 70% manager, weighted by sub-KRA weight, then by KRA weight;
rating questions (6-12) use a 0-5 scale; "Pending" = due date (end of the team window) has passed and the review is not completed; emails are drafted then sent manually (logged only).

## Staging (Render)

`render.yaml` at the repo root deploys this folder as one free Render web service (pages + API, no database).

1. render.com → New → Blueprint → pick this repo (Render's GitHub app needs access to it).
2. It deploys branch `pms/kandi-dev`, runs `node server.js`, and redeploys on every push.
3. The hosted site shows a STAGING badge. Data is the seeded demo set and resets on every restart or deploy;
   the free tier sleeps after 15 minutes idle, so the first visit after that takes about a minute.
