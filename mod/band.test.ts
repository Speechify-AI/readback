import { describe, expect, it } from "vitest";
import type { Voice } from "../src/speechifyShared.ts";
import { band, noticeBand, voicePicker, type BandActions, type Els } from "./band.ts";
import type { View } from "./player.ts";

type El = { type: string; props: Record<string, any> };
const mk = (type: string) => (props: object): El => ({ type, props: props as Record<string, any> });
const els: Els = { Box: mk("Box"), Text: mk("Text"), Button: mk("Button"), Select: mk("Select"), Input: mk("Input") };
const actions: BandActions = { toggle() {}, stop() {}, full() {}, speed() {} };
const none = { pick() {}, search() {}, cancel() {} };
const v = (id: string, name: string, locale = "en-US", featured = false): Voice => ({
  id, name, locale, cloned: false, gender: "female", tags: [], preview: null, featured,
});

const idle: View = { state: "idle", kind: null, paragraph: 0, paragraphs: 0, positionMs: 0, durationMs: 0, sentence: null };
const view = (v: Partial<View>): View => ({ ...idle, ...v });

const kids = (e: El): El[] => [e.props.children].flat() as El[];
const buttons = (e: El) => kids(e)[0]!.props.children.filter((c: El) => c.type === "Button") as El[];
const row1 = (e: El) => kids(e)[0]!;
const txt = (e: El): string => (typeof e === "string" ? e : [e.props.children].flat().map((c) => (typeof c === "string" ? c : txt(c))).join(""));

const playing = view({ state: "playing", kind: "summary", paragraph: 1, paragraphs: 3, positionMs: 12000, durationMs: 48000 });

describe("band", () => {
  it("the picker on a surface with no Select says so and offers Cancel", () => {
    const { Select: _unused, ...noSelect } = els;
    const p = voicePicker([v("a", "A")], "a", "", noSelect, none) as El;
    const [note, cancel] = kids(p);
    expect(note!.type).toBe("Text");
    expect(txt(note!)).toBe("This surface has no list to pick from.");
    expect(cancel!.props.label).toBe("Cancel");
  });

  it("idle band arms 1 and 3", () => {
    const b = band(idle, els, actions) as El;
    expect(buttons(b).map((x) => [x.props.label, x.props.hotkey])).toEqual([
      ["Play", "1"],
      ["Full reply", "3"],
      ["1×", undefined],
    ]);
    // Ctrl+X Tab lands the ring on Play, so Enter plays.
    expect(buttons(b)[0]!.props.autoFocus).toBe(true);
    // No meta at all: nothing to time yet.
    expect(row1(b).props.children.at(-1).type).toBe("Button");
  });

  it("playing band arms 1, 2 and 3", () => {
    const b = band(playing, els, actions) as El;
    expect(buttons(b).map((x) => [x.props.key, x.props.label, x.props.hotkey])).toEqual([
      ["play", "Pause", "1"],
      ["stop", "Stop", "2"],
      ["full", "Full reply", "3"],
      ["speed", "1×", undefined],
    ]);
    expect(txt(row1(b).props.children.at(-1))).toBe("summary · 1/3 · 0:12 / 0:48");
  });

  it("waiting band arms 1 so the wait can be cancelled", () => {
    const b = band(view({ state: "waiting" }), els, actions) as El;
    const [play] = buttons(b);
    expect(play!.props.label).toBe("Cancel");
    expect(play!.props.hotkey).toBe("1");
    const last = row1(b).props.children.at(-1);
    expect(last.props.color).toBe("#d77757");
    expect(txt(last)).toBe("⠋ condensing");
    expect(kids(b)).toHaveLength(1);
  });

  it("loading band spins where the clock goes", () => {
    const b = band(view({ state: "loading", kind: "summary", paragraph: 1, paragraphs: 2 }), els, actions, 2) as El;
    const [info, spin] = row1(b).props.children.slice(-2);
    expect(txt(info)).toBe("summary · 1/2");
    expect(spin.props.color).toBe("#d77757");
    expect(txt(spin)).toBe("⠹");
    expect(kids(b)).toHaveLength(1);
    expect(txt(row1(band(view({ state: "loading" }), els, actions, 12) as El).props.children.at(-1))).toBe("⠹");
  });

  it("loading band labels 1 \"Cancel\" with the hotkey armed", () => {
    const b = band(view({ state: "loading", kind: "summary", paragraph: 1, paragraphs: 2 }), els, actions) as El;
    const [play] = buttons(b);
    expect(play!.props.label).toBe("Cancel");
    expect(play!.props.hotkey).toBe("1");
  });

  it("the sentence row dims all but the word", () => {
    const b = band(view({ ...playing, sentence: { before: "Hello ", word: "big", after: " world." } }), els, actions) as El;
    const row = kids(b)[1]!;
    const parts = row.props.children as El[];
    expect(parts.map((p) => [p.props.children, p.props.dimColor ?? false, p.props.inverse ?? false])).toEqual([
      ["Hello ", true, false],
      ["big", false, true],
      [" world.", true, false],
    ]);
  });

  it("top padding is one row", () => {
    expect((band(idle, els, actions) as El).props.paddingTop).toBe(1);
  });

  it("the speed button shows the rate and steps it on press", () => {
    let pressed = 0;
    const b = band(idle, els, { ...actions, speed: () => pressed++ }, 0, 1.5) as El;
    const speed = buttons(b).find((x) => x.props.key === "speed")!;
    expect(speed.props.label).toBe("1.5×");
    expect(speed.props.hotkey).toBeUndefined();
    speed.props.onPress();
    expect(pressed).toBe(1);
  });

  it("a floor hint is dim text after the controls, and absent without one", () => {
    const b = band(idle, els, actions, 0, 1, "waiting for another session to finish") as El;
    const texts = row1(b).props.children.filter((c: El) => c.type === "Text" && c.props.dimColor) as El[];
    expect(texts.map(txt)).toEqual(["waiting for another session to finish"]);
    const plain = band(idle, els, actions) as El;
    expect(row1(plain).props.children.filter((c: El) => c.type === "Text" && c.props.dimColor)).toEqual([]);
  });

  it("no stop button when nothing is loaded", () => {
    const b = band(idle, els, actions) as El;
    expect(buttons(b).some((x) => x.props.key === "stop")).toBe(false);
  });
});

