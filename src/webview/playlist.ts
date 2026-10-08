/**
 * What plays next. The order of the player, with no DOM and no audio.
 *
 * A turn is a list of paragraphs. A run is the stretch of one turn played
 * from a starting paragraph to the end, or to `fullFrom` when the turn is
 * condensed: the full reply plays only when asked for. A new turn plays at
 * once when nothing is playing, and queues behind the current run otherwise,
 * one entry per turn. A turn that grows while it is current makes the run
 * longer; one that grows while it waits plays through its new paragraphs
 * from the entry it already has.
 *
 * An alert jumps the queue: what was playing goes back to the front of it,
 * at the paragraph it was on, and the alert plays now. A new prompt from the
 * person stops everything; the reply they were hearing has been read.
 *
 * With autoplay off, arrivals are counted as unheard instead of queued, and
 * a turn stops being unheard when it plays.
 *
 * The player applies the results: it owns the audio element and the DOM;
 * this knows only ids, indices and lengths, so the order can be tested.
 */

export interface Playhead {
  turnId: string;
  index: number;
}

/** A listed turn as far as the order needs it. */
export interface Listed {
  id: string;
  length: number;
  fullFrom: number | null;
}

/** Paragraphs requested ahead of the playhead, inside the run. */
export const LOOK_AHEAD = 2;

export type Move =
  /** Play this paragraph; request these indices (it and the look-ahead). */
  | { kind: "play"; previous: Playhead | null; at: Playhead; request: number[] }
  /** Nothing left to play. */
  | { kind: "idle"; previous: Playhead | null };

export type Arrival =
  | Move
  | { kind: "queued"; waiting: number }
  | { kind: "unheard"; count: number }
  /** Not a listed turn. */
  | { kind: "none" };

export class Playlist {
  private turns = new Map<string, Listed>();
  private queue: Playhead[] = [];
  private head: Playhead | null = null;
  /** First index the current run will not play. */
  private runEnd = 0;
  private unheard = new Set<string>();
  autoplay = true;

  get current(): Playhead | null {
    return this.head;
  }

  get waiting(): number {
    return this.queue.length;
  }

  get unheardCount(): number {
    return this.unheard.size;
  }

  has(turnId: string): boolean {
    return this.turns.has(turnId);
  }

  isUnheard(turnId: string): boolean {
    return this.unheard.has(turnId);
  }

  isCurrent(turnId: string, index: number): boolean {
    return this.head !== null && this.head.turnId === turnId && this.head.index === index;
  }

  add(turn: Listed): void {
    this.turns.set(turn.id, { ...turn });
  }

  /** Forget everything, including what was playing. */
  clear(): void {
    this.turns.clear();
    this.stop();
    this.unheard.clear();
  }

  /** Stop playing and forget the queue. The turns stay listed. */
  stop(): Playhead | null {
    const previous = this.head;
    this.head = null;
    this.queue = [];
    this.runEnd = 0;
    return previous;
  }

  /**
   * A listed turn has more paragraphs. When it is the one playing, the run
   * gets longer and the look-ahead may need more; the result says which
   * indices to request. Otherwise null: the caller decides whether the new
   * paragraphs arrive like a new turn.
   */
  grow(turnId: string, length: number, fullFrom: number | null): { request: number[] } | null {
    const turn = this.turns.get(turnId);
    if (!turn) return null;
    turn.length = length;
    turn.fullFrom = fullFrom;
    if (this.head === null || this.head.turnId !== turnId) return null;
    this.runEnd = runEndFor(turn, this.head.index);
    return { request: this.lookAhead(this.head.index + 1) };
  }

