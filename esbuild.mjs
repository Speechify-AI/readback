// Bundles the extension host entry and the webview page script. The hook is
// a shell script written at activation, not built.
import { build, context } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

// The codicon font, so the player's controls are VS Code's own icons.
mkdirSync("media/codicons", { recursive: true });
for (const f of ["codicon.css", "codicon.ttf"]) {
  copyFileSync(`node_modules/@vscode/codicons/dist/${f}`, `media/codicons/${f}`);
}

const host = {
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

// The page: one module, served from media/ next to its stylesheet.
const page = {
  entryPoints: ["src/webview/player.ts"],
  bundle: true,
  outfile: "media/player.js",
  platform: "browser",
  format: "esm",
  target: "es2022",
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const contexts = await Promise.all([context(host), context(page)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all([build(host), build(page)]);
}
