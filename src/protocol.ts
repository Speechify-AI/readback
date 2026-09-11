/** Messages between the extension host and the sidebar webview. */
import type { Mark } from "./marks.ts";
import type { Voice } from "./speechify.ts";
import type { Turn } from "./turns.ts";

export type HostMessage =
  | { kind: "state"; keyOk: boolean; voice: string; speed: number; autoplay: boolean; hookInstalled: boolean }
  | { kind: "turn"; turn: Turn; autoplay: boolean }
  /** More paragraphs for a listed turn, starting at index `from`. `fullFrom` is the turn's new value. */
  | { kind: "append"; turnId: string; from: number; paragraphs: string[]; fullFrom: number | null; autoplay: boolean }
  | { kind: "audio"; turnId: string; index: number; audio: string; marks: Mark[]; durationMs: number }
  | { kind: "error"; turnId: string; index: number; message: string }
  | { kind: "status"; text: string }
  | { kind: "stop" }
  /** Empty the list; the host has already forgotten the turns. */
  | { kind: "clear" }
  /** Open the voice picker. */
  | { kind: "showVoices" }
  /** The catalogue for the current model, or why it could not be fetched. */
  | { kind: "voices"; voices: Voice[]; error: string | null }
  /** A voice sample: the catalogue's preview or a synthesized line, or why neither came. */
  | { kind: "sample"; voiceId: string; audio: string | null; error: string | null };

export type WebCommand = "setApiKey" | "installHook";

export type WebMessage =
  | { kind: "ready" }
  | { kind: "need"; turnId: string; index: number }
  | { kind: "speed"; rate: number }
  | { kind: "autoplay"; on: boolean }
  | { kind: "note"; text: string }
  | { kind: "command"; name: WebCommand }
  /** Forget every listed turn. */
  | { kind: "clear" }
  /** Send the voice catalogue. */
  | { kind: "voices" }
  | { kind: "sample"; voiceId: string }
  | { kind: "voice"; id: string };

const WEB_COMMANDS: readonly WebCommand[] = ["setApiKey", "installHook"];

export function isWebMessage(value: unknown): value is WebMessage {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  switch (value.kind) {
    case "ready":
    case "clear":
    case "voices":
      return true;
    case "need":
      return "turnId" in value && typeof value.turnId === "string" && "index" in value && typeof value.index === "number";
    case "speed":
      return "rate" in value && typeof value.rate === "number";
    case "autoplay":
      return "on" in value && typeof value.on === "boolean";
    case "note":
      return "text" in value && typeof value.text === "string";
    case "command":
      return "name" in value && typeof value.name === "string" && WEB_COMMANDS.some((c) => c === value.name);
    case "sample":
      return "voiceId" in value && typeof value.voiceId === "string";
    case "voice":
      return "id" in value && typeof value.id === "string";
    default:
      return false;
  }
}
