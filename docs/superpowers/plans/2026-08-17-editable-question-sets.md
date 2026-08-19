# Editable Question Sets Implementation Plan

**Goal:** Let an admin add and delete assessment questions, give each question its own number of answer choices, and preview and score-test the result before publishing it to the live site.

**Architecture:** The database takes over ownership of the question set from `lib/questions.ts`, which becomes the factory default and the fallback. A single mutable draft row is edited freely; publishing appends an immutable numbered snapshot, and the highest version is live. The scoring formula's hardcoded `/4` becomes `/(choiceCount - 1)`, which is arithmetically identical for five-choice questions and therefore leaves the pinned worked example intact.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Prisma 6 on Postgres, zod, exceljs, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-08-17-editable-question-sets-design.md`

## Global Constraints

- **`tests/scoring.test.ts` must never be edited.** It is the regression gate for this entire change. If a task requires changing it, the task's design is wrong — stop and escalate.
- **Prisma stays on v6.** Decline any upgrade prompt; v7 removes the `url = env("DATABASE_URL")` line this schema uses.
- `proxy.ts` (not `middleware.ts`) is the auth gate, runs on the **Edge runtime**, and must not import Node APIs.
- `@/*` maps to the repo root in both `tsconfig.json` and `vitest.config.mts`.
- Tests run under jsdom with globals enabled — no per-file `import { describe }` is needed, but existing files do it anyway; match the file you are editing.
- Choice count bounds: `MIN_LEVELS = 2`, `MAX_LEVELS = 7`, `MAX_QUESTIONS = 100`.
- Length caps, unchanged from today: statement 400, label 80, description 600.
- Tier thresholds on the normalized 0-100 value: `< 25` Poor, `< 50` Fair, `< 75` Good, `>= 75` Excellent.
- Run the full suite with `npm test`; a single file with `npx vitest run tests/<file>`.
- Commit at the end of every task. Never mix two tasks in one commit.

## File Structure

**Created:**
- `lib/questionSet.ts` — the stored question shape, validation, tier derivation, id generation. Pure; no database, no Next.
- `lib/excelRun.ts` — the single-run workbook builder. Separate from `lib/excel.ts` because it answers a different question and shares nothing but exceljs.
- `app/api/admin/questions/draft/route.ts` — GET/PUT the draft.
- `app/api/admin/questions/publish/route.ts` — POST.
- `app/api/admin/questions/rollback/route.ts` — POST.
- `app/api/admin/questions/reset-draft/route.ts` — POST.
- `app/api/admin/preview-score/route.ts` — POST, scores against the draft, writes nothing.
- `app/api/admin/submissions/[id]/export/route.ts` — GET, single-run xlsx.
- `app/admin/preview/page.tsx` — the assessment rendered from the draft.
- `components/QuestionSetEditor.tsx` — the whole draft editor (client component holding draft state).
- `components/QuestionRow.tsx` — one question inside the editor.
- `components/ScoringCheck.tsx` — the all-lowest / all-middle / all-highest panel.
- `tests/scoring.variable.test.ts`, `tests/questionSet.test.ts`, `tests/adminQuestionRoutes.test.ts`, `tests/previewScore.test.ts`, `tests/excel.test.ts`

**Modified:**
- `lib/scoring.ts` — generalized `normalizeAnswer`, new `tierForLevel`, `scoreAssessment` takes the set.
- `lib/questionContent.ts` — rewritten around published/draft resolution.
- `lib/excel.ts` — summary sheet slimmed, version sheet added.
- `prisma/schema.prisma` — two models plus one nullable column.
- `app/api/submit/route.ts` — validator built from the published set.
- `app/page.tsx`, `components/Assessment.tsx`, `components/RatingSelector.tsx` — variable choice counts.
- `app/admin/page.tsx` — Export button per row, reworded footnote.
- `app/admin/questions/page.tsx` — server shell for the new editor.
- `tests/questionContent.test.ts`, `tests/submitRoute.test.ts`, `tests/adminRoutes.test.ts`.

**Deleted:**
- `app/api/admin/questions/[id]/route.ts` — superseded by whole-set operations.
- `components/QuestionEditor.tsx` — superseded by `QuestionRow.tsx`.

---

### Task 1: Generalize the scoring math

Pure functions only. No database, no Next.js. This task is the foundation everything else rests on, and it is the one place the pinned worked example could break.

**Files:**
- Modify: `lib/questions.ts` (one type widening only)
- Modify: `lib/scoring.ts`
- Test: `tests/scoring.variable.test.ts` (create)
- Do NOT touch: `tests/scoring.test.ts`

**Interfaces:**
- Consumes: `Question`, `GAPS`, `QUESTIONS` from `lib/questions.ts`.
- Produces:
  - `normalizeAnswer(rating: number, choiceCount?: number): number` — `choiceCount` **defaults to 5**. The default is load-bearing: `tests/scoring.test.ts` calls `normalizeAnswer(1)` with one argument.
  - `tierForLevel(value: number, choiceCount: number): Tier`
  - `scoreAssessment(answers: AnswerMap, questions?: Question[]): ScoreResult` — `questions` defaults to `QUESTIONS`.
  - `tierForRating(rating: number): Tier` — unchanged, kept for `tests/scoring.test.ts` and marked deprecated.

- [ ] **Step 1: Widen the rating value type**

`lib/questions.ts` types `RatingLevel.value` as the literal union `1 | 2 | 3 | 4 | 5`, which makes a six- or seven-choice question a compile error everywhere. Widen it:

```ts
export interface RatingLevel {
  value: number; // 1..levels.length, contiguous
  tier: Tier;
  label: string;
  description: string;
}
```

Leave the internal `tierFor` and `levels` helpers below it alone — they still only build five-choice factory questions, and narrowing inside the factory is fine. Nothing in `tests/scoring.test.ts` asserts on the type, so this is safe.

Run `npx tsc --noEmit` and confirm it is clean before continuing.

- [ ] **Step 2: Write the failing test**

