import { describe, expect, it } from "vitest";
import { claudeLanguage, defaultVoice, languageCode } from "./claudeLanguage.ts";
import { toVoice } from "./speechify.ts";

describe("languageCode", () => {
  it("reads names in English or in the language, and locale codes", () => {
    expect(languageCode("spanish")).toBe("es");
    expect(languageCode("Español")).toBe("es");
    expect(languageCode("Brazilian Portuguese")).toBe("pt");
    expect(languageCode("français")).toBe("fr");
    expect(languageCode("de-DE")).toBe("de");
    expect(languageCode("pt_BR")).toBe("pt");
    expect(languageCode("English")).toBe("en");
  });

  it("is null for a language no voice here speaks", () => {
    expect(languageCode("japanese")).toBeNull();
    expect(languageCode("ja")).toBeNull();
    expect(languageCode("")).toBeNull();
  });
});

describe("claudeLanguage", () => {
  it("takes the last file that sets it and skips the rest", () => {
    expect(claudeLanguage([`{"language":"spanish"}`, null, `{"model":"opus"}`, "not json"])).toBe("spanish");
    expect(claudeLanguage([`{"language":"spanish"}`, `{"language":"german"}`])).toBe("german");
    expect(claudeLanguage([`{"language":3}`, null])).toBeNull();
  });
});

describe("defaultVoice", () => {
  it("picks the first stock voice in the language, never a clone", () => {
    const voices = [
      toVoice({ id: "mine", type: "personal", locale: "es-ES" })!,
      toVoice({ id: "harper_32", locale: "en-US" })!,
      toVoice({ id: "aitana", locale: "es-MX" })!,
      toVoice({ id: "lucia", locale: "es-ES" })!,
    ];
    expect(defaultVoice(voices, "es")?.id).toBe("aitana");
    expect(defaultVoice(voices, "fr")).toBeUndefined();
  });
});
