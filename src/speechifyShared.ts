/**
 * The Node-free half of the Speechify client: types, the request body, the
 * voice catalogue's normalising and sorting, and the local key checks. The
 * Claude Code mod cannot load a module that imports a Node built-in or
 * the package manifest, so everything it needs from `speechify.ts` lives here and
 * `speechify.ts` re-exports it. The fetching, the Buffer and the caller
 * headers (which carry the package version) stay in `speechify.ts`.
 */
import type { Mark } from "./marks.ts";

export interface TtsConfig {
  apiBase: string;
  apiKey: string;
  voiceId: string;
  model: string;
  /** The voice's locale as the API spells it ("es-ES"); omitted, Speechify uses the voice's own. */
  language?: string;
}

export interface TtsResult {
  audio: Uint8Array;
  /** Characters Speechify bills for. */
  charsBilled: number;
  durationMs: number;
  /** Word marks with character offsets into `input`. See marks.ts. */
  marks: Mark[];
}

/** Statuses worth retrying: the TTS API 429/503s in bursts during incidents. */
export const TRANSIENT: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);
export const RETRY_DELAYS_MS: readonly number[] = [1500, 4000];

export class TtsError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Speechify ${status}: ${body}`);
    this.name = "TtsError";
  }
}


/** The JSON `synthesize` posts to /v1/audio/speech. Headers are not part of it. */
export function speechBody(input: string, cfg: TtsConfig): string {
  return JSON.stringify({
    input,
    voice_id: cfg.voiceId,
    model: cfg.model,
    ...(cfg.language ? { language: cfg.language } : {}),
    audio_format: "mp3",
  });
}

export type Gender = "female" | "male" | "unspecified";

export interface Voice {
  id: string;
  name: string;
  locale: string;
  /** A workspace clone rather than a shared stock voice. */
  cloned: boolean;
  gender: Gender;
  /** Catalogue tags such as "narrator" or "young"; empty when none. */
  tags: string[];
  /** A sample the catalogue already has, or null when one must be synthesized. */
  preview: string | null;
  /** One of the roster voices the picker puts first. See `isFeatured`. */
  featured: boolean;
}

/**
 * The roster: the eight `*_32` voices Speechify trained for simba-3.2. The
 * catalogue carries no flag for them, and no later naming: on 2026-10-16 it
 * held no `_35` id and listed no voice on simba-3.5 at all, yet 3.5 rendered
 * every stock English voice (RUNBOOK). So the roster stays featured whatever
 * model is configured. Between 2026-09-08 and 2026-09-22 these were also the
 * only voices whose speech marks reached the last word.
 */
export function isFeatured(id: string): boolean {
  return /_32$/.test(id);
}

/**
 * simba-3.2 and simba-english are English only: a non-English voice on them
 * answers 400. simba-3.5 speaks 48 languages with every voice, simba-3.0
 * English plus de-DE, es-ES, es-MX, fr-FR, it-IT and pt-BR (Speechify's
 * language-support guide, read 2026-10-22). So the model follows the voice
 * only when it has to: an English voice, or one with no locale, renders on
 * the configured model; any other does too unless that model is English
 * only, when it renders on simba-3.0.
 */
export const MULTILINGUAL_MODEL = "simba-3.0";
const ENGLISH_ONLY_MODELS = new Set(["simba-3.2", "simba-english"]);

export function modelFor(locale: string, model: string): string {
  const english = locale === "" || /^en([-_]|$)/i.test(locale);
  return english || !ENGLISH_ONLY_MODELS.has(model) ? model : MULTILINGUAL_MODEL;
}

/** "es-ES" for es-ES or es_ES; undefined when the voice has no locale. */
export function languageFor(locale: string): string | undefined {
  return locale === "" ? undefined : locale.replace("_", "-");
}

export interface RawVoice {
  id?: string;
  type?: string;
  display_name?: string;
  locale?: string;
  gender?: unknown;
  tags?: unknown;
  preview_audio?: unknown;
  models?: { name?: string; languages?: { locale?: string; preview_audio?: unknown }[] }[];
}

/**
 * One page of the voice catalog, normalized.
 *
 * `GET /v1/voices` answers in two shapes depending on the key, both seen
 * live on 2026-09-04: `{ voices, next_cursor, has_more }` cursor-paginated,
 * or a bare JSON array of the entire catalog with no cursor. Treat the shape
 * as something the server chooses, not something we know.
 */
export function normalizeVoicePage(json: unknown): { rows: RawVoice[]; cursor: string | null } {
  if (Array.isArray(json)) return { rows: json.filter(isRawVoice), cursor: null };
  if (typeof json !== "object" || json === null) return { rows: [], cursor: null };
  const body: { voices?: unknown; data?: unknown; next_cursor?: unknown; has_more?: unknown } = json;
  const rows = Array.isArray(body.voices) ? body.voices : Array.isArray(body.data) ? body.data : [];
  const cursor =
    body.has_more === true && typeof body.next_cursor === "string" ? body.next_cursor : null;
  return { rows: rows.filter(isRawVoice), cursor };
}

function isRawVoice(value: unknown): value is RawVoice {
  return typeof value === "object" && value !== null;
}

/** The catalogue's own sample for this voice: the voice's, else the model's for the voice's locale. */
function previewOf(raw: RawVoice, model: string | undefined): string | null {
  if (typeof raw.preview_audio === "string" && raw.preview_audio !== "") return raw.preview_audio;
  for (const m of raw.models ?? []) {
    if (model !== undefined && m.name !== model) continue;
    for (const lang of m.languages ?? []) {
      if (typeof lang.preview_audio === "string" && lang.preview_audio !== "") return lang.preview_audio;
    }
  }
  return null;
}

export function toVoice(raw: RawVoice, model?: string): Voice | null {
  if (!raw.id) return null;
  return {
    id: raw.id,
    name: raw.display_name ?? raw.id,
    locale: raw.locale ?? "",
    cloned: raw.type === "personal",
    gender: raw.gender === "female" || raw.gender === "male" ? raw.gender : "unspecified",
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string" && t !== "") : [],
    preview: previewOf(raw, model),
    featured: raw.type !== "personal" && isFeatured(raw.id),
  };
}

/** Featured first, then shared narrators, then workspace clones; A to Z within each. */
export function sortVoices(voices: Voice[]): Voice[] {
  const rank = (v: Voice) => (v.featured ? 0 : v.cloned ? 2 : 1);
  return [...voices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Voices that can render on their model (`modelFor`, given the configured
 * one), from every catalogue row. See `listVoices` for the rule.
 */
export function voicesOnModel(rows: RawVoice[], model: string): Voice[] {
  const listed = new Set(rows.flatMap((raw) => (raw.models ?? []).map((m) => m.name)));
  const out: Voice[] = [];
  for (const raw of rows) {
    const voiceModel = modelFor(raw.locale ?? "", model);
    const models = raw.models ?? [];
    const renders = listed.has(voiceModel) ? models.some((m) => m.name === voiceModel) : models.length > 0;
    if (!renders) continue;
    const voice = toVoice(raw, voiceModel);
    if (voice) out.push(voice);
  }
  return sortVoices(out);
}

/** What is wrong with a trimmed key without asking Speechify, or null. */
export function keyProblem(trimmed: string): string | null {
  if (trimmed === "") return "Paste your Speechify API key.";
  if (trimmed.length < 20 || /\s/.test(trimmed)) return "That does not look like an API key.";
  return null;
}

export type KeyCheck =
  | { ok: true; voices: Voice[] }
  | { ok: false; reason: string };
