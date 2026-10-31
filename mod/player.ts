/**
 * The mod's playback model, with no `$`: what is loaded, what plays, pause
 * and resume, and what the band should show. Everything it touches comes in
 * through `PlayerDeps`, so it runs under vitest with a fake clock and fake
 * audio. The mod has no timers: the caller calls `tick()` on its own clock.
 *
 * Nothing plays unless the person pressed play. A reply that lands while
 * another is playing does not interrupt it; it becomes the latest turn, the
 * one the next idle play and "full reply" use.
 *
 * Paragraph order comes from the extension's `Playlist` (autoplay off, every
 * move by hand): a summary run stops at `fullFrom`, and only the current
 * paragraph and the look-ahead are rendered, each once per load.
 *
 * Pause remembers the start of the sentence being read (`timeSentences`
 * over the paragraph's own marks, so a paragraph rendered in chunks pauses
 * and resumes like any other) and resume plays the clip from there, cut at
 * constant bitrate.
 */
import { markAtTime, timeSentences, type TimedRange } from "../src/marks.ts";
import type { Rendered } from "../src/renderShared.ts";
import { Playlist, type Move } from "../src/webview/playlist.ts";
import { sliceFromMs } from "./bytes.ts";
import { sentenceSegments, type Segments } from "./sentence.ts";

/** Paragraph lists from `replyParagraphs`; `condensing` while a summary may still come. */
export type ReplyTurn = { id: string; summary: string[]; full: string[]; condensing: boolean };