  /** A turn, or more of one, is here: play it, queue it, or count it as unheard. */
  arrive(turnId: string, index: number): Arrival {
    if (!this.turns.has(turnId)) return { kind: "none" };
    if (!this.autoplay) {
      this.unheard.add(turnId);
      return { kind: "unheard", count: this.unheard.size };
    }
    if (this.head !== null) {
      // One entry per turn. A queued turn that grows plays through its new
      // paragraphs from the entry it already has; a second entry would replay them.
      const queued = this.queue.find((q) => q.turnId === turnId);
      if (queued) queued.index = Math.min(queued.index, index);
      else this.queue.push({ turnId, index });
      return { kind: "queued", waiting: this.queue.length };
    }
    return this.goTo(turnId, index);
  }

  /**
   * Start, or carry on, a run at this paragraph. Past the run's end, the
   * next queued turn plays, or nothing does. Chosen by hand (a click, the
   * play button), the queue is dropped first: the person said what to hear.
   */
  goTo(turnId: string, index: number, byHand = false): Move {
    if (byHand) this.queue = [];
    const turn = this.turns.get(turnId);
    if (!turn) return { kind: "idle", previous: this.stop() };
    const sameRun = this.head !== null && this.head.turnId === turnId && index > this.head.index;
    if (!sameRun) this.runEnd = runEndFor(turn, index);
    if (index >= this.runEnd) return this.finish();
    const previous = this.head;
    this.head = { turnId, index };
    this.unheard.delete(turnId);
    return { kind: "play", previous, at: this.head, request: [index, ...this.lookAhead(index + 1)] };
  }

  /** The paragraph after the current one, or whatever follows the run. */
  next(): Move {
    if (this.head === null) return { kind: "idle", previous: null };
    return this.goTo(this.head.turnId, this.head.index + 1);
  }

  /** The current run is over: the next queued turn plays, or nothing does. */
  finish(): Move {
    const previous = this.head;
    this.head = null;
    this.runEnd = 0;
    const upcoming = this.queue.shift();
    if (!upcoming) return { kind: "idle", previous };
    const move = this.goTo(upcoming.turnId, upcoming.index);
    return move.kind === "play" ? { ...move, previous } : move;
  }

  /**
   * Play this turn now. Whatever was playing goes to the front of the queue
   * at the paragraph it was on, so it carries on after. Honours autoplay off
   * like any arrival: an alert nobody asked to hear is listed and counted.
   */
  urgent(turnId: string): Arrival {
    if (!this.turns.has(turnId)) return { kind: "none" };
    if (!this.autoplay) return this.arrive(turnId, 0);
    if (this.head !== null && this.head.turnId !== turnId) {
      this.queue = [this.head, ...this.queue.filter((q) => q.turnId !== this.head?.turnId)];
    }
    const previous = this.head;
    this.head = null;
    const move = this.goTo(turnId, 0);
    return { ...move, previous };
  }

  private lookAhead(from: number): number[] {
    const indices: number[] = [];
    for (let i = from; i < Math.min(from + LOOK_AHEAD, this.runEnd); i++) indices.push(i);
    return indices;
  }
}

/** Where a run starting at `index` ends: before the full reply, or at the end. */
export function runEndFor(turn: Listed, index: number): number {
  if (turn.fullFrom !== null && index < turn.fullFrom) return turn.fullFrom;
  return turn.length;
}

export type Step =
  | { kind: "seek"; ms: number }
  /** Back past the first sentence: the previous paragraph, or the start when there is none. */
  | { kind: "previous" }
  /** Forward past the last sentence: the next paragraph. */
  | { kind: "next" };

/**
 * Sentence-sized steps. Back goes to the start of the sentence before the
 * one playing, unless the playhead is within 900 ms of a sentence start, in
 * which case that start counts as "this sentence" and the step goes to the
 * one before it; forward goes to the next sentence start past the playhead.
 */
export function stepFrom(starts: readonly number[], nowMs: number, direction: -1 | 1): Step {
  if (direction < 0) {
    const previous = [...starts].reverse().find((t) => t < nowMs - 900);
    return previous === undefined ? { kind: "previous" } : { kind: "seek", ms: previous };
  }
  const upcoming = starts.find((t) => t > nowMs + 50);
  return upcoming === undefined ? { kind: "next" } : { kind: "seek", ms: upcoming };
}
