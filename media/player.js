/**
 * The sidebar player.
 *
 * Turns arrive from the host and are listed newest first. Audio is pulled
 * paragraph by paragraph: the player asks for what the playhead is about to
 * need plus a two-paragraph look-ahead, and the host answers with bytes and
 * marks. A new turn starts playing at once unless something is already
 * playing, in which case it queues behind it.
 *
 * A turn can grow while it is listed. Progress notes Claude writes between
 * tool calls are appended as they arrive, and the finished reply last. If
 * the turn is playing, the run simply gets longer; if it has finished, the
 * new paragraphs play or queue like a new turn would.
 *
 * A condensed turn carries its full reply after `fullFrom`. A run started
 * before that point stops there; the full reply plays only when asked.
 *
 * The browser under VS Code refuses to start sound until the window has had
 * a click or keypress since the page was made (NotAllowedError from
 * `play()`), and a reload makes a new page. The player says so with a card
 * until the first play succeeds, and a click resumes whatever was refused.
 *
 * Settings live behind the gear: voice, speed and autoplay, one panel that
 * replaces the list while it is open. The voice picker is a second panel
 * behind it: search, a row of filters, voices grouped by language, a sample
 * button on each. Samples play through their own audio element and pause
 * the reader while they do. Catalogue tags come as "Category:Value"; the
 * value is what people see.
 */
import { applyHighlight, clearHighlight, markIndexAtTime, paintParagraph, sentenceStarts } from "./reader.js";

const vscode = acquireVsCodeApi();
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const LOOK_AHEAD = 2;
/** Tag chips shown in the picker, at most. */
const TAG_CHIPS = 6;

const els = {
  toggle: document.getElementById("toggle"),
  back: document.getElementById("back"),
  fwd: document.getElementById("fwd"),
  stop: document.getElementById("stop"),
  settings: document.getElementById("settings"),
  settingsPanel: document.getElementById("settingsPanel"),
  settingsClose: document.getElementById("settingsClose"),
  voiceSetting: document.getElementById("voiceSetting"),
  voiceCurrent: document.getElementById("voiceCurrent"),
  speedSeg: document.getElementById("speedSeg"),
  autoplaySwitch: document.getElementById("autoplaySwitch"),
  autoplayHelp: document.getElementById("autoplayHelp"),
  allSettings: document.getElementById("allSettings"),
  keySetting: document.getElementById("keySetting"),
  keyHelp: document.getElementById("keyHelp"),
  keyAction: document.getElementById("keyAction"),
  clear: document.getElementById("clear"),
  status: document.getElementById("status"),
  progress: document.getElementById("progress"),
  progressFill: document.getElementById("progressFill"),
  setup: document.getElementById("setup"),
  voices: document.getElementById("voices"),
  voiceSearch: document.getElementById("voiceSearch"),
  voicesBack: document.getElementById("voicesBack"),
  voicesClose: document.getElementById("voicesClose"),
  voiceFilters: document.getElementById("voiceFilters"),
  voiceList: document.getElementById("voiceList"),
  turns: document.getElementById("turns"),
  empty: document.getElementById("empty"),
};

const state = {
  turns: new Map(), // id -> { turn, el, full, paragraphs: [{ el, body, text, entry, painted }] }
  order: [], // turn ids, newest first
  queue: [], // { turnId, index } waiting to play, oldest first
  requested: new Set(), // "turnId:index" asked of the host
  current: null, // { turnId, index }
  runEnd: 0, // first index the current run will not play
  playing: false,
  rate: 1,
  autoplay: true,
  unheard: 0, // turns that arrived while autoplay was off and have not been played
  highlight: { word: -1, sentence: -1 },
  frame: null,
  keyOk: false,
  hookInstalled: false,
  voiceId: "",
  // Sound is off until the window has been clicked. Known up front where the
  // browser says so, and learnt the hard way when play() is refused.
  needsClick: typeof navigator.userActivation === "object" ? !navigator.userActivation.hasBeenActive : false,
  refused: false,
  playedOnce: false,
  // Which panel covers the list: null, "settings" or "voices".
  panel: null,
  // The voice picker.
  picker: { voices: null, error: null, asked: false, query: "", chip: "all", sampling: null, rows: new Map() },
};

const audio = new Audio();
audio.preload = "auto";
/** Voice samples, so a sample never replaces what the reader was playing. */
const sampleAudio = new Audio();

// ---- messages from the host ---------------------------------------------

