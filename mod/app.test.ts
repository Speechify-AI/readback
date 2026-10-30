import { describe, expect, it } from "vitest";
import { TtsError, type Voice } from "../src/speechifyShared.ts";
import {
  API_BASE,
  KEYS_URL,
  NO_KEY,
  REFUSED,
  apiKeyFrom,
  bandMode,
  chooseVoice,
  claimsFloor,
  errorText,
  homeFrom,
  isRefusal,
  keyCheckText,
  loopGuard,
  pickedVoice,
  platformFrom,
  readbackCommand,
  replyTurn,
  storedVoice,
  summaryFrom,
  tickWanted,
  timersWanted,
  ttsConfig,
  versionFrom,
} from "./app.ts";

const voice = (id: string, locale: string, cloned = false): Voice => ({
  id,
  name: id,
  locale,
  cloned,
  gender: "female",
  tags: [],
  preview: null,
  featured: false,
});
const VOICES = [voice("harper_32", "en-US"), voice("mine", "es-ES", true), voice("lucia_32", "es-ES")];

const LONG = "This reply is long enough to be read aloud, since it runs well past the eighty character floor.";

describe("setup", () => {
  it("the key is a non-empty string option, else none", () => {
    expect(apiKeyFrom({ speechify_api_key: "abc" })).toBe("abc");
    expect(apiKeyFrom({ speechify_api_key: " abc\n" })).toBe("abc");
    expect(apiKeyFrom({ speechify_api_key: "" })).toBeNull();
    expect(apiKeyFrom({ speechify_api_key: "   " })).toBeNull();
    expect(apiKeyFrom({})).toBeNull();
    expect(apiKeyFrom({ speechify_api_key: 5 })).toBeNull();
  });

  it("the loop guard holds in a -p run and under READBACK_HOOK", () => {
    expect(loopGuard(undefined, true)).toBe(false);
    expect(loopGuard("1", true)).toBe(true);
    expect(loopGuard(undefined, false)).toBe(true);
    expect(loopGuard("0", true)).toBe(false);
  });

  it("home falls back to USERPROFILE; Windows by OS", () => {
    expect(homeFrom("/Users/a", "C:\\Users\\a")).toBe("/Users/a");
    expect(homeFrom(undefined, "C:\\Users\\a")).toBe("C:\\Users\\a");
    expect(homeFrom(undefined, undefined)).toBe("");
    expect(platformFrom("Windows_NT")).toBe("win32");
    expect(platformFrom(undefined)).toBe("posix");
  });

  it("the plugin version, or unknown", () => {
    expect(versionFrom('{"version":"0.8.2"}')).toBe("0.8.2");
    expect(versionFrom("{}")).toBe("unknown");
    expect(versionFrom("not json")).toBe("unknown");
  });

  it("the no-key text names the keys URL and /plugin", () => {
    expect(NO_KEY).toContain(KEYS_URL);
    expect(NO_KEY).toContain("/plugin → readback → configure");
  });
});

describe("/readback", () => {
  it("no key: the setup text, whatever was asked", () => {
    expect(readbackCommand("", null, false)).toEqual({ kind: "text", text: NO_KEY });
    expect(readbackCommand("voice", null, false)).toEqual({ kind: "text", text: NO_KEY });
  });

  it("toggles on and off", () => {
    expect(readbackCommand("", "k", false)).toEqual({ kind: "on", key: "k" });
    expect(readbackCommand("  ", "k", true)).toEqual({ kind: "off" });
  });

  it("voice only while on", () => {
    expect(readbackCommand("voice", "k", true)).toEqual({ kind: "voice" });
    expect(readbackCommand(" Voice ", "k", true)).toEqual({ kind: "voice" });
    const off = readbackCommand("voice", "k", false);
    expect(off.kind).toBe("text");
  });

  it("anything else is the usage line", () => {
    const r = readbackCommand("loud", "k", true);
    expect(r.kind).toBe("text");
    expect(r.kind === "text" && r.text).toContain("/readback voice");
  });

  it("a refused key says where to change it; other failures say why", () => {
    expect(keyCheckText({ ok: false, kind: "refused", reason: "Speechify refused that key." })).toBe(REFUSED);
    expect(keyCheckText({ ok: false, kind: "invalid", reason: "That does not look like an API key." })).toBe(
      "That does not look like an API key. Change it in /plugin → readback → configure.",
    );
    expect(keyCheckText({ ok: false, kind: "unreachable", reason: "Could not reach Speechify to check that key. Try again." })).toBe(
      "Could not reach Speechify to check that key. Try again.",
    );
  });
});

