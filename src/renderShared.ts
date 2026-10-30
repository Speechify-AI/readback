/**
 * The Node-free half of rendering: chunk, synthesize, stitch, fill gaps. The
 * Claude Code mod cannot load a module that imports `node:*`, so the part of
 * `renderParagraph` that needs neither sha256 nor the cache lives here, with
 * the key's format, and the mod passes its own `Synth` and hash. `render.ts`
 * keeps the hash and the cache around it and re-exports these types.
 */
import { mergeMp3, mp3DurationMs, stripId3 } from "./audio.ts";
import { fillGaps, type Mark } from "./marks.ts";
import type { TtsConfig, TtsResult } from "./speechifyShared.ts";
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

/** A render's cache key, from the paragraph's sha256 (each host hashes its own way). */
export function renderKeyFrom(hash: string, voiceId: string, model: string): string {
  return `${model}/${voiceId}/${hash}`;
}

export async function renderChunks(text: string, cfg: TtsConfig, synth: Synth): Promise<Rendered> {
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
  return { audio, marks: fillGaps(marks, text), durationMs };
}
