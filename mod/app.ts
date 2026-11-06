/**
 * Every decision `hooks/readback.ts` makes about data, with no `$`: whether
 * this process is a loop to stay out of, what `/readback` does, which turns
 * are read, which voice speaks, when to take the floor and run the clocks,
 * what the band draws, and the wording of each message. The hooks module
 * only carries the results to and from Claude Code.
 */
import { defaultVoice, languageCode } from "../src/claudeLanguageShared.ts";
import { TtsError, languageFor, modelFor, sortVoices, type KeyCheck, type TtsConfig, type Voice } from "../src/speechifyShared.ts";
import { entryLead, plainify, toParagraphs } from "../src/text.ts";
import { decideMessage, PROGRESS_MIN_CHARS, projectOf, replyParagraphs, worthCondensing, type TurnLimits } from "../src/turns.ts";
import { isPlanningNote } from "../src/liveShared.ts";
import { spokenNoteFrom } from "../src/summaryShared.ts";
import type { ReplyTurn, State } from "./player.ts";

export const LIMITS: TurnLimits = { minChars: 80, maxChars: 4000 };
export const API_BASE = "https://api.speechify.ai";
export const MODEL = "simba-3.5";
export const DEFAULT_VOICE = "harper_32";
export const KEY_OPTION = "speechify_api_key";
export const KEYS_URL =
  "https://platform.speechify.ai/api-keys?utm_source=readback&utm_medium=claude-code&utm_campaign=readback";

const CHANGE_KEY = "Change it in /plugin → readback → configure.";

export const WELCOME = "Readback installed. Type /readback on to turn it on.";
export const NO_KEY = `Readback needs a Speechify API key. Create one for free at ${KEYS_URL}, then add it in /plugin → readback → configure.`;
export const REFUSED = `Speechify refused the key. ${CHANGE_KEY}`;
export const ON = "Readback is on. When a reply lands, press 1 with the prompt empty, or click Play above the prompt.";
/** Turned on where nothing draws the band (an SDK host): the words stand in for the keys. */
export const ON_NO_BAND =
  "Readback is on. When a reply lands, type /readback play; /readback stop and /readback full as well. A new session sleeps until /readback is typed once, so its first reply is not heard; with auto on it starts at once.";
export const OFF = "Readback is off.";
export const OFF_HINT = "Readback is off. Type /readback on to turn it on.";
export const EXTENSION_READING = "Readback's VS Code extension is reading this session, so the plugin stays quiet here.";
export const OFF_NO_VOICE = "Readback is off. Type /readback on to turn it on, then /readback voice.";
export const USAGE =
  "/readback shows the status; /readback on and off turn it on or off; /readback play, stop, full and again control playback; /readback voice picks this project's voice, /readback voice default the one for projects without; /readback speed 1.25 sets the speed; /readback auto on plays each reply as it lands; /readback alerts off silences the spoken alerts.";

/** The speeds offered, the extension's steps. Played through SSML prosody (ssml.ts). */
export const RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 1.75, 2];
/** The most options the band's Select takes. */
export const SELECT_MAX = 64;
export const PICK = "Pick a voice above the prompt.";
/** `/readback voice` where nothing draws the picker. */
export const PICK_NO_BAND = "Name a voice for this project: /readback voice harper, or a language or tag, like /readback voice spanish; /readback voice random draws one you have not used.";
/** `/readback voice default` with no name. */
export const PICK_DEFAULT = "Name the voice for projects without one of their own: /readback voice default harper.";

/**
 * Which voice a `/readback voice` sets: this project's (the session's
 * directory, as the extension saves the picker's choice for the open
 * project), or the default for projects without one. `reset` drops this
 * project's so the default speaks again.
 */
export type VoiceTarget = "project" | "default" | "reset";

/** The store key of a project's own voice; the default is under `voice`. */
export function projectVoiceKey(cwd: string): string {
  return `voice:${cwd}`;
}

/** Where the voice speaking came from, for the status line. */
export type VoiceScope = "project" | "default" | "language";

