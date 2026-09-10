/** Messages between the extension host and the sidebar webview. */
import type { Mark } from "./marks.ts";
import type { Turn } from "./turns.ts";

export type HostMessage =
  | { kind: "state"; keyOk: boolean; voice: string; speed: number; autoplay: boolean; hookInstalled: boolean }
  | { kind: "turn"; turn: Turn; autoplay: boolean }
  | { kind: "audio"; turnId: string; index: number; audio: string; marks: Mark[]; durationMs: number }
  | { kind: "error"; turnId: string; index: number; message: string }
  | { kind: "status"; text: string }
  | { kind: "stop" };

export type WebCommand = "setApiKey" | "chooseVoice" | "installHook";

export type WebMessage =
  | { kind: "ready" }
  | { kind: "need"; turnId: string; index: number }
  | { kind: "speed"; rate: number }
  | { kind: "autoplay"; on: boolean }
  | { kind: "command"; name: WebCommand };

const WEB_COMMANDS: readonly WebCommand[] = ["setApiKey", "chooseVoice", "installHook"];

export function isWebMessage(value: unknown): value is WebMessage {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  switch (value.kind) {
    case "ready":
      return true;
    case "need":
      return "turnId" in value && typeof value.turnId === "string" && "index" in value && typeof value.index === "number";
    case "speed":
      return "rate" in value && typeof value.rate === "number";
    case "autoplay":
      return "on" in value && typeof value.on === "boolean";
    case "command":
      return "name" in value && typeof value.name === "string" && WEB_COMMANDS.some((c) => c === value.name);
    default:
      return false;
  }
}
