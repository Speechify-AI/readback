import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The Claude Code mod cannot load a module that imports node:* or package.json,
// even for one export. These are the files it may import; each must stay clean.
const SHARED = [
  "speechifyShared.ts",
  "summaryShared.ts",
  "claudeLanguageShared.ts",
  "renderShared.ts",
  "turns.ts",
  "text.ts",
  "marks.ts",
  "audio.ts",
  "webview/playlist.ts",
];

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Every module specifier a source pulls in at runtime: `from "x"` (multi-line
 * imports included), bare `import "x"` and `import("x")`. Type-only
 * statements are erased by the compiler and are dropped first.
 */
export function runtimeSpecifiers(src: string): string[] {
  const runtime = src.replace(/\b(?:import|export)\s+type\b[^;]*?;/g, "");
  const found: string[] = [];
  for (const re of [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const m of runtime.matchAll(re)) found.push(m[1] as string);
  }
  return found;
}

describe("runtimeSpecifiers", () => {
  it("sees multi-line, side-effect and dynamic imports, and skips type imports", () => {
    const src = [
      'import {\n  a,\n  b,\n} from "./speechify.ts";',
      'import "node:fs";',
      'const x = await import("node:os");',
      'import type {\n  T,\n} from "./types.ts";',
      'export * from "./y.ts";',
    ].join("\n");
    expect(runtimeSpecifiers(src).sort()).toEqual(["./speechify.ts", "./y.ts", "node:fs", "node:os"]);
  });
});

describe("shared modules", () => {
  it("shared modules load without Node", () => {
    for (const file of SHARED) {
      const src = readFileSync(join(here, file), "utf8");
      expect(src, file).not.toMatch(/package\.json/);
      for (const spec of runtimeSpecifiers(src)) {
        expect(spec.startsWith("node:"), `${file} imports ${spec}`).toBe(false);
        if (!spec.startsWith(".")) continue;
        const target = normalize(join(dirname(file), spec));
        expect(SHARED, `${file} imports ${spec}`).toContain(target);
      }
    }
  });
});