window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.kind) {
    case "state":
      state.keyOk = msg.keyOk;
      state.hookInstalled = msg.hookInstalled;
      state.voiceId = msg.voice;
      setRate(msg.speed, false);
      setAutoplay(msg.autoplay, false);
      renderSetup();
      renderSettings();
      if (state.panel === "voices") renderVoices();
      // The catalogue names the voice; ask once as soon as a key can answer.
      if (msg.keyOk && !state.picker.asked) {
        state.picker.asked = true;
        post({ kind: "voices" });
      }
      return;
    case "turn":
      addTurn(msg.turn);
      note(`turn ${msg.turn.id.slice(0, 8)} listed, autoplay ${msg.autoplay && state.autoplay ? "yes" : "no"}`);
      if (msg.autoplay) arrive(msg.turn.id, 0);
      return;
    case "append":
      onAppend(msg);
      return;
    case "audio":
      onAudio(msg);
      return;
    case "error":
      onError(msg);
      return;
    case "status":
      if (!state.playing) setStatus(msg.text);
      return;
    case "stop":
      stop();
      return;
    case "clear":
      clearAll(false);
      return;
    case "showVoices":
      openVoices();
      return;
    case "voices":
      state.picker.voices = msg.voices;
      state.picker.error = msg.error;
      renderSettings();
      if (state.panel === "voices") renderVoices();
      return;
    case "sample":
      onSample(msg);
      return;
  }
});

function post(message) {
  vscode.postMessage(message);
}

/** A line in the host's log, for the moments the page cannot show. */
function note(text) {
  post({ kind: "note", text });
}

// ---- setup cards ----------------------------------------------------------

function renderSetup() {
  els.setup.textContent = "";
  const needs = [];
  if (!state.keyOk) {
    needs.push(card(
      "Paste your Speechify API key",
      [keysLink("Create one at platform.speechify.ai"), ". It stays in VS Code's secret storage and every reply bills your workspace."],
      "Set API key",
      "setApiKey",
    ));
  }
  if (!state.hookInstalled) {
    needs.push(card(
      "Let Claude Code talk to Readback",
      "Adds Stop, MessageDisplay and PreToolUse hooks to ~/.claude/settings.json. Nothing else in the file is touched.",
      "Install the hook",
      "installHook",
    ));
  }
  if (state.needsClick || state.refused) {
    note(`sound card shown (${state.refused ? "play was refused" : "page not yet activated"})`);
    needs.push(card(
      "Click once to turn sound on",
      "After a reload, VS Code keeps audio silent until you have clicked somewhere in this window. Once is enough. Replies that arrive meanwhile queue up and play after the click.",
      "Turn sound on",
      null,
    ));
  }
  els.setup.hidden = needs.length === 0;
  for (const n of needs) els.setup.appendChild(n);
}

/** Where API keys are made. The webview hands http links to the browser. */
const KEYS_URL = "https://platform.speechify.ai/api-keys";

function keysLink(text) {
  const a = document.createElement("a");
  a.href = KEYS_URL;
  a.textContent = text;
  a.title = KEYS_URL;
  // Opened by the host. Stopping the click keeps the row around it from
  // firing too, and preventing the default keeps the page where it is.
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    post({ kind: "command", name: "openKeysPage" });
  });
  return a;
}

function card(title, body, action, command) {
  const el = document.createElement("div");
  el.className = "card";
  const h = document.createElement("h2");
  h.textContent = title;
  const p = document.createElement("p");
  if (Array.isArray(body)) p.append(...body);
  else p.textContent = body;
  const b = document.createElement("button");
  b.className = "action";
  b.textContent = action;
  // A card without a command only needs the click itself; the document
  // listener below turns that into sound.
  if (command) b.addEventListener("click", () => post({ kind: "command", name: command }));
  el.append(h, p, b);
  return el;
}

/** The first click in the page: sound is allowed from here on. */
document.addEventListener("click", () => {
  if (!state.needsClick && !state.refused) return;
  const resumeRun = state.refused;
  state.needsClick = false;
  state.refused = false;
  note(`first click in the panel${resumeRun ? ", resuming the refused run" : ""}`);
  renderSetup();
  if (resumeRun) resume();
}, true);

// ---- turns ------------------------------------------------------------------

function iconButton(icon, title, onClick) {
  const b = document.createElement("button");
  b.className = "icon";
  b.title = title;
  b.setAttribute("aria-label", title);
  const i = document.createElement("i");
  i.className = `codicon codicon-${icon}`;
  b.appendChild(i);
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return b;
}

