import { describe, expect, it } from "vitest";
import { Playlist, runEndFor, stepFrom } from "./playlist.ts";

const plain = (id: string, length: number) => ({ id, length, fullFrom: null });
const condensed = (id: string, length: number, fullFrom: number) => ({ id, length, fullFrom });

describe("Playlist", () => {
  it("plays a turn at once when nothing is playing, with a two-paragraph look-ahead", () => {
    const list = new Playlist();
    list.add(plain("a", 5));
    expect(list.arrive("a", 0)).toEqual({ kind: "play", previous: null, at: { turnId: "a", index: 0 }, request: [0, 1, 2] });
    expect(list.next()).toEqual({ kind: "play", previous: { turnId: "a", index: 0 }, at: { turnId: "a", index: 1 }, request: [1, 2, 3] });
  });

  it("queues a turn behind the current run, one entry per turn at its lowest index", () => {
    const list = new Playlist();
    list.add(plain("a", 2));
    list.add(plain("b", 4));
    list.arrive("a", 0);
    expect(list.arrive("b", 2)).toEqual({ kind: "queued", waiting: 1 });
    expect(list.arrive("b", 1)).toEqual({ kind: "queued", waiting: 1 });
    list.next();
    expect(list.next()).toEqual({ kind: "play", previous: { turnId: "a", index: 1 }, at: { turnId: "b", index: 1 }, request: [1, 2, 3] });
    expect(list.next().kind).toBe("play");
    expect(list.next().kind).toBe("play");
    expect(list.next()).toEqual({ kind: "idle", previous: { turnId: "b", index: 3 } });
    expect(list.current).toBeNull();
  });

  it("stops a run at the full reply and plays it only when asked", () => {
    const list = new Playlist();
    list.add(condensed("a", 5, 2));
    list.arrive("a", 0);
    expect(list.next()).toEqual(expect.objectContaining({ at: { turnId: "a", index: 1 }, request: [1] }));
    expect(list.next()).toEqual({ kind: "idle", previous: { turnId: "a", index: 1 } });
    expect(list.goTo("a", 2, true)).toEqual({ kind: "play", previous: null, at: { turnId: "a", index: 2 }, request: [2, 3, 4] });
    expect(runEndFor(condensed("a", 5, 2), 2)).toBe(5);
    expect(runEndFor(condensed("a", 5, 2), 0)).toBe(2);
  });

  it("extends the current run when its turn grows, and asks for the look-ahead", () => {
    const list = new Playlist();
    list.add(plain("a", 1));
    list.arrive("a", 0);
    expect(list.grow("a", 3, null)).toEqual({ request: [1, 2] });
    // Condensed at the end: the run still stops before the full reply.
    expect(list.grow("a", 6, 4)).toEqual({ request: [1, 2] });
    list.next();
    list.next();
    list.next();
    expect(list.current).toEqual({ turnId: "a", index: 3 });
    expect(list.next()).toEqual({ kind: "idle", previous: { turnId: "a", index: 3 } });
  });

  it("leaves a grown turn that is not current to the caller", () => {
    const list = new Playlist();
    list.add(plain("a", 2));
    list.add(plain("b", 1));
    list.arrive("a", 0);
    expect(list.grow("b", 3, null)).toBeNull();
    expect(list.grow("zz", 3, null)).toBeNull();
    expect(list.arrive("b", 1)).toEqual({ kind: "queued", waiting: 1 });
  });

  it("counts arrivals as unheard while autoplay is off, until they play", () => {
    const list = new Playlist();
    list.autoplay = false;
    list.add(plain("a", 2));
    list.add(plain("b", 2));
    expect(list.arrive("a", 0)).toEqual({ kind: "unheard", count: 1 });
    expect(list.arrive("a", 1)).toEqual({ kind: "unheard", count: 1 });
    expect(list.arrive("b", 0)).toEqual({ kind: "unheard", count: 2 });
    expect(list.isUnheard("a")).toBe(true);
    list.goTo("a", 0, true);
    expect(list.isUnheard("a")).toBe(false);
    expect(list.unheardCount).toBe(1);
  });

  it("drops the queue when a paragraph is chosen by hand", () => {
    const list = new Playlist();
    list.add(plain("a", 3));
    list.add(plain("b", 3));
    list.arrive("a", 0);
    list.arrive("b", 0);
    expect(list.waiting).toBe(1);
    list.goTo("a", 2, true);
    expect(list.waiting).toBe(0);
    expect(list.next()).toEqual({ kind: "idle", previous: { turnId: "a", index: 2 } });
  });

  it("lets an alert jump the queue and puts the interrupted run back in front", () => {
    const list = new Playlist();
    list.add(plain("a", 4));
    list.add(plain("b", 2));
    list.add(plain("alert", 1));
    list.arrive("a", 0);
    list.next();
    list.arrive("b", 0);
    expect(list.urgent("alert")).toEqual({ kind: "play", previous: { turnId: "a", index: 1 }, at: { turnId: "alert", index: 0 }, request: [0] });
    expect(list.waiting).toBe(2);
    expect(list.next()).toEqual({ kind: "play", previous: { turnId: "alert", index: 0 }, at: { turnId: "a", index: 1 }, request: [1, 2, 3] });
    list.next();
    list.next();
    expect(list.next()).toEqual(expect.objectContaining({ at: { turnId: "b", index: 0 } }));
  });

  it("plays an alert at once when idle and lists it when autoplay is off", () => {
    const list = new Playlist();
    list.add(plain("alert", 1));
    expect(list.urgent("alert")).toEqual({ kind: "play", previous: null, at: { turnId: "alert", index: 0 }, request: [0] });
    const quiet = new Playlist();
    quiet.autoplay = false;
    quiet.add(plain("alert", 1));
    expect(quiet.urgent("alert")).toEqual({ kind: "unheard", count: 1 });
    expect(quiet.urgent("missing")).toEqual({ kind: "none" });
  });

  it("stops: nothing current, nothing queued, turns still listed", () => {
    const list = new Playlist();
    list.add(plain("a", 3));
    list.add(plain("b", 3));
    list.arrive("a", 0);
    list.arrive("b", 0);
    expect(list.stop()).toEqual({ turnId: "a", index: 0 });
    expect(list.current).toBeNull();
    expect(list.waiting).toBe(0);
    expect(list.has("a")).toBe(true);
    expect(list.next()).toEqual({ kind: "idle", previous: null });
    list.clear();
    expect(list.has("a")).toBe(false);
    expect(list.arrive("a", 0)).toEqual({ kind: "none" });
  });

  it("goes idle on a turn it does not know", () => {
    const list = new Playlist();
    list.add(plain("a", 3));
    list.arrive("a", 0);
    expect(list.goTo("gone", 0)).toEqual({ kind: "idle", previous: { turnId: "a", index: 0 } });
    expect(list.current).toBeNull();
  });
});

describe("stepFrom", () => {
  const starts = [0, 4000, 9000];

  it("steps back to the previous sentence, treating the first 900 ms as the one before", () => {
    expect(stepFrom(starts, 6000, -1)).toEqual({ kind: "seek", ms: 4000 });
    expect(stepFrom(starts, 4500, -1)).toEqual({ kind: "seek", ms: 0 });
    expect(stepFrom(starts, 500, -1)).toEqual({ kind: "previous" });
  });

  it("steps forward to the next sentence, or on to the next paragraph", () => {
    expect(stepFrom(starts, 1000, 1)).toEqual({ kind: "seek", ms: 4000 });
    expect(stepFrom(starts, 3980, 1)).toEqual({ kind: "seek", ms: 9000 });
    expect(stepFrom(starts, 9500, 1)).toEqual({ kind: "next" });
    expect(stepFrom([], 0, 1)).toEqual({ kind: "next" });
  });
});
