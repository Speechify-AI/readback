import { describe, expect, it } from "vitest";
import { timeSentences, type Mark } from "../src/marks.ts";
import type { Rendered } from "../src/renderShared.ts";
import { TtsError } from "../src/speechifyShared.ts";
import { LOOK_AHEAD } from "../src/webview/playlist.ts";
import { sliceFromMs } from "./bytes.ts";
import { Player, type PlayerDeps, type ReplyTurn } from "./player.ts";

const WORD_MS = 100;

/** Every word a mark of WORD_MS, back to back; audio one byte per ms. */
function rendered(text: string): Rendered {
  const marks: Mark[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const i = marks.length;
    marks.push({ start: m.index, end: m.index + m[0].length, startMs: i * WORD_MS, endMs: (i + 1) * WORD_MS });
  }
  const durationMs = marks.length * WORD_MS;
  const audio = new Uint8Array(durationMs);
  for (let i = 0; i < audio.length; i++) audio[i] = i % 251;
  return { audio, marks, durationMs };
}

interface PlayCall {
  bytes: Uint8Array;
  signal: AbortSignal;
  finish(): void;
  fail(err: unknown): void;
}

function fake(opts: { render?: (text: string) => Promise<Rendered> } = {}) {
  const clock = { t: 1000 };
  /** `now()` calls still to hold open, and the held ones waiting for `releaseNow`. */
  let hold = 0;
  const held: Array<() => void> = [];
  const renders: string[] = [];
  const plays: PlayCall[] = [];
  const errors: unknown[] = [];
  let changes = 0;
  const deps: PlayerDeps = {
    render: (text) => {
      renders.push(text);
      return opts.render ? opts.render(text) : Promise.resolve(rendered(text));
    },
    play: (bytes, signal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () => resolve());
        plays.push({ bytes, signal, finish: resolve, fail: reject });
      }),
    now: () => {
      if (hold === 0) return Promise.resolve(clock.t);
      hold--;
      return new Promise<number>((resolve) => held.push(() => resolve(clock.t)));
    },
    onChange: () => {
      changes++;
    },
    onError: (err) => {
      errors.push(err);
    },
  };
  const player = new Player(deps);
  return {
    player,
    clock,
    renders,
    plays,
    errors,
    changes: () => changes,
    holdNow: (n = 1) => {
      hold += n;
    },
    releaseNow: () => {
      for (const release of held.splice(0)) release();
    },
  };
}

