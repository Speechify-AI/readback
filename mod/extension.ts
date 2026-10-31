/**
 * Whether Readback's VS Code extension is reading this session already. The
 * extension's hook posts every reply to the listeners it finds in
 * `~/.readback/endpoints`, one file per window holding `port token`. In the
 * integrated terminal that window hears the reply, so the mod reading it
 * too would mean the same reply twice in two voices. A file whose port
 * refuses the connection is a window that crashed (the hook removes such a
 * file on its next run); only one that answers counts.
 */

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

/** True when some window of the extension answers on its listener. */
export async function extensionListening(deps: EndpointDeps, dir: string): Promise<boolean> {
  let entries: readonly { name: string; kind: string }[];
  try {
    entries = await deps.list(dir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const port = endpointPort(await deps.read(`${dir}/${entry.name}`).catch(() => ""));
    if (port === null) continue;
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
