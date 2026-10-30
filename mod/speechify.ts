/**
 * The Speechify client for the mod: the extension's calls from
 * src/speechifyShared.ts, bound to what the mod runtime has. It has no fetch
 * of its own, no Buffer and no timers, so the HTTP call (`$.http.fetch`),
 * the wait between retries and the package version arrive as arguments, and
 * base64 is decoded by `fromBase64`.
 */
import * as shared from "../src/speechifyShared.ts";
import type { Http, KeyCheck, TtsConfig, TtsResult, Voice } from "../src/speechifyShared.ts";
import { fromBase64 } from "./bytes.ts";

export type { Http } from "../src/speechifyShared.ts";
export type Sleep = (ms: number) => Promise<void>;

export function synthesize(input: string, cfg: TtsConfig, http: Http, sleep: Sleep, version: string): Promise<TtsResult> {
  return shared.synthesize(input, cfg, { http, sleep, version, decodeBase64: fromBase64 });
}

export function listVoices(cfg: Omit<TtsConfig, "voiceId">, http: Http, version: string): Promise<Voice[]> {
  return shared.listVoices(cfg, { http, version });
}

export function checkKey(apiKey: string, cfg: { apiBase: string; model: string }, http: Http, version: string): Promise<KeyCheck> {
  return shared.checkKey(apiKey, cfg.apiBase, cfg.model, { http, version });
}
