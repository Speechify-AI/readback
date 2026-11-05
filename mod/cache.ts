/**
 * Renders on disk for the Claude Code mod, over the mod's `$.fs` (passed in
 * as `Files`). Text is the truth and audio is a cache over it: a render is
 * keyed by model, voice and the hash of the paragraph, so replaying never
 * bills and switching voice re-renders. Audio is stored as base64 inside
 * the JSON, since `$.fs` reads and writes text.
 */
import { renderChunks, renderKeyFrom, type RenderCache, type Rendered, type Synth } from "../src/renderShared.ts";
import type { TtsConfig } from "../src/speechifyShared.ts";
import { PARAGRAPH_LIMIT } from "../src/text.ts";
import { fromBase64, toBase64 } from "./bytes.ts";
import { unwrapMarks, wrapProsody, wrappedLimit } from "./ssml.ts";

export type Files = {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
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
        // A missing file rejects like a corrupt one: both are a miss.
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

/**
 * The paragraph rendered, from the cache when it is there. A speed other
 * than 1 is a different render (SSML prosody around each chunk, see
 * ssml.ts) under its own key; speed 1 sends and stores exactly as before.
 */
export async function renderParagraph(text: string, cfg: TtsConfig, cache: RenderCache, synth: Synth, speed = 1): Promise<Rendered> {
  const bare = renderKeyFrom(await sha256Hex(text), cfg.voiceId, cfg.model);
  const key = speed === 1 ? bare : `${bare}@${speed}`;
  const cached = await cache.get(key);
  if (cached) return cached;
  const rendered =
    speed === 1
      ? await renderChunks(text, cfg, synth)
      : await renderChunks(
          text,
          cfg,
          async (chunk, c) => {
            const r = await synth(wrapProsody(chunk, speed), c);
            return { ...r, marks: unwrapMarks(r.marks, chunk.length) };
          },
          wrappedLimit(text, speed, PARAGRAPH_LIMIT),
        );
  // Not awaited: the write is a few hundred KB of base64 and the paragraph
  // should not wait on it to play. `put` swallows its own failures.
  void cache.put(key, rendered);
  return rendered;
}
