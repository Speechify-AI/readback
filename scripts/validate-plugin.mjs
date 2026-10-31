// Runs `claude plugin validate .` when `claude` is on PATH and skips otherwise.
// A Node script rather than shell so `npm test` works under cmd.exe too.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const names = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"];
const claude = (process.env.PATH ?? "")
  .split(delimiter)
  .filter(Boolean)
  .flatMap((dir) => names.map((n) => join(dir, n)))
  .find((p) => existsSync(p));

if (!claude) {
  console.log("claude not on PATH: plugin validation skipped");
  process.exit(0);
}
const run = spawnSync(claude, ["plugin", "validate", "."], { stdio: "inherit", shell: claude.endsWith(".cmd") });
process.exit(run.status ?? 1);
