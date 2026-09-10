/**
 * Condensing a reply into something worth hearing.
 *
 * A finished reply is six paragraphs of tables, file names and version ids.
 * Read verbatim it is a chore; condensed to what was done and what is open
 * it is a briefing. The condensing is done by Claude Code itself, on the
 * person's own subscription, so Readback holds no model key: `claude -p` on
 * the smallest model, with the reply on stdin.
 *
 * Two things keep that run from feeding back into Readback. It loads no
 * settings (`--setting-sources ""`), so no Stop hook fires from it, and it
 * carries `READBACK_HOOK=1`, which the hook script honours by exiting at
 * the top. Either alone would do; both means a hook installed some other
 * way still cannot loop.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export const BRIEF =
  "Condense this finished coding-agent reply for someone hearing it read aloud a moment after it landed, possibly away from the screen. " +
  "One to three short sentences of plain prose: what was done, and what is still open or needs their decision, if anything. " +
  "Past tense. No markdown, lists, code, links, file paths, hashes or version ids unless a sentence makes no sense without them. " +
  "Output only the sentences.";

export const CLAUDE_ARGS: readonly string[] = [
  "-p",
  "--model", "haiku",
  "--tools", "",
  "--setting-sources", "",
  "--strict-mcp-config",
  "--no-session-persistence",
  "--output-format", "text",
];

/** Where `claude` might be: PATH first, then the usual install locations. */
export function claudeCandidates(path: string | undefined, home: string): string[] {
  const fromPath = (path ?? "")
    .split(delimiter)
    .filter((dir) => dir !== "")
    .map((dir) => join(dir, "claude"));
  return [
    ...fromPath,
    join(home, ".local", "bin", "claude"),
    join(home, ".claude", "local", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
}

export function findClaude(exists: (p: string) => boolean = existsSync): string | null {
  return claudeCandidates(process.env.PATH, homedir()).find(exists) ?? null;
}

export interface CondenseOptions {
  claudePath: string;
  timeoutMs?: number;
}

/** The condensed reply, or null when the run failed or said nothing. */
export function condense(text: string, opts: CondenseOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      opts.claudePath,
      [...CLAUDE_ARGS, BRIEF],
      {
        env: { ...process.env, READBACK_HOOK: "1" },
        timeout: opts.timeoutMs ?? 60_000,
        maxBuffer: 1_000_000,
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const out = stdout.trim();
        resolve(out === "" ? null : out);
      },
    );
    child.stdin?.end(text);
  });
}
