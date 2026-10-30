/**
 * Condensing a reply in the Claude Code mod: the same `claude -p` run as the
 * extension's, started through the mod's `$.process.run` (passed in as
 * `Run`) instead of execFile. Runs on the person's own subscription.
 * `READBACK_HOOK=1` and `--setting-sources ""` keep the run from re-entering
 * any Readback hook. Windows is not handled here: the reply is read in full.
 *
 * Checked from inside Claude Code (CLAUDECODE=1 in the environment) on
 * 2.1.x: `claude -p` still answers with `<spoken>` tags, so no override of
 * that variable is needed.
 */
import { BRIEF, CLAUDE_ARGS, condensePrompt, spokenFrom } from "../src/summaryShared.ts";

const TIMEOUT_MS = 60_000;

export type Run = (
  argv: string[],
  init: { stdin: string; env: Record<string, string>; timeoutMs: number },
) => Promise<{ exitCode: number; stdout: string }>;

/** PATH first, then the usual install locations. */
export function claudePaths(home: string): string[] {
  return ["claude", `${home}/.local/bin/claude`, `${home}/.claude/local/claude`, "/usr/local/bin/claude", "/opt/homebrew/bin/claude"];
}

/** The condensed reply, or null when it cannot be had: the caller reads the full reply. */
export async function condenseReply(text: string, deps: { run: Run; home: string; platform: string; now?: () => number }): Promise<string | null> {
  if (deps.platform === "win32") return null;
  const now = deps.now ?? Date.now;
  for (const path of claudePaths(deps.home)) {
    const started = now();
    let result: { exitCode: number; stdout: string };
    try {
      result = await deps.run([path, ...CLAUDE_ARGS], {
        stdin: condensePrompt(BRIEF, text),
        env: { READBACK_HOOK: "1" },
        timeoutMs: TIMEOUT_MS,
      });
    } catch {
      // A timeout and a missing binary both reject; the clock tells them apart.
      // A run that used its whole timeout was a claude that ran: the other
      // paths are the same binary, so stop rather than bill it again.
      if (now() - started >= TIMEOUT_MS) return null;
      continue; // not here
    }
    return result.exitCode === 0 ? spokenFrom(result.stdout) : null;
  }
  return null;
}
