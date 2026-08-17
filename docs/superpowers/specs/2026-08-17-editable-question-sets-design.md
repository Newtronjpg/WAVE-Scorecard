# Editable question sets: add/remove questions, variable answer counts, draft-then-publish

Date: 2026-08-17
Status: approved, not yet implemented

## Goal

Let an admin change the *structure* of the assessment, not just its wording:

- Add and delete questions, so the assessment can be more or fewer than 28.
- Give each question its own number of answer choices, so the choices fit the
  question instead of being forced to five.
- See and score-test every change before it reaches the live site.

## Why this needs a design

The 2026-08-12 admin-controls design deliberately drew the line at wording.
`lib/questions.ts` owned structure, the database owned text, and that split was
what made editing safe: no edit could change a score or break the submit
validator. This change crosses that line on purpose, and three assumptions
break with it.

| Assumption | Where it lives | What breaks |
| --- | --- | --- |
| Exactly five choices | `normalizeAnswer`: `(rating - 1) / 4 * 100` | The `4` is the choice count minus one, hardcoded. A three-choice question scores wrong. |
| Structure comes from code | `questionContent.ts`, submit validator, `excel.ts` | The database has to own structure instead. |
| 1→Poor, 2→Fair, 3→Good, 4-5→Excellent | `tierForRating` | Meaningless at three or six choices. |

Confirmed by grep before designing: `tier` is read only by `QuestionEditor`'s
display badge and by a type import in the dormant `lib/comboRules.ts`.
`tierForRating` has no live caller. Generalizing it is therefore safe.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Gaps | The four stay fixed | Questions move freely between them, but the four score columns, the four result bars, and the export shape all stay put. Roughly half the work of making gaps editable, and nothing in the ask needs it. |
| Publishing | Versioned history with rollback | A live demo link is out with a client. A bad publish has to be one button to undo, not a manual re-edit. |
| Mixed choice counts | Equal weight, each question 0-100 | A three-choice and a five-choice question count the same in their gap. Matches today's math for five-choice questions, so the pinned worked example still passes. |
| Existing stored runs | Not preserved specially | Explicitly out of scope per the user. Stored scores stay frozen; no re-scoring. |
| Change history | Surfaced in the Excel export | A dedicated worksheet per published version, so the file itself explains what a given run was answering. |

## Scoring

The formula generalizes by replacing the hardcoded denominator with the
question's own choice count:

```
normalized  = (rating - 1) / (choiceCount - 1) * 100   // lowest = 0, highest = 100
gapScore    = round(mean of that gap's normalized answers)
overall     = round(mean of the four rounded gap scores)
```

For a five-choice question `(rating - 1) / 4 * 100` is exactly what this
produces, so `tests/scoring.test.ts` passes **unchanged**. Its worked example
(Wealth 50, Accounting 75, Value 50, Earnings 57, overall 58) remains the
regression gate for this whole change.

The rounding at each displayed number stays load-bearing for the same reason
as before: the four gap scores a client reads must average by hand to the
overall score shown.

`scoreAssessment(answers, questions = QUESTIONS)` takes the question set as a
defaulted second argument. The default is what keeps existing callers and
tests working untouched.

### Tier

Derived from the normalized percentage rather than the raw rating:

| Normalized | Tier |
| --- | --- |
| < 25 | Poor |
| < 50 | Fair |
| < 75 | Good |
| >= 75 | Excellent |

For five choices this reproduces the current map exactly (0 → Poor, 25 → Fair,
50 → Good, 75 → Excellent, 100 → Excellent). A test pins that equivalence.

This arrives as a **new** function, `tierForLevel(value, choiceCount)`. The
existing `tierForRating(rating)` cannot express it — it has no choice count to
work from — so it stays exactly as it is, five-choice only, and is marked
deprecated. That is what lets `tests/scoring.test.ts` remain untouched.

`tier` stays on the in-memory `RatingLevel` type, computed by the loader, but
is **not** stored in the database. Stored tiers could go stale against the
choice count; derived ones cannot.

### Two hazards the current code would hit silently

1. **A gap with no questions** divides by zero and yields `NaN`, which would
   flow into a stored `Int` column. Validation forbids it, and
   `scoreAssessment` throws a named error rather than returning `NaN`.
