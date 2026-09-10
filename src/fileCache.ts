/**
 * Renders on disk, under the extension's global storage. One MP3 and one
 * JSON sidecar per render key. Missing or unreadable entries are misses,
 * never errors: the worst case is one re-render.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Mark } from "./marks.ts";
import type { RenderCache, Rendered } from "./render.ts";

interface Sidecar {
  marks: Mark[];
  durationMs: number;
}

function isSidecar(value: unknown): value is Sidecar {
  return (
    typeof value === "object" &&
    value !== null &&
    "marks" in value &&
    Array.isArray(value.marks) &&
    "durationMs" in value &&
    typeof value.durationMs === "number"
  );
}

export function fileCache(root: string): RenderCache {
  const paths = (key: string) => ({
    audio: join(root, `${key}.mp3`),
    sidecar: join(root, `${key}.json`),
  });
  return {
    async get(key) {
      const p = paths(key);
      try {
        const [audio, raw] = await Promise.all([readFile(p.audio), readFile(p.sidecar, "utf8")]);
        const sidecar: unknown = JSON.parse(raw);
        if (!isSidecar(sidecar)) return null;
        return { audio: new Uint8Array(audio), marks: sidecar.marks, durationMs: sidecar.durationMs };
      } catch {
        return null;
      }
    },
    async put(key, rendered: Rendered) {
      const p = paths(key);
      await mkdir(dirname(p.audio), { recursive: true });
      const sidecar: Sidecar = { marks: rendered.marks, durationMs: rendered.durationMs };
      await Promise.all([
        writeFile(p.audio, rendered.audio),
        writeFile(p.sidecar, JSON.stringify(sidecar)),
      ]);
    },
  };
}
