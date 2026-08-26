import { describe, it, expect } from "vitest";
import {
  MAX_COMMENT_LENGTH,
  commentsMap,
  normalizeComments,
} from "../lib/comments";

const IDS = ["W1", "W2", "A1"];

describe("normalizeComments", () => {
  it("keeps comments for known questions, trimmed", () => {
    expect(normalizeComments({ W1: "  sold the building  " }, IDS)).toEqual({
      W1: "sold the building",
    });
  });

  it("collapses the wrote-nothing cases to null, never {}", () => {
    // One representation for one fact -- see lib/comments.ts.
    expect(normalizeComments({}, IDS)).toBeNull();
    expect(normalizeComments(null, IDS)).toBeNull();
    expect(normalizeComments(undefined, IDS)).toBeNull();
    expect(normalizeComments({ W1: "" }, IDS)).toBeNull();
    expect(normalizeComments({ W1: "   \n\t  " }, IDS)).toBeNull();
  });

  it("rejects non-object input instead of throwing", () => {
    expect(normalizeComments("nope", IDS)).toBeNull();
    expect(normalizeComments(42, IDS)).toBeNull();
    expect(normalizeComments(["a"], IDS)).toBeNull();
  });

  it("drops keys that are not live question ids", () => {
    expect(normalizeComments({ W1: "keep", ZZ9: "drop" }, IDS)).toEqual({
      W1: "keep",
    });
  });

  it("drops non-string values", () => {
    expect(normalizeComments({ W1: 5, W2: "keep" }, IDS)).toEqual({ W2: "keep" });
  });

  it("truncates at the cap", () => {
    const long = "x".repeat(MAX_COMMENT_LENGTH + 250);
    const out = normalizeComments({ W1: long }, IDS);
    expect(out?.W1).toHaveLength(MAX_COMMENT_LENGTH);
  });

  it("keeps several comments keyed to the right questions", () => {
    expect(
      normalizeComments({ W1: "one", A1: "three", W2: "two" }, IDS)
    ).toEqual({ W1: "one", W2: "two", A1: "three" });
  });

  it("returns null when every id is unknown", () => {
    expect(normalizeComments({ NOPE: "text" }, IDS)).toBeNull();
  });
});

describe("commentsMap", () => {
  it("narrows the Json column to a string map", () => {
    expect(commentsMap({ W1: "a", W2: 3 })).toEqual({ W1: "a" });
    expect(commentsMap(null)).toEqual({});
    expect(commentsMap(["a"])).toEqual({});
  });
});