2. **A two-choice question** can only ever score 0 or 100. Permitted, but the
   editor warns; three is the practical floor.

## Data model

`lib/questions.ts` stops being the source of truth and becomes the **factory
default**: what the app uses when the database is empty, and what "reset to
factory" restores. This preserves the fallback property that matters — if the
database read fails, the assessment still renders from code rather than 500ing,
and deploying the code before running `prisma db push` degrades to today's
behavior instead of breaking the site.

```prisma
// Exactly one row. Every write upserts against the literal id "draft",
// so a second row is not reachable through the API.
model QuestionDraft {
  id        String   @id @default("draft")
  questions Json
  updatedAt DateTime @updatedAt
  @@map("question_draft")
}

// Immutable, append-only. The highest version is live.
model QuestionSetVersion {
  version     Int      @id
  questions   Json
  note        String?
  publishedAt DateTime @default(now())
  @@map("question_set_versions")
}
```

And on `Submission`:

```prisma
questionSetVersion Int?   // null = factory default / pre-feature
```

**Rollback appends rather than rewrites.** Rolling back to v3 publishes a new
v7 carrying v3's content. History stays a true log of what was live and when,
which is the point of having it.

### Stored question shape

```ts
interface StoredLevel  { value: number; label: string; description: string }
interface StoredQuestion { id: string; gap: Gap; statement: string; levels: StoredLevel[] }
```

`value` is contiguous from 1. `tier` is absent by design (see above).

### Question ids

Auto-generated on creation as the gap's letter prefix plus the next free
number (`W8`, `V9`). **Immutable once created**, including when a question
moves to another gap — an id is the key in every stored `answers` JSON and the
header of an Excel column, so stability beats tidiness. A question moved from
Wealth to Value keeps its `W` prefix, and the export's version tab records its
gap at the time.

### Migrating the existing override

The current `QuestionOverride` table holds real wording edits. The first time a
draft is created and no draft and no published version exist, the draft is
seeded with `mergeQuestions(QUESTIONS, overrides)` — exactly today's resolved
output — so no existing edit is lost.

`QuestionOverride` is then dead. It is **left in place**, unused, by this
change. Dropping a table in the same change that stops reading it is how edits
get lost if a rollback is needed. Removing it is a follow-up.

## Validation

One module, `lib/questionSet.ts`, used by all three of the draft save, the
publish, and the runtime resolver:

```ts
export const MIN_LEVELS = 2;
export const MAX_LEVELS = 7;
export const MAX_QUESTIONS = 100;

export function validateQuestionSet(raw: unknown):
  | { ok: true; questions: StoredQuestion[] }
  | { ok: false; errors: string[] };
```

Rules:

- All four gaps present, each with at least one question.
- Ids unique, matching `^[A-Za-z][A-Za-z0-9_-]{0,15}$`.
- Between `MIN_LEVELS` and `MAX_LEVELS` choices, values contiguous from 1.
- Statement, every label, every description non-empty after trim.
- Length caps: statement 400, label 80, description 600 (unchanged from today).
- At most `MAX_QUESTIONS` questions total.

The resolver re-validates what it reads from the database. A stored set that
fails validation falls back rather than being served, so one bad write cannot
take the assessment down for every prospect — the same property the wording
override merge already had.

## Resolver

`lib/questionContent.ts` is rewritten around two functions:

```ts
getPublishedQuestions(): Promise<{ questions: Question[]; version: number | null }>
getDraftQuestions():     Promise<Question[]>   // seeds from published, else factory
```

Both attach derived tiers, and both fall back to `QUESTIONS` on any read or
validation failure, logging the reason.

## API

Per-question `PUT`/`DELETE` at `/api/admin/questions/[id]` is **replaced**.
Whole-set operations make add, delete, and reorder atomic in a way per-question
edits cannot be:

| Route | Purpose |
| --- | --- |
| `GET /api/admin/questions/draft` | Read the draft plus its `updatedAt` |
| `PUT /api/admin/questions/draft` | Replace the draft wholesale |
| `POST /api/admin/questions/publish` | Validate, snapshot as the next version |
| `POST /api/admin/questions/rollback` | Append an old version's content as a new version |
| `POST /api/admin/questions/reset-draft` | Draft := live, or draft := factory |
| `POST /api/admin/preview-score` | Score an answer map against the draft |

