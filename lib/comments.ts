// Optional per-question context a respondent can attach to any question.
//
// Comments never touch scoring. They exist so an owner can say "we sold the
// building in 2024" next to a rating instead of leaving the number to
// speak for a situation it can't describe.
//
// Zero dependencies on Next.js, Prisma, React, or the DOM, so this is unit
// tested directly (tests/comments.test.ts) and shared by /api/submit and
// the exports without risking drift.

export const MAX_COMMENT_LENGTH = 1000;

// A second, far looser ceiling used only to reject abusive payloads at the
// API boundary. Two tiers, because the two jobs are different:
//
//   MAX_COMMENT_LENGTH  is a UI cap. The textarea enforces it, and anything
//                       arriving above it is TRUNCATED, never rejected.
//   MAX_COMMENT_PAYLOAD is an abuse ceiling, set high enough that no real
//                       respondent can reach it.
//
// A note must never be able to fail a submission -- losing five minutes of
// answers over a stray paste is the exact class of silent data loss this
// route already carries scar tissue about.
export const MAX_COMMENT_PAYLOAD_LENGTH = MAX_COMMENT_LENGTH * 4;

// Trims, drops anything empty or not asked about, and collapses the
// nothing-was-written case to null.
//
// Null rather than {} is deliberate: the column would otherwise have two
// spellings for the same fact, and every reader would have to check both.
// Unknown keys are dropped rather than rejected -- a stale client whose
// question set was republished mid-assessment should still get its
// answers recorded, and a note against a question that no longer exists
// has nowhere to be displayed anyway.
export function normalizeComments(
  raw: unknown,
  validIds: string[]
): Record<string, string> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const allowed = new Set(validIds);
  const out: Record<string, string> = {};

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(id)) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, MAX_COMMENT_LENGTH);
    if (trimmed.length === 0) continue;
    out[id] = trimmed;
  }

  return Object.keys(out).length > 0 ? out : null;
}

// How many questions a submission carries context for. Used by the admin
// table to show that a run has notes worth opening the export for.
export function commentCount(comments: unknown): number {
  if (comments === null || typeof comments !== "object" || Array.isArray(comments)) {
    return 0;
  }
  return Object.keys(comments as Record<string, unknown>).length;
}

// Narrows the Json column to something indexable by question id. Prisma
// types Json as unknown-ish, and every reader wants the same shape.
export function commentsMap(comments: unknown): Record<string, string> {
  if (comments === null || typeof comments !== "object" || Array.isArray(comments)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(comments as Record<string, unknown>)) {
    if (typeof value === "string") out[id] = value;
  }
  return out;
}
