import { describe, expect, it } from "vitest";
import { catchUpText, catchUpTurn, CONDENSE_MIN_CHARS, decideMessage, makeTurn, messageFromStop, replyParagraphs, worthCondensing, type Turn } from "./turns.ts";

const limits = { minChars: 20, maxChars: 4000 };
const at = new Date("2026-09-10T14:32:00");

describe("messageFromStop", () => {
  it("keeps the message, the cwd and its folder name", () => {
    const d = messageFromStop(
      { hook_event_name: "Stop", last_assistant_message: "Fixed the **bug** in `x.ts`.\n\nTests pass.", cwd: "/Users/me/code/customers" },
      limits,
    );
    expect(d).toEqual({ kind: "message", markdown: "Fixed the **bug** in `x.ts`.\n\nTests pass.", cwd: "/Users/me/code/customers", project: "customers" });
  });

  it("skips a bare acknowledgement by its plain length", () => {
    expect(messageFromStop({ last_assistant_message: "**Done.**" }, limits)).toEqual({ kind: "skip", reason: "too-short" });
  });

  it("skips payloads without a message and events that are not Stop", () => {
    expect(messageFromStop({ hook_event_name: "PreToolUse" }, limits).kind).toBe("skip");
    expect(messageFromStop({ hook_event_name: "Stop" }, limits)).toEqual({ kind: "skip", reason: "no-message" });
  });
});

describe("decideMessage", () => {
  it("skips code-only text as empty and short text as too short", () => {
    expect(decideMessage("", null, limits)).toEqual({ kind: "skip", reason: "empty" });
    expect(decideMessage("Okay.", "/p", limits)).toEqual({ kind: "skip", reason: "too-short" });
  });

  it("has no project without a cwd", () => {
    expect(decideMessage("I'll check the settings file first.", null, limits)).toMatchObject({ kind: "message", project: null });
  });
});

describe("replyParagraphs", () => {
  it("flattens both versions and keeps them apart", () => {
    expect(replyParagraphs({ markdown: "Fixed it.\n\n- a\n- b", summary: "It was fixed.", limits })).toEqual({
      summary: ["It was fixed."],
      full: ["Fixed it.", "a\nb"],
    });
    expect(replyParagraphs({ markdown: "Fixed it.", limits }).summary).toEqual([]);
  });
});

describe("makeTurn", () => {
  it("puts the lead, the summary, then the full reply in one list", () => {
    const t = makeTurn({ markdown: "Fixed it.\n\nTests pass.", summary: "The bug was fixed and tests pass.", project: "customers", limits, at });
    expect(t?.paragraphs).toEqual(["14:32, customers.", "The bug was fixed and tests pass.", "Fixed it.", "Tests pass."]);
    expect(t?.fullFrom).toBe(2);
  });

  it("has no fullFrom without a summary", () => {
    const t = makeTurn({ markdown: "Fixed it.", summary: null, project: null, limits, at });
    expect(t?.paragraphs).toEqual(["14:32.", "Fixed it."]);
    expect(t?.fullFrom).toBeNull();
  });

  it("caps a long reply with an 'and more' tail", () => {
    const t = makeTurn({ markdown: "Sentence here. ".repeat(500), project: "x", limits: { minChars: 1, maxChars: 200 }, at });
    const body = t!.paragraphs.slice(1).join("\n\n");
    expect(body.length).toBeLessThan(220);
    expect(body.endsWith("and more.")).toBe(true);
  });

  it("returns null for nothing to say", () => {
    expect(makeTurn({ markdown: "```\ncode\n```", project: null, limits, at })?.paragraphs).toEqual(["14:32.", "Code omitted."]);
    expect(makeTurn({ markdown: "   ", project: null, limits, at })).toBeNull();
  });
});

describe("worthCondensing", () => {
  it("leaves a reply that is already summary-sized alone and measures the flattened text", () => {
    expect(worthCondensing("Good, the guard is cleared then. Send me its id and the tier you want and I'll apply it.", limits)).toBe(false);
    expect(worthCondensing("word ".repeat(CONDENSE_MIN_CHARS / 5 + 1), limits)).toBe(true);
    const link = `[x](https://example.com/${"a".repeat(CONDENSE_MIN_CHARS)})`;
    expect(worthCondensing(`See ${link} for the rest.`, limits)).toBe(false);
  });
});

describe("decideMessage on Windows", () => {
  it("names the project from a backslash cwd", () => {
    expect(decideMessage("I'll check the settings file first.", "C:\\Users\\me\\code\\customers", limits)).toMatchObject({ project: "customers" });
  });
});

describe("catch-up", () => {
  const tz = "UTC";
  const at = new Date("2026-09-22T14:32:00Z");
  const listed = (over: Partial<Turn>): Turn => ({
    id: "t",
    at: "2026-09-22T13:50:00Z",
    project: "customers",
    paragraphs: ["13:50, customers.", "Fixed it.", "Tests pass."],
    fullFrom: null,
    ...over,
  });
  const condensed = listed({
    id: "c",
    at: "2026-09-22T14:05:00Z",
    project: "readback",
    paragraphs: ["14:05, readback.", "Looking at the hook first.", "The hook was rewritten.", "Rewrote the hook.", "Windows next."],
    fullFrom: 3,
  });

  it("feeds the condensing run each reply under its time and project, full reply where there is one", () => {
    const text = catchUpText([listed({}), condensed], tz);
    expect(text).toBe(
      "Reply 1 of 2, 13:50, in customers:\nFixed it.\n\nTests pass.\n\n" +
        "Reply 2 of 2, 14:05, in readback:\nRewrote the hook.\n\nWindows next.",
    );
  });

  it("briefs with the summary and counts the replies it covers", () => {
    const turn = catchUpTurn({ covered: [listed({}), condensed], earlier: 0, summary: "Two things landed. Windows is next.", limits, at, timeZone: tz });
    expect(turn?.paragraphs).toEqual(["14:32. Catching up on 2 replies since 13:50.", "Two things landed. Windows is next."]);
    expect(turn?.fullFrom).toBeNull();
    expect(turn?.project).toBeNull();
  });

  it("without a summary reads each reply's own spoken part after its lead", () => {
    const turn = catchUpTurn({ covered: [listed({}), condensed], earlier: 0, summary: null, limits, at, timeZone: tz });
    expect(turn?.paragraphs).toEqual([
      "14:32. Catching up on 2 replies since 13:50.",
      "13:50, customers.", "Fixed it.", "Tests pass.",
      "14:05, readback.", "Looking at the hook first.", "The hook was rewritten.",
    ]);
  });

  it("mentions the replies it does not read", () => {
    const turn = catchUpTurn({ covered: [listed({})], earlier: 3, summary: "One thing.", limits, at, timeZone: tz });
    expect(turn?.paragraphs[0]).toBe("14:32. Catching up on 4 replies since 13:50, the last 1 in detail.");
    expect(catchUpTurn({ covered: [], earlier: 0, summary: null, limits, at })).toBeNull();
  });
});
