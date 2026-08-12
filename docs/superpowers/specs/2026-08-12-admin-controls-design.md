# Admin controls: notification recipients, delete, question editor

Date: 2026-08-12
Status: approved

## Problem

Three things currently require a developer and a redeploy:

1. **Who gets notified.** The recipient list lives in the `NOTIFY_EMAIL`
   environment variable. Changing it means editing Vercel settings and
   rebuilding. The immediate need is that a prospective user (Ben) should
   be able to enter his own address once the link is handed to him.
2. **Removing a submission.** There is no way to delete a submission.
   Test runs and duplicates accumulate in the admin table permanently.
3. **Question wording.** The 28 questions and their 1-5 rating
   explanations are TypeScript constants. Every wording change is a code
   edit, a commit, and a deploy.

## Scope

In scope: notification recipients editable from `/admin`; permanent
deletion of a submission; editing the *wording* of questions and their
five rating explanations.

Out of scope, deliberately: adding, removing, or re-assigning questions;
editing the Poor/Fair/Good/Excellent tiers; per-submission historical
wording. See "Deferred" below.

## Design

### Edits are overrides, not replacements

`lib/questions.ts` remains the source of truth for *structure*: the 28
question ids, which gap each belongs to, 7 questions per gap, the 1-5
scale, and the tier of each level. The database stores only *text
overrides* keyed by question id.

Consequences, all of which are the reason for this choice:

- An empty database behaves exactly as the app does today. Nothing to
  seed, no migration of existing content.
- "Reset to default" is deleting a row.
- `scoreAssessment` and the submit route's zod validator keep reading the
  static constants. Scores and validation therefore cannot be broken by
  an edit, and the assessment still runs on default wording if the
  database is unavailable.
- The existing tests asserting 28 questions and 7-per-gap continue to
  pass unchanged, because those invariants still live in code.

Scores depend on structure; only display depends on text.

### Data model

```prisma
model Setting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}

model QuestionOverride {
  questionId String   @id
  statement  String?
  levels     Json?
  updatedAt  DateTime @updatedAt
}
```

`Setting` is key-value rather than typed columns so that adding a future
setting needs no schema change against the production database. Values
are untyped strings, validated at the edges.

`QuestionOverride.levels` holds an array of `{ value, label, description }`
for the five levels. Null fields fall through to the code default, so a
partial override is legal.

### Recipient resolution

Precedence: the `notify_email` Setting row wins; the `NOTIFY_EMAIL`
environment variable is the fallback when no row exists. Existing
production behaviour is therefore preserved, and the env var remains a
safety net.

`lib/email.ts` gains an optional `recipients` field on
`NotificationDetails`. When present it is used; when absent the existing
env-var path runs unchanged. The route resolves recipients and passes
them in, so `lib/email.ts` acquires no database dependency and stays
independently testable.

Gmail credentials (`GMAIL_USER`, `GMAIL_APP_PASSWORD`) stay in
environment variables and are deliberately NOT editable from the admin
UI. The recipient list is not a secret; the app password is, and putting
it in a database behind a shared passcode is a materially worse posture.

### Question resolution

`lib/questionContent.ts`:

- `mergeQuestions(defaults, overrides): Question[]` -- pure, no database,
  fully unit tested. Applies overrides field by field, ignoring unknown
  question ids and malformed level arrays.
- `getResolvedQuestions(): Promise<Question[]>` -- reads overrides,
  delegates to `mergeQuestions`.

Consumers of resolved (display) questions: the assessment page and the
Excel export's column headers. Consumers that stay on the static
constants: `scoring.ts` and the submit route's validator.

`app/page.tsx` resolves questions server-side and passes them to
`Assessment` as props, replacing its direct import. The page becomes
dynamic so edits are visible without a redeploy.

### Admin surface

All new routes live under `/api/admin/*` and are therefore already
passcode-gated by `proxy.ts`.

- `POST /api/admin/settings` -- save notification recipients
- `DELETE /api/admin/submissions/[id]` -- permanent deletion
- `PUT /api/admin/questions/[id]` -- save a question's wording
- `DELETE /api/admin/questions/[id]` -- reset to default

UI: a notifications card and per-row delete buttons on `/admin`; a
separate `/admin/questions` page listing all 28 questions grouped by gap,
each expandable to edit its statement and five explanations.

Deletion is a two-step inline confirm (the button becomes "Confirm?")
rather than a browser `confirm()` dialog, which cannot be styled and
blocks automated testing.

### Validation

- Recipients: each address validated; an invalid entry is rejected with a
  message rather than silently dropped. Empty is legal and means
  notifications are off.
- Question statement: non-empty, length-capped.
- Each level: label and description non-empty, length-capped. All five
  levels must be present.
- Unknown question id: 404.

### Testing

- `mergeQuestions`: defaults pass through untouched; a full override
  applies; a partial override applies only what it sets; unknown ids and
  malformed levels are ignored rather than throwing.
- Recipient parsing and validation, including the empty case.
- Each route: happy path, invalid input, unknown id.
- `lib/email.ts`: explicit recipients override the env var; absent
  recipients fall back to it.

## Deferred

**Adding/removing/re-assigning questions.** Requires question-set
versioning: submissions store answers keyed by question id, and
`scoreAssessment` averages a fixed 7 per gap. A changed set makes past
submissions incomparable and turns the Excel export's columns variable.

**Historical wording.** Editing wording changes it for past submissions
too, since only the rating is stored. Preserving the wording a prospect
actually saw would require snapshotting the question set per submission.
Accepted knowingly.

## Rollout

New tables are additive and backward compatible, so the schema is pushed
to production before the code that uses it is deployed. Verification is
against the live site, not localhost, because the deliverable is a link
handed to an external user.
