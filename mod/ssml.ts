/**
 * Speed for the mod. `$.audio.play` has no rate control, so the rate goes
 * to Speechify as SSML prosody around each chunk.
 *
 * Measured 2026-10-31 on a cached render (RUNBOOK): with SSML input the
 * speech marks index the plain text with the tags stripped, not the input
 * as sent; a mark sometimes starts on the space before its word. So the
 * marks are taken as offsets into the bare chunk, clamped to it, and the
 * markup is never subtracted. Whether an escaped `&` counts as one
 * character (the text node, decoded) or five (`&amp;`) is untested; the
 * decoded reading is the natural one for an XML parser and is assumed.
 * `scripts/probe-ssml.mjs` prints what the API does with a key.
 *
 * At speed 1 nothing is wrapped: the request and the cache key are the
 * same as before speed existed.
 */
import type { Mark } from "../src/marks.ts";

/** `rate` as SSML spells a relative change: 1.25 → "+25%", 0.75 → "-25%". */
export function rateAttr(speed: number): string {
  const pct = Math.round((speed - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

const markupLength = (speed: number): number => `<speak><prosody rate="${rateAttr(speed)}"></prosody></speak>`.length;

/** The SSML document for one chunk: the text escaped where XML needs it, inside prosody. */
export function wrapProsody(text: string, speed: number): string {
  let body = "";
  for (const c of text) body += ESCAPES[c] ?? c;
  return `<speak><prosody rate="${rateAttr(speed)}">${body}</prosody></speak>`;
}

/**
 * The most characters of `text` one chunk may hold so that, wrapped and
 * escaped, it stays within `cap`: the markup and every escape the whole
 * paragraph will need are taken off the top, so no chunk can exceed the
 * cap whichever characters fall in it. Never under 100.
 */
export function wrappedLimit(text: string, speed: number, cap: number): number {
  let extra = 0;
  for (const c of text) extra += (ESCAPES[c]?.length ?? 1) - 1;
  return Math.max(100, cap - markupLength(speed) - extra);
}

/** Marks as the API returned them for SSML input, clamped to the bare chunk; an empty one is dropped. */
export function unwrapMarks(marks: readonly Mark[], textLength: number): Mark[] {
  const out: Mark[] = [];
  for (const m of marks) {
    const start = Math.min(Math.max(0, m.start), textLength);
    const end = Math.min(Math.max(0, m.end), textLength);
    if (end > start) out.push({ ...m, start, end });
  }
  return out;
}
