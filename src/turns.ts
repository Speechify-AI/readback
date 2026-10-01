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
 *
 * A catch-up is a turn about other turns: the replies that landed while
 * nobody was listening, condensed into one briefing. It has no full section;
 * the replies it covers are still listed on their own.
 */
import { randomUUID } from "node:crypto";
import { clock, entryLead, plainify, toParagraphs } from "./text.ts";

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

/**
 * Shortest finished reply worth condensing. Condensed, a 300-character
 * reply came back at 253 to 292 characters and a 2,234-character one at 386
 * to 456. A reply already that size is read as it stands, with no run and
 * no wait.
 */
export const CONDENSE_MIN_CHARS = 500;

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
  const project = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() ?? null : null;
  return { kind: "message", markdown, cwd, project };
}

/** Is the reply long enough, once flattened, for condensing to shorten it. */
export function worthCondensing(markdown: string, limits: TurnLimits): boolean {
  return plainify(markdown, limits.maxChars).length >= CONDENSE_MIN_CHARS;
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

/** How many replies one catch-up reads at most. Older unheard ones are counted in the lead, not read. */
export const CATCH_UP_MAX = 20;

/** The spoken part of a listed turn: everything after the lead, up to the full reply when there is one. */
function spokenParagraphs(turn: Turn): string[] {
  return turn.paragraphs.slice(1, turn.fullFrom ?? undefined);
}

/**
 * The replies a catch-up covers, as text for the condensing run: oldest
 * first, each headed by its time and project so the briefing can group by
 * project. The full reply is used where there is one; a turn that never got
 * one (a selection, or a reply already read as a note) contributes what it
 * has.
 */
export function catchUpText(covered: readonly Turn[], timeZone?: string): string {
  return covered
    .map((turn, i) => {
      const where = turn.project ? `, in ${turn.project}` : "";
      const body = turn.fullFrom === null ? spokenParagraphs(turn) : turn.paragraphs.slice(turn.fullFrom);
      return `Reply ${i + 1} of ${covered.length}, ${clock(new Date(turn.at), timeZone)}${where}:\n${body.join("\n\n")}`;
    })
    .join("\n\n");
}

export interface CatchUpInput {
  /** Oldest first. */
  covered: readonly Turn[];
  /** Unheard replies older than `covered`, mentioned in the lead only. */
  earlier: number;
  /** The briefing, or null when no condensing run was possible. */
  summary: string | null;
  limits: TurnLimits;
  at?: Date;
  timeZone?: string;
}

/**
 * One turn that briefs the covered replies. With a summary, that is the
 * briefing; without one, each covered reply's own spoken paragraphs follow
 * its lead, so a catch-up without `claude` still catches up.
 */
export function catchUpTurn(input: CatchUpInput): Turn | null {
  const { covered, earlier } = input;
  const first = covered[0];
  if (!first) return null;
  const at = input.at ?? new Date();
  const count = covered.length + earlier;
  const lead =
    `${entryLead(at, null, input.timeZone)} Catching up on ${count} ${count === 1 ? "reply" : "replies"} since ` +
    `${clock(new Date(first.at), input.timeZone)}${earlier > 0 ? `, the last ${covered.length} in detail` : ""}.`;
  const body = input.summary
    ? toParagraphs(plainify(input.summary, input.limits.maxChars))
    : covered.flatMap((turn) => [turn.paragraphs[0], ...spokenParagraphs(turn)]);
  if (body.length === 0) return null;
  return {
    id: randomUUID(),
    at: at.toISOString(),
    project: null,
    paragraphs: [lead, ...body],
    fullFrom: null,
  };
}