describe("noticeBand", () => {
  it("is the notice alone, red, under the top padding", () => {
    const b = noticeBand("Key refused", els) as El;
    expect(b.props.paddingTop).toBe(1);
    expect(kids(b)).toHaveLength(1);
    expect(kids(b)[0]!.props).toMatchObject({ color: "#d75f5f", children: "Key refused" });
  });
});

describe("voicePicker", () => {
  it("a search field, the voices with their locale, current preselected, Cancel", () => {
    let picked = "";
    let searched = "";
    const p = voicePicker([v("a", "Ann"), v("b", "Bo", "en-GB")], "b", "", els, { ...none, pick: (id) => (picked = id), search: (q) => (searched = q) }) as El;
    const [input, sel, cancel] = kids(p);
    expect(input!.type).toBe("Input");
    expect(input!.props.value).toBe("");
    expect(sel!.props.options).toEqual([{ value: "a", label: "Ann · en-US" }, { value: "b", label: "Bo · en-GB" }]);
    expect(sel!.props.value).toBe("b");
    expect(cancel!.props.label).toBe("Cancel");
    sel!.props.onSelect("a");
    expect(picked).toBe("a");
    input!.props.onInput("bo");
    expect(searched).toBe("bo");
  });

  it("the query narrows the list and the first match is selected when the current voice is out", () => {
    const p = voicePicker([v("a", "Ann"), v("b", "Bo", "en-GB")], "a", "gb", els, none) as El;
    const [, sel] = kids(p);
    expect(sel!.props.options.map((o: { value: string }) => o.value)).toEqual(["b"]);
    expect(sel!.props.value).toBe("b");
  });

  it("never hands the Select more than 64 options, and says how many are hidden", () => {
    const many = Array.from({ length: 150 }, (_, i) => v(`v${i}`, `Voice ${String(i).padStart(3, "0")}`));
    const p = voicePicker(many, "v0", "", els, none) as El;
    const [, sel, note, cancel] = kids(p);
    expect(sel!.props.options).toHaveLength(64);
    expect(txt(note!)).toBe("The first 64 of 150; type to narrow.");
    expect(cancel!.props.label).toBe("Cancel");
  });

  it("featured voices lead the list", () => {
    const p = voicePicker([v("zed", "Zed"), v("amy_32", "Amy", "en-US", true)], "zed", "", els, none) as El;
    expect(kids(p)[1]!.props.options.map((o: { value: string }) => o.value)).toEqual(["amy_32", "zed"]);
  });

  it("no match says so instead of an empty Select, which the band refuses", () => {
    const p = voicePicker([v("a", "Ann")], "a", "zzz", els, none) as El;
    const [, note, cancel] = kids(p);
    expect(note!.type).toBe("Text");
    expect(txt(note!)).toBe("No voice matches.");
    expect(cancel!.props.label).toBe("Cancel");
  });
});
