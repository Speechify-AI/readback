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
import { posix, win32 } from "node:path";

export const BRIEF =
  "Condense this finished coding-agent reply for someone hearing it read aloud a moment after it landed, possibly away from the screen. " +
  "One to three short sentences of plain prose: what was done, and what is still open or needs their decision, if anything. " +
  "Past tense. No markdown, lists, code, links, file paths, hashes or version ids unless a sentence makes no sense without them. " +
  "Output only the sentences.";

export const CATCH_UP_BRIEF =
  "These are the replies a coding agent finished while the person was away from the screen, oldest first, each headed by its time and project. " +
  "Brief them in three to six short sentences of plain prose for someone hearing it read aloud: what landed, what is still open, and what waits on their decision. " +
  "Group by project when there is more than one. Past tense. " +
  "No markdown, lists, code, links, file paths, hashes or version ids unless a sentence makes no sense without them. " +
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

/**
 * Where `claude` might be: PATH first, then the usual install locations. On
 * Windows the native install is `claude.exe` and an npm install leaves a
 * `claude.cmd` shim, which `claudeCommand` knows how to run.
 */
export function claudeCandidates(path: string | undefined, home: string, platform: string = process.platform): string[] {
  const p = platform === "win32" ? win32 : posix;
  const { join } = p;
  const names = platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  const dirs = (path ?? "").split(p.delimiter).filter((dir) => dir !== "");
  const fromPath = dirs.flatMap((dir) => names.map((name) => join(dir, name)));
  if (platform === "win32") {
    return [
      ...fromPath,
      join(home, ".local", "bin", "claude.exe"),
      join(home, "AppData", "Roaming", "npm", "claude.cmd"),
    ];
  }
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

export interface Spawn {
  file: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

/**
 * How to run the found binary. A real executable is spawned as it is. An
 * npm `.cmd` shim is not one and needs cmd.exe, which gets the whole line
 * quoted and passed verbatim; none of our arguments contain a double quote.
 */
export function claudeCommand(claudePath: string, args: readonly string[], comSpec: string = process.env.ComSpec ?? "cmd.exe"): Spawn {
  if (!/\.(cmd|bat)$/i.test(claudePath)) return { file: claudePath, args: [...args] };
  const line = [claudePath, ...args].map((a) => `"${a}"`).join(" ");
  return { file: comSpec, args: ["/d", "/s", "/c", `"${line}"`], windowsVerbatimArguments: true };
}

export interface CondenseOptions {
  claudePath: string;
  /** What to ask for; the reply brief unless told otherwise. */
  brief?: string;
  timeoutMs?: number;
}

/** The condensed reply, or null when the run failed or said nothing. */
export function condense(text: string, opts: CondenseOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const spawn = claudeCommand(opts.claudePath, [...CLAUDE_ARGS, opts.brief ?? BRIEF]);
    const child = execFile(
      spawn.file,
      spawn.args,
      {
        windowsVerbatimArguments: spawn.windowsVerbatimArguments,
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
