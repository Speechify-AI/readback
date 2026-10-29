/**
 * Claude Code's own `language` setting: "Preferred language for Claude
 * responses and voice dictation (e.g., "japanese", "spanish")", free text,
 * in the schema of the 2.1.294 binary. Someone who set it hears replies in
 * that language, so it is the best guess at the voice they want before they
 * pick one. Readback reads it for that default and for a hint in the picker,
 * nothing else; a voice the person chose always wins.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeLanguage } from "./claudeLanguageShared.ts";

export * from "./claudeLanguageShared.ts";

/** The settings files in Claude Code's precedence, lowest first: user, then each folder's project and local. */
export function readClaudeLanguage(home: string, folders: readonly string[]): string | null {
  const paths = [
    join(home, ".claude", "settings.json"),
    ...folders.flatMap((f) => [join(f, ".claude", "settings.json"), join(f, ".claude", "settings.local.json")]),
  ];
  return claudeLanguage(paths.map(readOrNull));
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
