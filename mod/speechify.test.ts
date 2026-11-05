import { describe, expect, it } from "vitest";
import { toBase64 } from "./bytes.ts";
import { checkKey, listVoices, synthesize, type Http } from "./speechify.ts";
import { speechBody, type TtsConfig } from "../src/speechifyShared.ts";

const cfg: TtsConfig = { apiBase: "https://api.test", apiKey: "k", voiceId: "harper_32", model: "simba-3.5" };

type Call = { url: string; init?: Parameters<Http>[1] };
const fake = (replies: Array<{ ok?: boolean; status?: number; body: unknown }>) => {
  const calls: Call[] = [];
  const http: Http = async (url, init) => {
    calls.push({ url, init });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    const status = r.status ?? 200;
    return { ok: r.ok ?? (status >= 200 && status < 300), status, text: typeof r.body === "string" ? r.body : JSON.stringify(r.body) };
  };
  return { http, calls };
};
const okSpeech = { body: { audio_data: toBase64(new Uint8Array([1, 2, 3])), billable_characters_count: 5, speech_marks: { chunks: [] } } };

describe("synthesize", () => {
  it("posts speechBody with caller headers", async () => {
    const { http, calls } = fake([okSpeech]);
    const res = await synthesize("hello", cfg, http, async () => {}, "9.9.9");
    expect(calls[0]!.url).toBe("https://api.test/v1/audio/speech");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.headers).toMatchObject({
      Authorization: "Bearer k",
      "Speechify-Caller": "readback",
      "Speechify-Caller-Version": "9.9.9",
    });
    expect(calls[0]!.init?.body).toBe(speechBody("hello", cfg));
    expect([...res.audio]).toEqual([1, 2, 3]);
    expect(res.charsBilled).toBe(5);
  });

  it("retries a 503 then succeeds", async () => {
    const { http, calls } = fake([{ status: 503, body: "busy" }, okSpeech]);
    const waits: number[] = [];
    await synthesize("hello", cfg, http, async (ms) => void waits.push(ms), "9.9.9");
    expect(waits).toEqual([1500]);
    expect(calls.length).toBe(2);
  });

  it("throws TtsError on 401 without retrying", async () => {
    const { http, calls } = fake([{ status: 401, body: "nope" }]);
    const waits: number[] = [];
    await expect(synthesize("hello", cfg, http, async (ms) => void waits.push(ms), "9.9.9")).rejects.toMatchObject({
      status: 401,
      body: "nope",
    });
    expect(calls.length).toBe(1);
    expect(waits).toEqual([]);
  });
});

const voice = (id: string) => ({ id, display_name: id, locale: "en-US", gender: "female", models: [{ name: "simba-3.5", languages: [] }] });

describe("listVoices", () => {
  it("follows the cursor", async () => {
    const { http, calls } = fake([
      { body: { voices: [voice("a")], next_cursor: "c2", has_more: true } },
      { body: { voices: [voice("b")], has_more: false } },
    ]);
    const voices = await listVoices({ apiBase: cfg.apiBase, apiKey: "k", model: cfg.model }, http, "9.9.9");
    expect(voices.map((v) => v.id).sort()).toEqual(["a", "b"]);
    expect(calls[0]!.url).toBe("https://api.test/v1/voices?page_size=100");
    expect(calls[1]!.url).toBe("https://api.test/v1/voices?page_size=100&cursor=c2");
    expect(calls[0]!.init?.headers).toMatchObject({ "Speechify-Caller-Version": "9.9.9" });
  });
});

describe("checkKey", () => {
  const key = "k".repeat(24);
  it("401 → Speechify refused that key.", async () => {
    const { http } = fake([{ status: 401, body: "no" }]);
    expect(await checkKey(key, { apiBase: cfg.apiBase, model: cfg.model }, http, "9.9.9")).toEqual({
      ok: false,
      kind: "refused",
      reason: "Speechify refused that key.",
    });
  });
  it("short key is rejected before any request", async () => {
    const { http, calls } = fake([{ body: {} }]);
    const r = await checkKey("short", { apiBase: cfg.apiBase, model: cfg.model }, http, "9.9.9");
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0);
  });
});
