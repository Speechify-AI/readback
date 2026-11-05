import { describe, expect, it } from "vitest";
import { base64Of, fromBase64, sliceFromMs, toBase64 } from "./bytes.ts";

describe("bytes", () => {
  it("base64 round-trips 300 KB", () => {
    const b = new Uint8Array(300 * 1024);
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    expect(fromBase64(toBase64(b))).toEqual(b);
  });

  it("base64Of gives a decoded clip's source back and encodes a fresh one once", () => {
    const b64 = toBase64(new Uint8Array([1, 2, 3, 250]));
    expect(base64Of(fromBase64(b64))).toBe(b64);
    const fresh = new Uint8Array([9, 8, 7]);
    const first = base64Of(fresh);
    expect(first).toBe(toBase64(fresh));
    expect(base64Of(fresh)).toBe(first); // the same string, not a re-encode
    expect(base64Of(fresh.subarray(1))).toBe(toBase64(fresh.subarray(1)));
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
