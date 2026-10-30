/**
 * Thin client for Speechify /v1/audio/speech. Copied from Soundbites, Speechify's internal notebook.
 *
 * That endpoint and not /v1/audio/stream, deliberately. Stream takes 20,000
 * characters against speech's 2,000, but returns raw audio and nothing else.
 * Read-along needs `speech_marks`, and only /speech returns them. The 2,000
 * cap is what makes the paragraph the unit of rendering; a longer paragraph
 * is chunked and the chunks are joined back into one timeline in render.ts.
 *
 * The calls live in speechifyShared.ts so the Claude Code mod runs the same
 * code; this module binds them to Node's fetch, timers and Buffer.
 */
import { Buffer } from "node:buffer";
import { version } from "../package.json";
import * as shared from "./speechifyShared.ts";
import type { KeyCheck, SpeechifyIo, TtsConfig, TtsResult, Voice } from "./speechifyShared.ts";

export * from "./speechifyShared.ts";

const io: SpeechifyIo = {
  http: (url, init) =>
    fetch(url, init).then(async (res) => ({ ok: res.ok, status: res.status, text: await res.text() })),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  version,
  decodeBase64: (base64) => new Uint8Array(Buffer.from(base64, "base64")),
};

export function synthesize(input: string, cfg: TtsConfig): Promise<TtsResult> {
  return shared.synthesize(input, cfg, io);
}

/** Every page of the key's voices that can render on the model; see the shared `listVoices`. */
export function listVoices(cfg: Omit<TtsConfig, "voiceId">): Promise<Voice[]> {
  return shared.listVoices(cfg, io);
}

/** Is this a working key that can render our model? See the shared `checkKey`. */
export function checkKey(apiKey: string, apiBase: string, model: string): Promise<KeyCheck> {
  return shared.checkKey(apiKey, apiBase, model, io);
}
