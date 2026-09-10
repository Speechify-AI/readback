/**
 * A turn is one thing to read: an agent reply, or a selection someone asked
 * for. Plain text, split into paragraphs, with a spoken lead-in first.
 *
 * A turn can grow. The notes Claude writes between tool calls arrive while
 * the turn is still going and are appended as they come; the finished reply
 * lands last. A condensed reply carries both versions in the same paragraph
 * list: the condensed sentences, then the full reply from `fullFrom` on. One
 * index space keeps the player simple; autoplay stops at `fullFrom`, and the
 * full reply plays only when asked for.
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

/**
 * Shortest note between tool calls worth reading. "Done." is noise; "I'll
 * check the settings file first." is not. Lower than `minChars`, which
 * sizes the finished reply.
 */
export const PROGRESS_MIN_CHARS = 20;

/** The Stop payload, typed only as far as we read it. */
export interface StopPayload {
  hook_event_name?: unknown;
  last_assistant_message?: unknown;
  cwd?: unknown;
}

export function isStopPayload(value: unknown): value is StopPayload {
  return typeof value === "object" && value !== null;
}

export type MessageDecision =
  | { kind: "message"; markdown: string; cwd: string | null; project: string | null }
  | { kind: "skip"; reason: "not-a-stop" | "no-message" | "too-short" | "empty" };

export type Message = Extract<MessageDecision, { kind: "message" }>;

/** Is this Stop payload worth reading, and what is in it. */
export function messageFromStop(payload: StopPayload, limits: TurnLimits): MessageDecision {
  if (payload.hook_event_name !== undefined && payload.hook_event_name !== "Stop") {
    return { kind: "skip", reason: "not-a-stop" };
  }
  const markdown = payload.last_assistant_message;
  if (typeof markdown !== "string") return { kind: "skip", reason: "no-message" };
  return decideMessage(markdown, typeof payload.cwd === "string" ? payload.cwd : null, limits);
}

/** Is this text worth reading once flattened, and which project it came from. */
export function decideMessage(markdown: string, cwd: string | null, limits: TurnLimits): MessageDecision {
  const plain = plainify(markdown, limits.maxChars);
  if (plain === "") return { kind: "skip", reason: "empty" };
  if (plain.length < limits.minChars) return { kind: "skip", reason: "too-short" };
  const project = cwd ? cwd.split("/").filter(Boolean).pop() ?? null : null;
  return { kind: "message", markdown, cwd, project };
}

export interface ReplyInput {
  markdown: string;
  /** The condensed version, when one was made. */
  summary?: string | null;
  limits: TurnLimits;
}

/** The spoken paragraphs of a reply: the condensed ones, and the full ones. */
export function replyParagraphs(input: ReplyInput): { summary: string[]; full: string[] } {
  return {
    summary: input.summary ? toParagraphs(plainify(input.summary, input.limits.maxChars)) : [],
    full: toParagraphs(plainify(input.markdown, input.limits.maxChars)),
  };
}

export interface TurnInput extends ReplyInput {
  project: string | null;
  at?: Date;
}

export function makeTurn(input: TurnInput): Turn | null {
  const at = input.at ?? new Date();
  const { summary, full } = replyParagraphs(input);
  if (full.length === 0) return null;
  const lead = entryLead(at, input.project);
  return {
    id: randomUUID(),
    at: at.toISOString(),
    project: input.project,
    paragraphs: [lead, ...summary, ...full],
    fullFrom: summary.length > 0 ? 1 + summary.length : null,
  };
}
