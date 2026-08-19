# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

WAVE Scorecard: a transaction-readiness assessment for an advisory firm. A prospect
answers statements across four gaps (Wealth, Accounting, Value, Earnings) -- 28 by
factory default, editable by an admin -- each rated against its own
question-specific rubric of 2 to 7 choices, and gets a scored readiness report
immediately. Submissions persist to Postgres and are reviewable by firm staff as
a table plus an Excel export.

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4, Prisma 6 on
Postgres, deployed on Vercel. One deployable app.

## Commands

```bash
npm run dev                          # dev server on :3000
npm run build                        # production build
npm run lint                         # eslint (flat config, next core-web-vitals + ts)
npm test                             # vitest run (all tests)
npm run test:watch                   # vitest watch

npx vitest run tests/scoring.test.ts          # a single test file
npx vitest run tests/scoring.variable.test.ts # variable-choice-count scoring
npx vitest run -t "question bank"             # a single test/suite by name

npx prisma db push                   # apply schema.prisma to DATABASE_URL
npx prisma generate                  # regenerate the client after schema edits
```

Requires Node 20+ and a `DATABASE_URL`. `ADMIN_USERS` is needed for anything under
`/admin`; the Gmail vars are optional (see `.env.example`).

## Architecture

**The database owns the published question set.** `lib/questions.ts` is now the
factory default and the fallback -- served when the database is unavailable or
its content fails validation, never the live source of truth. The live set lives
in two tables: `QuestionDraft` (one mutable row an admin edits at `/admin/questions`)
and `QuestionSetVersion` (append-only; publishing snapshots the draft as a new
numbered row, and the highest version is what the public assessment serves).
`lib/questionSet.ts` is the one validator every write path goes through
(`validateQuestionSet`) -- it rejects any set that would leave a scoring gap
empty, and it's what keeps a bad edit from ever reaching the database. Start
here, not `lib/questions.ts`, when changing how question editing works.
`/admin/preview` scores a saved draft against the real scoring logic without
writing a submission row or sending an email, so a question set can be tried
before it goes live.

**Scoring is pure, generalized per question, and pinned to a known-good
example.** `lib/scoring.ts`: `normalized = (rating - 1) / (choiceCount - 1) * 100`
-- each question can have its own number of rating choices (2 to 7) now, not a
fixed five, and this formula is arithmetically identical to the old fixed-`/4`
version at five choices. Gap score = mean of that gap's normalized answers,
overall = mean of the 4 *rounded* gap scores. That rounding step is load-bearing
-- it was reverse-engineered from the old prototype and `tests/scoring.test.ts`
asserts the exact worked example (Wealth 50, Accounting 75, Value 50, Earnings
57, overall 58) at the original five-choice shape. **That file must never be
edited** -- it is the regression gate for the entire generalized-scoring and
editable-question-set feature; if a change seems to require editing it, the
change's design is wrong. `tests/scoring.variable.test.ts` covers the
variable-choice-count cases instead. `READINESS_BANDS` cutoffs, by contrast, are
an acknowledged first-pass draft, defined in one place so relabeling is a
one-file change.

**Scores are computed server-side and stored with what produced them.** The
client never sends a score. `/api/submit` resolves the exact question set the
respondent loaded (not whatever's live at the instant they submit -- a publish
can land mid-assessment), validates, calls `scoreAssessment`, and writes the raw
`answers` JSON, the five computed score columns, `questionSetVersion` (which
published version was in effect, null for the factory default), and
`questionSetSnapshot` (the literal question content scored against, so every
submission is self-describing with no join back to `QuestionSetVersion` ever
required). A DB write failure is logged and staff are alerted with the raw
answers, but the response is not blocked -- the person taking the assessment
still sees their result. The Excel export is split the same way content is
versioned: the Submissions sheet lists scores and which version each row
answered, and each row's own Export link produces that run's full answers
against the exact questions it was scored against (`lib/excelRun.ts`).

**Auth is a passcode gate in `proxy.ts`, not middleware.ts.** Next.js 16 renamed
the convention; the file must stay named `proxy.ts` exporting `proxy`. It runs on
the **Edge runtime**, so `lib/adminAuth.ts` cannot use Node APIs — its
constant-time comparison is hand-written from char codes precisely because
`crypto.timingSafeEqual` doesn't exist there, and importing it would fail the
deploy, not just warn. `ADMIN_USERS` is a comma-separated `Name:passcode` list;
the parser tolerates wrapping quotes and whitespace (a hosting dashboard stores
pasted quotes literally) and accepts a bare colon-free value as a single passcode.
The cookie carries the passcode and is re-checked against the live `ADMIN_USERS`
on every request — there is no session store.

**Dormant by design:** `lib/actionLibrary.ts` (per-question recommended actions)
and `lib/comboRules.ts` (cross-question rules transcribed from the source Excel
workbook) hold real data but nothing reads them yet. They're shaped to be
evaluated against `tierForRating()` when a results page wires them up. Adding that
is additive; it doesn't require reworking what's live.

## Constraints

- **Prisma stays on v6.** v7 removes the `url = env("DATABASE_URL")` line this
  schema uses and requires a `prisma.config.ts` plus a driver adapter. Decline the
  upgrade nag; this is a breaking change, not a routine bump.
- **Node runtime required on the host.** `exceljs` and Prisma both need it, which
  is why this targets Vercel's standard runtime rather than a Workers-style
  environment.
- `@/*` maps to the repo root, in both `tsconfig.json` and `vitest.config.mts`.
- Tests run under jsdom with globals enabled; no per-file `import { describe }`.