function addTurn(turn) {
  if (state.turns.has(turn.id)) return;
  const el = document.createElement("article");
  el.className = "turn";
  el.dataset.id = turn.id;
  const t = { turn, el, full: null, paragraphs: [] };

  const head = document.createElement("header");
  head.className = "turn-head";
  const lead = makeParagraph(turn.id, 0, turn.paragraphs[0]);
  lead.el.classList.add("lead");
  t.paragraphs.push(lead);
  head.appendChild(lead.el);
  head.appendChild(iconButton("play", "Play this turn", () => {
    state.queue = [];
    goTo(turn.id, 0, true);
  }));
  el.appendChild(head);

  for (let i = 1; i < turn.paragraphs.length; i++) addParagraph(t, i, turn.paragraphs[i]);

  els.turns.prepend(el);
  els.empty.hidden = true;
  state.turns.set(turn.id, t);
  state.order.unshift(turn.id);
}

function makeParagraph(turnId, index, text) {
  const p = document.createElement("div");
  p.className = "para";
  const body = document.createElement("div");
  body.className = "para-body";
  body.textContent = text;
  p.appendChild(body);
  p.addEventListener("click", (ev) => onParagraphClick(turnId, index, ev));
  return { el: p, body, text, entry: null, painted: null };
}

/** Paragraph `index` of a listed turn: in the article, or under "Full reply" once past `fullFrom`. */
function addParagraph(t, index, text) {
  const p = makeParagraph(t.turn.id, index, text);
  t.paragraphs[index] = p;
  const { fullFrom } = t.turn;
  if (fullFrom !== null && index >= fullFrom) fullSection(t).appendChild(p.el);
  else if (t.full) t.el.insertBefore(p.el, t.full);
  else t.el.appendChild(p.el);
}

/** The collapsed "Full reply" section, made on first use. */
function fullSection(t) {
  if (t.full) return t.full;
  const full = document.createElement("details");
  full.className = "full";
  const s = document.createElement("summary");
  const chevron = document.createElement("i");
  chevron.className = "codicon codicon-chevron-right";
  const label = document.createElement("span");
  label.textContent = "Full reply";
  const play = iconButton("play", "Read the full reply", () => {
    full.open = true;
    state.queue = [];
    goTo(t.turn.id, t.turn.fullFrom, true);
  });
  s.append(chevron, label, play);
  full.appendChild(s);
  t.el.appendChild(full);
  t.full = full;
  return full;
}

/** More paragraphs for a listed turn. */
function onAppend(msg) {
  const t = state.turns.get(msg.turnId);
  if (!t) return;
  if (msg.from !== t.turn.paragraphs.length) {
    note(`append to ${msg.turnId.slice(0, 8)} at ${msg.from} but ${t.turn.paragraphs.length} listed; ignored`);
    return;
  }
  t.turn.fullFrom = msg.fullFrom;
  msg.paragraphs.forEach((text, i) => {
    t.turn.paragraphs.push(text);
    addParagraph(t, msg.from + i, text);
  });
  note(`turn ${msg.turnId.slice(0, 8)} grew by ${msg.paragraphs.length}${msg.fullFrom !== null ? " (condensed)" : ""}`);
  if (state.current && state.current.turnId === msg.turnId) {
    // The run in progress gets longer; it still stops before the full reply.
    state.runEnd = runEndFor(t.turn, state.current.index);
    lookAhead(msg.turnId, state.current.index + 1);
    return;
  }
  if (msg.autoplay) arrive(msg.turnId, msg.from);
}

/** A turn, or more of one, has arrived: play it, queue it, or count it as unheard. */
function arrive(turnId, index) {
  const t = state.turns.get(turnId);
  if (!t) return;
  if (state.autoplay) {
    enqueue(turnId, index);
    return;
  }
  if (!t.el.classList.contains("unheard")) {
    state.unheard++;
    t.el.classList.add("unheard");
  }
  if (!state.playing) setStatus(state.unheard === 1 ? "1 new reply, press play" : `${state.unheard} new replies, press play`);
}

function onParagraphClick(turnId, index, ev) {
  const word = ev.target.closest(".word");
  const isCurrent = state.current && state.current.turnId === turnId && state.current.index === index;
  if (word && isCurrent) {
    const p = state.turns.get(turnId).paragraphs[index];
    const w = p.painted?.words[Number(word.dataset.i)];
    if (w) seek(w.startMs);
    return;
  }
  state.queue = [];
  goTo(turnId, index, true);
}

