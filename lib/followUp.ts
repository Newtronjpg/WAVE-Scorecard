// The question, asked on the results page, about whether the respondent wants
// to talk to someone -- and, if they do, what about.
//
// Dependency-free so the wording is shared by the client component, the
// API route, and both exports rather than being retyped in four places
// and drifting.

export const FOLLOW_UP_QUESTION =
  "Would you be open to discussing your results with a member of our team at a time that's convenient for you?";

export const FOLLOW_UP_YES = "Yes, I'd be open to a conversation";
export const FOLLOW_UP_NO = "Not at this time";

export const FOLLOW_UP_CONFIRMATION =
  "Someone from our team will reach out to find a convenient time to connect.";

// What someone may type about the conversation they want. Long enough for a
// paragraph, short enough that the column and the admin table stay readable;
// the textarea shows a counter as this is approached.
export const MAX_FOLLOW_UP_NOTE_LENGTH = 1000;

export const FOLLOW_UP_NOTE_LABEL =
  "Anything you'd like us to know before the conversation?";

export const FOLLOW_UP_NOTE_HINT =
  "Optional. A sentence on what you'd like to cover helps us come prepared.";

// Trimmed, capped, and emptied to null. Null and "" mean the same thing to a
// reader, so only one of them is ever stored.
export function normalizeFollowUpNote(
  note: string | null | undefined
): string | null {
  if (typeof note !== "string") return null;
  const trimmed = note.trim().slice(0, MAX_FOLLOW_UP_NOTE_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

// Null is a real answer here -- "hasn't answered" is not "said no", and
// only one of those is a lead worth chasing.
export function followUpLabel(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "Not at this time";
  return "";
}
