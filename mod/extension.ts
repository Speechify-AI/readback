/**
 * Whether Readback's VS Code extension will read this session's reply. The
 * extension's hook posts every reply to the listeners it finds in
 * `~/.readback/endpoints`, one file per window: a `port token` line, then
 * the window's workspace folders one per line. A window reads only its own
 * project's turns (`relatedToWorkspace`, the extension's own rule), so the
 * mod yields a reply only to a window that is both alive and related to
 * the session's directory; a window on another project stays silent, and so
 * would the mod, which is how a reply went unheard (2026-11-01). A file
 * whose port refuses the connection is a window that crashed (the hook
 * removes such a file on its next run). A window with no folder open writes
 * `NO_FOLDERS_LINE` and reads only turns from home, by the same rule. A
 * file with no folder lines at all comes from an extension older than
 * them: which project it has open is unknown, so the mod yields, as before.
 */
import { NO_FOLDERS_LINE, relatedToWorkspace } from "../src/windows.ts";

/** Under `$HOME`; the caller joins it. The extension fixes this path. */
export const ENDPOINTS_DIR = ".readback/endpoints";

export type EndpointDeps = {
  list(dir: string): Promise<readonly { name: string; kind: string }[]>;
  read(path: string): Promise<string>;
  /** Resolves on any HTTP answer; rejects when nothing listens. */
  fetch(url: string): Promise<unknown>;
};

/** The port out of an endpoint file's `port token` line, or null. */
export function endpointPort(text: string): number | null {
  const m = /^(\d{1,5})\s+\S+/.exec(text.trim());
  if (!m) return null;
  const port = Number(m[1]);
  return port > 0 && port < 65536 ? port : null;
}

/** The workspace folders under the first line, empty for a window with none open; null when the file does not say (an older extension). */
export function endpointFolders(text: string): string[] | null {
  const lines = text.split("\n").slice(1).map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length === 0) return null;
  return lines.filter((l) => l !== NO_FOLDERS_LINE);
}

/** True when a window of the extension that would read a reply from `cwd` answers on its listener. */
export async function extensionListening(deps: EndpointDeps, dir: string, cwd: string, home: string): Promise<boolean> {
  let entries: readonly { name: string; kind: string }[];
  try {
    entries = await deps.list(dir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const text = await deps.read(`${dir}/${entry.name}`).catch(() => "");
    const port = endpointPort(text);
    if (port === null) continue;
    const folders = endpointFolders(text);
    if (folders !== null && !relatedToWorkspace(cwd, folders, home)) continue;
    try {
      // Any answer will do, a 404 included: the listener is up.
      await deps.fetch(`http://127.0.0.1:${port}/turn`);
      return true;
    } catch {
      // refused: a window that is gone
    }
  }
  return false;
}
