// Bundles the extension host entry. The webview scripts in media/ are plain
// JS served as-is, and the hook is a shell script written at activation.
import { build, context } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

// The codicon font, so the player's controls are VS Code's own icons.
mkdirSync("media/codicons", { recursive: true });
for (const f of ["codicon.css", "codicon.ttf"]) {
  copyFileSync(`node_modules/@vscode/codicons/dist/${f}`, `media/codicons/${f}`);
}

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
