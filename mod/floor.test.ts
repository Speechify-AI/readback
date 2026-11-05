import { describe, expect, it } from "vitest";
import { Floor, STALE_MS, type Store } from "./floor.ts";

function memory(): Store & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(k) {
      return data.get(k);
    },
    async set(k, v) {
      data.set(k, v);
    },
  };
}

function setup() {
  const store = memory();
  let t = 1000;
  const now = async () => t;
  return {
    store,
    a: new Floor(store, "a", now),
    b: new Floor(store, "b", now),
    advance: (ms: number) => void (t += ms),
  };
}

describe("Floor", () => {
  it("the later claim wins", async () => {
    const { a, b } = setup();
    await a.claim();
    await b.claim();
    expect(await a.beat()).toBe("lost");
    expect(await b.beat()).toBe("held");
  });

  it("a claim with no heartbeat for 3 s is not lost to", async () => {
    const { a, b, advance } = setup();
    await b.claim();
    advance(STALE_MS - 1);
    expect(await a.beat()).toBe("lost");
    advance(1);
    expect(await a.beat()).toBe("free");
  });

  it("release does not clear another session's claim", async () => {
    const { a, b } = setup();
    await a.claim();
    await b.claim();
    await a.release();
    expect(await a.beat()).toBe("lost");
    await b.release();
    expect(await a.beat()).toBe("free");
  });

  it("a beat after another session claimed does not take the floor back", async () => {
    const { a, b, store, advance } = setup();
    await a.claim();
    await b.claim();
    advance(500);
    expect(await a.beat()).toBe("lost");
    expect(store.data.get("floor")).toMatchObject({ session: "b" });
    expect(await b.beat()).toBe("held");
  });

  it("a beat keeps our claim fresh", async () => {
    const { a, b, advance } = setup();
    await a.claim();
    advance(2500);
    expect(await a.beat()).toBe("held");
    advance(2500);
    expect(await b.beat()).toBe("lost");
  });

  it("an empty floor is free and stays empty", async () => {
    const { a, store } = setup();
    expect(await a.beat()).toBe("free");
    expect(store.data.get("floor")).toBeUndefined();
  });
});
