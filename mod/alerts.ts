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
 * Which `tool.call`s a waiting prompt may be about: a real call (not a
 * plugin's query) of the main loop. `tool.call` wraps the permission check,
 * the prompt and the run, so a call is remembered from its start to its end
 * and nothing is said yet. The word comes from the engine's `Notification`
 * of type `permission_prompt`, raised once a prompt has waited about six
 * seconds for a person (`promptWaiting`), as the extension hears it too.
 *
 * Until 2026-11-09 the mod read the verdict at `tool.check` and remembered
 * only an `ask`; the plugin directory blocks a `tool.check` hook unless it
 * plainly returns `next(e)` or a fixed verdict, so it reads no verdict now.
 */
export function mainLoopCall(e: { tool_use_id?: string; agentId?: string }): boolean {
  return e.tool_use_id !== undefined && e.agentId === undefined;
}

export type PendingCall = { tool: string; input: unknown; said: boolean };

/**
 * The call a waiting prompt is about, among the calls still running in
 * order of start: the latest not yet said whose tool the notification's
 * message names ("Claude needs your permission to use Bash"), else the
 * latest not yet said. A call allowed without asking is in the list too,
 * so with two of the same tool in flight the latest is a guess.
 */
export function waitingCall<K>(calls: readonly (readonly [K, PendingCall])[], message: string): readonly [K, PendingCall] | undefined {
  const open = calls.filter(([, p]) => !p.said);
  return open.filter(([, p]) => message.includes(p.tool)).pop() ?? open.at(-1);
}

/** The main loop's permission prompt has waited long enough that a person is being asked. */
export function promptWaiting(e: { notification_type: string; agent_id?: string }): boolean {
  return e.notification_type === "permission_prompt" && e.agent_id === undefined;
}
