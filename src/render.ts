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
import { mergeMp3, mp3DurationMs, stripId3 } from "./audio.ts";
import { fillGaps, type Mark } from "./marks.ts";
import { synthesize, type TtsConfig, type TtsResult } from "./speechify.ts";
import { chunkRanges, PARAGRAPH_LIMIT } from "./text.ts";

export interface Rendered {
  audio: Uint8Array;
  marks: Mark[];
  durationMs: number;
}

/** Where finished renders live. The file cache in the extension implements it. */
export interface RenderCache {
  get(key: string): Promise<Rendered | null>;
  put(key: string, rendered: Rendered): Promise<void>;
}

export type Synth = (input: string, cfg: TtsConfig) => Promise<TtsResult>;

export function renderKey(text: string, voiceId: string, model: string): string {
  const hash = createHash("sha256").update(text).digest("hex");
  return `${model}/${voiceId}/${hash}`;
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

  // One call per chunk. Ranges (not strings) so a mark's offset inside a
  // chunk plus the chunk's start is its offset in the whole paragraph.
  const segments: Uint8Array[] = [];
  const marks: Mark[] = [];
  let timeOffsetMs = 0;
  for (const range of chunkRanges(text, PARAGRAPH_LIMIT)) {
    const result = await synth(text.slice(range.start, range.end), cfg);
    for (const mark of result.marks) {
      marks.push({
        start: mark.start + range.start,
        end: mark.end + range.start,
        startMs: mark.startMs + timeOffsetMs,
        endMs: mark.endMs + timeOffsetMs,
      });
    }
    segments.push(result.audio);
    // Advance by the audio's own length, not the marks': marks stop at the
    // last word and would drift the next chunk earlier on every join.
    timeOffsetMs += result.durationMs;
  }

  // Always strip, even for a single chunk, so every stored object is bare
  // frames and safe to concatenate later.
  const [only] = segments;
  const audio = segments.length === 1 && only ? stripId3(only) : mergeMp3(segments);
  const durationMs = segments.length === 1 ? timeOffsetMs : mp3DurationMs(audio);
  const rendered: Rendered = { audio, marks: fillGaps(marks, text), durationMs };
  await cache.put(key, rendered);
  return rendered;
}

/** A cache that forgets everything. For tests and for a missing storage dir. */
export const noCache: RenderCache = {
  get: async () => null,
  put: async () => undefined,
};
