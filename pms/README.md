# Verve PMS (Performance Management System)

Monthly KRA reviews, review meetings and reports for Verve Advisory. Plain Node (20+), no framework, one
dependency (`pg`). The full notes for developers are in [`../CLAUDE.md`](../CLAUDE.md).

    cd pms
    npm install
    npm run local     # http://localhost:3000, keeps its data in private/state.json
    npm start         # in memory (resets on restart) unless DATABASE_URL is set

Settings are environment variables, listed in `.env.example` (copy it to `.env` for local runs).
Sign-in is Google (the verveadvisory.com Workspace) or the person's own PMS password; local runs without
Google also offer the test accounts.

| File | What it does |
|---|---|
| `server.js` | HTTP server, every `/api` route, static files from `public/` (compressed, with security headers) |
| `logic.js` | review rules: status, ratings, validation, reports |
| `data.js` | the app state (config, employees, forms, ...) and `migrate()` for older saved data |
| `db.js` | stores the whole state as one row in Postgres (`DATABASE_URL`) |
| `auth.js` | Google sign-in, passwords, the session cookie |
| `calendar.js` | Google Calendar invites for review meetings |
| `notify.js` | the bell's notifications and date reminders |
| `employees.js` | imports the employee list (`private/employees.tsv`, never in git) |
| `public/` | the whole page: `index.html` (markup + styles) and `app.js` |

Staging: push to the personal repo's `main` (Render runs `node server.js`, Vercel mirrors `public/`).
