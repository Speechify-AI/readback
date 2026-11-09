/**
 * The Node-free half of reading Claude Code's `language` setting: the
 * language names, the settings-text parse and the default voice. The Claude
 * Code mod cannot load a module that imports `node:*`; the file reads stay in
 * `claudeLanguage.ts`, which re-exports all of this.
 */
import type { Voice } from "./speechifyShared.ts";

/** The 48 languages simba-3.5 speaks (Speechify's language-support guide, read 2026-10-22). */
const CODES = [
  "ar", "be", "bn", "bs", "my", "ca", "zh", "hr", "cs", "da", "nl", "en", "fi", "fr", "ka", "de",
  "el", "gu", "he", "hi", "hu", "id", "it", "ja", "kk", "ko", "la", "ms", "mr", "no", "fa", "pl",
  "pt", "ro", "ru", "sr", "sk", "sl", "es", "sv", "tl", "ta", "te", "th", "tr", "uk", "ur", "vi",
] as const;

/** Codes the guide folds into one of its own: Norwegian is `no` there, `nb` or `nn` in a voice's locale. */
const SAME: Record<string, string> = { nb: "no", nn: "no" };

/** Names Intl does not give: older or second names someone might type. */
const EXTRA_NAMES: Record<string, readonly string[]> = {
  bn: ["bengali"],
  es: ["castellano"],
  fa: ["farsi"],
  tl: ["tagalog"],
  zh: ["mandarin"],
};

/** Lowercase, accents stripped, so "Español" and "espanol" are the same word. */
function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/**
 * Each language's name in English and in itself ("German", "Deutsch"), from
 * ICU, plus `EXTRA_NAMES`; folded. Built once, on first use.
 */
let names: ReadonlyMap<string, readonly string[]> | undefined;
function languageNames(): ReadonlyMap<string, readonly string[]> {
  if (names) return names;
  const english = new Intl.DisplayNames(["en"], { type: "language" });
  const built = new Map<string, string[]>();
  for (const code of CODES) {
    const own = [english.of(code), new Intl.DisplayNames([code], { type: "language" }).of(code), ...(EXTRA_NAMES[code] ?? [])];
    built.set(code, [...new Set(own.filter((n): n is string => typeof n === "string" && n !== "").map(fold))]);
  }
  names = built;
  return built;
}

/**
 * "es" for "Spanish", "español", "Latin American Spanish" or "es-MX"; null
 * for a language the model does not speak. A name inside a longer value
 * counts, the longest match winning, so "Latin American Spanish" is
 * Spanish and not Latin.
 */
export function languageCode(value: string): string | null {
  const v = fold(value);
  const code = /^([a-z]{2,3})(?:[-_][a-z]{2,4})?$/.exec(v)?.[1];
  if (code) {
    const known = SAME[code] ?? code;
    return languageNames().has(known) ? known : null;
  }
  let best: { code: string; length: number } | null = null;
  for (const [c, list] of languageNames()) {
    for (const n of list) {
      if (v.includes(n) && (best === null || n.length > best.length)) best = { code: c, length: n.length };
    }
  }
  return best?.code ?? null;
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

/** The first stock voice in this language, in the catalogue's order. */
export function defaultVoice(voices: readonly Voice[], code: string): Voice | undefined {
  return voices.find((v) => {
    const lang = v.locale.split(/[-_]/)[0]?.toLowerCase() ?? "";
    return !v.cloned && (SAME[lang] ?? lang) === code;
  });
}
