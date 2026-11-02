/**
 * The Node-free half of `live.ts`: what the mod imports too.
 */

/**
 * Since Claude Code 2.1.310 (seen 2026-10-24) a harness instruction asks
 * Claude to "first privately list what you need next" before a batch of
 * tool calls, and Claude answers it as an assistant message. It reaches
 * MessageDisplay like any note and is about tool calls, not the work, so
 * it is not read. Two shapes have been heard: one opening "Private list —
 * ...: (1) ...; (2) ...", one that is the enumeration alone, "(A) ...; (B)
 * ...; (C) .... Three calls, issued together." The opener is matched on the
 * first line; the enumeration needs two parenthesised markers and either
 * opens the message or is paired with a word about batching the calls.
 */
const PLANNING_OPENER = /^\s*private list\b/i;
const ENUMERATOR = /\((?:\d{1,2}|[a-z])\)/gi;
const OPENS_WITH_ENUMERATOR = /^\s*\((?:\d{1,2}|[a-z])\)/i;
const BATCHING = /\b(?:together|in parallel|at once|in (?:this |one )?(?:response|go|batch)|independent(?:ly)?)\b/i;

/** A completed message that is Claude's list of what to fetch next, not a note for the person. */
export function isPlanningNote(markdown: string): boolean {
  if (PLANNING_OPENER.test(markdown)) return true;
  const enumerators = markdown.match(ENUMERATOR)?.length ?? 0;
  if (enumerators < 2) return false;
  return OPENS_WITH_ENUMERATOR.test(markdown) || BATCHING.test(markdown);
}
