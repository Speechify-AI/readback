/**
 * Renders on disk for the Claude Code mod, over the mod's `$.fs` (passed in
 * as `Files`). Text is the truth and audio is a cache over it: a render is
 * keyed by model, voice and the hash of the paragraph, so replaying never
 * bills and switching voice re-renders. Audio is stored as base64 inside
 * the JSON, since `$.fs` reads and writes text.
 */
import { renderChunks, renderKeyFrom, type RenderCache, type Rendered, type Synth } from "../src/renderShared.ts";
import type { TtsConfig } from "../src/speechifyShared.ts";
import { fromBase64, toBase64 } from "./bytes.ts";

export type Files = {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
};

/** Under `$HOME`; the caller joins it. */
export const CACHE_DIR = ".readback/claude-code/renders";

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function diskCache(files: Files, dir: string): RenderCache {
  const path = (key: string) => `${dir}/${key}.json`;
  return {
    async get(key) {
      try {
        if (!(await files.exists(path(key)))) return null;
        const j = JSON.parse(await files.read(path(key)));
        if (typeof j?.audio !== "string" || !Array.isArray(j.marks) || typeof j.durationMs !== "number") return null;
        return { audio: fromBase64(j.audio), marks: j.marks, durationMs: j.durationMs };
      } catch {
        return null;
      }
    },
    async put(key, r) {
      try {
        await files.write(path(key), JSON.stringify({ audio: toBase64(r.audio), marks: r.marks, durationMs: r.durationMs }));
      } catch {
        // Not cached (for instance over $.fs's size cap); the render is still returned.
      }
    },
  };
}

export async function renderParagraph(text: string, cfg: TtsConfig, cache: RenderCache, synth: Synth): Promise<Rendered> {
  const key = renderKeyFrom(await sha256Hex(text), cfg.voiceId, cfg.model);
  const cached = await cache.get(key);
  if (cached) return cached;
  const rendered = await renderChunks(text, cfg, synth);
  await cache.put(key, rendered);
  return rendered;
}
