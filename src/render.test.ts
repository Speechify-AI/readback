import { describe, expect, it } from "vitest";
import { noCache, renderKey, renderParagraph, type RenderCache, type Rendered } from "./render.ts";
import type { TtsConfig, TtsResult } from "./speechify.ts";

const cfg: TtsConfig = { apiBase: "http://x", apiKey: "k", voiceId: "v", model: "m" };

/** A fake synth: 10ms per character, one mark per word, 100 bytes of "audio". */
const fakeSynth = async (input: string): Promise<TtsResult> => {
  const marks = [];
  for (const m of input.matchAll(/\S+/g)) {
    marks.push({ start: m.index, end: m.index + m[0].length, startMs: m.index * 10, endMs: (m.index + m[0].length) * 10 });
  }
  return { audio: new Uint8Array(100).fill(0xff), charsBilled: input.length, durationMs: input.length * 10, marks };
};

const memoryCache = (): RenderCache & { store: Map<string, Rendered> } => {
  const store = new Map<string, Rendered>();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    put: async (key, rendered) => {
      store.set(key, rendered);
    },
  };
};

describe("renderParagraph", () => {
  it("rebases chunk marks by character offset and audio duration", async () => {
    const text = `${"one two. ".repeat(20)}end.`;
    const calls: string[] = [];
    const synth = async (input: string) => {
      calls.push(input);
      return fakeSynth(input);
    };
    // A 60-character limit is not exposed, so force chunking via a long text
    // against the real 2,000 limit instead.
    const long = `${"word ".repeat(500)}last.`;
    const out = await renderParagraph(long, cfg, noCache, synth);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.join("")).toBe(long);
    // Every mark indexes the whole paragraph, not its chunk.
    for (const m of out.marks) expect(long.slice(m.start, m.end).trim()).not.toBe("");
    // Times are monotonic across the join.
    for (let i = 1; i < out.marks.length; i++) {
      expect(out.marks[i]!.startMs).toBeGreaterThanOrEqual(out.marks[i - 1]!.startMs);
    }
    expect(out.marks[out.marks.length - 1]!.end).toBe(long.length);
    expect(text).toBeTruthy();
  });

  it("is a cache hit the second time and never synthesizes again", async () => {
    const cache = memoryCache();
    let calls = 0;
    const synth = async (input: string) => {
      calls++;
      return fakeSynth(input);
    };
    await renderParagraph("Hello there.", cfg, cache, synth);
    await renderParagraph("Hello there.", cfg, cache, synth);
    expect(calls).toBe(1);
    expect(cache.store.size).toBe(1);
  });

  it("keys on voice and model as well as text", () => {
    const a = renderKey("x", "harper_32", "simba-3.2");
    expect(renderKey("x", "geffen_32", "simba-3.2")).not.toBe(a);
    expect(renderKey("x", "harper_32", "simba-3.3")).not.toBe(a);
    expect(renderKey("x", "harper_32", "simba-3.2")).toBe(a);
  });
});