Create `tests/scoring.variable.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeAnswer,
  tierForLevel,
  scoreAssessment,
} from "@/lib/scoring";
import type { Question } from "@/lib/questions";

// The choice count is no longer fixed at five, so the scoring formula's
// denominator can no longer be the constant 4. These tests pin the
// generalization AND its backward compatibility: for a five-choice
// question every number below must be identical to what the old
// formula produced, which is what lets tests/scoring.test.ts stay
// untouched as the regression gate.

function q(id: string, gap: Question["gap"], choiceCount: number): Question {
  return {
    id,
    gap,
    statement: `${id} statement`,
    levels: Array.from({ length: choiceCount }, (_, i) => ({
      value: i + 1,
      tier: tierForLevel(i + 1, choiceCount),
      label: `${id} label ${i + 1}`,
      description: `${id} description ${i + 1}`,
    })),
  };
}

// One question per gap so a set is valid; gaps are fixed at four.
function minimalSet(choiceCount: number): Question[] {
  return [
    q("W1", "wealth", choiceCount),
    q("A1", "accounting", choiceCount),
    q("V1", "value", choiceCount),
    q("E1", "earnings", choiceCount),
  ];
}

describe("normalizeAnswer with a variable choice count", () => {
  it("defaults to five choices when the count is omitted", () => {
    // tests/scoring.test.ts depends on this single-argument form.
    expect(normalizeAnswer(3)).toBe(50);
  });

  it("maps the lowest choice to 0 at any count", () => {
    expect(normalizeAnswer(1, 2)).toBe(0);
    expect(normalizeAnswer(1, 3)).toBe(0);
    expect(normalizeAnswer(1, 7)).toBe(0);
  });

  it("maps the highest choice to 100 at any count", () => {
    expect(normalizeAnswer(2, 2)).toBe(100);
    expect(normalizeAnswer(3, 3)).toBe(100);
    expect(normalizeAnswer(7, 7)).toBe(100);
  });

  it("spaces three choices evenly", () => {
    expect(normalizeAnswer(2, 3)).toBe(50);
  });

  it("is unchanged from the old formula at five choices", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(normalizeAnswer(rating, 5)).toBe(((rating - 1) / 4) * 100);
    }
  });

  it("rejects a rating below 1", () => {
    expect(() => normalizeAnswer(0, 5)).toThrow();
  });

  it("rejects a rating above the choice count", () => {
    expect(() => normalizeAnswer(4, 3)).toThrow();
  });

  it("rejects a choice count below two", () => {
    // A one-choice question carries no information and would divide by zero.
    expect(() => normalizeAnswer(1, 1)).toThrow();
  });
});

describe("tierForLevel", () => {
  it("reproduces the original five-choice mapping exactly", () => {
    expect(tierForLevel(1, 5)).toBe("Poor");
    expect(tierForLevel(2, 5)).toBe("Fair");
    expect(tierForLevel(3, 5)).toBe("Good");
    expect(tierForLevel(4, 5)).toBe("Excellent");
    expect(tierForLevel(5, 5)).toBe("Excellent");
  });

  it("puts the extremes of a two-choice question at Poor and Excellent", () => {
    expect(tierForLevel(1, 2)).toBe("Poor");
    expect(tierForLevel(2, 2)).toBe("Excellent");
  });

  it("puts the middle of a three-choice question at Good", () => {
    expect(tierForLevel(2, 3)).toBe("Good");
  });
});

describe("scoreAssessment with a supplied question set", () => {
  it("scores a three-choice set on the same 0-100 scale", () => {
    const questions = minimalSet(3);
    const result = scoreAssessment({ W1: 2, A1: 2, V1: 2, E1: 2 }, questions);
    for (const g of result.gaps) expect(g.score).toBe(50);
    expect(result.overallScore).toBe(50);
  });

  it("weighs a three-choice and a five-choice question equally in a gap", () => {
    // W1 three-choice answered at the top (100), W2 five-choice answered
    // at the bottom (0). The gap must be their plain average, 50.
    const questions = [
      q("W1", "wealth", 3),
      { ...q("W2", "wealth", 5), id: "W2" },
      q("A1", "accounting", 5),
      q("V1", "value", 5),
      q("E1", "earnings", 5),
    ];
    const result = scoreAssessment(
      { W1: 3, W2: 1, A1: 3, V1: 3, E1: 3 },
      questions
    );
    expect(result.gaps.find((g) => g.gap === "wealth")!.score).toBe(50);
  });

  it("handles gaps with different numbers of questions", () => {
    const questions = [
      q("W1", "wealth", 5),
      q("W2", "wealth", 5),
      q("W3", "wealth", 5),
      q("A1", "accounting", 5),
      q("V1", "value", 5),
      q("E1", "earnings", 5),
    ];
    const result = scoreAssessment(
      { W1: 5, W2: 5, W3: 1, A1: 1, V1: 1, E1: 1 },
      questions
    );
    // Wealth: (100 + 100 + 0) / 3 = 66.67 -> 67
    expect(result.gaps.find((g) => g.gap === "wealth")!.score).toBe(67);
    // Overall: (67 + 0 + 0 + 0) / 4 = 16.75 -> 17
    expect(result.overallScore).toBe(17);
  });

  it("throws a named error rather than returning NaN when a gap has no questions", () => {
    // Previously this divided by zero and wrote NaN into an Int column.
    const questions = [
      q("A1", "accounting", 5),
      q("V1", "value", 5),
      q("E1", "earnings", 5),
    ];
    expect(() => scoreAssessment({ A1: 3, V1: 3, E1: 3 }, questions)).toThrow(
      /wealth/i
    );
  });

  it("rejects an answer above that question's own choice count", () => {
    const questions = minimalSet(3);
    expect(() =>
      scoreAssessment({ W1: 5, A1: 2, V1: 2, E1: 2 }, questions)
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run the test and verify it fails for the right reason**

Run: `npx vitest run tests/scoring.variable.test.ts`

Expected: FAIL. `tierForLevel` is not exported, so expect an import or "is not a function" error. **Confirm the failure names `tierForLevel`** — a failure for any other reason means the test file itself is wrong.

- [ ] **Step 4: Implement in `lib/scoring.ts`**

Replace `normalizeAnswer`, add `tierForLevel`, and change `assertComplete` / `scoreAssessment` to take the question set:

```ts
// The denominator is the choice count minus one, not the constant 4.
// It defaults to 5 so the original single-argument call still works and
// produces identical numbers -- that equivalence is what keeps the pinned
// worked example in tests/scoring.test.ts valid across this change.
export function normalizeAnswer(rating: number, choiceCount: number = 5): number {
  if (choiceCount < 2) {
    throw new Error(`A question needs at least 2 choices, got ${choiceCount}`);
  }
  if (rating < 1 || rating > choiceCount) {
    throw new Error(`Rating must be between 1 and ${choiceCount}, got ${rating}`);
  }
  return ((rating - 1) / (choiceCount - 1)) * 100;
}

