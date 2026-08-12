# WAVE Scorecard

A transaction-readiness assessment for an advisory firm. A prospect
answers 28 statements across four gaps (Wealth, Accounting, Value,
Earnings), each rated 1-5 with its own specific rubric, and gets a scored
readiness report immediately. Every submission is saved and reviewable by
firm staff as a table and a downloadable Excel export.

This rebuild fixes the main weakness of the old prototype: the 1-5 scale
used to mean the same generic "strongly disagree to strongly agree" on
every question. Now every question defines its own 5-point rubric (see
`lib/questions.ts`), so a 3 on one question and a 3 on another represent
two different, specific, real states of the business.

## Quick start (local dev)

You need Node 20+ and a Postgres database.

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL and ADMIN_USERS
npx prisma db push        # creates the `submissions` table
npm run dev                # http://localhost:3000
```

Run the test suite (scoring math, the exact worked example from the old
prototype's screenshots, and question-bank integrity checks):

```bash
npm test
```

## Deploying (no existing accounts required)

Everything below is free and takes about ten minutes total. Do this once;
after that, every `git push` auto-deploys.

1. **Push this repo to GitHub.** If you don't already have a GitHub
   account, create one at github.com (free). Then, from this folder:
   ```bash
   git remote add origin https://github.com/<you>/wave-scorecard.git
   git branch -M main
   git push -u origin main
   ```
2. **Create a free Vercel account** at vercel.com, signing in with your
   GitHub account (one click, no separate password).
3. **Import the project.** On the Vercel dashboard, "Add New" ->
   "Project" -> select the `wave-scorecard` repo -> Import. Leave the
   build settings on their Next.js defaults.
4. **Add a database before the first deploy.** In the project's
   "Storage" tab, click "Create Database" -> Postgres (this provisions a
   free Neon-backed Postgres instance and wires `DATABASE_URL` into your
   project's environment variables automatically, no separate signup).
5. **Add your staff's admin logins.** Project Settings -> Environment
   Variables -> add `ADMIN_USERS` as comma-separated `Name:passcode`
   pairs, one per person who needs to review submissions, e.g.
   `Alex:pass-alex-2026,Sam:pass-sam-8841`. Add or remove people later by
   editing this one variable and redeploying, no code changes.
6. **Optional: email notifications.** Notifications are sent through
   Gmail's SMTP server using an App Password. On the sending Google
   account, turn on 2-Step Verification, then generate an App Password
   (Google Account -> Security -> App passwords -> "Mail"). Add
   `GMAIL_USER` (the sending address), `GMAIL_APP_PASSWORD` (the 16-char
   App Password), and `NOTIFY_EMAIL` (who to notify, one address or
   several comma-separated) as environment variables. Gmail delivers to
   any recipient with no domain-verification step. Leave these blank to
   skip notifications; nothing else breaks.
7. **Push the schema to the new database.** With `DATABASE_URL` from
   Vercel's dashboard copied into a local `.env`, run
   `npx prisma db push` once from your machine to create the
   `submissions` table in the real database. (Or run it from Vercel's
   own shell if you'd rather not have the production URL locally.)
8. **Deploy.** Vercel deploys automatically on import, and on every
   `git push` to `main` after that. You'll get a URL like
   `wave-scorecard-<random>.vercel.app`, that's the link to share.
9. **Custom domain, whenever you're ready.** Project Settings -> Domains
   -> add something like `wave.example.com`. Vercel gives you the DNS
   record to add; no code or redeploy needed once your DNS is updated.

Why Vercel over Cloudflare Pages: this app needs a normal Node.js server
runtime for the Excel export (the `exceljs` package) and for Prisma. Both
work out of the box on Vercel's standard runtime. Cloudflare's Workers
runtime is a different, more restricted JS environment, some Node APIs
these packages rely on don't run there without extra adapter work. Vercel
is also the natural home for a Next.js app since Vercel builds Next.js.

## Architecture

- **Next.js 16 (App Router) + TypeScript + Tailwind v4** for the frontend
  and API routes, one deployable app.
- **PostgreSQL via Prisma** for storage. One table today: `Submission`
  (see `prisma/schema.prisma`). Raw answers are stored as JSON *and* the
  computed scores are stored as their own columns, so admin reads don't
  need to recompute 28-question math, but the raw answers are always
  there if the scoring logic ever needs to be re-applied.

  Pinned to Prisma 6, deliberately. Prisma will nag about a v7 upgrade
  being available; don't take it. Prisma 7 removes the `url =
  env("DATABASE_URL")` line this schema uses and requires a separate
  `prisma.config.ts` plus a driver adapter instead, a real breaking
  change, not a routine bump. Most current guides (including Vercel's own
  Prisma docs) still assume the v6 setup this project uses. Worth
  revisiting once v7's ecosystem and docs catch up, not worth doing today.
- **`exceljs`** builds the `.xlsx` export server-side, on request, always
  reflecting the latest submissions.
- **A passcode, not a full login system**, protects `/admin` (checked in
  `proxy.ts`, formerly `middleware.ts`, Next.js 16 renamed the
  convention). The assessment itself has no login: it isn't handling
  anything regulated.

### The data model that matters most: `lib/questions.ts`

Every one of the 28 questions defines its own five rating levels, each
with a `tier` (Poor/Fair/Good/Excellent, matching the vocabulary already
used in the source Excel workbook), a short `label` (shown under each
number button), and a full `description` (shown in the caption once a
number is picked). This is the actual fix for "needs more nuance."

### Scoring: `lib/scoring.ts`

Reproduces the exact formula reverse-engineered from the old prototype's
screenshots (verified in `tests/scoring.test.ts` against the worked
example that was visible on screen: Wealth 50, Accounting 75, Value 50,
Earnings 57, overall 58):

```
normalized = (rating - 1) / 4 * 100        1 -> 0, 5 -> 100
gapScore   = average of the 7 normalized answers in that gap
overall    = average of the 4 (rounded) gap scores
```

Readiness bands (`READINESS_BANDS` in the same file) are a first-pass
extrapolation from the single example that survived in the source
material (58 = "Meaningful gaps"). Treat the exact cutoffs as a draft,
they're defined in one place, so relabeling is a one-file change.

## What's built but not turned on yet

The source Excel workbook has real infrastructure beyond a scorecard: an
**Action Library** (a recommended action per question, for low scores)
and **Combo Rules** (cross-question logic, e.g. "if the valuation
question scores well but the timeline question scores poorly, flag it
for verification"). Building and shipping that alongside a full staff
review workflow in one afternoon isn't realistic and isn't what today
needed.

What *is* here: `lib/actionLibrary.ts` and `lib/comboRules.ts`, real data
(the Combo Rules are transcribed from the source workbook; the Action
Library is a first-pass draft for all 28 questions, in the firm's voice,
meant to be reacted to and edited exactly like that workbook already says
its auto-recommendations should be). Both files are structured so a
future results page can evaluate them against `tierForRating()` from
`lib/scoring.ts`. Nothing reads these files yet, activating this is
additive work (build the trigger logic and, if you want to mirror the
Excel's human-review step, an approval queue before anything reaches a
client), not a rewrite of what's already live.

Because deploys are automatic on push, once that's built, reviewers see
it by refreshing the same link, no new link, no re-explaining, no one
needing to drive a laptop over to demo a localhost.

## Admin access

Visit `/admin`. It'll ask for a passcode, checked against `ADMIN_USERS`
(see `.env.example`), a comma-separated list of `Name:passcode` pairs so
each staff member has their own, and the page shows who's currently
logged in. From there: a table of every submission's scores, and a
"Download Excel" button that generates a `.xlsx` with every raw 1-5
answer as its own column, not just the computed scores.

This is deliberately not full SSO, there's no central identity provider,
no per-action audit log beyond "who's currently logged in". It's a real
step up from one shared secret, and it's what's buildable without
coordinating an Azure AD app registration first. Real Microsoft Entra ID
login (matching a firm's likely existing Microsoft 365 setup) is the
natural next upgrade whenever that coordination happens with the firm's
IT.

## Email notifications

Set `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and `NOTIFY_EMAIL` (see
`.env.example`) to get an email whenever someone finishes the assessment,
name, company, overall score, and a link straight to `/admin`. Leave them
unset to skip this entirely; the assessment and admin review both work
fine without it.