/** Forget every turn. From the bar the host is told too; from the host it already knows. */
function clearAll(tellHost = true) {
  stop();
  for (const t of state.turns.values()) {
    for (const p of t.paragraphs) if (p.entry) URL.revokeObjectURL(p.entry.url);
  }
  state.turns.clear();
  state.order = [];
  state.requested.clear();
  state.unheard = 0;
  els.turns.textContent = "";
  els.empty.hidden = state.panel !== null;
  if (tellHost) post({ kind: "clear" });
}

// ---- playback ---------------------------------------------------------------

function enqueue(turnId, index) {
  if (state.playing || state.current) {
    // One entry per turn. A queued turn that grows plays through its new
    // paragraphs from the entry it already has; a second entry would replay them.
    const queued = state.queue.find((q) => q.turnId === turnId);
    if (queued) {
      queued.index = Math.min(queued.index, index);
      return;
    }
    state.queue.push({ turnId, index });
    setStatus(`${state.queue.length} queued`);
    return;
  }
  goTo(turnId, index, true);
}

function need(turnId, index) {
  const t = state.turns.get(turnId);
  const p = t?.paragraphs[index];
  if (!p || p.entry) return;
  const key = `${turnId}:${index}`;
  if (state.requested.has(key)) return;
  state.requested.add(key);
  post({ kind: "need", turnId, index });
}

function lookAhead(turnId, fromIndex) {
  for (let i = fromIndex; i < Math.min(fromIndex + LOOK_AHEAD, state.runEnd); i++) need(turnId, i);
}

/** Where a run starting at `index` ends: before the full reply, or at the end. */
function runEndFor(turn, index) {
  if (turn.fullFrom !== null && index < turn.fullFrom) return turn.fullFrom;
  return turn.paragraphs.length;
}

function goTo(turnId, index, autoplay) {
  const t = state.turns.get(turnId);
  if (!t) return;
  const sameRun = state.current && state.current.turnId === turnId && index > state.current.index;
  if (!sameRun) state.runEnd = runEndFor(t.turn, index);
  if (index >= state.runEnd) {
    finishTurn();
    return;
  }
  clearCurrent();
  state.current = { turnId, index };
  if (t.el.classList.contains("unheard")) {
    t.el.classList.remove("unheard");
    state.unheard = Math.max(0, state.unheard - 1);
  }
  t.el.classList.add("playing");
  const p = t.paragraphs[index];
  p.el.classList.add("current");
  if (t.full && index >= t.turn.fullFrom) t.full.open = true;
  p.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  need(turnId, index);
  lookAhead(turnId, index + 1);
  if (p.entry) play(p, autoplay);
  else setStatus("Rendering…");
}

function onAudio(msg) {
  const t = state.turns.get(msg.turnId);
  const p = t?.paragraphs[msg.index];
  if (!p) return;
  const url = blobUrl(msg.audio);
  p.entry = { url, marks: msg.marks, durationMs: msg.durationMs, sentenceStarts: sentenceStarts(p.text, msg.marks) };
  p.painted = paintParagraph(p.body, p.text, msg.marks);
  if (state.current && state.current.turnId === msg.turnId && state.current.index === msg.index) {
    play(p, true);
  }
}