// Tier now derives from the normalized position, not the raw rating, so it
// means the same thing whatever the choice count. At five choices this
// reproduces the original 1=Poor 2=Fair 3=Good 4-5=Excellent map exactly.
export function tierForLevel(value: number, choiceCount: number): Tier {
  const normalized = normalizeAnswer(value, choiceCount);
  if (normalized < 25) return "Poor";
  if (normalized < 50) return "Fair";
  if (normalized < 75) return "Good";
  return "Excellent";
}
```

Add `import type { Tier }` to the existing import from `./questions`.

Then update the assessment functions:

```ts
function assertComplete(answers: AnswerMap, questions: Question[]): void {
  const missing = questions.filter((q) => answers[q.id] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Missing answers for: ${missing.map((q) => q.id).join(", ")}`
    );
  }
}

export function scoreAssessment(
  answers: AnswerMap,
  questions: Question[] = QUESTIONS
): ScoreResult {
  assertComplete(answers, questions);

  const gapResults: GapResult[] = GAPS.map((gapMeta) => {
    const gapQuestions = questions.filter((q) => q.gap === gapMeta.id);
    if (gapQuestions.length === 0) {
      // Previously this divided by zero and produced NaN, which would then
      // be written into an Int column. Fail loudly instead.
      throw new Error(
        `The ${gapMeta.id} gap has no questions; every gap needs at least one.`
      );
    }
    const normalizedScores = gapQuestions.map((q) =>
      normalizeAnswer(answers[q.id], q.levels.length)
    );
    const rawAverage =
      normalizedScores.reduce((sum, n) => sum + n, 0) / normalizedScores.length;
    const score = Math.round(rawAverage);
    return {
      gap: gapMeta.id,
      name: gapMeta.name,
      score,
      gapToClose: 100 - score,
    };
  });

  const overallScore = Math.round(
    gapResults.reduce((sum, g) => sum + g.score, 0) / gapResults.length
  );

  const widestGap = gapResults.reduce((worst, g) =>
    g.score < worst.score ? g : worst
  );

  return { overallScore, band: bandFor(overallScore), gaps: gapResults, widestGap };
}
```

Add `Question` to the type import from `./questions`.

Finally, mark the old helper deprecated without changing its behavior — add above `tierForRating`:

```ts
/**
 * @deprecated Five-choice questions only. It takes no choice count, so it
 * cannot describe a 3- or 7-choice question. Use tierForLevel(value, count).
 * Retained because tests/scoring.test.ts pins it as a regression gate.
 */
```

- [ ] **Step 5: Run both scoring test files**

Run: `npx vitest run tests/scoring.variable.test.ts tests/scoring.test.ts`

Expected: PASS, both files. `tests/scoring.test.ts` passing **unmodified** is the point of this task — its worked example (Wealth 50, Accounting 75, Value 50, Earnings 57, overall 58) must still hold.

- [ ] **Step 6: Run the whole suite to catch collateral damage**

Run: `npm test`

Expected: PASS. `scoreAssessment` gained a defaulted parameter, so existing callers in `app/api/submit/route.ts` are unaffected.

- [ ] **Step 7: Commit**

```bash
git add lib/questions.ts lib/scoring.ts tests/scoring.variable.test.ts
git commit -m "Score questions against their own choice count, not a fixed five"
```

---

### Task 2: The stored question shape and its validation

Still pure — no database. This module is the single gatekeeper used by the draft save, the publish, and the runtime resolver, so a malformed set cannot reach a prospect from any direction.

**Files:**
- Create: `lib/questionSet.ts`
- Test: `tests/questionSet.test.ts` (create)

**Interfaces:**
- Consumes: `tierForLevel` from `lib/scoring.ts` (Task 1); `Gap`, `Question`, `QUESTIONS` from `lib/questions.ts`.
- Produces:
  - `MIN_LEVELS = 2`, `MAX_LEVELS = 7`, `MAX_QUESTIONS = 100`
  - `interface StoredLevel { value: number; label: string; description: string }`
  - `interface StoredQuestion { id: string; gap: Gap; statement: string; levels: StoredLevel[] }`
  - `validateQuestionSet(raw: unknown): { ok: true; questions: StoredQuestion[] } | { ok: false; errors: string[] }`
  - `withDerivedTiers(questions: StoredQuestion[]): Question[]`
  - `toStored(questions: Question[]): StoredQuestion[]`
  - `nextQuestionId(questions: StoredQuestion[], gap: Gap): string`
  - `factoryQuestionSet(): StoredQuestion[]`

- [ ] **Step 1: Write the failing test**

Create `tests/questionSet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateQuestionSet,
  withDerivedTiers,
  toStored,
  nextQuestionId,
  factoryQuestionSet,
  MAX_LEVELS,
  type StoredQuestion,
} from "@/lib/questionSet";
import { QUESTIONS } from "@/lib/questions";

// One module gates every path into the stored question set: the draft
// save, the publish, and the runtime read. A set that fails here must
// never reach a prospect, and a set that passes here must be safe to
// score without further checking.

function question(
  id: string,
  gap: StoredQuestion["gap"],
  choiceCount = 5
): StoredQuestion {
  return {
    id,
    gap,
    statement: `${id} statement`,
    levels: Array.from({ length: choiceCount }, (_, i) => ({
      value: i + 1,
      label: `${id} label ${i + 1}`,
      description: `${id} description ${i + 1}`,
    })),
  };
}

// The smallest set that satisfies "every gap has at least one question".
function validSet(): StoredQuestion[] {
  return [
    question("W1", "wealth"),
    question("A1", "accounting"),
    question("V1", "value"),
    question("E1", "earnings"),
  ];
}

describe("validateQuestionSet accepts", () => {
  it("a minimal set with one question per gap", () => {
    const result = validateQuestionSet(validSet());
    expect(result.ok).toBe(true);
  });

  it("the factory question set", () => {
    // If the shipped defaults cannot pass their own validator, the
    // fallback path is broken and every other guarantee is worthless.
    const result = validateQuestionSet(factoryQuestionSet());
    expect(result.ok).toBe(true);
  });

  it("mixed choice counts across questions", () => {
    const set = validSet();
    set[0] = question("W1", "wealth", 3);
    set[1] = question("A1", "accounting", 7);
    expect(validateQuestionSet(set).ok).toBe(true);
  });

  it("a two-choice question, which is allowed but discouraged", () => {
    const set = validSet();
    set[0] = question("W1", "wealth", 2);
    expect(validateQuestionSet(set).ok).toBe(true);
  });

  it("trims surrounding whitespace from text", () => {
    const set = validSet();
    set[0].statement = "  padded  ";
    const result = validateQuestionSet(set);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.questions[0].statement).toBe("padded");
  });
});

describe("validateQuestionSet rejects", () => {
  it("a value that is not an array", () => {
    expect(validateQuestionSet({ nope: true }).ok).toBe(false);
  });

  it("a gap with no questions", () => {
    const set = validSet().filter((q) => q.gap !== "wealth");
    const result = validateQuestionSet(set);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/wealth/i);
  });

  it("duplicate question ids", () => {
    const set = [...validSet(), question("W1", "wealth")];
    const result = validateQuestionSet(set);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/W1/);
  });

  it("an id with characters that would break an Excel header or JSON key", () => {
    const set = validSet();
    set[0].id = "W 1!";
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("fewer than two choices", () => {
    const set = validSet();
    set[0] = question("W1", "wealth", 1);
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("more than the maximum choices", () => {
    const set = validSet();
    set[0] = question("W1", "wealth", MAX_LEVELS + 1);
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("level values that are not contiguous from 1", () => {
    const set = validSet();
    set[0].levels = [
      { value: 1, label: "a", description: "a" },
      { value: 3, label: "b", description: "b" },
    ];
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("an empty statement", () => {
    const set = validSet();
    set[0].statement = "   ";
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("an empty choice label", () => {
    const set = validSet();
    set[0].levels[2].label = "";
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("an unknown gap", () => {
    const set = validSet();
    (set[0] as { gap: string }).gap = "marketing";
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("a statement past the length cap", () => {
    const set = validSet();
    set[0].statement = "x".repeat(401);
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("reports every problem at once rather than only the first", () => {
    const set = validSet();
    set[0].statement = "";
    set[1].statement = "";
    const result = validateQuestionSet(set);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("does not mutate the input it was given", () => {
    const set = validSet();
    const before = JSON.parse(JSON.stringify(set));
    validateQuestionSet(set);
    expect(set).toEqual(before);
  });
});

describe("withDerivedTiers", () => {
  it("attaches a tier to every level", () => {
    const [q] = withDerivedTiers([question("W1", "wealth", 5)]);
    expect(q.levels.map((l) => l.tier)).toEqual([
      "Poor",
      "Fair",
      "Good",
      "Excellent",
      "Excellent",
    ]);
  });

  it("derives tiers correctly for a three-choice question", () => {
    const [q] = withDerivedTiers([question("W1", "wealth", 3)]);
    expect(q.levels.map((l) => l.tier)).toEqual(["Poor", "Good", "Excellent"]);
  });
});

describe("toStored", () => {
  it("drops the tier, which is derived rather than stored", () => {
    const stored = toStored(QUESTIONS);
    expect(stored[0].levels[0]).not.toHaveProperty("tier");
  });

  it("round-trips the factory set through validation", () => {
    expect(validateQuestionSet(toStored(QUESTIONS)).ok).toBe(true);
  });
});

describe("nextQuestionId", () => {
  it("uses the gap's letter and the next free number", () => {
    expect(nextQuestionId(validSet(), "wealth")).toBe("W2");
  });

  it("does not reuse an id that already exists in another gap", () => {
    const set = [...validSet(), question("W2", "value")];
    expect(nextQuestionId(set, "wealth")).toBe("W3");
  });

  it("gives each gap its own letter", () => {
    expect(nextQuestionId(validSet(), "accounting")).toBe("A2");
    expect(nextQuestionId(validSet(), "value")).toBe("V2");
    expect(nextQuestionId(validSet(), "earnings")).toBe("E2");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/questionSet.test.ts`

Expected: FAIL — `lib/questionSet.ts` does not exist, so the import fails.

- [ ] **Step 3: Implement `lib/questionSet.ts`**

Write the module to satisfy the interfaces above. Required behaviors, all pinned by the tests:

- `ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/`.
- `GAP_PREFIX: Record<Gap, string> = { wealth: "W", accounting: "A", value: "V", earnings: "E" }`.
- `validateQuestionSet` collects **all** errors into the array rather than returning on the first; it deep-copies before trimming so the input is never mutated; it returns trimmed text on success.
- Check order within a question: shape, then id, then gap, then statement, then levels. Prefix each error with the question id when one is known, so the admin UI can show it against the right row.
- The four-gaps-covered check runs after the per-question checks, comparing against the `GAPS` array so it cannot drift.
- `withDerivedTiers` calls `tierForLevel(level.value, question.levels.length)`.
- `nextQuestionId` scans **all** ids in the set, not just the target gap's, so ids stay globally unique even after a question moves between gaps.
- `factoryQuestionSet()` returns `toStored(QUESTIONS)`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/questionSet.test.ts`

Expected: PASS, all cases.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`

Expected: PASS. This task only adds a new module.

- [ ] **Step 6: Commit**

```bash
git add lib/questionSet.ts tests/questionSet.test.ts
git commit -m "Add the stored question set shape and its validator"
```

---

### Task 3: Schema and the published/draft resolver

Where the database takes ownership. The fallback behavior is the safety-critical part: a failed read, a missing table, or an invalid stored set must all degrade to the factory questions rather than breaking the assessment.

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `lib/questionContent.ts` (rewrite)
- Test: `tests/questionContent.test.ts` (rewrite)

**Interfaces:**
- Consumes: `validateQuestionSet`, `withDerivedTiers`, `toStored`, `factoryQuestionSet` from `lib/questionSet.ts` (Task 2); `db` from `lib/db.ts`.
- Produces:
  - `resolveQuestions(raw: unknown): Question[] | null` — pure; validates then derives tiers, `null` when invalid.
  - `getPublishedQuestions(): Promise<{ questions: Question[]; version: number | null }>`
  - `getDraftQuestions(): Promise<{ questions: Question[]; updatedAt: Date | null }>`
  - `seedDraftQuestions(): Promise<{ questions: StoredQuestion[]; updatedAt: Date }>` — the migration path off `QuestionOverride`. It returns `updatedAt` because Task 7's editor needs it for the 409 optimistic-concurrency check, and this function writes the row so it already holds the timestamp; returning a bare array would force Task 7 into a second redundant read.
- `mergeQuestions` is **retained**, used only by `seedDraftQuestions`.
- `getResolvedQuestions()` is **retained as a deprecated alias** delegating to `(await getPublishedQuestions()).questions`. `app/admin/questions/page.tsx` still imports it and is not rewritten until Task 7; without the alias the build is broken at every commit from Task 3 to Task 7. Task 7 deletes it.

- [ ] **Step 1: Add the schema models**

In `prisma/schema.prisma`, add:

```prisma
// The single mutable working copy of the question set. Every write
// upserts against the literal id "draft", so a second row is not
// reachable through the API. Nothing here is live until it is published.
model QuestionDraft {
  id        String   @id @default("draft")
  questions Json
  updatedAt DateTime @updatedAt

  @@map("question_draft")
}

// Published snapshots, append-only. The highest version is what the
// public assessment serves. Rolling back appends a new version carrying
// an older one's content rather than deleting rows, so this stays a true
// log of what was live and when.
model QuestionSetVersion {
  version     Int      @id
  questions   Json
  note        String?
  publishedAt DateTime @default(now())

  @@map("question_set_versions")
}
```

And on `model Submission`, after `readinessBand`:

```prisma
  // Which published question set this run answered. Null means the
  // factory default, including every run taken before versioning existed.
  questionSetVersion Int?
```

- [ ] **Step 2: Regenerate the Prisma client**

Run: `npx prisma generate`

Expected: "Generated Prisma Client". Without this the new models are absent from the client and every test in this task fails on an undefined property.

- [ ] **Step 3: Write the failing test**

Rewrite `tests/questionContent.test.ts`. Keep the existing `mergeQuestions` describe block verbatim — it still guards the seeding path — and add:

```ts
import { resolveQuestions } from "@/lib/questionContent";
import { factoryQuestionSet } from "@/lib/questionSet";

describe("resolveQuestions", () => {
  it("returns tier-annotated questions for a valid stored set", () => {
    const questions = resolveQuestions(factoryQuestionSet());
    expect(questions).not.toBeNull();
    expect(questions![0].levels[0].tier).toBe("Poor");
  });

  it("returns null for a stored set that fails validation", () => {
    // A stored set can be invalid even though the API validated it on the
    // way in: an older version, a hand-edited row, a partial write. The
    // caller falls back to the factory set rather than serving this.
    expect(resolveQuestions([{ id: "W1", gap: "wealth" }])).toBeNull();
  });

  it("returns null rather than throwing for junk", () => {
    expect(resolveQuestions("not a question set")).toBeNull();
    expect(resolveQuestions(null)).toBeNull();
  });
});
```

Then add a `getPublishedQuestions` block with a mocked `@/lib/db`, following the mocking style already used in `tests/submitRoute.test.ts`:

```ts
// Asserts the fallback chain, which is the safety-critical part: a
// missing table (the 2026-08-12 outage), a read error, or an invalid
// stored set must each degrade to the factory questions rather than
// breaking the assessment for every prospect.
```

Cover four cases: (a) no published version exists → factory questions and `version: null`; (b) a valid published version → its questions and its number; (c) the highest version wins when several exist; (d) `findFirst` rejects → factory questions, `version: null`, and `console.error` was called.

- [ ] **Step 4: Run the test and verify it fails**

Run: `npx vitest run tests/questionContent.test.ts`

Expected: FAIL — `resolveQuestions` and `getPublishedQuestions` are not exported yet.

- [ ] **Step 5: Rewrite `lib/questionContent.ts`**

Keep `mergeQuestions` and its helpers as they are. Add:

- `resolveQuestions(raw)` — `validateQuestionSet` then `withDerivedTiers`; returns `null` on failure, never throws.
- `getPublishedQuestions()` — `db.questionSetVersion.findFirst({ orderBy: { version: "desc" } })`; on a missing row, an invalid set, or a thrown error, return `{ questions: QUESTIONS, version: null }` and `console.error` the reason.
- `getDraftQuestions()` — read the `"draft"` row; if absent, fall back to the published set, then to factory; return `updatedAt` for the optimistic-concurrency check.
- `seedDraftQuestions()` — if a draft row exists, return its questions and `updatedAt`. Otherwise build from the highest published version if there is one, else `mergeQuestions(QUESTIONS, await db.questionOverride.findMany())` so the existing wording edits carry forward, then `toStored`, write the draft row, and return the written row's questions and `updatedAt`.
- `getResolvedQuestions()` — keep it exported as a thin deprecated alias returning `(await getPublishedQuestions()).questions`, with a comment saying Task 7 removes it. `app/admin/questions/page.tsx` imports it and is not rewritten until Task 7.

Update the file's header comment: it currently states that `lib/questions.ts` owns structure, which this change reverses. Say instead that the database owns the set and `lib/questions.ts` is the factory default and fallback.

- [ ] **Step 6: Run the test and verify it passes**

Run: `npx vitest run tests/questionContent.test.ts`

Expected: PASS.

- [ ] **Step 7: Push the schema to the local database**

Run: `npx prisma db push`

Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 8: Run the whole suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma lib/questionContent.ts tests/questionContent.test.ts
git commit -m "Store the question set in the database, with the code file as fallback"
```

---

### Task 4: Draft, publish, rollback, and reset routes

Whole-set operations rather than per-question edits, which is what makes add, delete, and reorder atomic.

**Files:**
- Create: `app/api/admin/questions/draft/route.ts`, `app/api/admin/questions/publish/route.ts`, `app/api/admin/questions/rollback/route.ts`, `app/api/admin/questions/reset-draft/route.ts`
- Delete: `app/api/admin/questions/[id]/route.ts`
- Modify: `tests/adminRoutes.test.ts` — remove the two describe blocks for `PUT /api/admin/questions/[id]` and `DELETE /api/admin/questions/[id]` (lines 110-197) and the now-unused `QUESTIONS` import. Leave the settings and submissions blocks untouched.
- Test: `tests/adminQuestionRoutes.test.ts` (create)

**Interfaces:**
- Consumes: `validateQuestionSet`, `factoryQuestionSet` (Task 2); `getDraftQuestions`, `seedDraftQuestions` (Task 3).
- Produces these HTTP contracts, which Task 7's UI depends on:
  - `GET /api/admin/questions/draft` → `200 { questions: StoredQuestion[], updatedAt: string | null, publishedVersion: number | null }`
  - `PUT /api/admin/questions/draft` body `{ questions, updatedAt }` → `200 { ok: true, updatedAt }` | `400 { error, errors[] }` | `409 { error }`
  - `POST /api/admin/questions/publish` body `{ note?: string }` → `200 { ok: true, version }` | `400 { error, errors[] }`
  - `POST /api/admin/questions/rollback` body `{ version: number }` → `200 { ok: true, version }` | `404 { error }`
  - `POST /api/admin/questions/reset-draft` body `{ to: "live" | "factory" }` → `200 { ok: true }`

- [ ] **Step 1: Write the failing test**

Create `tests/adminQuestionRoutes.test.ts`, mocking `@/lib/db` in the style of `tests/adminRoutes.test.ts`. Required cases:

*`PUT /api/admin/questions/draft`*
- saves a valid set and returns the new `updatedAt`
- rejects an invalid set with 400 **and writes nothing** (assert the upsert mock was not called — a rejected save that still wrote would be the worst outcome here)
- returns 400 listing every validation error, not just the first
- returns **409** when the submitted `updatedAt` is older than the stored one, and writes nothing
- accepts the write when `updatedAt` matches
- accepts the write when the stored draft does not exist yet

*`POST /api/admin/questions/publish`*
- writes a `QuestionSetVersion` whose `questions` equal the draft's
- numbers the first publish `1`
- numbers a later publish one above the current highest, **not** `count + 1` (a gap in the sequence must not cause a primary-key collision)
- refuses with 400 and publishes nothing when the draft fails validation
- stores the supplied note

*`POST /api/admin/questions/rollback`*
- appends a **new** version carrying the target version's questions
- leaves the target version row untouched
- returns 404 for a version that does not exist

*`POST /api/admin/questions/reset-draft`*
- `to: "factory"` overwrites the draft with the factory set
- `to: "live"` overwrites the draft with the highest published version
- `to: "live"` with nothing published falls back to the factory set

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/adminQuestionRoutes.test.ts`

Expected: FAIL — none of the four route modules exist.

- [ ] **Step 3: Implement the four routes**

Each route: parse JSON in a `try`/`catch` returning `400 { error: "Invalid JSON body." }`, validate with zod plus `validateQuestionSet`, and wrap database work in `try`/`catch` returning `500 { error: "Could not save. Please try again." }` after a `console.error`. Match the existing style in `app/api/admin/settings/route.ts`.

Two details the tests pin:

```ts
// Next version = highest existing + 1, never count + 1. A gap in the
// sequence (however it arose) would otherwise collide on the primary key.
const latest = await db.questionSetVersion.findFirst({
  orderBy: { version: "desc" },
});
const version = (latest?.version ?? 0) + 1;
```

```ts
// Optimistic concurrency. The admin passcode is shared, so two people can
// hold the editor at once; without this the second save silently discards
// the first person's work.
if (
  existing &&
  body.updatedAt &&
  existing.updatedAt.toISOString() !== body.updatedAt
) {
  return NextResponse.json(
    {
      error:
        "Someone else changed the draft while you were editing. Reload to get their changes before saving.",
    },
    { status: 409 }
  );
}
```

- [ ] **Step 4: Delete the superseded route**

```bash
git rm app/api/admin/questions/\[id\]/route.ts
```

- [ ] **Step 5: Remove its tests**

Delete lines 110-197 of `tests/adminRoutes.test.ts` (both `/api/admin/questions/[id]` describe blocks) and the `QUESTIONS` import on line 3, which becomes unused.

- [ ] **Step 6: Run the tests and verify they pass**

Run: `npx vitest run tests/adminQuestionRoutes.test.ts tests/adminRoutes.test.ts`

Expected: PASS both.

- [ ] **Step 7: Run the whole suite and the linter**

Run: `npm test && npm run lint`

Expected: PASS. Lint catches the unused import if step 5 was missed.

- [ ] **Step 8: Commit**

```bash
git add -A app/api/admin/questions tests/adminQuestionRoutes.test.ts tests/adminRoutes.test.ts
git commit -m "Replace per-question edits with whole-set draft, publish, and rollback"
```

---

### Task 5: Serve the published set to the public assessment

**Files:**
- Modify: `app/api/submit/route.ts`, `app/page.tsx`, `components/Assessment.tsx`, `components/RatingSelector.tsx`
- Test: `tests/submitRoute.test.ts`

**Interfaces:**
- Consumes: `getPublishedQuestions` (Task 3); `scoreAssessment(answers, questions)` (Task 1).
- Produces: `/api/submit` accepts a body whose ratings are bounded per question and writes `questionSetVersion` on the row.

- [ ] **Step 1: Update the submit route test**

In `tests/submitRoute.test.ts`, mock `@/lib/questionContent` so the route resolves a known set instead of reading the database:

```ts
vi.mock("@/lib/questionContent", () => ({
  getPublishedQuestions: vi.fn().mockResolvedValue({
    questions: QUESTIONS,
    version: 3,
  }),
}));
```

Keep every existing case — they are the silent-data-loss guards and must keep passing. Add:

```ts
it("records which published question set the run answered", async () => {
  createMock.mockResolvedValue({ id: "abc" });
  const { POST } = await import("@/app/api/submit/route");

  await POST(submitRequest(validBody) as never);

  expect(createMock.mock.calls[0][0].data.questionSetVersion).toBe(3);
});

it("rejects a rating above that question's own choice count", async () => {
  // The bound is per question now, not a global 1-5, so a three-choice
  // question must reject a 4 even though 4 is valid elsewhere in the set.
  const { POST } = await import("@/app/api/submit/route");
  const res = await POST(
    submitRequest({ ...validBody, answers: { ...completeAnswers(), W1: 9 } }) as never
  );
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/submitRoute.test.ts`

Expected: FAIL on the new `questionSetVersion` assertion — the route does not write that field yet.

- [ ] **Step 3: Update `app/api/submit/route.ts`**

Move the validator inside `POST`, because the question set is now resolved per request rather than imported:

```ts
// Built per request from the PUBLISHED set, so the bound on each answer
// is that question's own choice count. Deriving it here rather than
// hand-listing keys is what keeps the validator from drifting out of
// sync when a question is added or removed.
const { questions, version } = await getPublishedQuestions();

const answersShape = Object.fromEntries(
  questions.map((q) => [q.id, z.number().int().min(1).max(q.levels.length)])
);
const submitSchema = z.object({
  answers: z.object(answersShape).strict(),
  prospectName: z.string().trim().min(1, "Name is required.").max(200),
  companyName: z.string().trim().min(1, "Company is required.").max(200),
});
```

Pass the set to the scorer: `result = scoreAssessment(answers, questions);`

Add `questionSetVersion: version` to the `db.submission.create` data. Remove the now-unused `QUESTIONS` import.

Keep the rate-limit check first — it must stay ahead of the database read so a flood cannot force one query per request.

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run tests/submitRoute.test.ts`

Expected: PASS.

- [ ] **Step 5: Serve the published set from the public page**

In `app/page.tsx`, swap `getResolvedQuestions()` for `getPublishedQuestions()` and pass through only `questions`.

- [ ] **Step 6: Make the rating buttons handle a variable choice count**

`components/RatingSelector.tsx` line 35 hardcodes `grid-cols-5`. Tailwind cannot take an interpolated class name — `grid-cols-${n}` is not in the generated CSS and silently produces no columns. Use an inline style:

```tsx
<div
  role="radiogroup"
  aria-label={question.statement}
  className="grid gap-2"
  style={{
    // Tailwind's grid-cols-N classes are generated at build time, so an
    // interpolated class name would be purged and silently do nothing.
    gridTemplateColumns: `repeat(${question.levels.length}, minmax(0, 1fr))`,
  }}
>
```

In `components/Assessment.tsx`, confirm nothing assumes 28 questions or 5 levels — the progress bar already divides by `questions.length`. Then grep for stray hardcoded counts:

```bash
grep -rn "28\|grid-cols-5" --include='*.tsx' components app
```

Fix any user-facing copy that names a fixed count, `components/IntroView.tsx` included.

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev`, open `http://localhost:3000`, complete the assessment.

Expected: it renders and scores exactly as before, because nothing has been published yet and the resolver is serving the factory set.

- [ ] **Step 8: Run the whole suite and the linter**

Run: `npm test && npm run lint`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/api/submit/route.ts app/page.tsx components/Assessment.tsx components/RatingSelector.tsx components/IntroView.tsx tests/submitRoute.test.ts
git commit -m "Serve the published question set to the public assessment"
```

---

### Task 6: Preview scoring

The route that lets a draft be score-tested without touching production data. Its whole reason for existing separately from `/api/submit` is that it writes nothing and emails nobody.

**Files:**
- Create: `app/api/admin/preview-score/route.ts`, `app/admin/preview/page.tsx`
- Test: `tests/previewScore.test.ts` (create)
- Verify: `proxy.ts` already covers `/admin/*` and `/api/admin/*`

**Interfaces:**
- Consumes: `getDraftQuestions` (Task 3); `scoreAssessment` (Task 1).
- Produces: `POST /api/admin/preview-score` body `{ answers }` → `200 ScoreResult & { preview: true }`.

- [ ] **Step 1: Write the failing test**

Create `tests/previewScore.test.ts`. Mock `@/lib/db` and `@/lib/email`. Cases:

- scores an answer map against the **draft** set, not the published one
- **never calls `db.submission.create`** — the central assertion of this task
- **never calls `sendSubmissionNotification`**
- returns `preview: true` so the client cannot mistake it for a real submission
- returns 400 for an incomplete answer map
- returns 400 with a readable message when the draft is invalid, rather than a 500

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/previewScore.test.ts`

Expected: FAIL — the route module does not exist.

- [ ] **Step 3: Implement the route**

```ts
// Scores against the DRAFT so a question set can be tested before it goes
// live. It deliberately shares no code path with /api/submit beyond
// scoreAssessment: no row is written, no email is sent, no rate limit is
// consumed. If this ever starts persisting anything, that is a bug.
```

Build the zod shape from the draft questions exactly as Task 5 does from the published ones.

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run tests/previewScore.test.ts`

Expected: PASS.

- [ ] **Step 5: Build the preview page**

`app/admin/preview/page.tsx`: `export const dynamic = "force-dynamic"`, read `getDraftQuestions()`, render a persistent banner and the existing `<Assessment>`.

Give `Assessment` an optional `submitPath` prop defaulting to `/api/submit`, and pass `/api/admin/preview-score` here. Do not fork the component — a copy would drift from the real one and stop being a faithful preview, which defeats the purpose.

Banner copy:

```tsx
<div role="status" className="bg-maroon px-5 py-2 text-center text-sm text-white">
  Preview of the draft question set. Nothing here is saved and no email is sent.
</div>
```

- [ ] **Step 6: Verify the gate covers it**

Run: `grep -n "matcher\|/admin" proxy.ts`

Expected: `/admin/preview` and `/api/admin/preview-score` both fall under the existing matcher. If not, extend it — an ungated preview route would expose the draft publicly.

- [ ] **Step 7: Run the whole suite**

Run: `npm test && npm run lint`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/api/admin/preview-score app/admin/preview components/Assessment.tsx tests/previewScore.test.ts
git commit -m "Add draft preview scoring that writes nothing"
```

---

### Task 7: The draft editor UI

The largest task, and the only one whose verification is manual. Split into three components so no single file holds the whole editor.

**Files:**
- Create: `components/QuestionSetEditor.tsx`, `components/QuestionRow.tsx`, `components/ScoringCheck.tsx`
- Modify: `app/admin/questions/page.tsx`
- Delete: `components/QuestionEditor.tsx`

**Interfaces:**
- Consumes: the five HTTP contracts from Task 4; `nextQuestionId`, `MIN_LEVELS`, `MAX_LEVELS` from Task 2; `tierForLevel`, `normalizeAnswer` from Task 1.
- Produces: no exports other components rely on.

- [ ] **Step 1: Rewrite the page shell**

`app/admin/questions/page.tsx` keeps `export const dynamic = "force-dynamic"`, calls `seedDraftQuestions()` and `getPublishedQuestions()`, and renders `<QuestionSetEditor initialQuestions={...} initialUpdatedAt={...} publishedVersion={...} />`. `seedDraftQuestions()` returns `{ questions, updatedAt }`, which supplies the first two props directly.

Also delete the `getResolvedQuestions` alias from `lib/questionContent.ts` — this page was its last caller. Confirm with `grep -rn "getResolvedQuestions" app lib components` before removing, and expect no hits afterwards.

Replace the page's standfirst, which currently promises that structure cannot change:

```tsx
<p className="mt-2 text-sm text-ink-muted leading-relaxed max-w-xl">
  Add, remove, and reword questions, and set how many answer choices each
  one has. Nothing here reaches the live assessment until you press
  Publish. Past submissions keep the scores they were given.
</p>
```

- [ ] **Step 2: Build `QuestionSetEditor.tsx`**

A client component owning the whole draft as one `useState<StoredQuestion[]>`, plus `updatedAt`, `status`, and `error`.

Header: question count, live version (or "nothing published yet"), and buttons for Save draft, Publish, Discard changes, Reset to factory.

Client-side validation mirroring `validateQuestionSet` renders a problem list and disables Publish while it is non-empty. The server re-validates regardless — the client check is for feedback, never for safety.

Per gap: a heading, its `QuestionRow`s, and an "Add question" button calling `nextQuestionId(questions, gap)` and appending a question with three empty choices.

On a 409 from `PUT .../draft`, show: *"Someone else changed the draft while you were editing. Reload to get their changes before saving."* Do **not** auto-reload — that would discard the user's unsaved work.

Publish opens a two-step inline confirm naming what goes live, matching the pattern in `components/DeleteSubmissionButton.tsx`. It takes an optional note.

A link to `/admin/preview` sits next to Publish, with a note that preview shows the **draft**, so it must be saved first.

- [ ] **Step 3: Build `QuestionRow.tsx`**

One question, collapsed to its id and statement, expanding to: statement textarea; per-choice label input, description textarea, and a read-only tier badge from `tierForLevel(value, levels.length)`; Add choice (hidden at `MAX_LEVELS`) and Remove choice (hidden at `MIN_LEVELS`); move up/down within the gap; a gap `<select>`; and Delete question behind a two-step confirm.

Removing a choice always removes the **last** one and renumbers, so `value` stays contiguous from 1. Removing from the middle would leave a hole that `validateQuestionSet` rejects.

The two-choice warning, shown whenever `levels.length === 2`:

```tsx
{levels.length === 2 && (
  <p role="status" className="mt-2 text-xs text-maroon">
    With two choices this question can only score 0 or 100, so it moves its
    section score more than any other question. Three or more is usually
    better.
  </p>
)}
```

Deleting a question warns that answers already recorded against its id stay in past submissions but stop appearing in the summary export.

- [ ] **Step 4: Build `ScoringCheck.tsx`**

Given the draft, compute locally with `normalizeAnswer` and show: a per-gap question count, and the overall score for all-lowest, all-middle, and all-highest answers.

All-lowest must read 0 and all-highest 100 for any valid set. Any other number means the set or the math is wrong, so label them as expected values rather than leaving the reader to work it out:

```tsx
<p className="mt-2 text-xs text-ink-muted">
  Lowest should always be 0 and highest always 100. Anything else means a
  question is misconfigured.
</p>
```

Round the middle row exactly as `scoreAssessment` does — per gap, then overall — so the panel cannot disagree with the real scorer.

- [ ] **Step 5: Delete the superseded component**

```bash
git rm components/QuestionEditor.tsx
```

- [ ] **Step 6: Verify manually in the browser**

Run `npm run dev` and work through `/admin/questions`:

1. Add a question to Wealth, give it 3 choices, fill it in, Save draft.
2. Confirm `/` still shows the **old** set — it is not published yet.
3. Open `/admin/preview` and confirm the new question appears with 3 buttons.
4. Complete the preview, confirm a score comes back, and confirm `/admin` shows **no** new submission.
5. Drop a question to 2 choices and confirm the warning appears.
6. Empty a statement and confirm Publish is disabled with a named problem.
7. Fix it, Publish, and confirm `/` now shows the new set.
8. Delete a question, publish again, and confirm the assessment still scores.
9. Roll back to version 1 and confirm `/` returns to the earlier set.

- [ ] **Step 7: Run the whole suite and the linter**

Run: `npm test && npm run lint`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A components app/admin/questions
git commit -m "Add the draft question set editor with a scoring check panel"
```

---

### Task 8: Slim the summary export and add the version sheet

**Files:**
- Modify: `lib/excel.ts`
- Test: `tests/excel.test.ts` (create)

**Interfaces:**
- Consumes: `db.questionSetVersion` (Task 3).
- Produces: `buildSubmissionsWorkbook(submissions, versions)` — takes the published versions as a second argument so the builder stays pure and testable without a database.

- [ ] **Step 1: Write the failing test**

Create `tests/excel.test.ts`. Read the workbook back with `ExcelJS.Workbook().xlsx.load(buffer)` and assert on cells. Cases:

- the Submissions sheet has **no** per-question columns (assert no header equals `"W1"`) — this is the change the user asked for
- it carries the gap scores, overall, band, and a `Question set` column
- `Question set` shows the version number, and `factory` when the field is null
- a `Question sets` sheet exists
- it has one row per question per version
- choice columns are filled to each question's choice count and empty beyond it
- a question with 7 choices fills all 7 columns
- an empty version list still produces a valid workbook with only headers

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/excel.test.ts`

Expected: FAIL — the Submissions sheet still has question columns and there is no second sheet.

- [ ] **Step 3: Update `lib/excel.ts`**

Delete the `questionColumns` block and the per-question loop in the row builder. Add `{ header: "Question set", key: "questionSetVersion", width: 12 }` and populate it with `s.questionSetVersion ?? "factory"`.

Add the version sheet, one row per question per version, with columns Version, Published, Note, Question ID, Gap, Statement, Choices, then `Choice 1` through `Choice 7`. Fill each choice cell as `` `${label} — ${description}` `` and leave the rest empty.

Reuse the existing maroon header styling; extract it into a local helper rather than duplicating it across both sheets.

Update the file header comment — it currently describes 28 answer columns.

- [ ] **Step 4: Update the export route**

`app/api/admin/export/route.ts` now reads the versions and passes them in:

```ts
const versions = await db.questionSetVersion.findMany({
  orderBy: { version: "asc" },
});
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run tests/excel.test.ts`

Expected: PASS.

- [ ] **Step 6: Verify by downloading**

Run `npm run dev`, open `/admin`, click Download Excel, open the file.

Expected: two sheets; Submissions is scannable with no answer columns; Question sets lists every published version.

- [ ] **Step 7: Commit**

```bash
git add lib/excel.ts app/api/admin/export/route.ts tests/excel.test.ts
git commit -m "Slim the summary export and record question set versions in it"
```

---

### Task 9: Single-run export

**Files:**
- Create: `lib/excelRun.ts`, `app/api/admin/submissions/[id]/export/route.ts`
- Modify: `app/admin/page.tsx`
- Test: `tests/excel.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveQuestions` (Task 3); `normalizeAnswer` (Task 1).
- Produces: `buildRunWorkbook(submission, questions, versionLabel): Promise<ExcelJS.Buffer>`.

- [ ] **Step 1: Write the failing test**

Extend `tests/excel.test.ts`:

- one row per question, carrying the statement, the chosen number, that choice's label and description, and the score out of 100
- the score column matches `normalizeAnswer(answer, choiceCount)`
- the header block carries prospect, company, overall score, band, and the version label
- a question the run has no answer for renders blank rather than throwing
- a three-choice question's top answer scores 100, not 50 — the run export must use **that run's** question set, not today's

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/excel.test.ts`

Expected: FAIL — `lib/excelRun.ts` does not exist.

- [ ] **Step 3: Implement `lib/excelRun.ts`**

```ts
// One run, fully expanded, against the question set that run actually
// answered -- not today's. A question reworded or removed since must not
// change what this file says the client was asked.
```

Header block, the four gap scores, then the per-question table.

- [ ] **Step 4: Implement the route**

`GET /api/admin/submissions/[id]/export`: load the submission (404 if missing); if `questionSetVersion` is set, load that `QuestionSetVersion` and `resolveQuestions` it; otherwise, or if that fails, use `QUESTIONS` and label it `factory (version not recorded)`.

```ts
headers: {
  "Content-Type":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "Content-Disposition": `attachment; filename="${filename}"`,
}
```

Build the filename as `wave-{company}-{date}.xlsx`, lowercased, with everything outside `[a-z0-9-]` replaced by `-`. An unsanitized company name would break the header.

- [ ] **Step 5: Add the button and fix the footnote**

In `app/admin/page.tsx`, add an Export link in the actions cell beside `DeleteSubmissionButton`:

```tsx
<a
  href={`/api/admin/submissions/${s.id}/export`}
  className="mr-3 text-sm text-maroon hover:underline"
>
  Export
</a>
```

Replace the footnote at lines 141-143, which stops being true once the summary sheet loses its answer columns:

```tsx
<p className="mt-4 text-xs text-ink-muted">
  The Excel download above lists scores only. For one run&rsquo;s full
  answers, with the questions exactly as they were asked at the time, use
  Export on that row.
</p>
```

- [ ] **Step 6: Run it and verify it passes**

Run: `npx vitest run tests/excel.test.ts`

Expected: PASS.

- [ ] **Step 7: Verify by downloading**

Run `npm run dev`, complete an assessment, open `/admin`, click Export on that row.

Expected: a workbook whose per-question rows match what was answered, with scores out of 100 that average to the gap scores shown.

- [ ] **Step 8: Run the whole suite and the linter**

Run: `npm test && npm run lint`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/excelRun.ts app/api/admin/submissions app/admin/page.tsx tests/excel.test.ts
git commit -m "Export a single run against the question set it answered"
```

---

### Task 10: Documentation and deploy

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the architecture section**

`CLAUDE.md` currently opens with "The question bank is the schema" and says `lib/questions.ts` defines all 28 questions. That is now false in both particulars. Rewrite that paragraph to say the database owns the published set, `lib/questions.ts` is the factory default and the fallback when the database is unavailable or its content fails validation, and `lib/questionSet.ts` is the one validator every write path goes through.

Update the scoring paragraph: the formula is now `(rating - 1) / (choiceCount - 1) * 100`, identical at five choices, and `tests/scoring.test.ts` is the pinned regression gate that must not be edited.

Add a line describing the draft/publish model and that `/admin/preview` scores without persisting.

Update the Commands section with `npx vitest run tests/scoring.variable.test.ts`.

- [ ] **Step 2: Run the full check**

Run: `npm test && npm run lint && npm run build`

Expected: all three pass. The build is what catches a server component importing a client-only module.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe database-owned question sets"
```

- [ ] **Step 4: Deploy**

1. Push the branch and merge to `main`.
2. **Run `npx prisma db push` against production `DATABASE_URL_UNPOOLED`** before or immediately after the deploy. A missing table caused the 2026-08-12 outage; this step is not optional.
3. Confirm the Vercel build succeeds. `postinstall: prisma generate` already exists, so the new models reach the built client.
4. On production: load `/`, confirm the assessment renders. Open `/admin/questions`, confirm the draft seeded from the existing wording edits. Publish once. Complete a run. Confirm it appears in `/admin` with a version number, and export it.
5. Delete the test submission.

The ordering is safe either way: with the tables absent, the resolver's fallback serves the factory questions, so the site works before the push lands.

---

## Self-Review

**Spec coverage:** Every spec section maps to a task — scoring generalization and tier derivation (1), validation rules and id generation (2), the two models and the resolver's fallback chain and the `QuestionOverride` seeding migration (3), the six API contracts (4, 6, 9), submit and public rendering (5), preview (6), the editor with its two-choice warning and scoring check (7), the split export with the version sheet (8, 9), deploy (10).

**Not covered, deliberately:** the spec's "Out of scope" list — editable gaps, re-scoring past submissions, dropping `QuestionOverride`, per-question weighting, and `actionLibrary`/`comboRules`.

**Known risks:**
- Task 7 is the only task without automated verification. Its step 6 checklist is the substitute and should be worked through in order rather than skimmed.
- Task 5 changes `/api/submit` from a static import to a per-request database read. The rate limiter stays ahead of it so a flood cannot amplify into one query per request.
- `Assessment.tsx` is edited in both Task 5 and Task 6. Task 6 only adds the `submitPath` prop.
