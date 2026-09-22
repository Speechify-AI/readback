import { describe, expect, it } from "vitest";
import { claudeCandidates, claudeCommand, CLAUDE_ARGS } from "./summary.ts";

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

describe("on Windows", () => {
  it("looks for claude.exe and the npm shim on PATH, then the native and npm homes", () => {
    const c = claudeCandidates("C:\\Tools;C:\\Users\\me\\.local\\bin", "C:\\Users\\me", "win32");
    expect(c.slice(0, 2)).toEqual(["C:\\Tools\\claude.exe", "C:\\Tools\\claude.cmd"]);
    expect(c).toContain("C:\\Users\\me\\.local\\bin\\claude.exe");
    expect(c[c.length - 1]).toBe("C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd");
  });

  it("spawns an executable as it is and a .cmd shim through cmd.exe with the line quoted verbatim", () => {
    expect(claudeCommand("/usr/local/bin/claude", ["-p", "x"])).toEqual({ file: "/usr/local/bin/claude", args: ["-p", "x"] });
    const shim = claudeCommand("C:\\npm\\claude.cmd", ["-p", "--tools", ""], "C:\\Windows\\cmd.exe");
    expect(shim.file).toBe("C:\\Windows\\cmd.exe");
    expect(shim.windowsVerbatimArguments).toBe(true);
    expect(shim.args).toEqual(["/d", "/s", "/c", '""C:\\npm\\claude.cmd" "-p" "--tools" """']);
  });

  it("never puts a double quote into a brief the shim line would break on", () => {
    expect([...CLAUDE_ARGS].join("")).not.toContain('"');
  });
});
