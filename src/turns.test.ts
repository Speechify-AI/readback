import { describe, expect, it } from "vitest";
import { makeTurn, messageFromStop } from "./turns.ts";

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

describe("makeTurn", () => {
  it("puts the lead, the summary, then the full reply in one list", () => {
    const t = makeTurn({ markdown: "Fixed it.\n\nTests pass.", summary: "The bug was fixed and tests pass.", project: "customers", limits, at });
    expect(t?.paragraphs).toEqual(["14:32, in customers.", "The bug was fixed and tests pass.", "Fixed it.", "Tests pass."]);
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
