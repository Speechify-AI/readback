/**
 * Speed for the mod. `$.audio.play` has no rate control, so the rate goes
 * to Speechify as SSML prosody around each chunk. Speech marks index the
 * `input` exactly as sent (the API's rule, see marks.ts), so they come back
 * pointing into the markup and are mapped onto the bare text here: what is
 * shown is still what is spoken, and the markup is never highlighted.
 *
 * At speed 1 nothing is wrapped: the request and the cache key are the
 * same as before speed existed.
 */
import type { Mark } from "../src/marks.ts";

export type Wrapped = {
  /** The SSML document to send. */
  input: string;
  /** A mark start in `input` → its start in the text. */
  start(i: number): number;
  /** A mark end (exclusive) in `input` → its end in the text. */
  end(e: number): number;
};

/** `rate` as SSML spells a relative change: 1.25 → "+25%", 0.75 → "-25%". */
export function rateAttr(speed: number): string {
  const pct = Math.round((speed - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

const markupLength = (speed: number): number => `<speak><prosody rate="${rateAttr(speed)}"></prosody></speak>`.length;

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

export function wrapProsody(text: string, speed: number): Wrapped {
  const prefix = `<speak><prosody rate="${rateAttr(speed)}">`;
  const suffix = "</prosody></speak>";
  // origin[k]: the index in `text` of the character that produced body char k.
  const origin: number[] = [];
  let body = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const out = ESCAPES[c] ?? c;
    for (let k = 0; k < out.length; k++) origin.push(i);
    body += out;
  }
  const at = (k: number): number | null => (k < 0 ? null : k >= origin.length ? null : origin[k]!);
  return {
    input: prefix + body + suffix,
    start: (i) => {
      const k = i - prefix.length;
      if (k < 0) return 0;
      return at(k) ?? text.length;
    },
    end: (e) => {
      const k = e - 1 - prefix.length;
      if (k < 0) return 0;
      const o = at(k);
      return o === null ? text.length : o + 1;
    },
  };
}

/** Marks over the SSML input, mapped onto the text. A mark that falls entirely on markup is dropped. */
export function unwrapMarks(marks: readonly Mark[], w: Wrapped): Mark[] {
  const out: Mark[] = [];
  for (const m of marks) {
    const start = w.start(m.start);
    const end = w.end(m.end);
    if (end > start) out.push({ ...m, start, end });
  }
  return out;
}
