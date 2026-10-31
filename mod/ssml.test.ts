import { describe, expect, it } from "vitest";
import type { Mark } from "../src/marks.ts";
import { rateAttr, unwrapMarks, wrapProsody, wrappedLimit } from "./ssml.ts";

/** Marks over `input` for every run of non-space characters, as a word-level API would return them. */
const wordMarks = (input: string, from: number, to: number): Mark[] =>
  [...input.slice(from, to).matchAll(/\S+/g)].map((m) => ({ start: from + m.index, end: from + m.index + m[0].length, startMs: 0, endMs: 1 }));

describe("ssml", () => {
  it("spells the rate as a relative percentage", () => {
    expect(rateAttr(1.25)).toBe("+25%");
    expect(rateAttr(0.75)).toBe("-25%");
    expect(rateAttr(2)).toBe("+100%");
    expect(rateAttr(1)).toBe("+0%");
  });

  it("wraps the text and escapes what XML needs escaped", () => {
    const w = wrapProsody("a < b & c > d", 1.5);
    expect(w.input).toBe('<speak><prosody rate="+50%">a &lt; b &amp; c &gt; d</prosody></speak>');
  });

  it("maps marks on the body back onto the text, through the escapes", () => {
    const text = "Tom & Jerry <3 cats";
    const w = wrapProsody(text, 1.25);
    const bodyStart = w.input.indexOf(">") + 1;
    const bodyEnd = w.input.indexOf("</prosody>");
    const marks = unwrapMarks(wordMarks(w.input, bodyStart, bodyEnd), w);
    expect(marks.map((m) => text.slice(m.start, m.end))).toEqual(["Tom", "&", "Jerry", "<3", "cats"]);
  });

  it("a mark inside an escape covers the whole character it came from", () => {
    const w = wrapProsody("x&y", 1.25);
    const amp = w.input.indexOf("&amp;");
    const [m] = unwrapMarks([{ start: amp + 1, end: amp + 3, startMs: 0, endMs: 1 }], w);
    expect([m!.start, m!.end]).toEqual([1, 2]);
  });

  it("wrappedLimit leaves room for the markup and every escape in the paragraph", () => {
    const plain = "a".repeat(3000);
    expect(wrappedLimit(plain, 1.5, 2000)).toBe(2000 - '<speak><prosody rate="+50%"></prosody></speak>'.length);
    const amps = "a &".repeat(600); // 600 ampersands at 4 extra characters each: more than the cap, so the floor
    expect(wrappedLimit(amps, 1.5, 2000)).toBe(100);
    for (const limit of [wrappedLimit(plain, 1.5, 2000), wrappedLimit("x & y <z>", 2, 2000)]) {
      expect(limit).toBeGreaterThanOrEqual(100);
    }
  });

  it("marks on the markup alone are dropped, and ones past the body clamp", () => {
    const w = wrapProsody("hi", 1.25);
    const tail = w.input.length;
    expect(unwrapMarks([{ start: 0, end: 7, startMs: 0, endMs: 1 }], w)).toEqual([]);
    expect(unwrapMarks([{ start: tail - 3, end: tail, startMs: 0, endMs: 1 }], w)).toEqual([]);
    const bodyStart = w.input.indexOf(">") + 1;
    expect(unwrapMarks([{ start: bodyStart, end: tail, startMs: 0, endMs: 1 }], w)).toEqual([{ start: 0, end: 2, startMs: 0, endMs: 1 }]);
  });
});
