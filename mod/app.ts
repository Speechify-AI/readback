/**
 * Every decision `hooks/readback.ts` makes about data, with no `$`: whether
 * this process is a loop to stay out of, what `/readback` does, which turns
 * are read, which voice speaks, when to take the floor and run the clocks,
 * what the band draws, and the wording of each message. The hooks module
 * only carries the results to and from Claude Code.
 */
import { defaultVoice, languageCode } from "../src/claudeLanguageShared.ts";
import { TtsError, languageFor, modelFor, type KeyCheck, type TtsConfig, type Voice } from "../src/speechifyShared.ts";
import { plainify, toParagraphs } from "../src/text.ts";
import { decideMessage, replyParagraphs, worthCondensing, type TurnLimits } from "../src/turns.ts";
import type { ReplyTurn, State } from "./player.ts";

export const LIMITS: TurnLimits = { minChars: 80, maxChars: 4000 };
export const API_BASE = "https://api.speechify.ai";
export const MODEL = "simba-3.5";
export const DEFAULT_VOICE = "harper_32";
export const KEY_OPTION = "speechify_api_key";
export const KEYS_URL =
  "https://platform.speechify.ai/api-keys?utm_source=readback&utm_medium=claude-code&utm_campaign=readback";

const CHANGE_KEY = "Change it in /plugin → readback → configure.";

export const WELCOME = "Readback installed. Type /readback to turn it on.";
export const NO_KEY = `Readback needs a Speechify API key. Create one for free at ${KEYS_URL}, then add it in /plugin → readback → configure.`;
export const REFUSED = `Speechify refused the key. ${CHANGE_KEY}`;
export const ON = "Readback is on. When a reply lands, press 1 with the prompt empty, or click Play above the prompt.";
export const OFF = "Readback is off.";
export const OFF_NO_VOICE = "Readback is off. Type /readback to turn it on, then /readback voice.";
export const USAGE = "/readback turns Readback on or off; /readback voice picks the voice.";
export const PICK = "Pick a voice above the prompt.";
export const NO_VOICES = "Could not reach Speechify for the voice list. Try again.";

/** The key from the plugin's options, trimmed: a non-empty string, or none. */
export function apiKeyFrom(options: Readonly<Record<string, unknown>>): string | null {
  const v = options[KEY_OPTION];
  // Trimmed as the extension stores it: a pasted newline is no header.
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
}

/** True when this process must leave Readback out: the condensing child, or any `-p` run. */
export function loopGuard(readbackHook: string | undefined, isInteractive: boolean): boolean {
  return readbackHook === "1" || isInteractive === false;
}

export function homeFrom(home: string | undefined, userProfile: string | undefined): string {
  return home || userProfile || "";
}

export function platformFrom(os: string | undefined): "win32" | "posix" {
  return os === "Windows_NT" ? "win32" : "posix";
}

