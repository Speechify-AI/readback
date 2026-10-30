import { describe, expect, it } from "vitest";
import { fillGaps, sentenceRanges, type Mark } from "../src/marks.ts";
import { sentenceSegments } from "./sentence.ts";

const mark = (text: string, word: string, from = 0): Mark => {
  const start = text.indexOf(word, from);
  return { start, end: start + word.length, startMs: 0, endMs: 1 };
};

describe("sentenceSegments", () => {
  it("trims the leading gap carried from the previous sentence", () => {
    const text = "First one.   Second one here.";
    const second = sentenceRanges(text)[1]!;
    expect(text.slice(second.start, second.end)).toBe("   Second one here.");
    expect(sentenceSegments(text, second, mark(text, "one", 12))).toEqual({
      before: "Second ",
      word: "one",
      after: " here.",
    });
    expect(sentenceSegments(text, second, null)).toEqual({ before: "Second one here.", word: "", after: "" });
  });

  it("collapses a line break inside a sentence", () => {
    const text = "Read this\n  line  and\tthat.";
    const [only] = sentenceRanges(text);
    expect(sentenceSegments(text, only!, mark(text, "line"))).toEqual({
      before: "Read this ",
      word: "line",
      after: " and that.",
    });
  });

  it("the lit word never includes the gap fillGaps gave it", () => {
    // "(" and "Thursday" get no mark; fillGaps absorbs the hole forward into ")".
    const text = "See you on (a Thursday) then.";
    const raw = [mark(text, "See"), mark(text, "you"), mark(text, "on"), mark(text, "a"), mark(text, ")"), mark(text, "then.")];
    const filled = fillGaps(raw, text);
    const close = filled[4]!;
    expect(text.slice(close.start, close.end)).toBe(" Thursday)");
    const [only] = sentenceRanges(text);
    expect(sentenceSegments(text, only!, close)).toEqual({
      before: "See you on (a ",
      word: "Thursday)",
      after: " then.",
    });
  });
});
