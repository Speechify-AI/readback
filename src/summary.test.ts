import { describe, expect, it } from "vitest";
import { claudeCandidates, CLAUDE_ARGS } from "./summary.ts";

describe("claudeCandidates", () => {
  it("tries PATH entries first, then the usual homes", () => {
    const c = claudeCandidates("/usr/bin:/Users/me/.local/bin", "/Users/me");
    expect(c[0]).toBe("/usr/bin/claude");
    expect(c[1]).toBe("/Users/me/.local/bin/claude");
    expect(c).toContain("/Users/me/.claude/local/claude");
    expect(c).toContain("/opt/homebrew/bin/claude");
  });

  it("copes with no PATH at all", () => {
    expect(claudeCandidates(undefined, "/h")[0]).toBe("/h/.local/bin/claude");
  });
});

describe("CLAUDE_ARGS", () => {
  it("loads no settings, so the condensing run cannot fire the Stop hook", () => {
    const i = CLAUDE_ARGS.indexOf("--setting-sources");
    expect(i).toBeGreaterThan(-1);
    expect(CLAUDE_ARGS[i + 1]).toBe("");
    expect(CLAUDE_ARGS).toContain("--no-session-persistence");
  });
});
