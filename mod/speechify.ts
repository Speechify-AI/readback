/**
 * The Speechify client for the mod: the same calls as src/speechify.ts, with
 * the transport injected. The mod runtime has no fetch of its own, no Buffer
 * and no timers, so the HTTP call (`$.http.fetch`), the wait between retries
 * and the package version all arrive as arguments, and base64 is decoded by
 * `fromBase64`. Retries, wording and results are the extension's.
 */
import { mp3DurationMs } from "../src/audio.ts";
import { flattenMarks } from "../src/marks.ts";
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
} from "../src/speechifyShared.ts";
import { fromBase64 } from "./bytes.ts";

export type Http = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: string }>;
export type Sleep = (ms: number) => Promise<void>;

/** Attribution on every request; see src/speechify.ts. The slug is fixed, the version rides apart. */
export function callerHeaders(version: string): Record<string, string> {
  return { "Speechify-Caller": "readback", "Speechify-Caller-Version": version };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function synthesize(
  input: string,
  cfg: TtsConfig,
  http: Http,
  sleep: Sleep,
  version: string,
): Promise<TtsResult> {
  for (let attempt = 0; ; attempt++) {
    const res = await http(`${cfg.apiBase}/v1/audio/speech`, {
      method: "POST",
      headers: {
        ...callerHeaders(version),
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: speechBody(input, cfg),
    });

    if (!res.ok) {
      const body = res.text.slice(0, 300);
      const delay = RETRY_DELAYS_MS[attempt];
      if (TRANSIENT.has(res.status) && delay !== undefined) {
        await sleep(delay);
        continue;
      }
      throw new TtsError(res.status, body);
    }

    const json = parse(res.text);
    if (typeof json !== "object" || json === null || typeof (json as { audio_data?: unknown }).audio_data !== "string") {
      throw new TtsError(0, "missing audio_data in response");
    }
    const j = json as { audio_data: string; billable_characters_count?: unknown; speech_marks?: unknown };

    const audio = fromBase64(j.audio_data);
    return {
      audio,
      charsBilled: typeof j.billable_characters_count === "number" ? j.billable_characters_count : input.length,
      durationMs: mp3DurationMs(audio),
      marks: flattenMarks(j.speech_marks),
    };
  }
}

/** Every page of the key's voices that can render on the model; the rule is `voicesOnModel`'s. */
export async function listVoices(cfg: Omit<TtsConfig, "voiceId">, http: Http, version: string): Promise<Voice[]> {
  const rows: RawVoice[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 30; page++) {
    const query = `page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await http(`${cfg.apiBase}/v1/voices?${query}`, {
      headers: { ...callerHeaders(version), Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) throw new TtsError(res.status, res.text.slice(0, 200));

    const batch = normalizeVoicePage(parse(res.text));
    rows.push(...batch.rows);
    cursor = batch.cursor;
    if (!cursor) break;
  }

  return voicesOnModel(rows, cfg.model);
}

/** Is this a working key that can render our model? Same answers and wording as the extension's. */
export async function checkKey(
  apiKey: string,
  cfg: { apiBase: string; model: string },
  http: Http,
  version: string,
): Promise<KeyCheck> {
  const trimmed = apiKey.trim();
  const problem = keyProblem(trimmed);
  if (problem) return { ok: false, reason: problem };
  let voices: Voice[];
  try {
    voices = await listVoices({ apiBase: cfg.apiBase, apiKey: trimmed, model: cfg.model }, http, version);
  } catch (err) {
    if (err instanceof TtsError && (err.status === 401 || err.status === 403)) {
      return { ok: false, reason: "Speechify refused that key." };
    }
    return { ok: false, reason: "Could not reach Speechify to check that key. Try again." };
  }
  if (voices.length === 0) {
    return { ok: false, reason: `That key works, but no voice on it can render ${cfg.model}.` };
  }
  return { ok: true, voices };
}
