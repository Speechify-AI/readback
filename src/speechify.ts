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
import { flattenMarks } from "./marks.ts";
import { version } from "../package.json";
import {
  RETRY_DELAYS_MS,
  TRANSIENT,
  TtsError,
  keyProblem,
  normalizeVoicePage,
  speechBody,
  voicesOnModel,
  type KeyCheck,
  type RawVoice,
  type TtsConfig,
  type TtsResult,
  type Voice,
} from "./speechifyShared.ts";

export * from "./speechifyShared.ts";

/**
 * Attribution on every request, so Speechify can tell Readback's traffic
 * from the rest: `caller` and `caller_version` on each request in their
 * analytics. It never gates limits, pricing or access. The slug is fixed for
 * good; changing it would split the history. The version rides separately,
 * never inside the slug. See docs.speechify.ai/build/guides/integrations/build-an-integration.
 */
const CALLER_HEADERS = {
  "Speechify-Caller": "readback",
  "Speechify-Caller-Version": version,
};

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
        ...CALLER_HEADERS,
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: speechBody(input, cfg),
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

/**
 * Voices on this key that can render on their model (`modelFor`, given the
 * configured one), walking every page.
 *
 * A voice is offered when its catalogue entry lists that model. The
 * catalogue lags the API, though: on 2026-10-16 no voice listed simba-3.5
 * while 3.5 rendered every stock English voice, so requiring the entry
 * would have emptied the picker of English. When no voice anywhere in the
 * catalogue lists the model, the model is taken as newer than the
 * catalogue and every voice that lists any model is offered on it.
 */
export async function listVoices(cfg: Omit<TtsConfig, "voiceId">): Promise<Voice[]> {
  const rows: RawVoice[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 30; page++) {
    const url = new URL(`${cfg.apiBase}/v1/voices`);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { ...CALLER_HEADERS, Authorization: `Bearer ${cfg.apiKey}` } });
    if (!res.ok) throw new TtsError(res.status, (await res.text()).slice(0, 200));

    const batch = normalizeVoicePage(await res.json());
    rows.push(...batch.rows);
    cursor = batch.cursor;
    if (!cursor) break;
  }

  return voicesOnModel(rows, cfg.model);
}

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
  const problem = keyProblem(trimmed);
  if (problem) return { ok: false, reason: problem };
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
