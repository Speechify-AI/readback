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
const ok = async () => ({ exitCode: 0, stdout: "<spoken> Done. </spoken>" });

describe("condenseReply", () => {
  it("runs claude -p with the brief on stdin and READBACK_HOOK=1", async () => {
    const { run, calls } = recorder(ok);
    const out = await condenseReply("the reply", { run, home: "/h", platform: "darwin" });
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
    expect(await condenseReply("x", { run, home: "/h", platform: "darwin" })).toBe("Done.");
    expect(calls.map((c) => c.argv[0])).toEqual(["claude", "/h/.local/bin/claude"]);
  });

  it("no spoken tags → null", async () => {
    const { run } = recorder(async () => ({ exitCode: 0, stdout: "I understand." }));
    expect(await condenseReply("x", { run, home: "/h", platform: "darwin" })).toBeNull();
  });

  it("exit 1 → null", async () => {
    const { run } = recorder(async () => ({ exitCode: 1, stdout: "<spoken>Done.</spoken>" }));
    expect(await condenseReply("x", { run, home: "/h", platform: "darwin" })).toBeNull();
  });

  it("every path missing → null", async () => {
    const { run, calls } = recorder(async () => {
      throw new Error("ENOENT");
    });
    expect(await condenseReply("x", { run, home: "/h", platform: "linux" })).toBeNull();
    expect(calls.map((c) => c.argv[0])).toEqual(claudePaths("/h"));
  });

  it("win32 → null and run never called", async () => {
    const { run, calls } = recorder(ok);
    expect(await condenseReply("x", { run, home: "C:\\h", platform: "win32" })).toBeNull();
    expect(calls.length).toBe(0);
  });
});
