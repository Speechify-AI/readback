import { describe, expect, it } from "vitest";
import { LiveTurns, type LiveEvent, type Timers } from "./live.ts";

/** Timers that fire only when told to, and a clock that moves only when pushed. */
function fakeClock() {
  const pending = new Map<number, () => void>();
  let next = 0;
  let time = 1_000_000;
  const timers: Timers = {
    set: (fn) => {
      const handle = ++next;
      pending.set(handle, fn);
      return handle;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
    fire: () => {
      for (const [handle, fn] of [...pending]) {
        pending.delete(handle);
        fn();
      }
    },
    pending: () => pending.size,
  };
}

function setup() {
  const events: LiveEvent[] = [];
  const clock = fakeClock();
  const live = new LiveTurns((e) => events.push(e), 5000, clock.timers, clock.now);
  return { events, clock, live };
}

const session = { session_id: "s1", prompt_id: "p1", cwd: "/Users/me/code/app" };
const display = (fields: Record<string, unknown>) => ({ hook_event_name: "MessageDisplay", ...session, ...fields });
const tool = (fields: Record<string, unknown> = {}) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", ...session, ...fields });
const stop = (fields: Record<string, unknown> = {}) => ({ hook_event_name: "Stop", ...session, ...fields });

describe("LiveTurns", () => {
  it("reads a message followed by a tool call as progress, at once", () => {
    const { events, clock, live } = setup();
    live.accept(display({ message_id: "m1", index: 0, delta: "I'll check the settings file first.", final: true }));
    expect(events).toEqual([]);
    clock.advance(400);
    live.accept(tool());
    expect(events).toEqual([
      { kind: "progress", key: "s1/p1", markdown: "I'll check the settings file first.", cwd: "/Users/me/code/app", via: "tool", heldMs: 400 },
    ]);
    expect(clock.pending()).toBe(0);
  });

  it("reads a message nothing follows as progress when the timer runs out", () => {
    const { events, clock, live } = setup();
    live.accept(display({ message_id: "m1", index: 0, delta: "Still here.", final: true }));
    clock.advance(5000);
    clock.fire();
    expect(events).toEqual([expect.objectContaining({ kind: "progress", via: "timeout", heldMs: 5000 })]);
  });

  it("treats a message followed by Stop as the reply, with Stop's text and the wait", () => {
    const { events, clock, live } = setup();
    live.accept(display({ message_id: "m1", index: 0, delta: "All done.", final: true }));
    clock.advance(1520);
    live.accept(stop({ last_assistant_message: "All done." }));
    expect(events).toEqual([
      { kind: "final", key: "s1/p1", markdown: "All done.", cwd: "/Users/me/code/app", heldMs: 1520, readAsProgress: false },
    ]);
    expect(clock.pending()).toBe(0);
    clock.fire();
    expect(events).toHaveLength(1);
  });

  it("flags a reply that was already read as a note, so it is not read twice", () => {
    const { events, clock, live } = setup();
    live.accept(display({ message_id: "m1", index: 0, delta: "The whole reply.\n", final: true }));
    clock.advance(5000);
    clock.fire();
    live.accept(stop({ last_assistant_message: "The whole reply." }));
    expect(events.map((e) => e.kind)).toEqual(["progress", "final"]);
    expect(events[1]).toEqual(expect.objectContaining({ kind: "final", readAsProgress: true, heldMs: null }));
    // The next turn starts clean.
    live.accept(stop({ prompt_id: "p2", last_assistant_message: "The whole reply." }));
    expect(events[2]).toEqual(expect.objectContaining({ readAsProgress: false }));
  });

  it("does not flag a reply that only matches an older note", () => {
    const { events, live } = setup();
    live.accept(display({ message_id: "m1", index: 0, delta: "Looking.", final: true }));
    live.accept(tool());
    live.accept(display({ message_id: "m2", index: 0, delta: "Found it.", final: true }));
    live.accept(tool());
    live.accept(display({ message_id: "m3", index: 0, delta: "Done.", final: true }));
    live.accept(stop({ last_assistant_message: "Done." }));
    expect(events.map((e) => [e.kind, e.kind === "final" ? e.readAsProgress : e.via])).toEqual([
      ["progress", "tool"],
      ["progress", "tool"],
      ["final", false],
    ]);
  });

  it("joins the batches of one message until the final one", () => {
    const { events, live } = setup();
    live.accept(display({ message_id: "m1", index: 0, delta: "First line.\n", final: false }));
    live.accept(display({ message_id: "m1", index: 1, delta: "Second line.", final: true }));
    live.accept(tool());
    expect(events).toEqual([expect.objectContaining({ kind: "progress", markdown: "First line.\nSecond line." })]);
  });

  it("releases a held message as soon as the next one completes", () => {
    const { events, clock, live } = setup();
    live.accept(display({ message_id: "m1", index: 0, delta: "Looking.", final: true }));
    live.accept(display({ message_id: "m2", index: 0, delta: "Found it.", final: true }));
    expect(events).toEqual([expect.objectContaining({ kind: "progress", markdown: "Looking.", via: "message" })]);
    expect(clock.pending()).toBe(1);
    live.accept(stop({ last_assistant_message: "Found it." }));
    expect(events[1]).toEqual(expect.objectContaining({ kind: "final", markdown: "Found it.", readAsProgress: false }));
    expect(clock.pending()).toBe(0);
  });

  it("passes a Stop with nothing held straight through", () => {
    const { events, live } = setup();
    live.accept(stop({ last_assistant_message: "Fixed." }));
    live.accept(stop());
    live.accept({ last_assistant_message: "No event name, still a Stop.", cwd: "/x" });
    expect(events).toEqual([
      { kind: "final", key: "s1/p1", markdown: "Fixed.", cwd: "/Users/me/code/app", heldMs: null, readAsProgress: false },
      { kind: "final", key: "s1/p1", markdown: null, cwd: "/Users/me/code/app", heldMs: null, readAsProgress: false },
      { kind: "final", key: null, markdown: "No event name, still a Stop.", cwd: "/x", heldMs: null, readAsProgress: false },
    ]);
  });

  it("falls back to the held text when Stop carries no message", () => {
    const { events, live } = setup();
    live.accept(display({ message_id: "m1", index: 0, delta: "Held.", final: true }));
    live.accept(stop());
    expect(events).toEqual([expect.objectContaining({ kind: "final", markdown: "Held." })]);
  });

  it("ignores other events, a tool call with nothing held, blank messages and payloads missing their ids", () => {
    const { events, clock, live } = setup();
    live.accept({ hook_event_name: "PostToolUse", ...session, tool_name: "Bash" });
    live.accept(tool());
    live.accept(display({ message_id: "m1", index: 0, delta: "  \n", final: true }));
    live.accept(display({ index: 0, delta: "no message id", final: true }));
    live.accept({ hook_event_name: "MessageDisplay", message_id: "m2", delta: "no session", final: true });
    live.accept("not an object");
    clock.fire();
    expect(events).toEqual([]);
  });

  it("keeps sessions apart", () => {
    const { events, clock, live } = setup();
    live.accept(display({ message_id: "m1", index: 0, delta: "In session one.", final: true }));
    live.accept(display({ session_id: "s2", message_id: "m1", index: 0, delta: "In session two.", final: true }));
    live.accept(stop({ session_id: "s2", last_assistant_message: "In session two." }));
    live.accept(tool({ session_id: "s3" }));
    expect(events).toHaveLength(1);
    clock.fire();
    expect(events.map((e) => [e.kind, e.key])).toEqual([
      ["final", "s2/p1"],
      ["progress", "s1/p1"],
    ]);
  });
});
