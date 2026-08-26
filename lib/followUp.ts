// The results-page question asking whether the respondent wants to talk.
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

// Null is a real answer here -- "hasn't answered" is not "said no", and
// only one of those is a lead worth chasing.
export function followUpLabel(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "Not at this time";
  return "";
}
