import type { Voice } from "../src/speechifyShared.ts";
import { SELECT_MAX, filterVoices, speedLabel } from "./app.ts";
import type { View } from "./player.ts";

export type Els = {
  Box: (p: object) => unknown;
  Text: (p: object) => unknown;
  Button: (p: object) => unknown;
  Select?: (p: object) => unknown;
  Input?: (p: object) => unknown;
};

/** `speed` cycles the rate; the band shows the current one on the button. */
export type BandActions = { toggle(): void; stop(): void; full(): void; speed(): void };

const REFUSED = "#d75f5f";
const BUSY = "#d77757";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function meta(view: View): string {
  // Idle there is no clock to show; busy, the spinner stands in for it.
  if (view.state === "idle" || view.state === "waiting") return "";
  const parts: string[] = [view.kind ?? ""];
  if (view.paragraphs > 1) parts.push(`${view.paragraph}/${view.paragraphs}`);
  if (view.state !== "loading") parts.push(`${clock(view.positionMs)} / ${clock(view.durationMs)}`);
  return parts.filter(Boolean).join(" · ");
}

/**
 * `frame` turns the spinner; the caller advances it on its clock. `speed` is
 * shown on its button. `hint` is why the session is silent for the floor
 * (`floorHint`), dim after the controls.
 */
export function band(view: View, els: Els, actions: BandActions, frame = 0, speed = 1, hint: string | null = null): unknown {
  const { Box, Text, Button } = els;
  const loaded = view.state !== "idle";
  // The label says what a press does: waiting or loading, it cancels.
  const label =
    view.state === "waiting" || view.state === "loading"
      ? "Cancel"
      : view.state === "playing"
        ? "Pause"
        : view.state === "paused"
          ? "Resume"
          : "Play";
  // 1 and 3 are always armed, 2 while something is loaded, by the person's
  // choice: a bare digit in an empty prompt goes to the band, not to Claude.
  const controls: unknown[] = [
    Text({ bold: true, children: "Readback" }),
    Button({ key: "play", label, plain: true, autoFocus: true, hotkey: "1", onPress: () => actions.toggle() }),
  ];
  if (loaded) controls.push(Button({ key: "stop", label: "Stop", plain: true, hotkey: "2", onPress: () => actions.stop() }));
  controls.push(Button({ key: "full", label: "Full reply", plain: true, hotkey: "3", onPress: () => actions.full() }));
  // No hotkey: only 1, 2 and 3 are the person's digits. A press steps to the next rate.
  controls.push(Button({ key: "speed", label: speedLabel(speed), plain: true, onPress: () => actions.speed() }));
  const info = meta(view);
  if (info) controls.push(Text({ dimColor: true, children: info }));
  // Where the clock goes: the spinner while the voice renders, and with
  // "condensing" while the reply is condensed.
  const spin = SPINNER[frame % SPINNER.length];
  if (view.state === "loading") controls.push(Text({ color: BUSY, children: spin }));
  if (view.state === "waiting") controls.push(Text({ color: BUSY, children: `${spin} condensing` }));
  if (hint) controls.push(Text({ dimColor: true, children: hint }));

  const rows: unknown[] = [Box({ flexDirection: "row", gap: 1, children: controls })];
  if (view.sentence) {
    const s = view.sentence;
    rows.push(
      Text({
        children: [
          Text({ dimColor: true, children: s.before }),
          Text({ inverse: true, children: s.word }),
          Text({ dimColor: true, children: s.after }),
        ],
      }),
    );
  }
  return Box({ flexDirection: "column", paddingTop: 1, children: rows });
}

/** Readback off with a refused key: the notice and nothing to press. The only place a notice is drawn. */
export function noticeBand(notice: string, els: Els): unknown {
  const { Box, Text } = els;
  return Box({ flexDirection: "column", paddingTop: 1, children: [Text({ color: REFUSED, children: notice })] });
}

export type PickerActions = { pick(id: string): void; search(query: string): void; cancel(): void };

/**
 * The voice picker: a search field, then the matches in a Select, which
 * the band caps at SELECT_MAX options; past that a line says how many are
 * hidden and the search narrows them. The catalogue runs to hundreds.
 */
export function voicePicker(voices: readonly Voice[], current: string, query: string, els: Els, actions: PickerActions): unknown {
  const { Box, Text, Button, Select, Input } = els;
  const children: unknown[] = [];
  if (!Select) {
    // The command already said "pick a voice above the prompt"; say why nothing is here.
    children.push(Text({ dimColor: true, children: "This surface has no list to pick from." }));
  } else {
    const matches = filterVoices(voices, query);
    const shown = matches.slice(0, SELECT_MAX);
    if (Input) {
      children.push(
        Input({
          key: "voiceSearch",
          placeholder: "Type to narrow: a name, language or tag",
          value: query,
          autoFocus: true,
          onInput: actions.search,
          onSubmit: actions.search,
        }),
      );
    }
    if (shown.length === 0) {
      children.push(Text({ dimColor: true, children: "No voice matches." }));
    } else {
      children.push(
        Select({
          key: "voice",
          options: shown.map((v) => ({ value: v.id, label: `${v.name} · ${v.locale}` })),
          value: shown.some((v) => v.id === current) ? current : shown[0]!.id,
          onSelect: actions.pick,
        }),
      );
      if (matches.length > shown.length) {
        children.push(Text({ dimColor: true, children: `The first ${shown.length} of ${matches.length}; type to narrow.` }));
      }
    }
  }
  children.push(Button({ key: "cancel", label: "Cancel", plain: true, onPress: actions.cancel }));
  return Box({ flexDirection: "column", paddingTop: 1, children });
}
