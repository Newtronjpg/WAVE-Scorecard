# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

WAVE Scorecard: a transaction-readiness assessment for an advisory firm. A prospect
answers 28 statements across four gaps (Wealth, Accounting, Value, Earnings), each
rated 1-5 against its own question-specific rubric, and gets a scored readiness
report immediately. Submissions persist to Postgres and are reviewable by firm
staff as a table plus an Excel export.

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4, Prisma 6 on
Postgres, deployed on Vercel. One deployable app.

## Commands

```bash
npm run dev                          # dev server on :3000
npm run build                        # production build
npm run lint                         # eslint (flat config, next core-web-vitals + ts)
npm test                             # vitest run (all tests)
npm run test:watch                   # vitest watch

npx vitest run tests/scoring.test.ts # a single test file
npx vitest run -t "question bank"    # a single test/suite by name

npx prisma db push                   # apply schema.prisma to DATABASE_URL
npx prisma generate                  # regenerate the client after schema edits
```

Requires Node 20+ and a `DATABASE_URL`. `ADMIN_USERS` is needed for anything under
`/admin`; the Gmail vars are optional (see `.env.example`).

## Architecture

**The question bank is the schema.** `lib/questions.ts` defines all 28 questions,
each with five `RatingLevel`s carrying a `tier`, a short `label`, and a full
`description`. Everything else derives from it: `app/api/submit/route.ts` builds
its zod validator by mapping over `QUESTIONS` rather than hand-listing keys, so
adding or removing a question can't leave the validator out of sync. Start here
when changing assessment content.

**Scoring is pure and pinned to a known-good example.** `lib/scoring.ts`:
`normalized = (rating - 1) / 4 * 100`, gap score = mean of that gap's 7 normalized
answers, overall = mean of the 4 *rounded* gap scores. That rounding step is
load-bearing — it was reverse-engineered from the old prototype and
`tests/scoring.test.ts` asserts the exact worked example (Wealth 50, Accounting 75,
Value 50, Earnings 57, overall 58). Don't "clean up" the formula without a reason
that survives that test. `READINESS_BANDS` cutoffs, by contrast, are an
acknowledged first-pass draft, defined in one place so relabeling is a one-file
change.

**Scores are computed server-side and stored twice.** The client never sends a
score. `/api/submit` validates, calls `scoreAssessment`, and writes both the raw
`answers` JSON (source of truth, so old submissions can be re-scored) and the five
computed score columns (so admin reads and the Excel export never recompute
28-question math). A DB write failure is logged but does not block the response —
the person taking the assessment still sees their result.

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
