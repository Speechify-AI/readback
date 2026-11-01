/**
 * What the mod says on its own, besides replies: a permission prompt waiting
 * for the person, a command that ran long, a minute's silence after a reply.
 * Pure: the wiring in `hooks/readback.ts` reads the engine's events and
 * renders the sentence like any paragraph, so each distinct one is a cached
 * render. Nothing here is the whole input: a prompt is answered on screen,
 * this only says it is waiting. Off with `/readback alerts off`.
 */
import { describeToolUse } from "../src/turns.ts";

/** A tool call that ran at least this long is announced when it ends. */
export const LONG_TOOL_MS = 30_000;

export function permissionText(tool: string, input: unknown): string {
  return `Claude is waiting for your permission to ${describeToolUse({ name: tool, input })}.`;
}

/** Rounded to tens of seconds, then minutes, so the sentences it makes are few and their renders cached. */
export function longToolText(ms: number): string {
  const seconds = Math.max(10, Math.round(ms / 10_000) * 10);
  const took = seconds < 120 ? `${seconds} seconds` : `${Math.round(seconds / 60)} minutes`;
  return `A command finished after about ${took}.`;
}

/**
 * Which `tool.check` verdicts are worth a word: a real call (not a plugin's
 * query) of the main loop that the engine will put to the person.
 */
export function permissionWorthSaying(e: { tool_use_id?: string; agentId?: string }, decision: string): boolean {
  return e.tool_use_id !== undefined && e.agentId === undefined && decision === "ask";
}

/**
 * Which finished tool calls are worth a word: the main loop's Bash, long,
 * and not one whose time was spent waiting on a permission prompt (`asked`).
 */
export function longToolWorthSaying(e: { tool: string; agentId?: string }, ms: number, asked: boolean): boolean {
  return e.agentId === undefined && e.tool === "Bash" && !asked && ms >= LONG_TOOL_MS;
}