`PUT .../draft` carries the `updatedAt` the client loaded and returns **409** if
it has moved, so two people in the admin cannot silently overwrite each other.

`POST .../preview-score` **never writes a row and never sends an email**. That
is its entire reason for existing as a separate route from `/api/submit`.

`/api/submit` builds its zod validator from the **published** set at request
time, with a per-question max equal to that question's choice count, and
records `questionSetVersion` on the row it writes.

## Admin UI

`/admin/questions` becomes a draft editor. Nothing there touches the live site
until Publish is pressed.

- Header: draft state, question count, the live version number, and
  Publish / Discard changes / History.
- Per gap: each question expandable, with statement, per-choice label and
  description, the derived tier shown read-only, add/remove choice controls
  (2-7), reorder within the gap, move to another gap, and delete.
- Add question button per gap.
- Validation panel at the top listing every problem; Publish is disabled while
  any exist.
- **Scoring check panel**: for the current draft, the question count per gap and
  what all-lowest, all-middle, and all-highest answers produce. This makes the
  math visible without taking the assessment.

`/admin/preview` renders the real assessment from the draft, behind a banner,
posting to `preview-score`. Both routes sit behind the existing passcode gate
in `proxy.ts`.

## Excel export

Two changes to `lib/excel.ts`.

**Submissions sheet** gains a `Question set` column (the version number, or
`factory` when null), so a run can be tied to the version it answered.
Question columns are built from the union of the live question ids and every id
actually present in the exported rows, ordered live-set-first with orphans
appended. Without this, deleting a question would silently drop its historical
answers from the export.

**New `Question sets` sheet**, one row per question per published version:

| Version | Published | Note | Question ID | Gap | Statement | Choices | Choice 1 … Choice 7 |
| --- | --- | --- | --- | --- | --- | --- | --- |

Choice columns are sparse, filled to that question's choice count, each holding
the label and description. This makes the workbook self-explaining: a reader
can see what a given rating meant on a given question at the time a run was
taken, without access to the admin UI.

## Testing

TDD throughout: red, verify red, green, verify green.

| File | Covers |
| --- | --- |
| `tests/scoring.test.ts` | **Unchanged.** The regression gate for the whole change. |
| `tests/scoring.variable.test.ts` | `normalizeAnswer` at 2/3/5/7 choices; five-choice identical to the old formula; tier equivalence at five choices; mixed choice counts in one gap; uneven gap sizes; empty gap throws rather than returning `NaN`. |
| `tests/questionSet.test.ts` | Every validation rule, each rejected for the right reason. |
| `tests/questionContent.test.ts` | Rewritten: published/draft resolution, seeding from the existing override, fallback to factory on read failure and on invalid stored content. |
| `tests/adminQuestionRoutes.test.ts` | Replaces the per-question route tests: draft read/write, the 409 conflict, publish, rollback appending rather than rewriting, reset. |
| `tests/previewScore.test.ts` | Scores against the draft; asserts no row is written and no email is sent. |
| `tests/submitRoute.test.ts` | Updated: validator built from the published set, per-question max, `questionSetVersion` recorded. |
| `tests/excel.test.ts` | Orphaned question columns preserved; the version sheet's shape. |

## Deployment

1. `prisma db push` for the two new models and the nullable `Submission`
   column. The 2026-08-12 outage was a missing table; this step is not
   optional.
2. `postinstall: prisma generate` already exists, so the Vercel build picks up
   the new models.
3. Order is safe either way: with the tables absent, the resolver's fallback
   serves the factory questions, so the site works before the push lands.

## Out of scope

- Editing the four gaps themselves.
- Re-scoring past submissions when questions change. Stored scores stay frozen;
  the version number on each row is what makes them interpretable.
- Dropping the now-dead `QuestionOverride` table.
- Per-question weighting within a gap.
- Wiring up `lib/actionLibrary.ts` and `lib/comboRules.ts`, still dormant.
