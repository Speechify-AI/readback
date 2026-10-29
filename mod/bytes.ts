/**
 * Bytes for the mod, which has atob and btoa but no Buffer. Base64 in and
 * out of the API's JSON, and the constant-bitrate cut that resumes a clip
 * from a sentence's start.
 */

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Chunked: spreading a whole clip into one `fromCharCode` call overflows the stack. */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * The tail of a clip from `ms` in, assuming constant bitrate, which is what
 * Speechify's mp3 is. Pass bytes already stripped of ID3, so the proportion
 * is over audio only. Out-of-range `ms` clamps rather than throws.
 */
export function sliceFromMs(bytes: Uint8Array, durationMs: number, ms: number): Uint8Array {
  const at = Math.floor((bytes.length * ms) / Math.max(1, durationMs));
  return bytes.subarray(Math.min(bytes.length, Math.max(0, at)));
}