export type PlayerDeps = {
  render(text: string): Promise<Rendered>;
  /** Resolves when the clip has played to its end, or once `signal` aborts. */
  play(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  now(): Promise<number>;
  onChange(): void;
  onError(err: unknown): void;
};

export type State = "idle" | "waiting" | "loading" | "playing" | "paused";

export type View = {
  state: State;
  kind: "summary" | "full" | null;
  /** 1-based paragraph within the run; 0 when there is none. */
  paragraph: number;
  /** Paragraphs in the run (the summary, or the full reply). */
  paragraphs: number;
  /** Position in the current paragraph. */
  positionMs: number;
  durationMs: number;
  sentence: Segments | null;
};

interface Loaded {
  id: string;
  paragraphs: string[];
  fullFrom: number | null;
}

interface Track {
  text: string;
  rendered: Rendered;
  sentences: TimedRange[];
}

export class Player {
  private latest: ReplyTurn | null = null;
  private state: State = "idle";
  private loadedTurn: Loaded | null = null;
  private readonly playlist = new Playlist();
  private renders = new Map<number, Promise<Rendered>>();
  private index = 0;
  private track: Track | null = null;
  private fromMs = 0;
  private t0 = 0;
  private positionMs = 0;
  private abort: AbortController | null = null;
  /** Bumped by every change of course; a continuation from an older one does nothing. */
  private gen = 0;
  /** The generation of a resume still waiting for the clock; stale once `gen` moves on. */
  private resumeGen = -1;
  /** A pause still waiting for the clock to place the sentence start. */
  private pausing: Promise<void> | null = null;
  /** Preempted while loading: the render, when it lands, is held paused at 0. */
  private pauseOnLoad = false;

  constructor(private readonly deps: PlayerDeps) {
    this.playlist.autoplay = false;
  }

  get loaded(): boolean {
    return this.state !== "idle";
  }

  /** A finished turn has landed, so a press of 1 has something to play. */
  get hasLatest(): boolean {
    return this.latest !== null;
  }

  /** The latest finished turn. Never interrupts; a pending wait moves to it. */
  setLatest(turn: ReplyTurn): void {
    this.latest = copy(turn);
    if (this.state === "waiting") this.detach(this.startLatest());
    else this.deps.onChange();
  }

  /** Condensing finished: the summary, or null when it failed (the full reply plays). */
  summaryReady(turnId: string, summary: string[] | null): void {
    if (this.latest === null || this.latest.id !== turnId) return;
    this.latest = { ...this.latest, summary: summary ? [...summary] : [], condensing: false };
    if (this.state === "waiting") this.detach(this.startLatest());
  }

  /** Key 1: play the latest turn, pause, or resume. Waiting or loading, it cancels. */
  async toggle(): Promise<void> {
    // A press during a pause acts on the paused position, not the last tick's.
    if (this.pausing) await this.pausing;
    switch (this.state) {
      case "idle":
        if (this.latest) await this.startLatest();
        return;
      case "waiting":
      case "loading":
        this.unload();
        return;
      case "playing":
        await this.pause();
        return;
      case "paused": {
        if (!this.track) return;
        // A second press while the resume waits for the clock: stay paused.
        if (this.cancelResume()) return;
        const gen = ++this.gen;
        this.resumeGen = gen;
        await this.playFrom(this.positionMs, gen);
        return;
      }
    }
  }

  /** Key 2: stop and unload. */
  stop(): void {
    this.unload();
  }

  /** Key 3: the latest turn's full reply from its first paragraph, whatever is loaded. */
  async playFull(): Promise<void> {
    const turn = this.latest;
    if (!turn || turn.full.length === 0) return;
    await this.load(turn, turn.summary.length);
  }

  /**
   * Another session took the floor: pause where a press of 1 would. A
   * pending render is kept and lands paused at the start of its paragraph;
   * a wait on condensing is cancelled.
   */
  preempt(): void {
    if (this.state === "playing") this.detach(this.pause());
    else if (this.state === "paused") this.cancelResume();
    else if (this.state === "loading") this.pauseOnLoad = true;
    else if (this.state === "waiting") this.unload();
  }

  async tick(): Promise<void> {
    if (this.state !== "playing" || !this.track) return;
    const gen = this.gen;
    const now = await this.deps.now();
    if (gen !== this.gen || this.state !== "playing" || !this.track) return;
    this.positionMs = this.clamp(this.fromMs + (now - this.t0));
  }

  view(): View {
    const turn = this.loadedTurn;
    const track = this.track;
    let kind: View["kind"] = null;
    let paragraph = 0;
    let paragraphs = 0;
    if (turn && this.state !== "idle" && this.state !== "waiting") {
      const fullFrom = turn.fullFrom ?? 0;
      if (turn.fullFrom !== null && this.index < turn.fullFrom) {
        kind = "summary";
        paragraph = this.index + 1;
        paragraphs = turn.fullFrom;
      } else {
        kind = "full";
        paragraph = this.index - fullFrom + 1;
        paragraphs = turn.paragraphs.length - fullFrom;
      }
    }
    const showing = track !== null && (this.state === "playing" || this.state === "paused");
    return {
      state: this.state,
      kind,
      paragraph,
      paragraphs,
      positionMs: showing ? this.positionMs : 0,
      durationMs: showing ? track.rendered.durationMs : 0,
      sentence: showing ? this.sentenceAt(track, this.positionMs) : null,
    };
  }

  private startLatest(): Promise<void> {
    const turn = this.latest;
    if (!turn) return Promise.resolve();
    if (turn.summary.length === 0 && turn.condensing) {
      this.unload(false);
      this.state = "waiting";
      this.deps.onChange();
      return Promise.resolve();
    }
    return this.load(turn, 0);
  }

  private load(turn: ReplyTurn, index: number): Promise<void> {
    this.unload(false);
    this.pauseOnLoad = false;
    const gen = this.gen;
    const fullFrom = turn.summary.length > 0 ? turn.summary.length : null;
    const paragraphs = [...turn.summary, ...turn.full];
    this.loadedTurn = { id: turn.id, paragraphs, fullFrom };
    this.playlist.clear();
    this.playlist.add({ id: turn.id, length: paragraphs.length, fullFrom });
    return this.enter(this.playlist.goTo(turn.id, index, true), gen);
  }

  /** Apply a playlist move: render what it asks for and play its paragraph. */
  private async enter(move: Move, gen: number): Promise<void> {
    if (move.kind === "idle") {
      this.unload();
      return;
    }
    const turn = this.loadedTurn!;
    for (const i of move.request) {
      if (this.renders.has(i)) continue;
      const pending = this.deps.render(turn.paragraphs[i]!);
      pending.catch(() => {}); // a look-ahead failure surfaces when it is reached
      this.renders.set(i, pending);
    }
    const index = move.at.index;
    this.index = index;
    this.track = null;
    this.positionMs = 0;
    this.state = "loading";
    this.deps.onChange();
    let rendered: Rendered;
    try {
      rendered = await this.renders.get(index)!;
    } catch (err) {
      if (gen === this.gen) this.fail(err);
      return;
    }
    if (gen !== this.gen) return;
    const text = turn.paragraphs[index]!;
    this.track = { text, rendered, sentences: timeSentences(text, rendered.marks) };
    if (this.pauseOnLoad) {
      this.pauseOnLoad = false;
      this.state = "paused";
      this.positionMs = 0;
      this.deps.onChange();
      return;
    }
    await this.playFrom(0, gen);
  }

  /** Start the current track at `fromMs`; resolves once it is playing. */
  private async playFrom(fromMs: number, gen: number): Promise<void> {
    const track = this.track!;
    const { audio, durationMs } = track.rendered;
    const bytes = fromMs > 0 ? sliceFromMs(audio, durationMs, fromMs) : audio;
    const t0 = await this.deps.now();
    if (gen !== this.gen) return;
    this.fromMs = fromMs;
    this.positionMs = fromMs;
    this.t0 = t0;
    const abort = new AbortController();
    this.abort = abort;
    this.state = "playing";
    this.resumeGen = -1;
    this.deps.onChange();
    this.detach(this.follow(this.deps.play(bytes, abort.signal), gen));
  }

  /**
   * When the paragraph plays out, the next one in the run, or idle. Every
   * abort comes after a `gen` bump (pause, unload), so the gen check also
   * covers a clip that ended because it was aborted.
   */
  private async follow(done: Promise<void>, gen: number): Promise<void> {
    try {
      await done;
    } catch (err) {
      if (gen === this.gen) this.fail(err);
      return;
    }
    if (gen !== this.gen) return;
    await this.enter(this.playlist.next(), gen);
  }

  /** Stop the audio and hold the start of the sentence being read. */
  private async pause(): Promise<void> {
    const gen = ++this.gen;
    this.abort?.abort();
    this.abort = null;
    this.state = "paused";
    // Snap from the last tick before yielding, then refine from the clock.
    this.positionMs = this.sentenceStart(this.positionMs);
    const placing = (async () => {
      const now = await this.deps.now();
      if (gen !== this.gen || !this.track) return;
      this.positionMs = this.sentenceStart(this.fromMs + (now - this.t0));
      this.deps.onChange();
    })();
    this.pausing = placing;
    try {
      await placing;
    } finally {
      if (this.pausing === placing) this.pausing = null;
    }
  }

  /** A resume is waiting for the clock; the next press of 1 cancels it and stays paused. */
  get resuming(): boolean {
    return this.resumeGen === this.gen;
  }

  /** A resume waiting for the clock never starts; true when there was one. */
  private cancelResume(): boolean {
    if (!this.resuming) return false;
    this.gen++;
    return true;
  }

  /** The start of the sentence playing at `ms`, inside the paragraph. */
  private sentenceStart(ms: number): number {
    if (!this.track) return 0;
    return this.clamp(sentenceAtMs(this.track.sentences, this.clamp(ms))?.startMs ?? 0);
  }

  private fail(err: unknown): void {
    this.deps.onError(err);
    this.unload();
  }

  /** Back to idle with nothing loaded. */
  private unload(notify = true): void {
    this.gen++;
    this.pauseOnLoad = false;
    this.abort?.abort();
    this.abort = null;
    this.playlist.stop();
    this.loadedTurn = null;
    this.renders = new Map();
    this.track = null;
    this.index = 0;
    this.fromMs = 0;
    this.positionMs = 0;
    this.state = "idle";
    if (notify) this.deps.onChange();
  }

  private clamp(ms: number): number {
    const duration = this.track?.rendered.durationMs ?? 0;
    return Math.max(0, Math.min(duration, ms));
  }

  private sentenceAt(track: Track, ms: number): Segments | null {
    const sentence = sentenceAtMs(track.sentences, ms);
    if (!sentence) return null;
    const mark = markAtTime(track.rendered.marks, ms);
    const inside = mark && mark.start < sentence.end && mark.end > sentence.start ? mark : null;
    return sentenceSegments(track.text, sentence, inside);
  }

  private detach(work: Promise<void>): void {
    work.catch((err: unknown) => this.fail(err));
  }
}

/** The sentence playing at `ms`: the last one started by then, else the first. */
function sentenceAtMs(sentences: readonly TimedRange[], ms: number): TimedRange | null {
  let found: TimedRange | null = sentences[0] ?? null;
  for (const s of sentences) {
    if (s.startMs <= ms) found = s;
    else break;
  }
  return found;
}

function copy(turn: ReplyTurn): ReplyTurn {
  return { id: turn.id, summary: [...turn.summary], full: [...turn.full], condensing: turn.condensing };
}