/** `version` out of plugin.json's text, or "unknown". */
export function versionFrom(text: string): string {
  try {
    const v = (JSON.parse(text) as { version?: unknown }).version;
    return typeof v === "string" && v !== "" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

export type CommandPlan = { kind: "text"; text: string } | { kind: "on"; key: string } | { kind: "off" } | { kind: "voice" };

/** What `/readback [args]` does, given the key and whether Readback is on. */
export function readbackCommand(args: string, key: string | null, enabled: boolean): CommandPlan {
  const a = args.trim().toLowerCase();
  if (a !== "" && a !== "voice") return { kind: "text", text: USAGE };
  if (key === null) return { kind: "text", text: NO_KEY };
  if (a === "voice") return enabled ? { kind: "voice" } : { kind: "text", text: OFF_NO_VOICE };
  return enabled ? { kind: "off" } : { kind: "on", key };
}

/** Why turning on failed, said so the person knows what to do. */
export function keyCheckText(check: Extract<KeyCheck, { ok: false }>): string {
  switch (check.kind) {
    case "refused":
      return REFUSED;
    case "unreachable":
      return check.reason;
    case "invalid":
    case "no-voice":
      return `${check.reason} ${CHANGE_KEY}`;
  }
}

export type TurnEvent = { answer: string; turnId: string; isAborted: boolean; reason: string; agentId?: string };

/**
 * The main loop's finished answer as the latest turn, or null when it is not
 * one to read. Only a turn that ended normally is: one that died on an error
 * or a refusal can still carry the text written before it did.
 */
export function replyTurn(e: TurnEvent): ReplyTurn | null {
  if (e.agentId !== undefined || e.isAborted || e.reason !== "answer" || e.answer.trim() === "") return null;
  if (decideMessage(e.answer, null, LIMITS).kind === "skip") return null;
  const { full } = replyParagraphs({ markdown: e.answer, limits: LIMITS });
  if (full.length === 0) return null;
  return { id: e.turnId, summary: [], full, condensing: worthCondensing(e.answer, LIMITS) };
}

/** The condensed reply's paragraphs, or null when condensing gave nothing. */
export function summaryFrom(summary: string | null): string[] | null {
  if (summary === null) return null;
  const paragraphs = toParagraphs(plainify(summary, LIMITS.maxChars));
  return paragraphs.length > 0 ? paragraphs : null;
}

export type StoredVoice = { id: string; locale: string };

export function storedVoice(v: unknown): StoredVoice | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as { id?: unknown; locale?: unknown };
  return typeof r.id === "string" && r.id !== "" && typeof r.locale === "string" ? { id: r.id, locale: r.locale } : null;
}

/**
 * The voice to speak in when none was picked with `/readback voice` (the
 * caller reads that first, `storedVoice`): a stock voice in Claude Code's
 * `language` when that is not English, else harper_32. As the extension
 * does, English keeps harper_32 rather than the catalogue's first English
 * voice.
 */
export function chooseVoice(voices: readonly Voice[] | null, language: unknown): StoredVoice {
  const code = typeof language === "string" ? languageCode(language) : null;
  if (code !== null && code !== "en" && voices) {
    const v = defaultVoice(voices, code);
    if (v) return { id: v.id, locale: v.locale };
  }
  return { id: DEFAULT_VOICE, locale: voices?.find((v) => v.id === DEFAULT_VOICE)?.locale ?? "" };
}

/**
 * `chooseVoice` over Claude Code's `language` and the catalogue, kept for
 * the session once the catalogue was had. A failed fetch gives harper_32
 * for that render only, so one dropped request does not fix the voice.
 */
export function fallbackVoice(
  language: () => Promise<unknown>,
  catalogue: () => Promise<readonly Voice[]>,
): () => Promise<StoredVoice> {
  let kept: StoredVoice | null = null;
  return async () => {
    if (kept) return kept;
    const lang = await language().catch(() => undefined);
    const list = await catalogue().catch(() => null);
    const voice = chooseVoice(list, lang);
    if (list !== null) kept = voice;
    return voice;
  };
}

export function pickedVoice(voices: readonly Voice[], id: string): StoredVoice {
  return { id, locale: voices.find((v) => v.id === id)?.locale ?? "" };
}

export function ttsConfig(apiKey: string, voice: StoredVoice): TtsConfig {
  return {
    apiBase: API_BASE,
    apiKey,
    voiceId: voice.id,
    model: modelFor(voice.locale, MODEL),
    language: languageFor(voice.locale),
  };
}

/**
 * Whether a press of 1 (toggle) or 3 (full) will start sound, and so takes
 * the floor. A press while a resume waits on the clock stays paused and
 * takes nothing.
 */
export function claimsFloor(state: State, action: "toggle" | "full", hasLatest: boolean, resuming = false): boolean {
  if (action === "full") return hasLatest;
  return (state === "idle" && hasLatest) || (state === "paused" && !resuming);
}

/**
 * Both clocks (the floor heartbeat and the 100 ms tick that moves the
 * highlight and turns the spinner) run while sound is playing or about to:
 * a session waiting on condensing holds the floor with nothing sounding.
 */
export function clocksWanted(state: State): boolean {
  return state === "playing" || state === "loading" || state === "waiting";
}

export function isRefusal(err: unknown): boolean {
  return err instanceof TtsError && (err.status === 401 || err.status === 403);
}

export function errorText(err: unknown): string {
  if (isRefusal(err)) return REFUSED;
  if (err instanceof TtsError) return `Readback could not render that: Speechify answered ${err.status}.`;
  return `Readback could not play that: ${err instanceof Error ? err.message : String(err)}`;
}

export type BandMode = "pass" | "band" | "picker" | "notice";

/** What the band above the prompt draws. Off, it is drawn only to hold a refused key's notice. */
export function bandMode(s: { hasSurvey: boolean; enabled: boolean; notice: string | null; picking: boolean }): BandMode {
  if (s.hasSurvey) return "pass";
  if (s.enabled) return s.picking ? "picker" : "band";
  return s.notice !== null ? "notice" : "pass";
}