function blobUrl(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

function onError(msg) {
  note(`paragraph ${msg.index} failed: ${msg.message}`);
  setStatus(msg.message);
  if (state.current && state.current.turnId === msg.turnId && state.current.index === msg.index) {
    // Skip the paragraph that will not play rather than block the run.
    state.requested.delete(`${msg.turnId}:${msg.index}`);
    goTo(msg.turnId, msg.index + 1, true);
  }
}

async function play(p, autoplay) {
  stopSample();
  audio.onended = null;
  audio.src = p.entry.url;
  audio.playbackRate = state.rate;
  audio.currentTime = 0;
  audio.onended = () => next();
  if (!autoplay) {
    setPlaying(false);
    return;
  }
  try {
    await audio.play();
    setPlaying(true);
    setStatus(nowPlaying());
    watch();
    if (!state.playedOnce) {
      state.playedOnce = true;
      note("first play() of this page succeeded");
    }
    if (state.needsClick) {
      // A click elsewhere in the window was enough; the card was not needed.
      state.needsClick = false;
      renderSetup();
    }
  } catch (err) {
    const name = err && err.name ? err.name : String(err);
    note(`play() refused: ${name}${name === "NotAllowedError" ? " (no click in the window yet)" : ""}`);
    setPlaying(false);
    if (name === "NotAllowedError") {
      state.refused = true;
      renderSetup();
      setStatus("Click anywhere in this window to hear it");
    } else {
      setStatus("Press play to start");
    }
  }
}

function nowPlaying() {
  const t = state.current && state.turns.get(state.current.turnId);
  if (!t) return "";
  const { fullFrom, project } = t.turn;
  const what = fullFrom !== null && state.current.index >= fullFrom ? "the full reply" : "";
  return ["Playing", what, project ? (what ? `, ${project}` : project) : ""].join(" ").replace(" ,", ",").trim();
}

function next() {
  if (!state.current) return;
  goTo(state.current.turnId, state.current.index + 1, true);
}

function finishTurn() {
  clearCurrent();
  state.current = null;
  setPlaying(false);
  setProgress(0, false);
  const upcoming = state.queue.shift();
  if (upcoming) goTo(upcoming.turnId, upcoming.index, true);
  else setStatus("");
}

function clearCurrent() {
  if (!state.current) return;
  const t = state.turns.get(state.current.turnId);
  const p = t?.paragraphs[state.current.index];
  if (t) t.el.classList.remove("playing");
  if (p) {
    p.el.classList.remove("current");
    state.highlight = clearHighlight(p.painted, state.highlight);
  }
}

function stop() {
  stopSample();
  audio.pause();
  audio.onended = null;
  state.queue = [];
  clearCurrent();
  state.current = null;
  setPlaying(false);
  setProgress(0, false);
  setStatus("");
}

function toggle() {
  if (state.playing) {
    audio.pause();
    setPlaying(false);
    setStatus("Paused");
    return;
  }
  if (!state.current) {
    const [latest] = state.order;
    if (latest) goTo(latest, 0, true);
    return;
  }
  resume();
}

/** Carry on with the current paragraph, whether paused or never started. */
function resume() {
  if (!state.current || state.playing) return;
  stopSample();
  audio.play().then(() => {
    setPlaying(true);
    setStatus(nowPlaying());
    watch();
  }).catch(() => setStatus("Press play to start"));
}

function seek(ms) {
  audio.currentTime = Math.max(0, ms / 1000);
  tick();
}

function step(direction) {
  if (!state.current) return;
  const p = state.turns.get(state.current.turnId)?.paragraphs[state.current.index];
  if (!p?.entry) return;
  const now = audio.currentTime * 1000;
  const starts = p.entry.sentenceStarts;
  if (direction < 0) {
    const previous = [...starts].reverse().find((t) => t < now - 900);
    if (previous === undefined) {
      if (state.current.index > 0) goTo(state.current.turnId, state.current.index - 1, state.playing);
      else seek(0);
      return;
    }
    seek(previous);
    return;
  }
  const upcoming = starts.find((t) => t > now + 50);
  if (upcoming === undefined) next();
  else seek(upcoming);
}

function setRate(rate, persist) {
  if (!RATES.includes(rate)) rate = 1;
  state.rate = rate;
  audio.playbackRate = rate;
  renderSpeed();
  if (persist) post({ kind: "speed", rate });
}

function setAutoplay(on, persist) {
  state.autoplay = on;
  els.autoplaySwitch.classList.toggle("on", on);
  els.autoplaySwitch.setAttribute("aria-checked", String(on));
  els.autoplayHelp.textContent = on ? "New replies play as they arrive" : "New replies wait for play";
  if (persist) post({ kind: "autoplay", on });
}

// ---- panels -----------------------------------------------------------------

/** Show one panel over the list, or none. */
function showPanel(name) {
  if (state.panel === "voices" && name !== "voices") stopSample();
  state.panel = name;
  els.settingsPanel.hidden = name !== "settings";
  els.voices.hidden = name !== "voices";
  els.turns.hidden = name !== null;
  els.empty.hidden = name !== null || state.turns.size > 0;
  els.settings.classList.toggle("on", name !== null);
  if (name === "settings") renderSettings();
}

function renderSettings() {
  const v = state.picker.voices?.find((x) => x.id === state.voiceId);
  const parts = [voiceLabel(state.voiceId)];
  if (v) {
    const region = regionOf(v.locale);
    if (region) parts.push(region);
    if (v.gender !== "unspecified") parts.push(capitalize(v.gender));
    if (v.cloned) parts.push("your clone");
  }
  els.voiceCurrent.textContent = parts.join(" · ");
  els.keyHelp.textContent = "";
  els.keyHelp.append(
    state.keyOk ? "Stored in VS Code's secret storage." : "Not set.",
    document.createElement("br"),
    keysLink(state.keyOk ? "Create a new one at platform.speechify.ai" : "Create one at platform.speechify.ai"),
  );
  els.keyAction.firstChild.textContent = state.keyOk ? "Change " : "Set ";
  renderSpeed();
}

function renderSpeed() {
  els.speedSeg.textContent = "";
  for (const rate of RATES) {
    const b = document.createElement("button");
    b.className = "seg";
    b.textContent = `${rate}×`;
    b.classList.toggle("on", rate === state.rate);
    b.setAttribute("aria-pressed", String(rate === state.rate));
    b.addEventListener("click", () => setRate(rate, true));
    els.speedSeg.appendChild(b);
  }
}

function setPlaying(playing) {
  state.playing = playing;
  els.toggle.firstElementChild.className = `codicon codicon-${playing ? "debug-pause" : "play"}`;
  els.toggle.title = playing ? "Pause (space)" : "Play (space)";
}

function setStatus(text) {
  els.status.textContent = text;
}

function setProgress(fraction, live) {
  els.progressFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  els.progress.classList.toggle("live", live);
}

function watch() {
  if (state.frame !== null) return;
  const loop = () => {
    tick();
    if (state.playing) state.frame = requestAnimationFrame(loop);
    else state.frame = null;
  };
  state.frame = requestAnimationFrame(loop);
}

function tick() {
  if (!state.current) return;
  const p = state.turns.get(state.current.turnId)?.paragraphs[state.current.index];
  if (!p?.entry) return;
  const ms = audio.currentTime * 1000;
  state.highlight = applyHighlight(p.painted, state.highlight, markIndexAtTime(p.entry.marks, ms));
  setProgress(p.entry.durationMs > 0 ? ms / p.entry.durationMs : 0, true);
}

// ---- voice picker -----------------------------------------------------------

/** The voice's name when the catalogue is known, else its id made readable: "harper_32" → "Harper". */
function voiceLabel(id) {
  const v = state.picker.voices?.find((x) => x.id === id);
  if (v) return v.name;
  return (id || "").replace(/[_-]?\d+$/, "").split(/[_-]+/).filter(Boolean).map(capitalize).join(" ") || id;
}

function capitalize(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : "";
}

/** "Audiobook long form" from "Use-Case:Audiobook-Long-Form". */
function tagValue(tag) {
  const value = tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;
  return capitalize(value.replace(/[-_]+/g, " ").trim().toLowerCase());
}

function openVoices() {
  showPanel("voices");
  // Always ask again: the host answers from its cache when nothing changed,
  // and with a fresh list after a new key or model. What is known shows meanwhile.
  if (state.picker.voices === null || state.picker.voices.length === 0) {
    els.voiceList.textContent = "";
    els.voiceList.appendChild(hint("Fetching voices…"));
  } else {
    renderVoices();
  }
  post({ kind: "voices" });
  els.voiceSearch.focus();
}

function hint(text) {
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = text;
  return p;
}

const languageNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "language" }) : null;
const regionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

