/**
 * A turn is one thing to read: the final text of an agent reply, or a
 * selection someone asked for. Plain text, split into paragraphs, with a
 * spoken lead-in first.
 *
 * A condensed turn carries both versions in one paragraph list: the lead,
 * the condensed sentences, then the full reply from `fullFrom` on. One
 * index space keeps the player simple; autoplay stops at `fullFrom`, and
 * the full reply plays only when asked for.
 */
import { randomUUID } from "node:crypto";
import { entryLead, plainify, toParagraphs } from "./text.ts";

export interface Turn {
  id: string;
  at: string;
  /** Spoken as "in <project>": the folder Claude Code ran in, or a file name. */
  project: string | null;
  /** Plain-text paragraphs. The first is the lead-in. */
  paragraphs: [string, ...string[]];
  /** Where the verbatim reply starts when a condensed version precedes it. */
  fullFrom: number | null;
}

export interface TurnLimits {
  minChars: number;
  maxChars: number;
}

/** The Stop payload, typed only as far as we read it. */
export interface StopPayload {
  hook_event_name?: unknown;
  last_assistant_message?: unknown;
  cwd?: unknown;
}

export function isStopPayload(value: unknown): value is StopPayload {
  return typeof value === "object" && value !== null;
}

export type StopDecision =
  | { kind: "message"; markdown: string; cwd: string | null; project: string | null }
  | { kind: "skip"; reason: "not-a-stop" | "no-message" | "too-short" | "empty" };

/** Is this Stop payload worth reading, and what is in it. */
export function messageFromStop(payload: StopPayload, limits: TurnLimits): StopDecision {
  if (payload.hook_event_name !== undefined && payload.hook_event_name !== "Stop") {
    return { kind: "skip", reason: "not-a-stop" };
  }
  const markdown = payload.last_assistant_message;
  if (typeof markdown !== "string") return { kind: "skip", reason: "no-message" };
  const plain = plainify(markdown, limits.maxChars);
  if (plain === "") return { kind: "skip", reason: "empty" };
  if (plain.length < limits.minChars) return { kind: "skip", reason: "too-short" };
  const cwd = typeof payload.cwd === "string" ? payload.cwd : null;
  const project = cwd ? cwd.split("/").filter(Boolean).pop() ?? null : null;
  return { kind: "message", markdown, cwd, project };
}

export interface TurnInput {
  markdown: string;
  /** The condensed version, when one was made. */
  summary?: string | null;
  project: string | null;
  limits: TurnLimits;
  at?: Date;
}

export function makeTurn(input: TurnInput): Turn | null {
  const at = input.at ?? new Date();
  const full = toParagraphs(plainify(input.markdown, input.limits.maxChars));
  if (full.length === 0) return null;
  const summary = input.summary ? toParagraphs(plainify(input.summary, input.limits.maxChars)) : [];
  const lead = entryLead(at, input.project);
  return {
    id: randomUUID(),
    at: at.toISOString(),
    project: input.project,
    paragraphs: summary.length > 0 ? [lead, ...summary, ...full] : [lead, ...full],
    fullFrom: summary.length > 0 ? 1 + summary.length : null,
  };
}
