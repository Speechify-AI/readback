import { describe, expect, it, vi } from "vitest";
import { languageFor, listVoices, modelFor, normalizeVoicePage, sortVoices, synthesize, toVoice } from "./speechify.ts";

describe("modelFor and languageFor", () => {
  it("keeps English on the configured model and moves every other language to simba-3.0", () => {
    expect(modelFor("en-US", "simba-3.2")).toBe("simba-3.2");
    expect(modelFor("en_GB", "simba-3.2")).toBe("simba-3.2");
    expect(modelFor("", "simba-3.2")).toBe("simba-3.2");
    expect(modelFor("es-ES", "simba-3.2")).toBe("simba-3.0");
    expect(modelFor("de-DE", "simba-3.0")).toBe("simba-3.0");
  });

  it("spells the locale the way the API takes it, and sends none for a voice without one", () => {
    expect(languageFor("es-MX")).toBe("es-MX");
    expect(languageFor("pt_BR")).toBe("pt-BR");
    expect(languageFor("")).toBeUndefined();
  });
});

describe("toVoice", () => {
  it("keeps what the picker groups and samples by", () => {
    const v = toVoice(
      {
        id: "harper_32",
        display_name: "Harper",
        locale: "en-US",
        type: "shared",
        gender: "female",
        tags: ["narrator", "", 3],
        preview_audio: null,
        models: [
          { name: "simba-3.0", languages: [{ locale: "en-US", preview_audio: "https://x/old.mp3" }] },
          { name: "simba-3.2", languages: [{ locale: "en-US", preview_audio: "https://x/new.mp3" }] },
        ],
      },
      "simba-3.2",
    );
    expect(v).toEqual({
      id: "harper_32",
      name: "Harper",
      locale: "en-US",
      cloned: false,
      gender: "female",
      tags: ["narrator"],
      preview: "https://x/new.mp3",
      featured: true,
    });
  });

  it("features the roster suffix on simba-3.2 only, never a clone", () => {
    expect(toVoice({ id: "wyatt_32" }, "simba-3.2")?.featured).toBe(true);
    expect(toVoice({ id: "wyatt_32" }, "simba-3.0")?.featured).toBe(false);
    expect(toVoice({ id: "wyatt" }, "simba-3.2")?.featured).toBe(false);
    expect(toVoice({ id: "mine_32", type: "personal" }, "simba-3.2")?.featured).toBe(false);
  });

  it("prefers the voice's own preview, and has none when the catalogue has none", () => {
    expect(toVoice({ id: "a", preview_audio: "https://x/a.mp3", models: [] })?.preview).toBe("https://x/a.mp3");
    const bare = toVoice({ id: "b", type: "personal", gender: "not_specified" });
    expect(bare).toMatchObject({ name: "b", cloned: true, gender: "unspecified", tags: [], preview: null, featured: false });
    expect(toVoice({})).toBeNull();
  });
});

describe("normalizeVoicePage and sortVoices", () => {
  it("reads both response shapes and orders featured, shared, clones", () => {
    expect(normalizeVoicePage([{ id: "a" }]).rows).toHaveLength(1);
    expect(normalizeVoicePage({ voices: [{ id: "a" }], next_cursor: "c", has_more: true }).cursor).toBe("c");
    const m = "simba-3.2";
    const voices = [toVoice({ id: "z", type: "personal" }, m)!, toVoice({ id: "b" }, m)!, toVoice({ id: "a" }, m)!, toVoice({ id: "wyatt_32" }, m)!];
    expect(sortVoices(voices).map((v) => v.id)).toEqual(["wyatt_32", "a", "b", "z"]);
  });
});

describe("listVoices", () => {
  it("offers English voices on the configured model and the rest on simba-3.0", async () => {
    const catalogue = [
      { id: "harper_32", locale: "en-US", models: [{ name: "simba-3.2" }] },
      { id: "old_en", locale: "en-US", models: [{ name: "simba-3.0" }] },
      { id: "lucia", locale: "es-ES", models: [{ name: "simba-3.0" }] },
      { id: "bad_es", locale: "es-ES", models: [{ name: "simba-3.2" }] },
    ];
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(catalogue)));
    try {
      const voices = await listVoices({ apiBase: "http://x", apiKey: "k", model: "simba-3.2" });
      expect(voices.map((v) => v.id).sort()).toEqual(["harper_32", "lucia"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("synthesize", () => {
  it("sends the language when it has one and leaves the field out when not", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ audio_data: "", speech_marks: [] }));
    });
    try {
      const cfg = { apiBase: "http://x", apiKey: "k", voiceId: "lucia", model: "simba-3.0" };
      await synthesize("Hola.", { ...cfg, language: "es-ES" });
      await synthesize("Hola.", cfg);
      expect(bodies).toEqual([
        { input: "Hola.", voice_id: "lucia", model: "simba-3.0", language: "es-ES", audio_format: "mp3" },
        { input: "Hola.", voice_id: "lucia", model: "simba-3.0", audio_format: "mp3" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
