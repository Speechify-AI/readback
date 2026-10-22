/**
 * Which window a turn belongs to.
 *
 * Every window receives every turn; a window shows only the turns from its
 * own project. A turn is this window's when the folder Claude Code ran in
 * is inside one of the workspace folders, or contains one: running Claude
 * at a monorepo's root while the window has a sub-project open is the same
 * project. The home directory, and anything above it, contains every
 * project and counts for neither direction: a terminal in a window with no
 * folder open starts at home, and a turn from there would otherwise show in
 * every window. Such a turn belongs to the windows with no folder open.
 * Anything else is another window's, or nobody's.
 */
import { isAbsolute, relative, resolve } from "node:path";

function within(inner: string, outer: string): boolean {
  const rel = relative(resolve(outer), resolve(inner));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function relatedToWorkspace(cwd: string | null, folders: readonly string[], home: string): boolean {
  if (cwd === null || cwd === "") return false;
  // Home, or anything above it, contains every project.
  const everything = within(home, cwd);
  if (folders.length === 0) return everything;
  return !everything && folders.some((folder) => within(cwd, folder) || within(folder, cwd));
}
