import { describe, expect, it } from "vitest";
import { fromBase64, sliceFromMs, toBase64 } from "./bytes.ts";

describe("bytes", () => {
  it("base64 round-trips 300 KB", () => {
    const b = new Uint8Array(300 * 1024);
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    expect(fromBase64(toBase64(b))).toEqual(b);
  });

  it("sliceFromMs cuts in proportion", () => {
    expect(sliceFromMs(new Uint8Array(1000), 10_000, 2_500).length).toBe(750);
  });

  it("sliceFromMs clamps", () => {
    const b = new Uint8Array(1000);
    expect(sliceFromMs(b, 10_000, -5).length).toBe(1000);
    expect(sliceFromMs(b, 10_000, 99_000).length).toBe(0);
  });
});
