import * as vscode from "vscode";
import type { TurnLimits } from "./turns.ts";

export type Summarize = "claude" | "off";

export interface Settings extends TurnLimits {
  summarize: Summarize;
  autoplay: boolean;
  voice: string;
  model: string;
  speed: number;
  apiBase: string;
}

export function readSettings(): Settings {
  const cfg = vscode.workspace.getConfiguration("readback");
  return {
    voice: cfg.get<string>("voice", "harper_32"),
    model: cfg.get<string>("model", "simba-3.2"),
    speed: cfg.get<number>("speed", 1),
    apiBase: cfg.get<string>("apiBase", "https://api.speechify.ai").replace(/\/+$/, ""),
    summarize: cfg.get<string>("summarize", "claude") === "off" ? "off" : "claude",
    autoplay: cfg.get<boolean>("autoplay", true),
    minChars: cfg.get<number>("minChars", 80),
    maxChars: cfg.get<number>("maxChars", 4000),
  };
}

export async function writeSetting(key: "voice" | "speed" | "autoplay", value: string | number | boolean): Promise<void> {
  await vscode.workspace.getConfiguration("readback").update(key, value, vscode.ConfigurationTarget.Global);
}

export const SECRET_KEY = "readback.speechifyApiKey";
