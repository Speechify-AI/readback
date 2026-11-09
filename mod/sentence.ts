/**
 * The band's sentence row: the sentence being read, split around the word
 * being spoken. Only whitespace is dropped, so what is shown is still what
 * is spoken: the sentence is trimmed at both ends, runs of whitespace
 * collapse to one space, and the lit word is trimmed too, because
 * `fillGaps` can stretch a mark back over the gap before it. The space the
 * word gives up stays in `before` / `after`, so the three parts joined are
 * the sentence as shown.
 */
import type { Mark } from "../src/marks.ts";

export interface Segments {
  before: string;
  word: string;
  after: string;
}

const collapse = (s: string): string => s.replace(/\s+/g, " ");

export function sentenceSegments(
  text: string,
  sentence: { start: number; end: number },
  mark: Mark | null,
): Segments {
  const s = text.slice(sentence.start, sentence.end);
  let from = mark ? Math.max(0, mark.start - sentence.start) : s.length;
  let to = mark ? Math.min(s.length, mark.end - sentence.start) : s.length;
  while (from < to && /\s/.test(s[from]!)) from++;
  while (to > from && /\s/.test(s[to - 1]!)) to--;
  // No mark inside this sentence: the whole sentence, nothing lit.
  if (from >= to) return { before: collapse(s).trim(), word: "", after: "" };
  return {
    before: collapse(s.slice(0, from)).trimStart(),
    word: collapse(s.slice(from, to)),
    after: collapse(s.slice(to)).trimEnd(),
  };
}
