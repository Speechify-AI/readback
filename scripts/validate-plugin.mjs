// Builds the plugin tree (scripts/plugin-tree.mjs) into a temporary folder,
// then runs `claude plugin validate .` on the repo and
// `claude plugin validate . --profile directory` on that tree, when `claude`
// is on PATH; skips the validation otherwise. A Node script rather than shell
// so `npm test` works under cmd.exe too.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tree = mkdtempSync(join(tmpdir(), "readback-plugin-"));
const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: "inherit", shell: cmd.endsWith(".cmd") }).status ?? 1;

function check() {
  if (run(process.execPath, [join(root, "scripts", "plugin-tree.mjs"), "--out", tree], root) !== 0) return 1;

  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"];
  const claude = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((dir) => names.map((n) => join(dir, n)))
    .find((p) => existsSync(p));
  if (!claude) {
    console.log("claude not on PATH: plugin validation skipped");
    return 0;
  }
  return run(claude, ["plugin", "validate", "."], root) || run(claude, ["plugin", "validate", ".", "--profile", "directory"], tree);
}

try {
  process.exitCode = check();
} finally {
  rmSync(tree, { recursive: true, force: true });
}
