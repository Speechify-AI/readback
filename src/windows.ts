/**
 * Which window a turn belongs to.
 *
 * Every window receives every turn; a window shows only the turns from its
 * own project. A turn is this window's when the folder Claude Code ran in
 * is inside one of the workspace folders, or contains one: running Claude
 * at a monorepo's root while the window has a sub-project open is the same
 * project. Anything else is another window's, or nobody's.
 */
import { isAbsolute, relative, resolve } from "node:path";

function within(inner: string, outer: string): boolean {
  const rel = relative(resolve(outer), resolve(inner));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function relatedToWorkspace(cwd: string | null, folders: readonly string[]): boolean {
  if (cwd === null || cwd === "") return false;
  return folders.some((folder) => within(cwd, folder) || within(folder, cwd));
}
