import { describe, expect, it } from "vitest";
import { band, noticeBand, voicePicker, type BandActions, type Els } from "./band.ts";
import type { View } from "./player.ts";

type El = { type: string; props: Record<string, any> };
const mk = (type: string) => (props: object): El => ({ type, props: props as Record<string, any> });
const els: Els = { Box: mk("Box"), Text: mk("Text"), Button: mk("Button"), Select: mk("Select") };
const actions: BandActions = { toggle() {}, stop() {}, full() {} };

const idle: View = { state: "idle", kind: null, paragraph: 0, paragraphs: 0, positionMs: 0, durationMs: 0, sentence: null };
const view = (v: Partial<View>): View => ({ ...idle, ...v });

const kids = (e: El): El[] => [e.props.children].flat() as El[];
const buttons = (e: El) => kids(e)[0]!.props.children.filter((c: El) => c.type === "Button") as El[];
const row1 = (e: El) => kids(e)[0]!;
const txt = (e: El): string => (typeof e === "string" ? e : [e.props.children].flat().map((c) => (typeof c === "string" ? c : txt(c))).join(""));

const playing = view({ state: "playing", kind: "summary", paragraph: 1, paragraphs: 3, positionMs: 12000, durationMs: 48000 });

describe("band", () => {
  it("idle band arms 1 and 3", () => {
    const b = band(idle, els, actions) as El;
    expect(buttons(b).map((x) => [x.props.label, x.props.hotkey])).toEqual([
      ["Play", "1"],
      ["Full reply", "3"],
    ]);
    // Ctrl+X Tab lands the ring on Play, so Enter plays.
    expect(buttons(b)[0]!.props.autoFocus).toBe(true);
    expect(txt(row1(b).props.children.at(-1))).toBe("");
  });

  it("playing band arms 1, 2 and 3", () => {
    const b = band(playing, els, actions) as El;
    expect(buttons(b).map((x) => [x.props.key, x.props.label, x.props.hotkey])).toEqual([
      ["play", "Pause", "1"],
      ["stop", "Stop", "2"],
      ["full", "Full reply", "3"],
    ]);
    expect(txt(row1(b).props.children.at(-1))).toBe("summary · 1/3 · 0:12 / 0:48");
  });

  it("waiting band arms 1 so the wait can be cancelled", () => {
    const b = band(view({ state: "waiting" }), els, actions) as El;
    const [play] = buttons(b);
    expect(play!.props.label).toBe("Cancel");
    expect(play!.props.hotkey).toBe("1");
    expect(txt(row1(b).props.children.at(-1))).toBe("condensing…");
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
  it("lists voices as given, preselects current, has Cancel", () => {
    let picked = "";
    const p = voicePicker([{ id: "a", name: "Ann" }, { id: "b", name: "Bo" }], "b", els, (id) => (picked = id), () => {}) as El;
    const [sel, cancel] = kids(p);
    expect(sel!.props.options).toEqual([{ value: "a", label: "Ann" }, { value: "b", label: "Bo" }]);
    expect(sel!.props.value).toBe("b");
    expect(cancel!.props.label).toBe("Cancel");
    sel!.props.onSelect("a");
    expect(picked).toBe("a");
  });
});
