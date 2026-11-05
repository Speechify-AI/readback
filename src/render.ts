/**
 * Turning one paragraph into audio plus marks, once.
 *
 * Text is the source of truth and audio is a cache over it. A render is
 * keyed by the hash of the paragraph text plus the voice and model that
 * produced it, so replaying a turn, or reading the same reply in two
 * windows, never bills twice, and switching voice re-renders rather than
 * serving the wrong narrator.
 *
 * Nothing renders ahead of the player: the webview asks for a paragraph
 * when the playhead is about to need it (plus a short look-ahead), so a
 * turn you stop after one sentence costs one sentence.
 */
import { createHash } from "node:crypto";
import { renderChunks, renderKeyFrom, type RenderCache, type Rendered, type Synth } from "./renderShared.ts";
import { synthesize, type TtsConfig } from "./speechify.ts";

export type { RenderCache, Rendered, Synth } from "./renderShared.ts";
export { renderChunks } from "./renderShared.ts";

export function renderKey(text: string, voiceId: string, model: string): string {
  return renderKeyFrom(createHash("sha256").update(text).digest("hex"), voiceId, model);
}

export async function renderParagraph(
  text: string,
  cfg: TtsConfig,
  cache: RenderCache,
  synth: Synth = synthesize,
): Promise<Rendered> {
  const key = renderKey(text, cfg.voiceId, cfg.model);
  const cached = await cache.get(key);
  if (cached) return cached;

  const rendered = await renderChunks(text, cfg, synth);
  await cache.put(key, rendered);
  return rendered;
}

/** A cache that forgets everything. For tests and for a missing storage dir. */
export const noCache: RenderCache = {
  get: async () => null,
  put: async () => undefined,
};
