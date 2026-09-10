/**
 * Paragraph plus speech marks → highlightable DOM. Copied from
 * tools/soundbites/public/reader.js and trimmed.
 *
 * Marks carry character offsets into the exact string that was sent, and
 * after the host's fillGaps pass they tile the paragraph with only
 * whitespace between them. So the paragraph is rebuilt as sentence spans
 * holding word spans, and highlighting is toggling two classes.
 */

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "st", "sr", "jr", "vs", "etc", "eg", "ie",
  "no", "fig", "al", "inc", "ltd", "co", "approx", "dept", "est", "min", "max",
]);

export function sentenceRanges(text) {
  const ranges = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    let j = i;
    while (j + 1 < text.length && ".!?".includes(text[j + 1])) j++;
    while (j + 1 < text.length && "\"')]}”’".includes(text[j + 1])) j++;
    const after = text.slice(j + 1);
    if (after !== "" && !/^\s/.test(after)) { i = j; continue; }
    if (ch === ".") {
      const before = text.slice(start, i);
      const word = /([A-Za-z.]+)$/.exec(before)?.[1] ?? "";
      const bare = word.replace(/\./g, "").toLowerCase();
      if (ABBREVIATIONS.has(bare) || bare.length === 1) { i = j; continue; }
      if (/\d$/.test(before) && /^\d/.test(after.trimStart())) { i = j; continue; }
    }
    const end = j + 1;
    if (text.slice(start, end).trim() !== "") ranges.push({ start, end });
    start = end;
    i = j;
  }
  if (text.slice(start).trim() !== "") ranges.push({ start, end: text.length });
  return ranges;
}

/** The mark playing at `ms`, by index, or -1. Marks are sorted and disjoint. */
export function markIndexAtTime(marks, ms) {
  if (!marks || marks.length === 0) return -1;
  let lo = 0;
  let hi = marks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ms < marks[mid].startMs) hi = mid - 1;
    else { found = mid; lo = mid + 1; }
  }
  if (found === marks.length - 1 && ms >= marks[found].endMs) return -1;
  return found;
}

/**
 * Rebuild `el`'s contents as sentence spans of word spans. Walking one
 * cursor through the text means the DOM's text content is character for
 * character the paragraph, whatever the marks do.
 */
export function paintParagraph(el, text, marks) {
  el.textContent = "";
  if (!marks || marks.length === 0) {
    el.textContent = text;
    return { words: [], sentences: [] };
  }
  const sentences = sentenceRanges(text);
  const bounds = sentences.length > 0 ? sentences : [{ start: 0, end: text.length }];
  const words = [];
  const sentEls = [];
  let cursor = 0;
  let mi = 0;
  for (const s of bounds) {
    const sent = document.createElement("span");
    sent.className = "sent";
    while (mi < marks.length && marks[mi].start < s.end) {
      const m = marks[mi];
      if (cursor < m.start) sent.appendChild(document.createTextNode(text.slice(cursor, m.start)));
      const w = document.createElement("span");
      w.className = "word";
      w.dataset.i = String(words.length);
      w.textContent = text.slice(Math.max(cursor, m.start), m.end);
      sent.appendChild(w);
      words.push({ el: w, sentence: sentEls.length, startMs: m.startMs });
      cursor = m.end;
      mi++;
    }
    if (cursor < s.end) {
      sent.appendChild(document.createTextNode(text.slice(cursor, s.end)));
      cursor = s.end;
    }
    if (sent.childNodes.length > 0) {
      el.appendChild(sent);
      sentEls.push(sent);
    }
  }
  if (cursor < text.length) el.appendChild(document.createTextNode(text.slice(cursor)));
  return { words, sentences: sentEls };
}

/** Move the highlight, touching only the spans that change. */
export function applyHighlight(painted, state, wordIndex) {
  if (!painted) return state;
  const next = {
    word: wordIndex,
    sentence: wordIndex >= 0 ? (painted.words[wordIndex]?.sentence ?? -1) : -1,
  };
  if (next.word === state.word && next.sentence === state.sentence) return state;
  if (state.word >= 0) painted.words[state.word]?.el.classList.remove("on");
  if (state.sentence >= 0) painted.sentences[state.sentence]?.classList.remove("on");
  if (next.word >= 0) painted.words[next.word]?.el.classList.add("on");
  if (next.sentence >= 0) painted.sentences[next.sentence]?.classList.add("on");
  return next;
}

export function clearHighlight(painted, state) {
  if (!painted) return { word: -1, sentence: -1 };
  if (state.word >= 0) painted.words[state.word]?.el.classList.remove("on");
  if (state.sentence >= 0) painted.sentences[state.sentence]?.classList.remove("on");
  return { word: -1, sentence: -1 };
}

/** Where in the audio a character offset is: the first mark covering it. */
export function timeAtOffset(marks, offset) {
  if (!marks || marks.length === 0) return 0;
  for (const m of marks) if (offset >= m.start && offset < m.end) return m.startMs;
  for (const m of marks) if (m.start >= offset) return m.startMs;
  return marks[marks.length - 1].startMs;
}

/** Sentence-sized steps for the skip buttons. */
export function sentenceStarts(text, marks) {
  return sentenceRanges(text).map((r) => timeAtOffset(marks, r.start));
}