describe("turns", () => {
  const e = { answer: LONG, turnId: "t1", isAborted: false, reason: "answer" };

  it("a main-loop answer becomes the latest turn", () => {
    expect(replyTurn(e)).toEqual({ id: "t1", summary: [], full: [LONG], condensing: false });
  });

  it("subagent, aborted, failed, refused, empty and short turns are ignored", () => {
    expect(replyTurn({ ...e, agentId: "a1" })).toBeNull();
    expect(replyTurn({ ...e, isAborted: true })).toBeNull();
    expect(replyTurn({ ...e, reason: "error" })).toBeNull();
    expect(replyTurn({ ...e, reason: "refusal" })).toBeNull();
    expect(replyTurn({ ...e, answer: "" })).toBeNull();
    expect(replyTurn({ ...e, answer: "Done." })).toBeNull();
  });

  it("a long reply is condensed; markdown is flattened", () => {
    const answer = `## Heading\n\n${LONG.repeat(7)}`;
    const t = replyTurn({ ...e, answer })!;
    expect(t.condensing).toBe(true);
    expect(t.full[0]).toBe("Heading.");
  });

  it("the summary's paragraphs, or null when there is none", () => {
    expect(summaryFrom("One.\n\nTwo **bold**.")).toEqual(["One.", "Two bold."]);
    expect(summaryFrom(null)).toBeNull();
    expect(summaryFrom("  ")).toBeNull();
  });
});

describe("voice", () => {
  it("with none picked, a stock voice in Claude's language", () => {
    expect(chooseVoice(VOICES, "Spanish")).toEqual({ id: "lucia_32", locale: "es-ES" });
  });

  it("else harper_32, with its locale when the catalogue has it", () => {
    expect(chooseVoice(VOICES, undefined)).toEqual({ id: "harper_32", locale: "en-US" });
    expect(chooseVoice(VOICES, "English")).toEqual({ id: "harper_32", locale: "en-US" });
    expect(chooseVoice(VOICES, "Klingon")).toEqual({ id: "harper_32", locale: "en-US" });
    expect(chooseVoice(null, "Spanish")).toEqual({ id: "harper_32", locale: "" });
  });

  it("a malformed stored voice is ignored", () => {
    expect(storedVoice({ id: 3 })).toBeNull();
    expect(storedVoice("harper_32")).toBeNull();
    expect(storedVoice({ id: "a", locale: "en-US" })).toEqual({ id: "a", locale: "en-US" });
  });

  it("a pick keeps the voice's locale", () => {
    expect(pickedVoice(VOICES, "lucia_32")).toEqual({ id: "lucia_32", locale: "es-ES" });
    expect(pickedVoice(VOICES, "gone")).toEqual({ id: "gone", locale: "" });
  });

  it("the render config follows the voice's locale", () => {
    expect(ttsConfig("k", { id: "harper_32", locale: "" })).toEqual({
      apiBase: API_BASE,
      apiKey: "k",
      voiceId: "harper_32",
      model: "simba-3.5",
      language: undefined,
    });
    expect(ttsConfig("k", { id: "lucia_32", locale: "es_ES" }).language).toBe("es-ES");
  });
});

describe("playback wiring", () => {
  it("pressing play takes the floor only when something will play", () => {
    expect(claimsFloor("idle", "toggle", true)).toBe(true);
    expect(claimsFloor("idle", "toggle", false)).toBe(false);
    expect(claimsFloor("paused", "toggle", true)).toBe(true);
    expect(claimsFloor("playing", "toggle", true)).toBe(false);
    expect(claimsFloor("waiting", "toggle", true)).toBe(false);
    expect(claimsFloor("loading", "toggle", true)).toBe(false);
    expect(claimsFloor("playing", "full", true)).toBe(true);
    expect(claimsFloor("idle", "full", false)).toBe(false);
  });

  it("the clocks run while something is pending or playing", () => {
    expect(timersWanted("playing")).toBe(true);
    expect(timersWanted("loading")).toBe(true);
    expect(timersWanted("waiting")).toBe(true);
    expect(timersWanted("paused")).toBe(false);
    expect(timersWanted("idle")).toBe(false);
  });

  it("the highlight tick runs only while playing, not while loading or condensing", () => {
    expect(tickWanted("playing")).toBe(true);
    expect(tickWanted("loading")).toBe(false);
    expect(tickWanted("waiting")).toBe(false);
    expect(tickWanted("paused")).toBe(false);
    expect(tickWanted("idle")).toBe(false);
  });

  it("401 and 403 are refusals", () => {
    expect(isRefusal(new TtsError(401, ""))).toBe(true);
    expect(isRefusal(new TtsError(403, ""))).toBe(true);
    expect(isRefusal(new TtsError(500, ""))).toBe(false);
    expect(isRefusal(new Error("x"))).toBe(false);
  });

  it("error wording", () => {
    expect(errorText(new TtsError(401, "no"))).toBe(REFUSED);
    expect(errorText(new TtsError(500, "boom"))).toBe("Readback could not render that: Speechify answered 500.");
    expect(errorText(new Error("no player"))).toBe("Readback could not play that: no player");
  });
});

describe("the band", () => {
  const base = { hasSurvey: false, enabled: true, notice: null, picking: false };

  it("yields to a survey, and passes while off", () => {
    expect(bandMode({ ...base, hasSurvey: true })).toBe("pass");
    expect(bandMode({ ...base, enabled: false })).toBe("pass");
  });

  it("the band, or the voice picker", () => {
    expect(bandMode(base)).toBe("band");
    expect(bandMode({ ...base, picking: true })).toBe("picker");
  });

  it("a refused key holds its notice while off", () => {
    expect(bandMode({ ...base, enabled: false, notice: REFUSED })).toBe("notice");
    expect(bandMode({ ...base, enabled: false, notice: REFUSED, hasSurvey: true })).toBe("pass");
  });
});
