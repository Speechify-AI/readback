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
 * The browser under VS Code refuses to start sound until the page has been
 * clicked once (NotAllowedError from `play()`), and a reload makes a new
 * page. The player says so with a card until the first click, and a click
 * resumes whatever was refused; turns that arrived meanwhile are queued.
 */
import { applyHighlight, clearHighlight, markIndexAtTime, paintParagraph, sentenceStarts } from "./reader.js";

const vscode = acquireVsCodeApi();
const RATES = [1, 1.25, 1.5, 1.75, 2, 0.75];
const LOOK_AHEAD = 2;

const els = {
  toggle: document.getElementById("toggle"),
  back: document.getElementById("back"),
  fwd: document.getElementById("fwd"),
  stop: document.getElementById("stop"),
  autoplay: document.getElementById("autoplay"),
  speed: document.getElementById("speed"),
  voice: document.getElementById("voice"),
  voiceName: document.getElementById("voiceName"),
  status: document.getElementById("status"),
  progress: document.getElementById("progress"),
  progressFill: document.getElementById("progressFill"),
  setup: document.getElementById("setup"),
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
  // Sound is off until the page has been clicked. Known up front where the
  // browser says so, and learnt the hard way when play() is refused.
  needsClick: typeof navigator.userActivation === "object" ? !navigator.userActivation.hasBeenActive : false,
  refused: false,
  playedOnce: false,
};

const audio = new Audio();
audio.preload = "auto";

// ---- messages from the host ---------------------------------------------

window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.kind) {
    case "state":
      state.keyOk = msg.keyOk;
      state.hookInstalled = msg.hookInstalled;
      els.voiceName.textContent = msg.voice;
      setRate(msg.speed, false);
      setAutoplay(msg.autoplay, false);
      renderSetup();
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
  }
});

function post(message) {
  vscode.postMessage(message);
}

/** A line in the host's log, for the moments the page cannot show. */
function note(text) {
  post({ kind: "note", text });
}

// ---- setup card -----------------------------------------------------------

function renderSetup() {
  els.setup.textContent = "";
  const needs = [];
  if (!state.keyOk) {
    needs.push(card(
      "Paste your Speechify API key",
      "Create one at platform.speechify.ai/api-keys. It stays in VS Code's secret storage and every reply bills your workspace.",
      "Set API key",
      "setApiKey",
    ));
  }
  if (!state.hookInstalled) {
    needs.push(card(
      "Let Claude Code talk to Readback",
      "Adds Stop and MessageDisplay hooks to ~/.claude/settings.json. Nothing else in the file is touched.",
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

function card(title, body, action, command) {
  const el = document.createElement("div");
  el.className = "card";
  const h = document.createElement("h2");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = body;
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
  const bytes = Uint8Array.from(atob(msg.audio), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
  p.entry = { url, marks: msg.marks, durationMs: msg.durationMs, sentenceStarts: sentenceStarts(p.text, msg.marks) };
  p.painted = paintParagraph(p.body, p.text, msg.marks);
  if (state.current && state.current.turnId === msg.turnId && state.current.index === msg.index) {
    play(p, true);
  }
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
  els.speed.textContent = `${rate}×`;
  if (persist) post({ kind: "speed", rate });
}

function setAutoplay(on, persist) {
  state.autoplay = on;
  els.autoplay.classList.toggle("on", on);
  els.autoplay.title = on ? "Autoplay is on: new replies play as they arrive" : "Autoplay is off: new replies wait for play";
  if (persist) post({ kind: "autoplay", on });
}

function setPlaying(playing) {
  state.playing = playing;
  els.toggle.firstElementChild.className = `codicon codicon-${playing ? "debug-pause" : "play"}`;
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

// ---- controls ---------------------------------------------------------------

els.toggle.addEventListener("click", toggle);
els.back.addEventListener("click", () => step(-1));
els.fwd.addEventListener("click", () => step(1));
els.stop.addEventListener("click", stop);
els.autoplay.addEventListener("click", () => setAutoplay(!state.autoplay, true));
els.speed.addEventListener("click", () => setRate(RATES[(RATES.indexOf(state.rate) + 1) % RATES.length], true));
els.voice.addEventListener("click", () => post({ kind: "command", name: "chooseVoice" }));

document.addEventListener("keydown", (ev) => {
  if (ev.target.closest("button, input, textarea")) return;
  if (ev.key === " ") { ev.preventDefault(); toggle(); }
  else if (ev.key === "ArrowLeft") step(-1);
  else if (ev.key === "ArrowRight") step(1);
});

post({ kind: "ready" });
