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
import type { Voice } from "./speechify.ts";

/** The languages simba-3.0 speaks, by the names someone might type, accents stripped. */
const NAMES: Record<string, readonly string[]> = {
  en: ["english"],
  es: ["spanish", "espanol", "castellano"],
  de: ["german", "deutsch"],
  fr: ["french", "francais"],
  it: ["italian", "italiano"],
  pt: ["portuguese", "portugues"],
};

/** "es" for "Spanish", "español" or "es-MX"; null for a language no voice here speaks. */
export function languageCode(value: string): string | null {
  const v = value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  const code = /^([a-z]{2})(?:[-_][a-z]{2})?$/.exec(v)?.[1];
  if (code) return code in NAMES ? code : null;
  for (const [c, names] of Object.entries(NAMES)) {
    if (names.some((n) => v.includes(n))) return c;
  }
  return null;
}

/** The `language` set by the last of these settings files that sets one. Unreadable files are skipped. */
export function claudeLanguage(files: readonly (string | null)[]): string | null {
  let found: string | null = null;
  for (const text of files) {
    if (!text) continue;
    try {
      const json: unknown = JSON.parse(text);
      if (typeof json === "object" && json !== null && "language" in json && typeof json.language === "string") {
        found = json.language;
      }
    } catch {
      // Not ours to judge; Claude Code reports its own settings errors.
    }
  }
  return found;
}

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

/** The first stock voice in this language, in the catalogue's order. */
export function defaultVoice(voices: readonly Voice[], code: string): Voice | undefined {
  return voices.find((v) => !v.cloned && v.locale.split(/[-_]/)[0]?.toLowerCase() === code);
}
