/**
 * Thin client for Speechify /v1/audio/speech. Copied from Soundbites, Speechify's internal notebook.
 *
 * That endpoint and not /v1/audio/stream, deliberately. Stream takes 20,000
 * characters against speech's 2,000, but returns raw audio and nothing else.
 * Read-along needs `speech_marks`, and only /speech returns them. The 2,000
 * cap is what makes the paragraph the unit of rendering; a longer paragraph
 * is chunked and the chunks are joined back into one timeline in render.ts.
 */
import { Buffer } from "node:buffer";
import { mp3DurationMs } from "./audio.ts";
import { flattenMarks, type Mark } from "./marks.ts";

export interface TtsConfig {
  apiBase: string;
  apiKey: string;
  voiceId: string;
  model: string;
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
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1500, 4000];

export class TtsError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Speechify ${status}: ${body}`);
    this.name = "TtsError";
  }
}

interface SpeechResponse {
  audio_data?: unknown;
  billable_characters_count?: unknown;
  speech_marks?: unknown;
}

function isSpeechResponse(value: unknown): value is SpeechResponse {
  return typeof value === "object" && value !== null;
}

export async function synthesize(input: string, cfg: TtsConfig): Promise<TtsResult> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${cfg.apiBase}/v1/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input,
        voice_id: cfg.voiceId,
        model: cfg.model,
        audio_format: "mp3",
      }),
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      const delay = RETRY_DELAYS_MS[attempt];
      if (TRANSIENT.has(res.status) && delay !== undefined) {
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new TtsError(res.status, body);
    }

    const json: unknown = await res.json();
    if (!isSpeechResponse(json) || typeof json.audio_data !== "string") {
      throw new TtsError(0, "missing audio_data in response");
    }

    const audio = new Uint8Array(Buffer.from(json.audio_data, "base64"));
    return {
      audio,
      charsBilled:
        typeof json.billable_characters_count === "number"
          ? json.billable_characters_count
          : input.length,
      durationMs: mp3DurationMs(audio),
      marks: flattenMarks(json.speech_marks),
    };
  }
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
 * The roster: the `*_32` voices on simba-3.2. The catalogue carries no flag
 * for them, but the suffix is how Speechify names the voices trained for
 * that model, and since 2026-09-08 they are the ones whose speech marks
 * reach the last word, so read-along is reliable on them and not on the
 * rest. Other models have no roster here.
 */
export function isFeatured(id: string, model: string | undefined): boolean {
  return model === "simba-3.2" && /_32$/.test(id);
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
    featured: raw.type !== "personal" && isFeatured(raw.id, model),
  };
}

/** Featured first, then shared narrators, then workspace clones; A to Z within each. */
export function sortVoices(voices: Voice[]): Voice[] {
  const rank = (v: Voice) => (v.featured ? 0 : v.cloned ? 2 : 1);
  return [...voices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Voices on this key that can render `model`, walking every page. */
export async function listVoices(cfg: Omit<TtsConfig, "voiceId">): Promise<Voice[]> {
  const out: Voice[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 30; page++) {
    const url = new URL(`${cfg.apiBase}/v1/voices`);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    if (!res.ok) throw new TtsError(res.status, (await res.text()).slice(0, 200));

    const { rows, cursor: next } = normalizeVoicePage(await res.json());
    for (const raw of rows) {
      if (!(raw.models ?? []).some((m) => m.name === cfg.model)) continue;
      const voice = toVoice(raw, cfg.model);
      if (voice) out.push(voice);
    }
    cursor = next;
    if (!cursor) break;
  }
  return sortVoices(out);
}

export type KeyCheck =
  | { ok: true; voices: Voice[] }
  | { ok: false; reason: string };

/**
 * Is this a working Speechify key, and can it render our model?
 *
 * Run before the key is stored, because the key is the admission test: an
 * unchecked key would leave a player that silently cannot speak, and the
 * person would have no way to tell whether they had mistyped or we were
 * broken. Checking also tells us which voices to offer.
 */
export async function checkKey(apiKey: string, apiBase: string, model: string): Promise<KeyCheck> {
  const trimmed = apiKey.trim();
  if (trimmed === "") return { ok: false, reason: "Paste your Speechify API key." };
  if (trimmed.length < 20 || /\s/.test(trimmed)) {
    return { ok: false, reason: "That does not look like an API key." };
  }
  let voices: Voice[];
  try {
    voices = await listVoices({ apiBase, apiKey: trimmed, model });
  } catch (err) {
    if (err instanceof TtsError && (err.status === 401 || err.status === 403)) {
      return { ok: false, reason: "Speechify refused that key." };
    }
    return { ok: false, reason: "Could not reach Speechify to check that key. Try again." };
  }
  if (voices.length === 0) {
    return { ok: false, reason: `That key works, but no voice on it can render ${model}.` };
  }
  return { ok: true, voices };
}
