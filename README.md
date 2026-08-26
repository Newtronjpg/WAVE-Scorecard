# WAVE Scorecard

A transaction-readiness assessment tool built for an advisory firm's client
intake process. A prospect answers a series of statements across four gaps
(Wealth, Accounting, Value, Earnings), each rated against its own rubric of
2 to 7 choices rather than a single generic scale, and receives a scored
readiness report immediately. Every submission is saved and reviewable by
firm staff as a table with a downloadable Excel export.

The question set itself is not fixed in code. An admin edits it, publishes
new versions, and can roll back or delete versions, all from `/admin/questions`
without a redeploy.

## Stack

Next.js 16 (App Router), TypeScript, Tailwind v4, PostgreSQL via Prisma 6,
deployed on Vercel. One deployable app, no separate backend service.

## Local development

Requires Node 20+ and a Postgres database.

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL and ADMIN_USERS
npx prisma db push        # creates the tables
npm run dev                # http://localhost:3000
```

```bash
npm test                   # scoring math + question-bank integrity checks
npm run lint
npm run build
```

## Architecture

**The question set lives in the database, not in code.** An admin edits a
single working draft at `/admin/questions`. Publishing snapshots that draft
as a new, immutable, numbered version; the public assessment always serves
the highest version that exists. Rolling back to an earlier version doesn't
reassign its number, it appends a new version carrying that content forward,
so the version history stays a true, unbroken log of what was live and when.
An admin can also mark any published version as the default, independent of
whether it's currently live, giving `/admin/questions`'s reset button a
stable baseline to fall back to that isn't tied to a specific point in
history. `lib/questions.ts` is the factory default: the seed data for a
fresh install, and the fallback if the database is ever unreachable or holds
something invalid, but not the runtime source of truth.

**Every question defines its own rating scale.** Each question carries 2 to
7 rating levels, each with a short label and a full description shown once
that rating is picked, so a given number can mean something specific and
different from one question to the next rather than reusing one scale
everywhere.

```
normalized = (rating - 1) / (choiceCount - 1) * 100
gapScore   = average of a gap's normalized answers
overall    = average of the 4 rounded gap scores
```

Covered by `tests/scoring.test.ts` against a fixed worked example at the
original five-choice shape (Wealth 50, Accounting 75, Value 50, Earnings 57,
overall 58) and `tests/scoring.variable.test.ts` for other choice counts.
Readiness band cutoffs (`READINESS_BANDS`, `lib/scoring.ts`) are defined in
one place, so relabeling them is a one-file change.

**Scores are computed server-side and stored with what produced them.** The
client never sends a score. `/api/submit` resolves the exact question set
the respondent loaded, scores it, and stores the raw answers, the five
computed score columns, which published version was in effect, and a full
snapshot of the question content itself, so a submission never needs a join
back to version history to know exactly what it was scored against.

**PostgreSQL via Prisma**, six tables (`prisma/schema.prisma`): `Submission`,
`Setting` (editable key-value settings, e.g. the notification recipient
list), `QuestionOverride` (a legacy per-question text override, superseded
by the draft/version system but kept for backward compatibility),
`RateLimit` (fixed-window throttling for the public submit endpoint),
`QuestionDraft`, and `QuestionSetVersion`. Pinned to Prisma 6; the v7
migration is a deliberate, separate piece of work.

**A shared-passcode gate**, not a full login system, protects `/admin`
(`proxy.ts`, checked against `ADMIN_USERS`). The assessment itself has no
login; it isn't handling anything regulated. `ADMIN_USERS` is a
comma-separated `Name:passcode` list, so each staff member has their own
credential and the admin view shows who's currently logged in.

**`exceljs`** builds the `.xlsx` export server-side, on request. The
Submissions sheet lists every run's scores and which version it answered;
each row also has its own export producing that run's full answers against
the exact questions it was scored against.

## Admin access

Visit `/admin`. Staff sign in with their individual passcode from
`ADMIN_USERS`, then see a table of every submission's scores, a per-row
Excel export, and a link to the question editor.

## Email notifications

Set `GMAIL_USER`, `GMAIL_APP_PASSWORD` (a Gmail App Password, not the
account password), and `NOTIFY_EMAIL` to notify staff by email whenever an
assessment is completed, with a link straight to `/admin`. All three are
optional; the app works the same without them. `NOTIFY_EMAIL` accepts a
comma-separated list for multiple recipients. If a notification link ever
resolves incorrectly, set `NEXT_PUBLIC_SITE_URL` to pin the base URL
explicitly.

## Deploying

Deploys automatically on push to `main` via Vercel's GitHub integration.
Required environment variables: `DATABASE_URL`, `ADMIN_USERS`, plus the
optional email variables above, set in the Vercel project's environment
variables. Run `npx prisma db push` once against the production
`DATABASE_URL` to create the tables on a fresh database, and again after
any schema change.

## Project structure

```
app/
  page.tsx                landing + the 4-section assessment + results
  admin/                   passcode-gated submissions table + export
    questions/               draft editor, publish, version history
    preview/                  score a draft without saving a submission
  api/submit/              validates, scores server-side, persists
  api/admin/                login/logout/export/questions routes
lib/
  questions.ts             the factory-default question set
  questionSet.ts            validates and normalizes any question set
  questionContent.ts        resolves draft/published/factory content
  scoring.ts                 pure scoring functions, unit tested
  excel.ts                    builds the submissions .xlsx export
  excelRun.ts                  builds one run's full-answer export
  email.ts                      optional notification email via Gmail SMTP
  rateLimit.ts                   throttling for the public submit endpoint
  db.ts                           Prisma client
  adminAuth.ts                    multi-user passcode check
  settings.ts                      editable key-value settings
components/
  Assessment.tsx           intro -> questions -> results flow
  RatingSelector.tsx        the per-question rating + live-meaning interaction
  QuestionSetEditor.tsx      the admin draft editor
  VersionHistory.tsx          version list, rollback, delete, set default
tests/
  scoring.test.ts           formula correctness against a fixed worked example
  scoring.variable.test.ts   the same, at other choice counts
prisma/schema.prisma        the six tables
```
