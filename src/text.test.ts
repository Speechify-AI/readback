import { describe, expect, it } from "vitest";
import {
  chunkRanges,
  entryLead,
  plainify,
  speakable,
  spokenTable,
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

  it("reads a short table as header and value pairs", () => {
    const out = plainify("Before.\n\n| Name | Stars |\n| --- | ---: |\n| Readback | 12 |\n| Heard | 3 |\n\nAfter.");
    expect(out).toBe("Before.\n\nName: Readback, Stars: 12.\nName: Heard, Stars: 3.\n\nAfter.");
  });

  it("notes a long table instead of reading it", () => {
    const rows = Array.from({ length: 5 }, (_, i) => `| r${i} | ${i} |`).join("\n");
    const out = plainify(`| a | b |\n| --- | --- |\n${rows}`);
    expect(out).toBe("A table of 5 rows, not read out.");
    expect(out).not.toContain("| a |");
  });

  it("notes a run of pipe rows with no separator", () => {
    expect(spokenTable("| a | b |\n| 1 | 2 |")).toBe("A table, not read out.");
  });

  it("skips empty cells and a headerless column", () => {
    expect(spokenTable("| a |  |\n|---|---|\n| 1 | 2 |\n|  | 4 |")).toBe("a: 1, 2.\n4.");
  });

  it("drops an HTML comment, so a spoken note is never shown", () => {
    expect(plainify("Done.\n\n<!-- readback: It is done. -->")).toBe("Done.");
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

describe("speakable", () => {
  it("says a bare URL is a link", () => {
    expect(speakable("See https://example.com/a?b=1 for more.")).toBe("See a link for more.");
  });

  it("reads a file and line reference as a line", () => {
    expect(speakable("Fixed in src/app.ts:42 and hooks/readback.ts:318:5.")).toBe("Fixed in src/app.ts, line 42 and hooks/readback.ts, line 318.");
    expect(speakable("At 10:30 we met.")).toBe("At 10:30 we met.");
    expect(speakable("Write to a@b.io:22 now.")).toBe("Write to a@b.io:22 now.");
  });

  it("names a commit by its first four characters", () => {
    expect(speakable("Pushed as ab2caa0 and b01e9e5f3c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f.")).toBe("Pushed as commit ab2c and commit b01e.");
    expect(speakable("Call 1234567 or read deadbeef.")).toBe("Call 1234567 or read deadbeef.");
    expect(speakable("Id 4d39efe5-c30a-4e89.")).toBe("Id 4d39efe5-c30a-4e89.");
  });

  it("reads a version, a home path and operators as words", () => {
    expect(speakable("Tag v0.9.0 lives in ~/.readback.")).toBe("Tag version 0.9.0 lives in home/.readback.");
    expect(speakable("Needs n >= 3 && m != 2, or x => y.")).toBe("Needs n greater than or equal to 3 and m is not 2, or x to y.");
    expect(speakable("a||b")).toBe("a||b");
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
  it("names the project and nothing else, so every turn of a project shares one render", () => {
    expect(entryLead("customers")).toBe("customers.");
    expect(entryLead("extension.ts")).toBe("extension.ts.");
  });

  it("names Readback when there is no project", () => {
    expect(entryLead(null)).toBe("Readback.");
  });
});
