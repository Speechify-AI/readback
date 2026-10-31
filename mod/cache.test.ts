import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { diskCache, renderParagraph, sha256Hex, type Files } from "./cache.ts";
import type { TtsConfig, TtsResult } from "../src/speechifyShared.ts";

const cfg: TtsConfig = { apiBase: "http://x", apiKey: "k", voiceId: "v", model: "m" };

/** Marks the words of the text as the API does: for SSML input, over the plain text with the tags stripped. */
const fakeSynth = (calls: string[]) => async (input: string): Promise<TtsResult> => {
  calls.push(input);
  const marks = [];
  const spoken = input.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  for (const m of spoken.matchAll(/\S+/g)) {
    marks.push({ start: m.index, end: m.index + m[0].length, startMs: m.index * 10, endMs: (m.index + m[0].length) * 10 });
  }
  return { audio: new Uint8Array([0xff, 1, 2, 3]), charsBilled: input.length, durationMs: input.length * 10, marks };
};

const memoryFiles = (): Files & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return {
    store,
    read: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw new Error("ENOENT");
      return v;
    },
    write: async (p, t) => void store.set(p, t),
  };
};

describe("renderParagraph with a disk cache", () => {
  it("second render of the same text never calls synth", async () => {
    const files = memoryFiles();
    const cache = diskCache(files, "/c");
    const calls: string[] = [];
    const first = await renderParagraph("hello there world", cfg, cache, fakeSynth(calls));
    const second = await renderParagraph("hello there world", cfg, cache, fakeSynth(calls));
    expect(calls.length).toBe(1);
    expect([...second.audio]).toEqual([...first.audio]);
    expect(second.marks).toEqual(first.marks);
    expect(second.durationMs).toBe(first.durationMs);
    const key = `m/v/${await sha256Hex("hello there world")}`;
    expect(files.store.has(`/c/${key}.json`)).toBe(true);
  });

  it("a different voice re-renders", async () => {
    const cache = diskCache(memoryFiles(), "/c");
    const calls: string[] = [];
    await renderParagraph("hello there world", cfg, cache, fakeSynth(calls));
    await renderParagraph("hello there world", { ...cfg, voiceId: "other" }, cache, fakeSynth(calls));
    expect(calls.length).toBe(2);
  });

  it("a speed other than 1 wraps each chunk in prosody, maps the marks back, and keys the render apart", async () => {
    const files = memoryFiles();
    const cache = diskCache(files, "/c");
    const calls: string[] = [];
    const fast = await renderParagraph("hello there world", cfg, cache, fakeSynth(calls), 1.5);
    expect(calls).toEqual(['<speak><prosody rate="+50%">hello there world</prosody></speak>']);
    expect(fast.marks.map((m) => "hello there world".slice(m.start, m.end))).toEqual(["hello", "there", "world"]);
    await renderParagraph("hello there world", cfg, cache, fakeSynth(calls), 1.5);
    expect(calls.length).toBe(1);
    await renderParagraph("hello there world", cfg, cache, fakeSynth(calls));
    expect(calls.length).toBe(2); // speed 1 is its own render under the bare key
    expect(calls[1]).toBe("hello there world");
    const bare = `m/v/${await sha256Hex("hello there world")}`;
    expect(files.store.has(`/c/${bare}.json`)).toBe(true);
    expect(files.store.has(`/c/${bare}@1.5.json`)).toBe(true);
  });

  it("at speed, a paragraph dense in & and < never sends a chunk over the API's 2,000 characters", async () => {
    const cache = diskCache(memoryFiles(), "/c");
    const calls: string[] = [];
    const words = Array.from({ length: 300 }, (_, i) => (i % 6 === 0 ? "a&b" : i % 7 === 0 ? "<c>" : "word")).join(" ");
    expect(words.length).toBeGreaterThan(1200);
    const r = await renderParagraph(words, cfg, cache, fakeSynth(calls), 1.5);
    expect(calls.length).toBeGreaterThan(0);
    for (const input of calls) expect(input.length).toBeLessThanOrEqual(2000);
    // Every mark still lands on a word of the bare text.
    for (const m of r.marks) expect(words.slice(m.start, m.end)).toMatch(/^\S+$/);
  });

  it("a corrupt cache file is a miss", async () => {
    const files = memoryFiles();
    const cache = diskCache(files, "/c");
    const calls: string[] = [];
    await renderParagraph("hello there world", cfg, cache, fakeSynth(calls));
    for (const k of files.store.keys()) files.store.set(k, "{not json");
    const again = await renderParagraph("hello there world", cfg, cache, fakeSynth(calls));
    expect(calls.length).toBe(2);
    expect(again.durationMs).toBeGreaterThan(0);
  });

  it("a write that rejects still returns the render", async () => {
    const files = memoryFiles();
    files.write = async () => {
      throw new Error("too big");
    };
    const calls: string[] = [];
    const r = await renderParagraph("hello there world", cfg, diskCache(files, "/c"), fakeSynth(calls));
    expect(r.marks.length).toBe(3);
  });
});

describe("sha256Hex", () => {
  it("matches node:crypto", async () => {
    for (const s of ["", "hello", "naïve — ünïcode 🎧"]) {
      expect(await sha256Hex(s)).toBe(createHash("sha256").update(s).digest("hex"));
    }
  });
});
