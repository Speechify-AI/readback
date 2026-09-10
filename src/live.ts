/**
 * A turn as it streams: from hook payloads to things worth reading.
 *
 * Claude Code fires MessageDisplay with each batch of completed lines of an
 * assistant message, the last batch marked final. What follows that message
 * says what it was. PreToolUse with the same prompt_id means it was a note
 * written before a tool call, to be read as it stands. Stop with the same
 * prompt_id means it was the finished reply, which the extension condenses.
 * A completed message is therefore held until one of those arrives, with a
 * long timer as the fallback for the case where neither does.
 *
 * Measured on 2.1.267: PreToolUse follows a note by about 400 ms; Stop
 * follows the final message by 27 ms headless and by up to 1.5 s in an
 * interactive session. A timing window alone got that last case wrong, so
 * the timer is generous and Stop is also checked against the last note read:
 * a reply that was already read as a note is not read again.
 *
 * Text is the truth: at Stop, `last_assistant_message` wins over whatever was
 * held, and a held message the hook never confirmed is dropped in its favour.
 *
 * Pure apart from the timers and the clock, which are injected so tests
 * need neither.
 */

/** What released a held message as a progress note. */
export type Released = "tool" | "message" | "timeout";

export type LiveEvent =
  | { kind: "progress"; key: string; markdown: string; cwd: string | null; via: Released; heldMs: number }
  | {
      kind: "final";
      key: string | null;
      markdown: string | null;
      cwd: string | null;
      /** How long the last message waited for this Stop; null when nothing was held. */
      heldMs: number | null;
      /** The reply's text was already read as a progress note; do not read it again. */
      readAsProgress: boolean;
    };

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * How long a completed message waits when neither PreToolUse nor Stop
 * follows it. Both normally arrive well inside this; a message that hits
 * the timer is read as a note, and Stop's text check catches it if that was
 * wrong.
 */
export const GRACE_MS = 5000;

/** Messages still streaming with no final flush yet; more than this and the oldest is dropped. */
const MAX_PARTIAL = 50;

type Payload = Record<string, unknown>;

/** One turn of one session: what MessageDisplay, PreToolUse and Stop share. */
function turnKey(payload: Payload): string | null {
  const { session_id, prompt_id } = payload;
  return typeof session_id === "string" && typeof prompt_id === "string" ? `${session_id}/${prompt_id}` : null;
}

function cwdOf(payload: Payload): string | null {
  return typeof payload.cwd === "string" ? payload.cwd : null;
}

interface Held {
  markdown: string;
  cwd: string | null;
  timer: unknown;
  since: number;
}

export class LiveTurns {
  /** Messages still streaming, by turn key and message id. */
  private partial = new Map<string, string>();
  /** Completed messages waiting to learn what they were, by turn key. */
  private held = new Map<string, Held>();
  /** The last note read per turn, so Stop can tell when the reply was already heard. */
  private lastRead = new Map<string, string>();

  constructor(
    private readonly emit: (event: LiveEvent) => void,
    private readonly graceMs: number = GRACE_MS,
    private readonly timers: Timers = realTimers,
    private readonly now: () => number = Date.now,
  ) {}

  /** A hook payload, of any event. Only MessageDisplay, PreToolUse and Stop do anything. */
  accept(payload: unknown): void {
    if (typeof payload !== "object" || payload === null) return;
    const p = payload as Payload;
    switch (p.hook_event_name) {
      case "MessageDisplay":
        this.display(p);
        return;
      case "PreToolUse": {
        const key = turnKey(p);
        if (key !== null) this.release(key, "tool");
        return;
      }
      // A payload without an event name is taken as Stop, as before.
      case "Stop":
      case undefined:
        this.stop(p);
        return;
      default:
        return;
    }
  }

  private display(p: Payload): void {
    const key = turnKey(p);
    const { message_id, delta, final } = p;
    if (key === null || typeof message_id !== "string" || typeof delta !== "string") return;
    const id = `${key}/${message_id}`;
    const text = (this.partial.get(id) ?? "") + delta;
    if (final !== true) {
      this.partial.set(id, text);
      if (this.partial.size > MAX_PARTIAL) {
        const oldest = this.partial.keys().next().value;
        if (oldest !== undefined) this.partial.delete(oldest);
      }
      return;
    }
    this.partial.delete(id);
    if (text.trim() === "") return;
    // A second message completing means the first was not the reply.
    this.release(key, "message");
    const timer = this.timers.set(() => this.release(key, "timeout"), this.graceMs);
    this.held.set(key, { markdown: text, cwd: cwdOf(p), timer, since: this.now() });
  }

  /** Read a held message as a progress note. */
  private release(key: string, via: Released): void {
    const held = this.held.get(key);
    if (!held) return;
    this.held.delete(key);
    this.timers.clear(held.timer);
    this.lastRead.set(key, held.markdown.trim());
    if (this.lastRead.size > MAX_PARTIAL) {
      const oldest = this.lastRead.keys().next().value;
      if (oldest !== undefined) this.lastRead.delete(oldest);
    }
    this.emit({ kind: "progress", key, markdown: held.markdown, cwd: held.cwd, via, heldMs: this.now() - held.since });
  }

  private stop(p: Payload): void {
    const key = turnKey(p);
    const held = key === null ? undefined : this.held.get(key);
    let lastRead: string | undefined;
    if (key !== null) {
      if (held) {
        this.held.delete(key);
        this.timers.clear(held.timer);
      }
      lastRead = this.lastRead.get(key);
      this.lastRead.delete(key);
      for (const id of this.partial.keys()) if (id.startsWith(`${key}/`)) this.partial.delete(id);
    }
    const message = p.last_assistant_message;
    const markdown = typeof message === "string" ? message : held?.markdown ?? null;
    this.emit({
      kind: "final",
      key,
      markdown,
      cwd: cwdOf(p) ?? held?.cwd ?? null,
      heldMs: held ? this.now() - held.since : null,
      readAsProgress: markdown !== null && lastRead !== undefined && lastRead === markdown.trim(),
    });
  }
}