/** "English" for en-US; the raw tag when the browser cannot name it. */
function languageOf(locale) {
  const lang = (locale || "").split(/[-_]/)[0];
  if (!lang) return "Other";
  try {
    return languageNames?.of(lang) ?? lang;
  } catch {
    return lang;
  }
}

/** "US" for en-US, "" when the locale has no region. */
function regionOf(locale) {
  const region = (locale || "").split(/[-_]/)[1];
  if (!region) return "";
  try {
    return regionNames?.of(region.toUpperCase()) ?? region;
  } catch {
    return region;
  }
}

/** Filter chips: everyone, featured if any, gender, clones if any, then the commonest tags. */
function chipsFor(voices) {
  const chips = [{ id: "all", label: "All" }];
  if (voices.some((v) => v.featured)) chips.push({ id: "featured", label: "Featured" });
  if (voices.some((v) => v.gender === "female")) chips.push({ id: "female", label: "Female" });
  if (voices.some((v) => v.gender === "male")) chips.push({ id: "male", label: "Male" });
  if (voices.some((v) => v.cloned)) chips.push({ id: "clones", label: "Your clones" });
  const counts = new Map();
  for (const v of voices) for (const tag of v.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TAG_CHIPS);
  for (const [tag] of tags) chips.push({ id: `tag:${tag}`, label: tagValue(tag) });
  return chips;
}

