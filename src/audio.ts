/**
 * MP3 plumbing, copied from an internal Speechify demo.
 *
 * Speechify returns each synthesis as a complete MP3 (ID3v2 header + MPEG
 * frames) with identical encoder settings per voice and model, so a paragraph
 * that needed more than one call is just the frames of each chunk back to
 * back. ID3 containers are stripped and nothing is re-tagged: a tag left
 * mid-file makes some players stop early.
 */

/** Drop an ID3v2 header (if present) and an ID3v1 "TAG" trailer (if present). */
export function stripId3(bytes: Uint8Array): Uint8Array {
  let start = 0;
  let end = bytes.length;
  if (
    bytes.length > 10 &&
    bytes[0] === 0x49 && // I
    bytes[1] === 0x44 && // D
    bytes[2] === 0x33 // 3
  ) {
    // Syncsafe 28-bit size, exclusive of the 10-byte header.
    const size =
      (((bytes[6] ?? 0) & 0x7f) << 21) |
      (((bytes[7] ?? 0) & 0x7f) << 14) |
      (((bytes[8] ?? 0) & 0x7f) << 7) |
      ((bytes[9] ?? 0) & 0x7f);
    start = Math.min(10 + size, bytes.length);
  }
  if (
    end - start > 128 &&
    bytes[end - 128] === 0x54 && // T
    bytes[end - 127] === 0x41 && // A
    bytes[end - 126] === 0x47 // G
  ) {
    end -= 128;
  }
  return bytes.subarray(start, end);
}

/** Concatenate MP3 segments into one playable stream (ID3 stripped throughout). */
export function mergeMp3(segments: Uint8Array[]): Uint8Array {
  const frames = segments.map(stripId3);
  const merged = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
  let offset = 0;
  for (const f of frames) {
    merged.set(f, offset);
    offset += f.length;
  }
  return merged;
}

/**
 * Parse an HTTP Range header against a known size. Handles the single-range
 * forms browsers actually send (`bytes=a-`, `bytes=a-b`, `bytes=-suffix`);
 * anything else → null (caller serves the whole body with 200).
 */
export function parseRange(
  header: string | null,
  size: number,
): { offset: number; length: number } | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || size === 0) return null;
  const [, startStr, endStr] = m;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    const suffix = Math.min(Number(endStr), size);
    return suffix === 0 ? null : { offset: size - suffix, length: suffix };
  }
  const offset = Number(startStr);
  if (offset >= size) return null;
  const end = endStr === "" ? size - 1 : Math.min(Number(endStr), size - 1);
  return end < offset ? null : { offset, length: end - offset + 1 };
}

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES_V1 = [44100, 48000, 32000];
const SAMPLE_RATES_V2 = [22050, 24000, 16000];

/**
 * Clip duration in ms, derived from the frames themselves (bitrate read from
 * the first frame header, CBR assumed — true for Speechify output). The API's
 * speech_marks stop at the last word, so they under-report clips that end in
 * an SSML <break/>; the frames don't lie (verified against ffprobe).
 */
export function mp3DurationMs(bytes: Uint8Array): number {
  const d = stripId3(bytes);
  for (let i = 0; i + 4 <= d.length; i++) {
    if (d[i] !== 0xff || (((d[i + 1] ?? 0) & 0xe0) !== 0xe0)) continue;
    const b1 = d[i + 1] ?? 0;
    const b2 = d[i + 2] ?? 0;
    const layerBits = (b1 >> 1) & 0x03; // 1 = Layer III
    const bitrateIdx = (b2 >> 4) & 0x0f;
    if (layerBits !== 1 || bitrateIdx === 0 || bitrateIdx === 15) continue;
    const isV1 = ((b1 >> 3) & 0x03) === 3;
    const kbps = (isV1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIdx] ?? 0;
    if (kbps === 0) continue;
    return Math.round((d.length * 8) / kbps);
  }
  return 0;
}
