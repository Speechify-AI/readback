import { describe, expect, it } from "vitest";
import { normalizeVoicePage, sortVoices, toVoice } from "./speechify.ts";

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
