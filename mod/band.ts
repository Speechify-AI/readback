import type { View } from "./player.ts";

export type Els = {
  Box: (p: object) => unknown;
  Text: (p: object) => unknown;
  Button: (p: object) => unknown;
  Select?: (p: object) => unknown;
};

export type BandActions = { toggle(): void; stop(): void; full(): void };

const REFUSED = "#d75f5f";
const BUSY = "#d77757";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function meta(view: View): string {
  // Idle there is no clock to show; waiting, the busy row says it all.
  if (view.state === "idle" || view.state === "waiting") return "";
  const parts: string[] = [view.kind ?? ""];
  if (view.paragraphs > 1) parts.push(`${view.paragraph}/${view.paragraphs}`);
  // Loading, the clock would read 0:00 / 0:00; the busy row stands in.
  if (view.state !== "loading") parts.push(`${clock(view.positionMs)} / ${clock(view.durationMs)}`);
  return parts.filter(Boolean).join(" · ");
}

/** What the busy row says while nothing sounds yet, or null when not busy. */
function busy(view: View): string | null {
  if (view.state === "waiting") return "Condensing the reply…";
  if (view.state === "loading") return "Getting the voice from Speechify…";
  return null;
}

/** `frame` turns the spinner; the caller advances it on its clock. */
export function band(view: View, els: Els, actions: BandActions, frame = 0): unknown {
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
  // 1, 2 and 3 are always armed, by the person's choice: a bare digit in an
  // empty prompt goes to the band, not to Claude.
  const controls: unknown[] = [
    Text({ bold: true, children: "Readback" }),
    Button({ key: "play", label, plain: true, autoFocus: true, hotkey: "1", onPress: () => actions.toggle() }),
  ];
  if (loaded) controls.push(Button({ key: "stop", label: "Stop", plain: true, hotkey: "2", onPress: () => actions.stop() }));
  controls.push(Button({ key: "full", label: "Full reply", plain: true, hotkey: "3", onPress: () => actions.full() }));
  controls.push(Text({ dimColor: true, children: meta(view) }));

  const rows: unknown[] = [Box({ flexDirection: "row", gap: 1, children: controls })];
  const wait = busy(view);
  if (wait) {
    rows.push(
      Text({
        color: BUSY,
        children: [Text({ bold: true, children: SPINNER[frame % SPINNER.length] }), ` ${wait}`],
      }),
    );
  } else if (view.sentence) {
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

export function voicePicker(
  voices: { id: string; name: string }[],
  current: string,
  els: Els,
  pick: (id: string) => void,
  cancel: () => void,
): unknown {
  const { Box, Button, Select } = els;
  const children: unknown[] = [];
  if (Select) {
    children.push(
      Select({
        key: "voice",
        options: voices.map((v) => ({ value: v.id, label: v.name })),
        value: current,
        onSelect: pick,
      }),
    );
  }
  children.push(Button({ key: "cancel", label: "Cancel", plain: true, onPress: cancel }));
  return Box({ flexDirection: "column", paddingTop: 1, children });
}
