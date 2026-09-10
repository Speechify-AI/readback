/**
 * Text in, paragraphs out. Copied from tools/soundbites (repo rule: copy,
 * never import across project folders) and trimmed to what a player needs.
 *
 * `plainify` turns an agent's markdown into something worth listening to.
 * The flattened text is what is sent to the API and what the player shows,
 * so the character offsets on the speech marks index the same string the
 * reader displays. Anything that renders the shown text differently from
 * the sent text breaks the highlight, which is why markdown is flattened on
 * the way in rather than rendered on the way out.
 */

/** One synthesis call takes at most 2,000 characters on /v1/audio/speech. */
export const PARAGRAPH_LIMIT = 2000;

/** Split on blank lines. Single newlines inside a paragraph are kept. */
export function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/[ \t]+$/gm, "").trim())
    .filter((p) => p !== "");
}

export interface Range {
  start: number;
  end: number;
}

/**
 * Split a paragraph too long for one synthesis call into character ranges
 * that are not, preferring sentence boundaries, then words, then a hard cut
 * for a single token longer than the limit.
 *
 * Ranges rather than strings, because the speech marks that come back carry
 * offsets into the exact string sent. Sending `text.slice(start, end)` means
 * a mark's offset plus `start` is its offset in the whole paragraph. The
 * ranges tile the paragraph end to end and never overlap.
 */
export function chunkRanges(text: string, limit = PARAGRAPH_LIMIT): Range[] {
  if (text.length <= limit) return text === "" ? [] : [{ start: 0, end: text.length }];
  const ranges: Range[] = [];
  let start = 0;
  while (text.length - start > limit) {
    const window = text.slice(start, start + limit + 1);
    let cut = lastBoundary(window, /[.!?]["')\]]?\s/g);
    if (cut <= 0) cut = lastBoundary(window, /\s/g);
    if (cut <= 0) cut = limit;
    ranges.push({ start, end: start + cut });
    start += cut;
  }
  if (start < text.length) ranges.push({ start, end: text.length });
  return ranges;
}

/** Index just past the last match of `pattern` in `window`, or -1. */
function lastBoundary(window: string, pattern: RegExp): number {
  let cut = -1;
  for (const match of window.matchAll(pattern)) cut = match.index + match[0].length;
  return cut;
}

/** Longest reply read in one go before "and more". Overridable in settings. */
export const REPLY_LIMIT = 4000;

/**
 * Markdown → speakable plain text.
 *
 * Code, tables and link targets are noise when read aloud, so they go. What
 * is left is what the player shows and what the API is sent, so what you
 * read is exactly what you hear.
 */
export function plainify(markdown: string, limit = REPLY_LIMIT): string {
  let text = markdown.replace(/\r\n?/g, "\n");

  // Fenced code: one short spoken note, however long the block was.
  text = text.replace(/^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]*(?:```|~~~)[ \t]*$/gm, "\nCode omitted.\n");
  // An unterminated fence runs to the end of the text.
  text = text.replace(/^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*$/m, "\nCode omitted.\n");

  // Tables: any run of pipe rows becomes a note. Done before inline marks so
  // the pipes are still there to recognise.
  text = text.replace(/(?:^[ \t]*\|.*\|[ \t]*$\n?){2,}/gm, "\nA table, not read out.\n");

  // Images before links: the alt text alone is rarely a sentence.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Reference-style and bare autolinks.
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  text = text.replace(/<(https?:\/\/[^>]+)>/g, "a link");

  // Inline code keeps its contents, loses its backticks.
  text = text.replace(/`{1,3}([^`\n]+)`{1,3}/g, "$1");

  // Headings become their own short paragraph, so they land as a spoken beat.
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, "$1.");
  // Setext underlines.
  text = text.replace(/^[ \t]*[=-]{3,}[ \t]*$/gm, "");

  // Emphasis and strikethrough markers.
  text = text.replace(/(\*\*\*|___)(\S(?:[\s\S]*?\S)?)\1/g, "$2");
  text = text.replace(/(\*\*|__)(\S(?:[\s\S]*?\S)?)\1/g, "$2");
  text = text.replace(/(?<!\w)([*_])(\S(?:[\s\S]*?\S)?)\1(?!\w)/g, "$2");
  text = text.replace(/~~([\s\S]+?)~~/g, "$1");

  // List and quote markers. The item text stays, the bullet goes.
  text = text.replace(/^[ \t]*>[ \t]?/gm, "");
  text = text.replace(/^[ \t]*[-*+][ \t]+(?=\S)/gm, "");
  text = text.replace(/^[ \t]*\d+[.)][ \t]+(?=\S)/gm, "");
  // Horizontal rules.
  text = text.replace(/^[ \t]*(?:\*[ \t]*){3,}$|^[ \t]*(?:-[ \t]*){3,}$/gm, "");

  // Checkbox items read as their state.
  text = text.replace(/^\[[ xX]\][ \t]+/gm, "");

  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return truncate(text, limit);
}

/** Cut at a sentence end if there is one nearby, otherwise at a word. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const window = text.slice(0, limit);
  const sentence = lastBoundary(window, /[.!?]["')\]]?\s/g);
  const cut = sentence >= limit * 0.5 ? sentence : (lastBoundary(window, /\s/g) || limit);
  return `${text.slice(0, cut).trim()} and more.`;
}

/**
 * The spoken lead-in on a turn: when it finished and which project it came
 * from. Its own paragraph so the player can show it as a heading and you can
 * skip it in one step.
 */
export function entryLead(at: Date, project: string | null, timeZone?: string): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(at);
  return project ? `${time}, in ${project}.` : `${time}.`;
}
