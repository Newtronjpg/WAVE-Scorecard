# WAVE Scorecard

A transaction-readiness assessment tool built for an advisory firm's client
intake process. A prospect answers 28 statements across four gaps (Wealth,
Accounting, Value, Earnings), each rated against its own specific rubric
rather than a single generic scale, and receives a scored readiness report
immediately. Every submission is saved and reviewable by firm staff as a
table with a downloadable Excel export.

## Stack

Next.js 16 (App Router), TypeScript, Tailwind v4, PostgreSQL via Prisma 6,
deployed on Vercel. One deployable app, no separate backend service.

## Local development

Requires Node 20+ and a Postgres database.

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL and ADMIN_USERS
npx prisma db push        # creates the submissions table
npm run dev                # http://localhost:3000
```

```bash
npm test                   # scoring math + question-bank integrity checks
npm run lint
npm run build
```

## Architecture

- **PostgreSQL via Prisma**, one table (`Submission`, see
-   `prisma/schema.prisma`). Raw answers are stored as JSON alongside the
-     computed scores as their own columns, so reads don't need to recompute
-   the scoring math, but the raw answers remain available if it ever needs
-     to be reapplied. Pinned to Prisma 6; the v7 migration is a deliberate,
-   separate piece of work.
-   - **`exceljs`** builds the `.xlsx` export server-side, on request, always
    -   reflecting current submissions.
    -   - **A shared-passcode gate**, not a full login system, protects `/admin`
        -   (`proxy.ts`, checked against `ADMIN_USERS`). The assessment itself has
        -     no login, it isn't handling anything regulated. `ADMIN_USERS` is a
        -   comma-separated `Name:passcode` list, so each staff member has their
        -     own credential and the admin view shows who's currently logged in.
     
        - ### `lib/questions.ts`
     
        - Every one of the 28 questions defines its own five rating levels, each with
        - a `tier` (Poor/Fair/Good/Excellent), a short `label`, and a full
        - `description` shown once a rating is picked, so a given number means
        - something specific and different on every question rather than a single
        - reused scale.
     
        - ### `lib/scoring.ts`
     
        - ```
          normalized = (rating - 1) / 4 * 100        1 -> 0, 5 -> 100
          gapScore   = average of the 7 normalized answers in that gap
          overall    = average of the 4 (rounded) gap scores
          ```

          Covered by `tests/scoring.test.ts` against a fixed worked example (Wealth
          50, Accounting 75, Value 50, Earnings 57, overall 58). Readiness band
          cutoffs (`READINESS_BANDS`, same file) are defined in one place, so
          relabeling them is a one-file change.

          ### Built, not yet wired up

          `lib/actionLibrary.ts` (a recommended action per question) and
          `lib/comboRules.ts` (cross-question logic) hold real content, structured to
          be evaluated against `tierForRating()` once a results page reads them.
          Nothing consumes them yet; wiring them in is additive and doesn't touch
          what's currently live.

          ## Admin access

          Visit `/admin`. Staff sign in with their individual passcode from
          `ADMIN_USERS`, then see a table of every submission's scores and a
          per-row Excel export with the full raw answers.

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
          `DATABASE_URL` to create the table on a fresh database.

          ## Project structure

          ```
          app/
            page.tsx          landing + the 4-section assessment + results
            admin/             passcode-gated submissions table + export
            api/submit/        validates, scores server-side, persists
            api/admin/          login/logout/export routes
          lib/
            questions.ts        the 28 questions x 5-point rubric
            scoring.ts           pure scoring functions, unit tested
            actionLibrary.ts     dormant: per-question recommended actions
            comboRules.ts         dormant: cross-question rules
            excel.ts               builds the .xlsx export
            email.ts                optional notification email via Gmail SMTP
            db.ts                    Prisma client
            adminAuth.ts             multi-user passcode check
          components/
            Assessment.tsx       intro -> questions -> results flow
            RatingSelector.tsx    the 1-5 + live-meaning interaction
            GapScoreBar.tsx, LogoutButton.tsx
          tests/
            scoring.test.ts       formula correctness + question-bank integrity
          prisma/schema.prisma   the one table
          ```
          
