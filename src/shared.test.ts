import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
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

const here = dirname(new URL(import.meta.url).pathname);

describe("shared modules", () => {
  it("shared modules load without Node", () => {
    for (const file of SHARED) {
      const src = readFileSync(join(here, file), "utf8");
      expect(src, file).not.toMatch(/from\s+["']node:/);
      expect(src, file).not.toMatch(/package\.json/);

      for (const line of src.split("\n")) {
        if (/^\s*import\s+type\b/.test(line)) continue;
        const spec = /^\s*(?:import|export)\b.*\bfrom\s+["'](\.{1,2}\/[^"']+)["']/.exec(line)?.[1];
        if (!spec) continue;
        const target = normalize(join(dirname(file), spec));
        expect(SHARED, `${file} imports ${spec}`).toContain(target);
      }
    }
  });
});