The email is sent from a Gmail account you control, using an App Password
(generated under that account's Security -> App passwords, with 2-Step
Verification on). A few things worth knowing:

- **It goes to your staff, not to the person taking the assessment.**
  `NOTIFY_EMAIL` is the recipient list.
- **You can notify more than one person.** `NOTIFY_EMAIL` accepts a
  comma-separated list, e.g. `owner@example.com,partner@example.com`.
- **Gmail delivers to any recipient with no domain setup**, unlike a
  transactional-email sandbox. The only requirement is that
  `GMAIL_USER`/`GMAIL_APP_PASSWORD` belong to a real Google account.
- **Store the App Password only in your host's environment variables**
  (Vercel Project Settings, or a local gitignored `.env`), never in code.
  Free Gmail sending caps out around 500 recipients/day, far above this
  app's needs.

The `/admin` link inside the email is derived from the origin of the
request that submitted the assessment, so a submission made on the
deployed site produces a deployed link (a submission made against
`localhost` during local testing correctly produces a localhost link).
If your emails ever arrive with a wrong or unclickable link, set
`NEXT_PUBLIC_SITE_URL` to the site's public base URL to pin it
explicitly.

## Project structure

```
app/
  page.tsx               landing + the 4-section assessment + results (client state)
  admin/                 passcode-gated submissions table + export
  api/submit/            validates, scores server-side, persists
  api/admin/              login/logout/export routes
lib/
  questions.ts            the 28 questions x 5-point rubric (start here)
  scoring.ts               pure scoring functions (unit tested)
  actionLibrary.ts         dormant: per-question recommended actions
  comboRules.ts             dormant: cross-question rules
  excel.ts                  builds the .xlsx export
  email.ts                   optional submission-notification emails via Gmail SMTP
  db.ts                      Prisma client
  adminAuth.ts               multi-user passcode check (constant-time, Edge-runtime safe)
components/
  Assessment.tsx           the whole intro -> questions -> results flow
  RatingSelector.tsx        the signature 1-5 + live-meaning interaction
  GapScoreBar.tsx, LogoutButton.tsx
tests/
  scoring.test.ts           21 tests: formula correctness + question-bank integrity
prisma/schema.prisma       the one table
```
