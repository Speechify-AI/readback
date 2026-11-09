/**
 * Which window a turn belongs to.
 *
 * Every window receives every turn; a window reads and shows only the turns
 * from its own project. A turn is this window's when the folder Claude Code
 * ran in is inside one of the workspace folders, or contains one: running
 * Claude at a monorepo's root while the window has a sub-project open is
 * the same project. The home directory, and anything above it, contains
 * every project and counts for neither direction: a terminal in a window
 * with no folder open starts at home, and a turn from there would otherwise
 * show in every window. Such a turn belongs to the windows with no folder
 * open. Anything else is another window's, or nobody's.
 *
 * Pure string work, no `node:path`: the Claude Code mod applies the same
 * rule to the folders a window publishes (`mod/extension.ts`), so it yields
 * only to a window that will read the reply. Paths are compared as given
 * after the separators and a trailing slash are normalised; both sides
 * come from the same machine.
 */

function normalise(path: string): string {
  const slashes = path.replace(/\\/g, "/");
  return slashes.length > 1 ? slashes.replace(/\/+$/, "") : slashes;
}

function within(inner: string, outer: string): boolean {
  const a = normalise(inner);
  const b = normalise(outer);
  return a === b || a.startsWith(b === "/" ? b : `${b}/`);
}

export function relatedToWorkspace(cwd: string | null, folders: readonly string[], home: string): boolean {
  if (cwd === null || cwd === "") return false;
  // Home, or anything above it, contains every project.
  const everything = within(home, cwd);
  if (folders.length === 0) return everything;
  return !everything && folders.some((folder) => within(cwd, folder) || within(folder, cwd));
}
