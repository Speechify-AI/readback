/**
 * Text in, paragraphs out. Copied from Soundbites, Speechify's internal
 * notebook, and trimmed to what a player needs.
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

  // HTML comments are for the machine (the spoken note among them), never
  // shown and never spoken.
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Fenced code: one short spoken note, however long the block was.
  text = text.replace(/^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]*(?:```|~~~)[ \t]*$/gm, "\nCode omitted.\n");
  // An unterminated fence runs to the end of the text.
  text = text.replace(/^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*$/m, "\nCode omitted.\n");

  // Tables: a short one is read row by row as header and value pairs, a long
  // one becomes a note. Done before inline marks so the pipes are still there
  // to recognise.
  text = text.replace(/(?:^[ \t]*\|.*\|[ \t]*$\n?){2,}/gm, (block) => `\n${spokenTable(block)}\n`);

  // Images before links: the alt text alone is rarely a sentence.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Reference-style and bare autolinks.
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  text = text.replace(/<(https?:\/\/[^>]+)>/g, "a link");

  // Inline code keeps its contents, loses its backticks.
  text = text.replace(/`{1,3}([^`\n]+)`{1,3}/g, "$1");

  text = speakable(text);

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

/** The most body rows a table is read out with; a longer one is a note. */
export const TABLE_MAX_ROWS = 4;

const SEPARATOR_ROW = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function tableCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * A pipe table as speech: each body row one line of "header: value" pairs,
 * so a short table (a few options, a few numbers) is heard whole. A table
 * past TABLE_MAX_ROWS rows, or one with no separator row, is a note that
 * says so instead.
 */
export function spokenTable(block: string): string {
  const rows = block.split("\n").filter((line) => line.trim() !== "");
  const [head, separator, ...body] = rows;
  if (head === undefined || separator === undefined || !SEPARATOR_ROW.test(separator)) return "A table, not read out.";
  if (body.length > TABLE_MAX_ROWS) return `A table of ${body.length} rows, not read out.`;
  const headers = tableCells(head);
  return body
    .map((row) => {
      const cells = tableCells(row);
      const pairs = headers
        .map((header, i) => (cells[i] ? (header ? `${header}: ${cells[i]}` : cells[i]) : ""))
        .filter((pair) => pair !== "");
      return pairs.length > 0 ? `${pairs.join(", ")}.` : "";
    })
    .filter((line) => line !== "")
    .join("\n");
}

const OPERATORS: Record<string, string> = {
  ">=": "greater than or equal to",
  "<=": "less than or equal to",
  "!==": "is not",
  "!=": "is not",
  "===": "equals",
  "==": "equals",
  "=>": "to",
  "->": "to",
  "&&": "and",
  "||": "or",
};

/**
 * Developer text as a voice should say it. Only what a voice gets wrong or
 * spells out at length is changed: a bare URL, a file and line reference, a
 * commit hash, a version, a home path, an operator between words. Paths are
 * left as they are: the voice reads "src/app.ts" well enough. Shown and
 * spoken alike, like everything here.
 */
export function speakable(text: string): string {
  return (
    text
      // A bare URL is noise read out; that there is one is what matters.
      .replace(/\bhttps?:\/\/[^\s<>()"']+/g, "a link")
      // file.ts:42 and file.ts:42:7 → "file.ts, line 42".
      .replace(/(?<![@\w])([^\s@]+\.[A-Za-z][A-Za-z0-9]{0,5}):(\d+)(?::\d+)?\b/g, "$1, line $2")
      // A commit hash, short or full: its first four characters name it. A
      // run of digits alone (a number) or letters alone (a word) is neither.
      .replace(/(?<![\w-])(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])([0-9a-f]{4})[0-9a-f]{3,36}(?![\w-])/g, "commit $1")
      // v1.2.3 → "version 1.2.3".
      .replace(/\bv(\d+\.\d+(?:\.\d+)*)\b/g, "version $1")
      // A home path.
      .replace(/(^|[\s(])~\//gm, "$1home/")
      // An operator between words, as words.
      .replace(/ (>=|<=|!==|!=|===|==|=>|->|&&|\|\|) /g, (_, op: string) => ` ${OPERATORS[op]} `)
  );
}

/** Cut at a sentence end if there is one nearby, otherwise at a word. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const window = text.slice(0, limit);
  const sentence = lastBoundary(window, /[.!?]["')\]]?\s/g);
  const cut = sentence >= limit * 0.5 ? sentence : (lastBoundary(window, /\s/g) || limit);
  return `${text.slice(0, cut).trim()} and more.`;
}

/** "14:32", as the catch-up lead and the condensing run's headers say it. */
export function clock(at: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(at);
}

/**
 * The spoken lead-in on a turn: the project it came from, or the extension's
 * name when there is none. Its own paragraph so the player can show it as a
 * heading and you can skip it in one step.
 *
 * No time in it. Until 0.6.0 the lead was "14:32, readback.", a new string
 * every minute and so a fresh render (1.3 to 1.8 s in the log) before the
 * first word of every turn. A lead that is the same for every turn of a
 * project renders once and plays from the cache in a few milliseconds; the
 * time is shown in the turn's header instead, where nobody has to hear it.
 * No "in" either: the voice may not speak English, and a bare name reads in
 * any language.
 */
export function entryLead(project: string | null): string {
  return project ? `${project}.` : "Readback.";
}