function matchesChip(v, chip) {
  if (chip === "all") return true;
  if (chip === "featured") return v.featured;
  if (chip === "female" || chip === "male") return v.gender === chip;
  if (chip === "clones") return v.cloned;
  if (chip.startsWith("tag:")) return v.tags.includes(chip.slice(4));
  return true;
}

function matchesQuery(v, query) {
  if (!query) return true;
  const hay = `${v.name} ${v.id} ${v.locale} ${languageOf(v.locale)} ${regionOf(v.locale)} ${v.tags.map(tagValue).join(" ")}`.toLowerCase();
  return query.split(/\s+/).every((word) => hay.includes(word));
}

function renderVoices() {
  const { voices, error, query, chip } = state.picker;
  els.voiceFilters.textContent = "";
  els.voiceList.textContent = "";
  state.picker.rows.clear();
  if (error && (!voices || voices.length === 0)) {
    els.voiceList.appendChild(hint(error));
    return;
  }
  if (!voices) return;

  const chips = chipsFor(voices);
  if (!chips.some((c) => c.id === chip)) state.picker.chip = "all";
  for (const c of chips) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = c.label;
    b.classList.toggle("on", c.id === state.picker.chip);
    b.addEventListener("click", () => {
      state.picker.chip = c.id;
      renderVoices();
    });
    els.voiceFilters.appendChild(b);
  }

  const shown = voices.filter((v) => matchesChip(v, state.picker.chip) && matchesQuery(v, query.trim().toLowerCase()));
  if (shown.length === 0) {
    els.voiceList.appendChild(hint("No voice matches."));
    return;
  }

  // Featured first, as their own group; every voice also appears under its language.
  const featured = shown.filter((v) => v.featured);
  if (featured.length > 0 && state.picker.chip !== "featured") {
    els.voiceList.appendChild(groupHeading("Featured", featured.length, "Read-along tested on these"));
    for (const v of featured) els.voiceList.appendChild(voiceRow(v, "featured"));
  }

  // Grouped by language, the current voice's language first, then A to Z.
  const groups = new Map();
  for (const v of shown) {
    const name = languageOf(v.locale);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(v);
  }
  const currentLanguage = languageOf(voices.find((v) => v.id === state.voiceId)?.locale ?? "");
  const names = [...groups.keys()].sort((a, b) => (a === currentLanguage ? -1 : b === currentLanguage ? 1 : a.localeCompare(b)));
  for (const name of names) {
    const list = groups.get(name);
    els.voiceList.appendChild(groupHeading(name, list.length, null));
    for (const v of list) els.voiceList.appendChild(voiceRow(v, "language"));
  }
  if (error) els.voiceList.prepend(hint(error));
}

function groupHeading(name, count, help) {
  const h = document.createElement("h3");
  h.className = "voice-group";
  h.textContent = name;
  const n = document.createElement("span");
  n.textContent = String(count);
  h.appendChild(n);
  if (help) {
    const s = document.createElement("small");
    s.textContent = help;
    h.appendChild(s);
  }
  return h;
}

/** One row. `section` keeps the two rows of a featured voice apart in the row map. */
function voiceRow(v, section) {
  const row = document.createElement("div");
  row.className = "voice";
  row.classList.toggle("current", v.id === state.voiceId);
  row.setAttribute("role", "button");
  row.tabIndex = 0;

  const sample = iconButton("play", `Hear ${v.name}`, () => toggleSample(v.id));
  sample.classList.add("sample");
  row.appendChild(sample);

  const main = document.createElement("div");
  main.className = "voice-main";
  const nameEl = document.createElement("div");
  nameEl.className = "voice-name";
  nameEl.textContent = v.name;
  if (v.featured && section !== "featured") {
    const star = document.createElement("i");
    star.className = "codicon codicon-star-full featured";
    star.title = "Featured";
    nameEl.appendChild(star);
  }
  if (v.id === state.voiceId) {
    const check = document.createElement("i");
    check.className = "codicon codicon-check";
    nameEl.appendChild(check);
  }
  const meta = document.createElement("div");
  meta.className = "voice-meta";
  const parts = [];
  const region = regionOf(v.locale);
  if (region) parts.push(region);
  if (v.gender !== "unspecified") parts.push(capitalize(v.gender));
  if (v.cloned) parts.push("your clone");
  if (v.tags.length) parts.push(v.tags.map(tagValue).join(", "));
  meta.textContent = parts.join(" · ");
  main.append(nameEl, meta);
  row.appendChild(main);

  const choose = () => {
    if (v.id === state.voiceId) return;
    state.voiceId = v.id;
    post({ kind: "voice", id: v.id });
    renderVoices();
    renderSettings();
  };
  row.addEventListener("click", choose);
  row.addEventListener("keydown", (ev) => {
    // Only the row itself; Enter on the sample button samples.
    if (ev.target !== row) return;
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      choose();
    }
  });
  const rows = state.picker.rows.get(v.id) ?? [];
  rows.push(row);
  state.picker.rows.set(v.id, rows);
  return row;
}