/** What `/readback voice [default] <query>` did: the first match is the voice now, or there was none. */
export function voiceSetText(voices: readonly Voice[], query: string, target: "project" | "default" = "project"): { voice: Voice | null; text: string } {
  const voice = filterVoices(voices, query)[0] ?? null;
  if (!voice) return { voice, text: `No voice matches "${query}".` };
  const others = filterVoices(voices, query).length - 1;
  const what = target === "project" ? "Voice for this project" : "Default voice";
  return { voice, text: `${what}: ${voice.name} (${voice.id}, ${voice.locale}).${others > 0 ? ` ${others} other${others === 1 ? "" : "s"} matched; add a word to narrow it.` : ""}` };
}

/**
 * `/readback voice random`: a stock voice in `locale`'s language that no
 * project and not the default uses (`inUse`, their ids), drawn with
 * `random` (0 to 1), from the featured ones while any is free. Clones are
 * left out: a draw should land on a shared narrator. An empty locale
 * means any language.
 */
export function randomVoice(voices: readonly Voice[], locale: string, inUse: readonly string[], random: () => number = Math.random): Voice | null {
  const lang = languageOf(locale);
  const free = voices.filter((v) => !v.cloned && !inUse.includes(v.id) && (lang === "" || languageOf(v.locale) === lang));
  const pool = free.some((v) => v.featured) ? free.filter((v) => v.featured) : free;
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? null;
}

const languageOf = (locale: string): string => locale.split(/[-_]/)[0]?.toLowerCase() ?? "";

/** The store keys that hold a voice: the default and every project's. */
export function voiceKeys(keys: readonly string[]): string[] {
  return keys.filter((k) => k === "voice" || k.startsWith("voice:"));
}

/** What `/readback voice [default] random` did. */
export function voiceRandomText(voice: Voice | null, target: "project" | "default", locale: string): string {
  if (!voice) return `No voice${locale ? ` in ${locale}` : ""} is free: every one is in use.`;
  const what = target === "project" ? "Voice for this project" : "Default voice";
  return `${what}, drawn at random: ${voice.name} (${voice.id}, ${voice.locale}). Run it again for another.`;
}

/** After `/readback voice reset`: the default speaks here again. */
export function voiceResetText(fallback: StoredVoice): string {
  return `This project's voice is dropped; the default (${fallback.id}) speaks here.`;
}
export const NO_VOICES = "Could not reach Speechify for the voice list. Try again.";

/** The key from the plugin's options, trimmed: a non-empty string, or none. */
export function apiKeyFrom(options: Readonly<Record<string, unknown>>): string | null {
  const v = options[KEY_OPTION];
  // Trimmed as the extension stores it: a pasted newline is no header.
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
}

/**
 * What `session.start` does. `off` in the condensing child (`READBACK_HOOK`),
 * which must never loop. `start` with a person at the prompt. `wait` under
 * the SDK: a `-p` run and the desktop app both start non-interactive with no
 * surface, and only an attach tells them apart (`startsOnAttach`). Starting
 * at once would condense every headless run's replies, unheard. Except when
 * the person has turned Readback on and autoplay on: they have asked twice
 * to hear each reply, so a surfaceless session (T3 Code) starts at once and
 * its first reply is heard. The trade, taken 2026-11-01: a headless `-p` run
 * on that machine speaks too while autoplay is on.
 */
export type StartPlan = "off" | "start" | "wait";
export function startPlan(
  readbackHook: string | undefined,
  isInteractive: boolean,
  wanted = false,
): StartPlan {
  if (readbackHook === "1") return "off";
  return isInteractive || wanted ? "start" : "wait";
}

/**
 * An attached surface a waiting session starts on: the desktop app, which
 * draws the band. A phone does not, and the sound would play on a machine
 * the person has left.
 */