/** Let detached continuations run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const last = <T>(xs: T[]): T => xs[xs.length - 1]!;

const turn = (id: string, summary: string[], full: string[], condensing = false): ReplyTurn => ({
  id,
  summary,
  full,
  condensing,
});

const SUMMARY = ["Sum one. Sum two.", "Sum three.", "Sum four.", "Sum five."];
const FULL = ["Full one is long. Full two.", "Full three."];

describe("Player", () => {
  it("hasLatest is true once a turn has landed", () => {
    const f = fake();
    expect(f.player.hasLatest).toBe(false);
    f.player.setLatest(turn("a", SUMMARY, FULL));
    expect(f.player.hasLatest).toBe(true);
  });

  it("toggle from idle plays the latest turn's summary run", async () => {
    const f = fake();
    f.player.setLatest(turn("a", SUMMARY, FULL));
    await f.player.toggle();
    expect(f.player.view()).toMatchObject({ state: "playing", kind: "summary", paragraph: 1, paragraphs: 4 });
    expect(f.plays).toHaveLength(1);
    expect(f.plays[0]!.bytes).toEqual(rendered(SUMMARY[0]!).audio);
    expect(f.player.loaded).toBe(true);
  });

  it("toggle from idle without a summary plays the full reply from paragraph 0", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL));
    await f.player.toggle();
    expect(f.player.view()).toMatchObject({ state: "playing", kind: "full", paragraph: 1, paragraphs: 2 });
    expect(f.renders[0]).toBe(FULL[0]);
  });

  it("play while condensing waits, then plays the summary", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL, true));
    await f.player.toggle();
    expect(f.player.view().state).toBe("waiting");
    expect(f.player.loaded).toBe(true);
    expect(f.renders).toEqual([]);
    expect(f.plays).toEqual([]);
    f.player.summaryReady("a", ["Short. Version."]);
    await settle();
    expect(f.player.view()).toMatchObject({ state: "playing", kind: "summary", paragraphs: 1 });
    expect(f.renders[0]).toBe("Short. Version.");
  });

  it("play while condensing that fails plays the full reply", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL, true));
    await f.player.toggle();
    f.player.summaryReady("a", null);
    await settle();
    expect(f.player.view()).toMatchObject({ state: "playing", kind: "full", paragraph: 1, paragraphs: 2 });
    expect(f.renders[0]).toBe(FULL[0]);
  });

  it("toggle while waiting goes back to idle and the summary does not start it", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL, true));
    await f.player.toggle();
    await f.player.toggle();
    expect(f.player.view().state).toBe("idle");
    expect(f.player.loaded).toBe(false);
    f.player.summaryReady("a", ["Short."]);
    await settle();
    expect(f.player.view().state).toBe("idle");
    expect(f.plays).toEqual([]);
  });

  it("a summary for a turn that is not the latest is ignored", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL, true));
    f.player.setLatest(turn("b", [], ["B full."], true));
    f.player.summaryReady("a", ["Old."]);
    await f.player.toggle();
    expect(f.player.view().state).toBe("waiting");
  });

  it("a new turn while waiting takes over the wait", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL, true));
    await f.player.toggle();
    f.player.setLatest(turn("b", [], ["B full."]));
    await settle();
    expect(f.player.view()).toMatchObject({ state: "playing", kind: "full" });
    expect(f.renders).toEqual(["B full."]);
  });

  it("renders the current paragraph plus the look-ahead, each once, and a summary run stops at fullFrom", async () => {
    const f = fake();
    f.player.setLatest(turn("a", SUMMARY, FULL));
    await f.player.toggle();
    expect(f.renders).toEqual(SUMMARY.slice(0, 1 + LOOK_AHEAD));
    for (let i = 1; i < SUMMARY.length; i++) {
      last(f.plays).finish();
      await settle();
      expect(f.player.view()).toMatchObject({ state: "playing", kind: "summary", paragraph: i + 1 });
    }
    expect(f.renders).toEqual(SUMMARY);
    last(f.plays).finish();
    await settle();
    expect(f.player.view().state).toBe("idle");
    expect(f.plays).toHaveLength(SUMMARY.length);
    expect(f.renders).toEqual(SUMMARY);
  });

  it("toggle while playing pauses at the start of the current sentence; toggle again resumes there", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL));
    await f.player.toggle();
    const text = FULL[0]!;
    const r = rendered(text);
    const [, second] = timeSentences(text, r.marks);
    f.clock.t += second!.startMs + 150; // inside the second sentence
    await f.player.toggle();
    expect(f.plays[0]!.signal.aborted).toBe(true);
    expect(f.player.view()).toMatchObject({ state: "paused", positionMs: second!.startMs, kind: "full" });
    expect(f.player.loaded).toBe(true);

    f.clock.t += 5000;
    await f.player.toggle();
    expect(f.player.view()).toMatchObject({ state: "playing", positionMs: second!.startMs });
    expect(f.plays[1]!.bytes).toEqual(sliceFromMs(r.audio, r.durationMs, second!.startMs));
    expect(f.renders).toHaveLength(2); // nothing rendered again
    f.clock.t += 100;
    await f.player.tick();
    expect(f.player.view().positionMs).toBe(second!.startMs + 100);
  });

  it("pause on the last sentence of a chunked paragraph resumes at that sentence", async () => {
    let long = "";
    for (let n = 1; long.length <= 2500; n++) long += `Sentence number ${n} carries a few words. `;
    long = long.trim();
    const r = rendered(long);
    expect(r.marks.some((m) => m.start > 2000)).toBe(true);
    const f = fake();
    f.player.setLatest(turn("a", [], [long]));
    await f.player.toggle();
    const sentences = timeSentences(long, r.marks);
    const lastOne = last(sentences);
    f.clock.t += r.durationMs - 50; // on the last sentence, near its end
    await f.player.tick();
    expect(f.player.view().sentence).toMatchObject({ after: "" });
    await f.player.toggle();
    expect(f.player.view()).toMatchObject({ state: "paused", positionMs: lastOne.startMs });
    expect(f.player.view().positionMs).toBeLessThan(r.durationMs);
    await f.player.toggle();
    expect(f.plays[1]!.bytes).toEqual(sliceFromMs(r.audio, r.durationMs, lastOne.startMs));
    expect(f.plays[1]!.bytes.length).toBeGreaterThan(0);
    const seg = f.player.view().sentence!;
    expect(seg.before + seg.word + seg.after).toBe(long.slice(lastOne.start, lastOne.end).trim());
  });

  it("a pause past the paragraph's end never lands past it", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], ["One. Two."]));
    await f.player.toggle();
    f.clock.t += 60_000;
    await f.player.tick();
    const r = rendered("One. Two.");
    expect(f.player.view().positionMs).toBe(r.durationMs);
    await f.player.toggle();
    expect(f.player.view().positionMs).toBe(last(timeSentences("One. Two.", r.marks)).startMs);
  });

  it("preempt pauses like toggle while playing", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL));
    await f.player.toggle();
    const r = rendered(FULL[0]!);
    const [, second] = timeSentences(FULL[0]!, r.marks);
    f.clock.t += second!.startMs + 150; // inside the second sentence
    f.player.preempt();
    await settle();
    expect(f.plays[0]!.signal.aborted).toBe(true);
    expect(f.player.view()).toMatchObject({ state: "paused", positionMs: second!.startMs });
    await f.player.toggle();
    expect(f.player.view().state).toBe("playing");
    expect(f.plays[1]!.bytes).toEqual(sliceFromMs(r.audio, r.durationMs, second!.startMs));
  });

  it("preempt while waiting cancels the wait", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL, true));
    await f.player.toggle();
    f.player.preempt();
    f.player.summaryReady("a", ["Short."]);
    await settle();
    expect(f.player.view().state).toBe("idle");
    expect(f.plays).toEqual([]);
  });

  it("start plays the latest turn from its start whatever is loaded: a reply landing on a paused note does not resume the note", async () => {
    const f = fake();
    f.player.setLatest(turn("note", [], ["The note."]));
    await f.player.toggle();
    await f.player.toggle(); // paused
    f.player.setLatest(turn("reply", [], ["The reply."]));
    await f.player.start();
    await settle();
    expect(f.player.view()).toMatchObject({ state: "playing", kind: "full" });
    expect(last(f.renders)).toBe("The reply.");
    expect(f.plays[0]!.signal.aborted).toBe(true);
    expect(last(f.plays).bytes).toEqual(rendered("The reply.").audio);
  });

  it("start while a note is still loading plays the reply, not nothing", async () => {
    const d = deferred<Rendered>();
    const f = fake({ render: (text) => (text === "The note." ? d.promise : Promise.resolve(rendered(text))) });
    f.player.setLatest(turn("note", [], ["The note."]));
    void f.player.toggle(); // resolves only once the render lands, as the hook's detached press
    await settle();
    expect(f.player.view().state).toBe("loading");
    f.player.setLatest(turn("reply", [], ["The reply."]));
    await f.player.start();
    await settle();
    expect(f.player.view()).toMatchObject({ state: "playing" });
    expect(last(f.plays).bytes).toEqual(rendered("The reply.").audio);
    d.resolve(rendered("The note.")); // the stale render lands on a gone generation
    await settle();
    expect(f.plays.length).toBe(1);
  });

  it("stop goes idle and unloads", async () => {
    const f = fake();
    f.player.setLatest(turn("a", SUMMARY, FULL));
    await f.player.toggle();
    f.player.stop();
    expect(f.plays[0]!.signal.aborted).toBe(true);
    expect(f.player.view()).toEqual({
      state: "idle",
      kind: null,
      paragraph: 0,
      paragraphs: 0,
      positionMs: 0,
      durationMs: 0,
      sentence: null,
    });
    expect(f.player.loaded).toBe(false);
    await settle();
    expect(f.player.view().state).toBe("idle");
  });

  it("playFull plays the latest turn's full reply from its first full paragraph, whatever is loaded", async () => {
    const f = fake();
    f.player.setLatest(turn("a", SUMMARY, FULL));
    await f.player.toggle();
    await f.player.playFull();
    expect(f.plays[0]!.signal.aborted).toBe(true);
    expect(f.player.view()).toMatchObject({ state: "playing", kind: "full", paragraph: 1, paragraphs: 2 });
    expect(last(f.renders)).not.toBe(SUMMARY[0]);
    expect(f.plays[1]!.bytes).toEqual(rendered(FULL[0]!).audio);
    last(f.plays).finish();
    await settle();
    expect(f.player.view()).toMatchObject({ state: "playing", kind: "full", paragraph: 2 });
    last(f.plays).finish();
    await settle();
    expect(f.player.view().state).toBe("idle");
  });

  it("setLatest while playing does not interrupt; the next idle toggle plays the new turn", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], ["A one.", "A two."]));
    await f.player.toggle();
    f.player.setLatest(turn("b", ["B summary."], ["B full."]));
    await settle();
    expect(f.plays[0]!.signal.aborted).toBe(false);
    last(f.plays).finish();
    await settle();
    expect(f.renders).toContain("A two.");
    expect(f.player.view()).toMatchObject({ state: "playing", paragraph: 2 });
    last(f.plays).finish();
    await settle();
    expect(f.player.view().state).toBe("idle");
    await f.player.toggle();
    expect(last(f.renders)).toBe("B summary.");
  });

  it("3 after a new reply plays the new reply's full text", async () => {
    const f = fake();
    f.player.setLatest(turn("a", ["A summary."], ["A full."]));
    await f.player.toggle();
    f.player.setLatest(turn("b", ["B summary."], ["B full one.", "B full two."]));
    expect(f.plays[0]!.signal.aborted).toBe(false);
    await f.player.playFull();
    expect(f.plays[0]!.signal.aborted).toBe(true);
    expect(f.plays[1]!.bytes).toEqual(rendered("B full one.").audio);
    expect(f.player.view()).toMatchObject({ state: "playing", kind: "full", paragraphs: 2 });
  });

  it("tick moves the position with the clock and lights the spoken word in its sentence", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], ["Hello there   world. Next\nline here."]));
    await f.player.toggle();
    expect(f.player.view().sentence).toEqual({ before: "", word: "Hello", after: " there world." });
    f.clock.t += 2 * WORD_MS + 10;
    await f.player.tick();
    expect(f.player.view().positionMs).toBe(2 * WORD_MS + 10);
    expect(f.player.view().sentence).toEqual({ before: "Hello there ", word: "world.", after: "" });
    f.clock.t += 2 * WORD_MS;
    await f.player.tick();
    expect(f.player.view().sentence).toEqual({ before: "Next ", word: "line", after: " here." });
    expect(f.player.view().durationMs).toBe(6 * WORD_MS);
  });

  it("a 401 on render reports the error and goes idle", async () => {
    const err = new TtsError(401, "bad key");
    const f = fake({ render: () => Promise.reject(err) });
    f.player.setLatest(turn("a", ["S."], ["F."]));
    await f.player.toggle();
    await settle();
    expect(f.errors).toEqual([err]);
    expect(f.player.view().state).toBe("idle");
    expect(f.player.loaded).toBe(false);
    expect(f.plays).toEqual([]);
  });

  it("a 403 on a look-ahead render reports the error when it is reached", async () => {
    const err = new TtsError(403, "forbidden");
    const f = fake({ render: (t) => (t === "Two." ? Promise.reject(err) : Promise.resolve(rendered(t))) });
    f.player.setLatest(turn("a", [], ["One.", "Two."]));
    await f.player.toggle();
    expect(f.errors).toEqual([]);
    last(f.plays).finish();
    await settle();
    expect(f.errors).toEqual([err]);
    expect(f.player.view().state).toBe("idle");
  });

  it("calls onChange when the state changes", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL));
    const before = f.changes();
    await f.player.toggle();
    expect(f.changes()).toBeGreaterThan(before);
    const playing = f.changes();
    f.clock.t += 50;
    await f.player.tick();
    expect(f.changes()).toBe(playing);
    await f.player.toggle();
    expect(f.changes()).toBeGreaterThan(playing);
  });
});

describe("Player in-flight races", () => {
  const pending = (cancel: (p: Player) => void) => async () => {
    const late = deferred<Rendered>();
    const f = fake({ render: () => late.promise });
    f.player.setLatest(turn("a", [], ["One. Two."]));
    const started = f.player.toggle();
    await settle();
    expect(f.player.view().state).toBe("loading");
    cancel(f.player);
    expect(f.player.view().state).toBe("idle");
    late.resolve(rendered("One. Two."));
    await started;
    await settle();
    expect(f.player.view().state).toBe("idle");
    expect(f.player.loaded).toBe(false);
    expect(f.plays).toEqual([]);
  };

  it("stop while a render is pending ignores the late render", pending((p) => p.stop()));
  it("toggle while a render is pending cancels, and the late render plays nothing", pending((p) => void p.toggle()));

  it("preempt while a render is pending leaves it paused at 0 once the render lands; toggle resumes it", async () => {
    const late = deferred<Rendered>();
    const f = fake({ render: () => late.promise });
    f.player.setLatest(turn("a", [], ["One. Two."]));
    const started = f.player.toggle();
    await settle();
    expect(f.player.view().state).toBe("loading");
    f.player.preempt();
    const r = rendered("One. Two.");
    late.resolve(r);
    await started;
    await settle();
    expect(f.player.view()).toMatchObject({ state: "paused", kind: "full", positionMs: 0 });
    expect(f.plays).toEqual([]);
    await f.player.toggle();
    expect(f.player.view().state).toBe("playing");
    expect(f.plays[0]!.bytes).toEqual(r.audio);
  });

  it("preempt while the full reply's render is pending keeps the full reply", async () => {
    const late = deferred<Rendered>();
    const f = fake({ render: () => late.promise });
    f.player.setLatest(turn("a", ["Sum one."], ["Full one.", "Full two."]));
    const started = f.player.playFull();
    await settle();
    f.player.preempt();
    late.resolve(rendered("Full one."));
    await started;
    await settle();
    expect(f.player.view()).toMatchObject({ state: "paused", kind: "full", paragraph: 1 });
  });

  it("stop after a preempt while loading still unloads", async () => {
    const late = deferred<Rendered>();
    const f = fake({ render: () => late.promise });
    f.player.setLatest(turn("a", [], ["One. Two."]));
    const started = f.player.toggle();
    await settle();
    f.player.preempt();
    f.player.stop();
    late.resolve(rendered("One. Two."));
    await started;
    await settle();
    expect(f.player.view().state).toBe("idle");
    // A fresh play is not caught by the stale preempt.
    await f.player.toggle();
    expect(f.player.view().state).toBe("playing");
  });

  it("preempt during a resume leaves it paused at the sentence start", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL));
    await f.player.toggle();
    const r = rendered(FULL[0]!);
    const [, second] = timeSentences(FULL[0]!, r.marks);
    f.clock.t += second!.startMs + 150;
    await f.player.toggle();
    expect(f.player.view()).toMatchObject({ state: "paused", positionMs: second!.startMs });
    f.holdNow();
    const resuming = f.player.toggle();
    await settle();
    f.player.preempt();
    f.releaseNow();
    await resuming;
    await settle();
    expect(f.player.view()).toMatchObject({ state: "paused", positionMs: second!.startMs });
    expect(f.plays).toHaveLength(1);
    await f.player.toggle();
    expect(f.player.view().state).toBe("playing");
    expect(f.plays[1]!.bytes).toEqual(sliceFromMs(r.audio, r.durationMs, second!.startMs));
  });

  it("a second press during a resume keeps it paused", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL));
    await f.player.toggle();
    await f.player.toggle();
    f.holdNow();
    const resuming = f.player.toggle();
    await settle();
    await f.player.toggle();
    f.releaseNow();
    await resuming;
    await settle();
    expect(f.player.view().state).toBe("paused");
    expect(f.plays).toHaveLength(1);
  });

  it("toggle during a pause resumes at the sentence start, not the last tick", async () => {
    const f = fake();
    f.player.setLatest(turn("a", [], FULL));
    await f.player.toggle();
    const r = rendered(FULL[0]!);
    const [, second] = timeSentences(FULL[0]!, r.marks);
    f.clock.t += second!.startMs + 150;
    await f.player.tick();
    expect(f.player.view().positionMs).toBe(second!.startMs + 150);
    f.holdNow();
    const pausing = f.player.toggle();
    await settle();
    const resuming = f.player.toggle();
    await settle();
    f.releaseNow();
    await pausing;
    await resuming;
    await settle();
    expect(f.player.view()).toMatchObject({ state: "playing", positionMs: second!.startMs });
    expect(f.plays[1]!.bytes).toEqual(sliceFromMs(r.audio, r.durationMs, second!.startMs));
  });
});
