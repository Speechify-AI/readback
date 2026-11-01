import { describe, expect, it } from "vitest";
import { TtsError, type Voice } from "../src/speechifyShared.ts";
import {
  API_BASE,
  KEYS_URL,
  NO_KEY,
  OFF,
  OFF_HINT,
  ON,
  ON_NO_BAND,
  onText,
  playbackText,
  YIELDED,
  speedSetText,
  statusText,
  voiceSetText,
  REFUSED,
  apiKeyFrom,
  autoText,
  bandMode,
  chooseVoice,
  claimsFloor,
  clocksWanted,
  filterVoices,
  nextRate,
  speedText,
  storedSpeed,
  errorText,
  hasBand,
  fallbackVoice,
  homeFrom,
  isRefusal,
  keyCheckText,
  pickedVoice,
  platformFrom,
  readbackCommand,
  replyTurn,
  startPlan,
  startsOnAttach,
  storedAuto,
  storedVoice,
  summaryFrom,
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

  it("starts at the prompt, waits under the SDK, stays off in the condensing child", () => {
    expect(startPlan(undefined, true)).toBe("start");
    expect(startPlan("0", true)).toBe("start");
    expect(startPlan("1", true)).toBe("off");
    expect(startPlan("1", false)).toBe("off");
    expect(startPlan(undefined, false)).toBe("wait");
  });

  it("a surfaceless session starts itself once on and autoplay are both stored", () => {
    expect(startPlan(undefined, false, true)).toBe("start");
    expect(startPlan(undefined, false, false)).toBe("wait");
    expect(startPlan("1", false, true)).toBe("off");
  });

  it("a waiting session starts when the desktop app attaches, not a phone", () => {
    expect(startsOnAttach("desktop")).toBe(true);
    expect(startsOnAttach("mobile")).toBe(false);
    expect(startsOnAttach("vscode")).toBe(false);
    expect(startsOnAttach("terminal")).toBe(false);
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
    expect(readbackCommand("", "k", false)).toEqual({ kind: "status" });
    expect(readbackCommand("  ", "k", true)).toEqual({ kind: "status" });
  });

  it("voice only while on", () => {
    expect(readbackCommand("voice", "k", true)).toEqual({ kind: "voice", query: "" });
    expect(readbackCommand(" Voice ", "k", true)).toEqual({ kind: "voice", query: "" });
    expect(readbackCommand("voice Harper en-US", "k", true)).toEqual({ kind: "voice", query: "harper en-us" });
    const off = readbackCommand("voice", "k", false);
    expect(off.kind).toBe("text");
  });

  it("anything else is the usage line", () => {
    const r = readbackCommand("loud", "k", true);
    expect(r.kind).toBe("text");
    expect(r.kind === "text" && r.text).toContain("/readback voice");
    expect(r.kind === "text" && r.text).toContain("/readback speed");
  });

  it("speed takes one of the offered rates, with or without an x", () => {
    expect(readbackCommand("speed 1.25", "k", true)).toEqual({ kind: "speed", rate: 1.25 });
    expect(readbackCommand("Speed 2x", "k", false)).toEqual({ kind: "speed", rate: 2 });
    expect(readbackCommand("speed 1", "k", true)).toEqual({ kind: "speed", rate: 1 });
  });

  it("speed alone or with a rate not offered says the current speed and the choices", () => {
    expect(readbackCommand("speed", "k", true, 1.5)).toEqual({ kind: "text", text: speedText(1.5) });
    expect(readbackCommand("speed 3", "k", true)).toEqual({ kind: "text", text: speedText(1) });
    expect(speedText(1.5)).toBe("Speed is 1.5×. /readback speed 1.5 sets it; 0.75, 1, 1.25, 1.5, 1.75, 2 are offered.");
    expect(readbackCommand("speed 2", null, true)).toEqual({ kind: "text", text: NO_KEY });
  });

  it("on and off are explicit, whatever the state", () => {
    expect(readbackCommand("on", "k", false)).toEqual({ kind: "on", key: "k" });
    expect(readbackCommand("on", "k", true)).toEqual({ kind: "on", key: "k" });
    expect(readbackCommand("off", "k", true)).toEqual({ kind: "off" });
    expect(readbackCommand("off", "k", false)).toEqual({ kind: "text", text: OFF });
    expect(readbackCommand("on", null, false)).toEqual({ kind: "text", text: NO_KEY });
  });

  it("play, pause, resume, stop and full are the band's buttons as words, on only", () => {
    expect(readbackCommand("play", "k", true)).toEqual({ kind: "toggle" });
    expect(readbackCommand("Pause", "k", true)).toEqual({ kind: "toggle" });
    expect(readbackCommand("resume", "k", true)).toEqual({ kind: "toggle" });
    expect(readbackCommand("stop", "k", true)).toEqual({ kind: "stop" });
    expect(readbackCommand("full", "k", true)).toEqual({ kind: "full" });
    expect(readbackCommand("play", "k", false)).toEqual({ kind: "text", text: OFF_HINT });
    expect(readbackCommand("play", null, false)).toEqual({ kind: "text", text: NO_KEY });
  });

  it("the on text names the keys where a band draws, the words elsewhere", () => {
    expect(hasBand(["terminal"])).toBe(true);
    expect(hasBand(["desktop", "mobile"])).toBe(true);
    expect(hasBand([])).toBe(false);
    expect(hasBand(["mobile"])).toBe(false);
    expect(onText(true)).toBe(ON);
    expect(onText(false)).toBe(ON_NO_BAND);
    expect(speedSetText(2, true)).toBe("Speed is 2×. Press 1 to hear it.");
    expect(speedSetText(1.25, false)).toBe("Speed is 1.25×. Type /readback play to hear it.");
  });

  it("a playback word answers with what the player is doing", () => {
    expect(playbackText("idle", false)).toMatch(/Nothing to play/);
    expect(playbackText("idle", false, true)).toBe(YIELDED);
    expect(playbackText("playing", true, true)).toBe("Playing.");
    expect(playbackText("playing", true)).toBe("Playing.");
    expect(playbackText("loading", true)).toBe("Loading.");
    expect(playbackText("waiting", true)).toBe("Loading.");
    expect(playbackText("paused", true)).toBe("Paused.");
    expect(playbackText("idle", true)).toBe("Stopped.");
  });

  it("the stored speed is one offered, else 1; the button cycles through them", () => {
    expect(storedSpeed(1.5)).toBe(1.5);
    expect(storedSpeed(3)).toBe(1);
    expect(storedSpeed("1.5")).toBe(1);
    expect(storedSpeed(undefined)).toBe(1);
    expect(nextRate(1)).toBe(1.25);
    expect(nextRate(2)).toBe(0.75);
  });

  it("filterVoices matches every word across name, id, locale and tags, featured first", () => {
    const list = [
      { ...voice("zed_32", "en-US"), featured: true },
      voice("ana", "es-ES"),
      { ...voice("bob", "en-GB"), tags: ["Use-Case:Narrator"] },
      voice("carl", "en-US"),
    ];
    expect(filterVoices(list, "").map((v) => v.id)).toEqual(["zed_32", "ana", "bob", "carl"]);
    expect(filterVoices(list, "en").map((v) => v.id)).toEqual(["zed_32", "bob", "carl"]);
    expect(filterVoices(list, "narrator").map((v) => v.id)).toEqual(["bob"]);
    expect(filterVoices(list, "en-us").map((v) => v.id)).toEqual(["zed_32", "carl"]);
    expect(filterVoices(list, "en narr").map((v) => v.id)).toEqual(["bob"]);
    expect(filterVoices(list, "nobody")).toEqual([]);
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

  it("the fallback is kept once the catalogue loads, and asked again after a failure", async () => {
    let fail = true;
    let fetches = 0;
    const voice = fallbackVoice(
      async () => "Spanish",
      async () => {
        fetches++;
        if (fail) throw new Error("offline");
        return VOICES;
      },
    );
    expect(await voice()).toEqual({ id: "harper_32", locale: "" });
    fail = false;
    expect(await voice()).toEqual({ id: "lucia_32", locale: "es-ES" });
    expect(await voice()).toEqual({ id: "lucia_32", locale: "es-ES" });
    expect(fetches).toBe(2);
  });

  it("a settings read that fails counts as no language", async () => {
    const voice = fallbackVoice(
      () => Promise.reject(new Error("no settings")),
      async () => VOICES,
    );
    expect(await voice()).toEqual({ id: "harper_32", locale: "en-US" });
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
    expect(claimsFloor("paused", "toggle", true, true)).toBe(false);
    expect(claimsFloor("playing", "toggle", true)).toBe(false);
    expect(claimsFloor("waiting", "toggle", true)).toBe(false);
    expect(claimsFloor("loading", "toggle", true)).toBe(false);
    expect(claimsFloor("playing", "full", true)).toBe(true);
    expect(claimsFloor("idle", "full", false)).toBe(false);
  });

  it("the clocks run while something is pending or playing", () => {
    expect(clocksWanted("playing")).toBe(true);
    expect(clocksWanted("loading")).toBe(true);
    expect(clocksWanted("waiting")).toBe(true);
    expect(clocksWanted("paused")).toBe(false);
    expect(clocksWanted("idle")).toBe(false);
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

  it("a voice named by word is the first match, and says how many others matched", () => {
    const voices = [
      { id: "harper_32", name: "Harper", locale: "en-US", tags: [], models: ["simba-3.5"], gender: "female", previewAudio: null },
      { id: "aitana", name: "Aitana", locale: "es-MX", tags: ["Language:Spanish"], models: ["simba-3.0"], gender: "female", previewAudio: null },
      { id: "pablo", name: "Pablo", locale: "es-ES", tags: ["Language:Spanish"], models: ["simba-3.0"], gender: "male", previewAudio: null },
    ] as unknown as Parameters<typeof voiceSetText>[0];
    expect(voiceSetText(voices, "harper")).toMatchObject({ voice: { id: "harper_32" }, text: "Voice: Harper (harper_32, en-US)." });
    expect(voiceSetText(voices, "spanish").text).toMatch(/1 other matched/);
    expect(voiceSetText(voices, "klingon")).toEqual({ voice: null, text: 'No voice matches "klingon".' });
  });

  it("bare /readback is a status line", () => {
    expect(statusText(false, { id: "harper_32", locale: "en-US" }, 1, "idle", false)).toBe(OFF_HINT);
    expect(statusText(true, { id: "harper_32", locale: "en-US" }, 1, "idle", false)).toBe(
      "Readback is on. Voice harper_32 (en-US), speed 1×, autoplay off, nothing loaded.",
    );
    expect(statusText(true, { id: "aitana", locale: "" }, 1.5, "playing", true)).toBe("Readback is on. Voice aitana, speed 1.5×, autoplay off, playing.");
    expect(statusText(true, { id: "aitana", locale: "es-MX" }, 2, "paused", true, true)).toMatch(/autoplay on, paused\.$/);
  });

  it("autoplay is a stored flag, off unless true, set by word", () => {
    expect(storedAuto(undefined)).toBe(false);
    expect(storedAuto("true")).toBe(false);
    expect(storedAuto(true)).toBe(true);
    expect(readbackCommand("auto on", "k", true)).toEqual({ kind: "auto", on: true });
    expect(readbackCommand("auto off", "k", true)).toEqual({ kind: "auto", on: false });
    expect(readbackCommand("auto", "k", true)).toEqual({ kind: "auto", on: null });
    expect(readbackCommand("auto yes", "k", true)).toEqual({ kind: "auto", on: null });
    expect(autoText(true)).toMatch(/^Autoplay is on/);
    expect(autoText(false)).toMatch(/^Autoplay is off/);
  });
});
