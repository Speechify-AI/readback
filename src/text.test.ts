import { describe, expect, it } from "vitest";
import {
  chunkRanges,
  entryLead,
  plainify,
  toParagraphs,
  truncate,
} from "./text.ts";

describe("toParagraphs", () => {
  it("splits on blank lines and keeps single newlines", () => {
    expect(toParagraphs("One line\nstill one.\n\nTwo.")).toEqual(["One line\nstill one.", "Two."]);
  });

  it("drops blank runs and trailing whitespace", () => {
    expect(toParagraphs("  A.  \n\n\n\n  B.  \n\n")).toEqual(["A.", "B."]);
  });

  it("normalizes CRLF", () => {
    expect(toParagraphs("A.\r\n\r\nB.")).toEqual(["A.", "B."]);
  });

  it("returns nothing for blank input", () => {
    expect(toParagraphs("\n \n")).toEqual([]);
  });
});

describe("chunkRanges", () => {
  const chunks = (text: string, limit: number) =>
    chunkRanges(text, limit).map((r) => text.slice(r.start, r.end));

  it("leaves a paragraph inside the limit as one range", () => {
    expect(chunkRanges("Short.", 100)).toEqual([{ start: 0, end: 6 }]);
  });

  it("returns nothing for empty text", () => {
    expect(chunkRanges("", 100)).toEqual([]);
  });

  it("prefers a sentence boundary", () => {
    const text = `${"a".repeat(40)}. ${"b".repeat(40)}.`;
    expect(chunks(text, 50)[0]).toBe(`${"a".repeat(40)}. `);
  });

  it("falls back to a word boundary when no sentence fits", () => {
    const text = "word ".repeat(30).trim();
    expect(chunks(text, 50).every((c) => c.length <= 50)).toBe(true);
  });

  it("hard cuts a single token longer than the limit", () => {
    expect(chunks("x".repeat(120), 50).every((c) => c.length <= 50)).toBe(true);
  });

  it("tiles the paragraph end to end with no gaps or overlaps", () => {
    const text = `${"Sentence here. ".repeat(40)}${"tail ".repeat(20)}`.trim();
    const ranges = chunkRanges(text, 90);
    expect(ranges[0]!.start).toBe(0);
    expect(ranges[ranges.length - 1]!.end).toBe(text.length);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.start).toBe(ranges[i - 1]!.end);
    }
    expect(ranges.map((r) => text.slice(r.start, r.end)).join("")).toBe(text);
    expect(ranges.every((r) => r.end - r.start <= 90)).toBe(true);
  });
});

describe("plainify", () => {
  it("replaces a fenced code block with a spoken note", () => {
    const out = plainify("Before.\n\n```js\nconst x = 1;\n```\n\nAfter.");
    expect(out).toContain("Code omitted.");
    expect(out).not.toContain("const x");
    expect(out).toContain("Before.");
    expect(out).toContain("After.");
  });

  it("handles a fence that is never closed", () => {
    const out = plainify("Text.\n\n```sh\nnpm run deploy\n");
    expect(out).toContain("Code omitted.");
    expect(out).not.toContain("npm run deploy");
  });

  it("keeps inline code contents without the backticks", () => {
    expect(plainify("Run `npm test` now.")).toBe("Run npm test now.");
  });

  it("reduces a link to its text", () => {
    expect(plainify("See [the docs](https://example.com/x) for more.")).toBe(
      "See the docs for more.",
    );
  });

  it("drops an image entirely", () => {
    expect(plainify("Look ![a chart](chart.png) here.")).toBe("Look  here.");
  });

  it("drops a table with a note", () => {
    const out = plainify("Before.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.");
    expect(out).toContain("A table, not read out.");
    expect(out).not.toContain("| a |");
  });

  it("turns a heading into its own sentence", () => {
    expect(plainify("## What changed\n\nThe worker.")).toBe("What changed.\n\nThe worker.");
  });

  it("strips list bullets but keeps the items", () => {
    expect(plainify("- First\n- Second")).toBe("First\nSecond");
    expect(plainify("1. First\n2. Second")).toBe("First\nSecond");
  });

  it("strips emphasis markers", () => {
    expect(plainify("This is **bold** and *italic* and ~~gone~~.")).toBe(
      "This is bold and italic and gone.",
    );
  });

  it("leaves an underscore inside a word alone", () => {
    expect(plainify("The space_id column.")).toBe("The space_id column.");
  });

  it("strips a block quote marker", () => {
    expect(plainify("> Quoted line.")).toBe("Quoted line.");
  });

  it("caps a long entry and says so", () => {
    const out = plainify(`${"Sentence here. ".repeat(200)}`, 200);
    expect(out.length).toBeLessThanOrEqual(220);
    expect(out.endsWith("and more.")).toBe(true);
  });
});

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("Short.", 100)).toBe("Short.");
  });

  it("cuts at a sentence end when one is close enough", () => {
    expect(truncate("One. Two. Three and a much longer tail here.", 20)).toBe("One. Two. and more.");
  });

  it("cuts at a word when no sentence end is near", () => {
    const out = truncate(`${"word ".repeat(20)}`, 20);
    expect(out.endsWith("and more.")).toBe(true);
    expect(out).not.toContain("wor and");
  });
});

describe("entryLead", () => {
  it("names the time and the project", () => {
    const at = new Date("2026-09-04T14:32:00Z");
    expect(entryLead(at, "customers", "UTC")).toBe("14:32, in customers.");
  });

  it("drops the project when there is not one", () => {
    const at = new Date("2026-09-04T09:05:00Z");
    expect(entryLead(at, null, "UTC")).toBe("09:05.");
  });
});
