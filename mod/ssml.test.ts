import { describe, expect, it } from "vitest";
import { rateAttr, unwrapMarks, wrapProsody, wrappedLimit } from "./ssml.ts";

describe("ssml", () => {
  it("spells the rate as a relative percentage", () => {
    expect(rateAttr(1.25)).toBe("+25%");
    expect(rateAttr(0.75)).toBe("-25%");
    expect(rateAttr(2)).toBe("+100%");
    expect(rateAttr(1)).toBe("+0%");
  });

  it("wraps the text and escapes what XML needs escaped", () => {
    expect(wrapProsody("a < b & c > d", 1.5)).toBe('<speak><prosody rate="+50%">a &lt; b &amp; c &gt; d</prosody></speak>');
  });

  it("marks index the bare text as the API returns them; one on the leading space is kept", () => {
    const text = "Cape Town sits";
    const marks = unwrapMarks(
      [
        { start: 0, end: 4, startMs: 0, endMs: 1 },
        { start: 4, end: 9, startMs: 1, endMs: 2 }, // " Town": the API sometimes starts on the space
        { start: 10, end: 14, startMs: 2, endMs: 3 },
      ],
      text.length,
    );
    expect(marks.map((m) => text.slice(m.start, m.end))).toEqual(["Cape", " Town", "sits"]);
  });

  it("marks past the text clamp, and an empty one is dropped", () => {
    expect(unwrapMarks([{ start: 10, end: 20, startMs: 0, endMs: 1 }], 14)).toEqual([{ start: 10, end: 14, startMs: 0, endMs: 1 }]);
    expect(unwrapMarks([{ start: 14, end: 20, startMs: 0, endMs: 1 }], 14)).toEqual([]);
    expect(unwrapMarks([{ start: -3, end: 2, startMs: 0, endMs: 1 }], 14)).toEqual([{ start: 0, end: 2, startMs: 0, endMs: 1 }]);
  });

  it("wrappedLimit leaves room for the markup and every escape in the paragraph", () => {
    const plain = "a".repeat(3000);
    expect(wrappedLimit(plain, 1.5, 2000)).toBe(2000 - '<speak><prosody rate="+50%"></prosody></speak>'.length);
    const amps = "a &".repeat(600); // 600 ampersands at 4 extra characters each: more than the cap, so the floor
    expect(wrappedLimit(amps, 1.5, 2000)).toBe(100);
  });
});
