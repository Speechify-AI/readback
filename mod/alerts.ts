/**
 * What the mod says on its own, besides replies: a permission prompt waiting
 * for the person. Pure: the wiring in `hooks/readback.ts` reads the engine's
 * events and renders the sentence like any paragraph, so each distinct one
 * is a cached render. Nothing here is the whole input: a prompt is answered
 * on screen, this only says it is waiting. Off with `/readback alerts off`.
 * Two more were tried and removed (2026-11-01, 2026-11-02): a minute's
 * silence after a reply, and a Bash call past half a minute; both spoke on
 * every turn of ordinary work.
 */
import { describeToolUse } from "../src/turns.ts";

export function permissionText(tool: string, input: unknown): string {
  return `Claude is waiting for your permission to ${describeToolUse({ name: tool, input })}.`;
}

/**
 * Which `tool.check` verdicts name a prompt that may wait: a real call (not
 * a plugin's query) of the main loop whose verdict is `ask`. Not a word yet:
 * in auto mode a classifier answers the ask and nobody waits, so the ask only
 * remembers the tool for the sentence. The word comes from the engine's
 * `Notification` of type `permission_prompt`, raised once the prompt has
 * waited about six seconds for a person (`promptWaiting`), as the extension
 * hears it too.
 */
export function permissionWorthSaying(e: { tool_use_id?: string; agentId?: string }, decision: string): boolean {
  return e.tool_use_id !== undefined && e.agentId === undefined && decision === "ask";
}

/** The main loop's permission prompt has waited long enough that a person is being asked. */
export function promptWaiting(e: { notification_type: string; agent_id?: string }): boolean {
  return e.notification_type === "permission_prompt" && e.agent_id === undefined;
}
