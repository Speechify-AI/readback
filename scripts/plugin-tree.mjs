// The Claude Code plugin as a tree of its own: the manifest, the hooks module
// and every file it imports, a README and the license. Nothing else.
//
// Why: Claude Code runs an npm install in an installed plugin whose root holds
// package.json beside a lockfile. With the repo root as the plugin, every
// install pulled the extension's dev tools (164 MB) into the cache, and the
// plugin directory holds such a plugin for a reviewer. The mod needs none of it.
//
//   node scripts/plugin-tree.mjs --out <dir>   write the tree to a new or empty directory
//   node scripts/plugin-tree.mjs --commit      commit it to the `plugin` branch
//                                              and tag it readback--v<version>
//
// --commit reads the working tree, so it refuses unless the tree is clean.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRANCH = "plugin";
const FIXED = [".claude-plugin/plugin.json", ".claude-plugin/icon.png", "hooks/hooks.json", "LICENSE"];
const README_TEMPLATE = "docs/plugin-README.md";
const README_SECTION_MARK = "<!-- section: Claude Code -->";

const read = (path) => readFileSync(join(ROOT, path));
const readText = (path) => readFileSync(join(ROOT, path), "utf8");

/** Relative specifiers a TypeScript source names, type-only imports included. */
function relativeImports(src) {
  const found = [];
  for (const re of [/\bfrom\s+["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const m of src.matchAll(re)) if (m[1].startsWith(".")) found.push(m[1]);
  }
  return found;
}

/** The hooks modules and everything they import, as repo-relative paths. */
function moduleFiles() {
  const hooks = JSON.parse(readText("hooks/hooks.json"));
  const queue = (hooks.modules ?? []).map((m) => posix.join("hooks", m));
  const seen = new Set();
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    if (!existsSync(join(ROOT, file))) throw new Error(`${file} is imported but does not exist`);
    if (file.startsWith("..")) throw new Error(`${file} is outside the repo`);
    seen.add(file);
    for (const spec of relativeImports(readText(file))) queue.push(posix.normalize(posix.join(posix.dirname(file), spec)));
  }
  return [...seen].sort();
}

/** The plugin README: the template with the main README's Claude Code section in place of its mark. */
function pluginReadme() {
  const template = readText(README_TEMPLATE);
  const main = readText("README.md");
  const start = main.indexOf("\n## Claude Code\n");
  if (start < 0) throw new Error("README.md has no '## Claude Code' section");
  const bodyStart = main.indexOf("\n", start + 1) + 1;
  const next = main.indexOf("\n## ", bodyStart);
  const section = main.slice(bodyStart, next < 0 ? undefined : next).trim();
  if (!template.includes(README_SECTION_MARK)) throw new Error(`${README_TEMPLATE} lacks ${README_SECTION_MARK}`);
  return template.replace(README_SECTION_MARK, section);
}

/** Every file of the plugin tree: path → contents. */
function pluginTree() {
  const files = new Map();
  for (const path of [...FIXED, ...moduleFiles()]) files.set(path, read(path));
  files.set("README.md", Buffer.from(pluginReadme()));
  return files;
}

function writeOut(dir) {
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} is not empty; give a new or empty folder`);
  for (const [path, body] of pluginTree()) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  console.log(`wrote the plugin tree to ${dir}`);
}

const git = (args, opts = {}) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", ...opts }).trim();

function commit() {
  if (git(["status", "--porcelain"]) !== "") throw new Error("the working tree is not clean; commit first");
  const version = JSON.parse(readText(".claude-plugin/plugin.json")).version;
  const tag = `readback--v${version}`;
  const head = git(["rev-parse", "--short", "HEAD"]);
  const scratch = mkdtempSync(join(tmpdir(), "readback-plugin-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
  try {
    for (const [path, body] of pluginTree()) {
      const blob = git(["hash-object", "-w", "--stdin"], { input: body });
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
    }
    const tree = git(["write-tree"], { env });
    let parent = "";
    for (const ref of [`refs/heads/${BRANCH}`, `refs/remotes/origin/${BRANCH}`]) {
      try {
        parent = git(["rev-parse", "--verify", "--quiet", ref]);
        break;
      } catch {}
    }
    if (parent && git(["rev-parse", `${parent}^{tree}`]) === tree) {
      console.log(`${BRANCH} already holds this tree (${parent.slice(0, 7)}); nothing to commit`);
    } else {
      const message = `readback ${version}, the plugin from ${head}`;
      const sha = git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message]);
      git(["update-ref", `refs/heads/${BRANCH}`, sha]);
      console.log(`${BRANCH} → ${sha.slice(0, 7)} (${message})`);
    }
    git(["tag", "-a", tag, "-m", `Readback ${version}, the Claude Code plugin`, BRANCH]);
    console.log(`tagged ${tag}; push with: git push origin ${BRANCH} ${tag}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (args[0] === "--out" && args[1]) writeOut(args[1]);
else if (args[0] === "--commit") commit();
else {
  console.error("usage: node scripts/plugin-tree.mjs --out <dir> | --commit");
  process.exit(2);
}