/** A featured voice has two rows; both follow the sample. */
function setRowState(voiceId, cls) {
  for (const row of state.picker.rows.get(voiceId) ?? []) {
    row.classList.remove("loading", "sampling");
    if (cls) row.classList.add(cls);
    const icon = row.querySelector(".sample .codicon");
    if (icon) icon.className = `codicon codicon-${cls === "sampling" ? "debug-stop" : cls === "loading" ? "loading codicon-modifier-spin" : "play"}`;
  }
}

function toggleSample(voiceId) {
  if (state.picker.sampling === voiceId) {
    stopSample();
    return;
  }
  stopSample();
  state.picker.sampling = voiceId;
  setRowState(voiceId, "loading");
  post({ kind: "sample", voiceId });
}

function onSample(msg) {
  if (state.picker.sampling !== msg.voiceId) return;
  if (!msg.audio) {
    note(`sample of ${msg.voiceId} failed: ${msg.error}`);
    setStatus(msg.error || "No sample for this voice.");
    state.picker.sampling = null;
    setRowState(msg.voiceId, null);
    return;
  }
  // A sample should not talk over the reader.
  if (state.playing) {
    audio.pause();
    setPlaying(false);
    setStatus("Paused for a sample");
  }
  if (sampleAudio.src) URL.revokeObjectURL(sampleAudio.src);
  sampleAudio.src = blobUrl(msg.audio);
  sampleAudio.onended = () => stopSample();
  setRowState(msg.voiceId, "sampling");
  sampleAudio.play().catch((err) => {
    note(`sample play() refused: ${err && err.name ? err.name : err}`);
    stopSample();
  });
}

function stopSample() {
  const was = state.picker.sampling;
  if (was === null) return;
  sampleAudio.pause();
  sampleAudio.onended = null;
  state.picker.sampling = null;
  setRowState(was, null);
}

// ---- controls ---------------------------------------------------------------

els.toggle.addEventListener("click", toggle);
els.back.addEventListener("click", () => step(-1));
els.fwd.addEventListener("click", () => step(1));
els.stop.addEventListener("click", stop);
els.clear.addEventListener("click", () => clearAll(true));
els.settings.addEventListener("click", () => showPanel(state.panel === null ? "settings" : null));
els.settingsClose.addEventListener("click", () => showPanel(null));
els.autoplaySwitch.addEventListener("click", () => setAutoplay(!state.autoplay, true));
els.allSettings.addEventListener("click", () => post({ kind: "command", name: "openSettings" }));
els.keySetting.addEventListener("click", () => post({ kind: "command", name: "setApiKey" }));
els.keySetting.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    post({ kind: "command", name: "setApiKey" });
  }
});
els.voiceSetting.addEventListener("click", openVoices);
els.voiceSetting.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    openVoices();
  }
});
els.voicesBack.addEventListener("click", () => showPanel("settings"));
els.voicesClose.addEventListener("click", () => showPanel(null));
els.voiceSearch.addEventListener("input", () => {
  state.picker.query = els.voiceSearch.value;
  renderVoices();
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && state.panel !== null) {
    showPanel(state.panel === "voices" ? "settings" : null);
    return;
  }
  if (ev.target.closest("button, input, textarea, [role=button]")) return;
  if (ev.key === " ") { ev.preventDefault(); toggle(); }
  else if (ev.key === "ArrowLeft") step(-1);
  else if (ev.key === "ArrowRight") step(1);
});

post({ kind: "ready" });