export function startsOnAttach(surface: string): boolean {
  return surface === "desktop";
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

export type CommandPlan =
  | { kind: "text"; text: string }
  | { kind: "on"; key: string }
  | { kind: "off" }
  /** Bare `/readback`: what is on, which voice, which speed, what the player is doing. */
  | { kind: "status" }
  /** `query` names a voice by word (`/readback voice harper`); empty opens the band's picker. `target` says whose voice. */
  | { kind: "voice"; query: string; target: VoiceTarget; random?: true }
  | { kind: "speed"; rate: number }
  /** The band's buttons as words, for a session with no band; each word does one thing (`playbackAction`). */
  | { kind: "playback"; word: PlaybackWord }
  | { kind: "stop" }
  | { kind: "full" }
  /** `/readback auto on|off`; `auto` alone asks. */
  | { kind: "auto"; on: boolean | null }
  /** The latest reply from its start, whatever is loaded: a replay costs nothing, the render is cached. */
  | { kind: "again" }
  /** `/readback alerts on|off`: a waiting permission prompt. */
  | { kind: "alerts"; on: boolean | null };

export type PlaybackWord = "play" | "pause" | "resume";
const PLAYBACK_WORDS: Record<string, PlaybackWord | "stop" | "full"> = {
  play: "play",
  pause: "pause",
  resume: "resume",
  stop: "stop",
  full: "full",
};

/**
 * What a playback word does in the player's `state`, or nothing: unlike the
 * band's one button, whose changing label says what a press does, a typed
 * word must mean one thing. `pause` while idle used to start playback and
 * `play` while playing used to pause it (2026-11-05). `play` starts the
 * latest turn when idle and resumes when paused.
 */
export function playbackAction(word: PlaybackWord, state: State): PressAction | null {
  switch (word) {
    case "play":
      return state === "idle" ? "start" : state === "paused" ? "toggle" : null;
    case "pause":
      return state === "playing" ? "toggle" : null;
    case "resume":
      return state === "paused" ? "toggle" : null;
  }
}

/** The surfaces that draw the band (`AbovePrompt`), per Claude Code's declarations. */
export function hasBand(surfaces: readonly string[]): boolean {
  return surfaces.some((s) => s === "terminal" || s === "desktop");
}

export function onText(band: boolean): string {
  return band ? ON : ON_NO_BAND;
}

/** After `/readback speed <rate>`: how to hear it, by key where a band draws, by word elsewhere. */
export function speedSetText(rate: number, band: boolean): string {
  return `Speed is ${speedLabel(rate)}. ${band ? "Press 1" : "Type /readback play"} to hear it.`;
}

export const YIELDED =
  "The VS Code extension read the last reply, so nothing is loaded here. Close VS Code to hear replies in this session.";

/** What a playback word did, from the player's state after it; `yielded` when the last reply went to the extension. */
export function playbackText(state: State, hasLatest: boolean, yielded = false): string {
  if (!hasLatest) return yielded ? YIELDED : "Nothing to play yet: Readback reads the next reply.";
  switch (state) {
    case "playing":
      return "Playing.";
    case "loading":
    case "waiting":
      return "Loading.";
    case "paused":
      return "Paused.";
    case "idle":
      return "Stopped.";
  }
}

export function speedLabel(speed: number): string {
  return `${speed}×`;
}

/** The current speed and how to set it, for `/readback speed` with no value or a value not offered. */
export function speedText(speed: number): string {
  return `Speed is ${speedLabel(speed)}. /readback speed 1.5 sets it; ${RATES.join(", ")} are offered.`;
}

/** What `/readback [args]` does, given the key, whether Readback is on, and the speed. */
export function readbackCommand(args: string, key: string | null, enabled: boolean, speed = 1): CommandPlan {
  const [word = "", ...rest] = args.trim().toLowerCase().split(/\s+/);
  const value = rest[0] ?? "";
  const playback = PLAYBACK_WORDS[word];
  if (!["", "on", "off", "voice", "speed", "auto", "again", "replay", "alerts"].includes(word) && !playback) return { kind: "text", text: USAGE };
  if (key === null) return { kind: "text", text: NO_KEY };
  // Explicit, for a session with no band to show the state: "on" when on
  // checks the key again and says so; "off" when off just says so.
  if (word === "on") return { kind: "on", key };
  if (word === "off") return enabled ? { kind: "off" } : { kind: "text", text: OFF };
  if (word === "") return { kind: "status" };
  if (word === "auto") return { kind: "auto", on: value === "on" ? true : value === "off" ? false : null };
  if (word === "alerts") return { kind: "alerts", on: value === "on" ? true : value === "off" ? false : null };
  if (word === "again" || word === "replay") return enabled ? { kind: "again" } : { kind: "text", text: OFF_HINT };
  if (playback) {
    if (!enabled) return { kind: "text", text: OFF_HINT };
    return playback === "stop" || playback === "full" ? { kind: playback } : { kind: "playback", word: playback };
  }
  if (word === "speed") {
    const rate = Number(value.replace(/[x×]$/, ""));
    if (value === "" || !RATES.includes(rate)) return { kind: "text", text: speedText(speed) };
    return { kind: "speed", rate };
  }
  if (!enabled) return { kind: "text", text: OFF_NO_VOICE };
  if (value === "reset") return { kind: "voice", query: "", target: "reset" };
  const target = value === "default" ? "default" : "project";
  const words = target === "default" ? rest.slice(1) : rest;
  if (words.length === 1 && words[0] === "random") return { kind: "voice", query: "", target, random: true };
  return { kind: "voice", query: words.join(" "), target };
}

/** The status line bare `/readback` prints. */
export function statusText(
  enabled: boolean,
  voice: StoredVoice & { scope?: VoiceScope },
  speed: number,
  state: State,
  hasLatest: boolean,
  auto = false,
  alerts = true,
  floor: FloorNote | null = null,
): string {
  if (!enabled) return OFF_HINT;
  const hint = floorHint(floor);
  const player = (hasLatest ? playbackText(state, true).replace(/\.$/, "").toLowerCase() : "nothing loaded") + (hint ? `, ${hint}` : "");
  const about = [voice.locale, voice.scope === "project" ? "this project's" : voice.scope === "default" ? "the default" : voice.scope === "language" ? "from Claude's language" : ""].filter(Boolean);
  return `Readback is on. Voice ${voice.id}${about.length > 0 ? ` (${about.join(", ")})` : ""}, speed ${speedLabel(speed)}, autoplay ${auto ? "on" : "off"}, alerts ${alerts ? "on" : "off"}, ${player}.`;
}

/** The stored alerts flag; on unless stored false. */
export function storedAlerts(v: unknown): boolean {
  return v !== false;
}

export function alertsText(on: boolean): string {
  return on
    ? "Alerts are on: a permission prompt waiting for you is spoken. /readback alerts off silences it. Sessions already open keep their own setting."
    : "Alerts are off. /readback alerts on speaks a permission prompt waiting for you. Sessions already open keep their own setting.";
}

/**
 * A typed prompt stops what is playing, as the extension stops on
 * UserPromptSubmit: the person has moved on. A continuation ("" for its
 * text) and a subagent's turn are not the person moving on.
 */
export function stopsOnTurnStart(e: { text: string; agentId?: string }): boolean {
  return e.agentId === undefined && e.text.trim() !== "";
}

/** The stored autoplay flag; off unless stored true. */
export function storedAuto(v: unknown): boolean {
  return v === true;
}

export function autoText(on: boolean): string {
  return on
    ? "Autoplay is on: each reply plays as it lands, and a new session starts without waiting for /readback. /readback auto off turns it off. Sessions already open keep their own setting."
    : "Autoplay is off: /readback play plays the last reply. /readback auto on plays each reply as it lands. Sessions already open keep their own setting.";
}

/** The stored speed, or 1 when none or not one offered. */
export function storedSpeed(v: unknown): number {
  return typeof v === "number" && RATES.includes(v) ? v : 1;
}

/** The speed after `speed` in the cycle the band's button runs. */
export function nextRate(speed: number): number {
  const i = RATES.indexOf(speed);
  return RATES[(i + 1) % RATES.length]!;
}

/**
 * The voices the picker lists for `query`: every word of it found in the
 * name, id, locale or a tag; featured first, then A to Z. The caller cuts
 * the list at SELECT_MAX and says so.
 */
export function filterVoices(voices: readonly Voice[], query: string): Voice[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (v: Voice) => {
    if (words.length === 0) return true;
    const hay = `${v.name} ${v.id} ${v.locale} ${v.tags.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  return sortVoices(voices.filter(matches));
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
 * The spoken cue before a reply: the project's folder name, as the
 * extension's lead-in, so with several sessions speaking the ear knows
 * which project this is. One render per project, cached after the first.
 */
export function leadFor(cwd: string | null): string {
  return entryLead(projectOf(cwd));
}

/**
 * The main loop's finished answer as the latest turn, or null when it is not
 * one to read. Only a turn that ended normally is: one that died on an error
 * or a refusal can still carry the text written before it did. `lead` is
 * spoken first (`leadFor`).
 */
export function replyTurn(e: TurnEvent, lead: string | null = null): ReplyTurn | null {
  if (e.agentId !== undefined || e.isAborted || e.reason !== "answer" || e.answer.trim() === "") return null;
  if (decideMessage(e.answer, null, LIMITS).kind === "skip") return null;
  const { full } = replyParagraphs({ markdown: e.answer, limits: LIMITS });
  if (full.length === 0) return null;
  // A reply long enough to condense that carries its own spoken note is
  // condensed already, by the model that wrote it: no run, no wait. A short
  // one is read as it stands, note or not.
  const condensing = worthCondensing(e.answer, LIMITS);
  const note = condensing ? summaryFrom(spokenNoteFrom(e.answer)) : null;
  return { id: e.turnId, summary: note ?? [], full, condensing: condensing && note === null, lead, note: false };
}

export type StepEvent = { turnId: string; index: number; answer: string; toolUses: readonly unknown[]; agentId?: string };

/**
 * A model step that wrote text and then called tools is a progress note: the
 * extension reads those as they arrive (MessageDisplay followed by
 * PreToolUse), and the mod reads them off `turn.step`, which says outright
 * what the extension infers from timing. Read as it stands, never condensed;
 * the same floor (`PROGRESS_MIN_CHARS`) and the same planning-list filter.
 * The last step, with no tool calls, is the reply, read at `turn.complete`.
 */
export function noteTurn(e: StepEvent): ReplyTurn | null {
  if (e.agentId !== undefined || e.toolUses.length === 0) return null;
  const limits = { ...LIMITS, minChars: PROGRESS_MIN_CHARS };
  if (decideMessage(e.answer, null, limits).kind === "skip" || isPlanningNote(e.answer)) return null;
  const { full } = replyParagraphs({ markdown: e.answer, limits });
  return full.length === 0 ? null : { id: `${e.turnId}:${e.index}`, summary: [], full, condensing: false, lead: null, note: true };
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
 * Whether a press of 1 (toggle), 3 (full) or a start (autoplay, `/readback
 * again`) will start sound, and so takes the floor. A press while a resume
 * waits on the clock stays paused and takes nothing.
 */
export type PressAction = "toggle" | "full" | "start";
export function claimsFloor(state: State, action: PressAction, hasLatest: boolean, resuming = false): boolean {
  if (action === "full" || action === "start") return hasLatest;
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

/**
 * Why this session is silent for the floor: `queued`, autoplay waiting for
 * another session to finish before it starts; `preempted`, another session
 * took the floor and this one paused, to resume when it is free again.
 */
export type FloorNote = "queued" | "preempted";

/** The band's word for a floor note, dim after the controls; the status line's too. */
export function floorHint(note: FloorNote | null): string | null {
  switch (note) {
    case "queued":
      return "waiting for another session to finish";
    case "preempted":
      return "another session took over";
    case null:
      return null;
  }
}

/** The floor note a session takes when it loses the floor in `state`: a wait on condensing queues again, sound pauses. */
export function preemptedNote(state: State): FloorNote {
  return state === "waiting" ? "queued" : "preempted";
}

export type BandMode = "pass" | "band" | "picker" | "notice";

/** What the band above the prompt draws. Off, it is drawn only to hold a refused key's notice. */
export function bandMode(s: { hasSurvey: boolean; enabled: boolean; notice: string | null; picking: boolean; yielded?: boolean }): BandMode {
  if (s.hasSurvey) return "pass";
  // The extension's window speaks and shows its own player, so the band
  // would be controls over nothing; the picker still opens on request.
  if (s.enabled) return s.picking ? "picker" : s.yielded ? "pass" : "band";
  return s.notice !== null ? "notice" : "pass";
}
