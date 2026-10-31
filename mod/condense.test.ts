import { describe, expect, it } from "vitest";
import { claudePaths, condenseReply, type Run } from "./condense.ts";
import { BRIEF, CLAUDE_ARGS, condensePrompt } from "../src/summaryShared.ts";

type Call = { argv: string[]; init: Parameters<Run>[1] };
const recorder = (reply: (argv: string[]) => Promise<{ exitCode: number; stdout: string }>) => {
  const calls: Call[] = [];
  const run: Run = (argv, init) => {
    calls.push({ argv, init });
    return reply(argv);
  };
  return { run, calls };
};
/** A clock that stands still: no run looks like a timeout. */
const now = async () => 0;
const ok = async () => ({ exitCode: 0, stdout: "<spoken> Done. </spoken>" });

describe("condenseReply", () => {
  it("runs claude -p with the brief on stdin and READBACK_HOOK=1", async () => {
    const { run, calls } = recorder(ok);
    const out = await condenseReply("the reply", { run, home: "/h", platform: "darwin", now });
    expect(out).toBe("Done.");
    expect(calls.length).toBe(1);
    expect(calls[0]!.argv).toEqual(["claude", ...CLAUDE_ARGS]);
    expect(calls[0]!.init).toEqual({ stdin: condensePrompt(BRIEF, "the reply"), env: { READBACK_HOOK: "1" }, timeoutMs: 60_000 });
  });

  it("falls through to ~/.local/bin/claude when claude is not on PATH", async () => {
    const { run, calls } = recorder(async (argv) => {
      if (argv[0] === "claude") throw new Error("ENOENT");
      return ok();
    });
    expect(await condenseReply("x", { run, home: "/h", platform: "darwin", now })).toBe("Done.");
    expect(calls.map((c) => c.argv[0])).toEqual(["claude", "/h/.local/bin/claude"]);
  });

  it("no spoken tags → null", async () => {
    const { run } = recorder(async () => ({ exitCode: 0, stdout: "I understand." }));
    expect(await condenseReply("x", { run, home: "/h", platform: "darwin", now })).toBeNull();
  });

  it("exit 1 → null", async () => {
    const { run } = recorder(async () => ({ exitCode: 1, stdout: "<spoken>Done.</spoken>" }));
    expect(await condenseReply("x", { run, home: "/h", platform: "darwin", now })).toBeNull();
  });

  it("every path missing → null", async () => {
    const { run, calls } = recorder(async () => {
      throw new Error("ENOENT");
    });
    expect(await condenseReply("x", { run, home: "/h", platform: "linux", now })).toBeNull();
    expect(calls.map((c) => c.argv[0])).toEqual(claudePaths("/h"));
  });

  it("a run that timed out is not followed by a second path", async () => {
    let t = 0;
    const { run, calls } = recorder(async () => {
      t += 60_000; // the timeout kills the child and the call rejects
      throw new Error("timed out");
    });
    expect(await condenseReply("x", { run, home: "/h", platform: "darwin", now: async () => t })).toBeNull();
    expect(calls.length).toBe(1);
  });

  it("a run killed a moment before the timeout is read the same way", async () => {
    let t = 0;
    const { run, calls } = recorder(async () => {
      t += 59_990;
      throw new Error("killed");
    });
    expect(await condenseReply("x", { run, home: "/h", platform: "darwin", now: async () => t })).toBeNull();
    expect(calls.length).toBe(1);
  });

  it("a rejection within milliseconds is a missing binary, so the next path is tried", async () => {
    let t = 0;
    const { run, calls } = recorder(async (argv) => {
      t += 3;
      if (argv[0] === "claude") throw new Error("ENOENT");
      return ok();
    });
    expect(await condenseReply("x", { run, home: "/h", platform: "darwin", now: async () => t })).toBe("Done.");
    expect(calls.length).toBe(2);
  });

  it("win32 → null and run never called", async () => {
    const { run, calls } = recorder(ok);
    expect(await condenseReply("x", { run, home: "C:\\h", platform: "win32", now })).toBeNull();
    expect(calls.length).toBe(0);
  });
});
