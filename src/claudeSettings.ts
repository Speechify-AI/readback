/**
 * Installing the Stop hook into Claude Code's user settings.
 *
 * Merge, never overwrite: people keep other hooks in this file. Our entry is
 * recognised by its command, which ends in the hook script's fixed path, so
 * install is idempotent and uninstall removes exactly ours. Everything else
 * in the file, including hooks we do not understand, is left byte-for-byte
 * as parsed.
 */

export const HOOK_SCRIPT_NAME = "hook.sh";

interface HookCommand {
  type: string;
  command: string;
  async?: boolean;
}

interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}

/** The settings object, typed only as far as we touch it. */
export interface ClaudeSettings {
  hooks?: { Stop?: unknown; [event: string]: unknown };
  [key: string]: unknown;
}

export function isClaudeSettings(value: unknown): value is ClaudeSettings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHookCommand(value: unknown): value is HookCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    "command" in value &&
    typeof value.command === "string"
  );
}

function isHookGroup(value: unknown): value is HookGroup {
  return typeof value === "object" && value !== null && "hooks" in value && Array.isArray(value.hooks);
}

export function isReadbackCommand(command: string, scriptPath: string): boolean {
  return command.includes(scriptPath);
}

/** The Stop entry Readback wants present. */
export function hookEntry(scriptPath: string): HookGroup {
  return { hooks: [{ type: "command", command: JSON.stringify(scriptPath), async: true }] };
}

export function hasHook(settings: ClaudeSettings, scriptPath: string): boolean {
  const stop = settings.hooks?.Stop;
  if (!Array.isArray(stop)) return false;
  return stop.some(
    (group) =>
      isHookGroup(group) &&
      group.hooks.some((h) => isHookCommand(h) && isReadbackCommand(h.command, scriptPath)),
  );
}

/** A copy of `settings` with our Stop hook present exactly once. */
export function withHook(settings: ClaudeSettings, scriptPath: string): ClaudeSettings {
  if (hasHook(settings, scriptPath)) return settings;
  const hooks = { ...(settings.hooks ?? {}) };
  const stop = Array.isArray(hooks.Stop) ? [...hooks.Stop] : [];
  stop.push(hookEntry(scriptPath));
  hooks.Stop = stop;
  return { ...settings, hooks };
}

/** A copy of `settings` with our Stop hook gone and nothing else touched. */
export function withoutHook(settings: ClaudeSettings, scriptPath: string): ClaudeSettings {
  const stop = settings.hooks?.Stop;
  if (!Array.isArray(stop)) return settings;
  const kept = stop
    .map((group) => {
      if (!isHookGroup(group)) return group;
      const hooks = group.hooks.filter(
        (h) => !(isHookCommand(h) && isReadbackCommand(h.command, scriptPath)),
      );
      return hooks.length === group.hooks.length ? group : { ...group, hooks };
    })
    .filter((group) => !isHookGroup(group) || group.hooks.length > 0);
  const hooks = { ...settings.hooks };
  if (kept.length === 0) delete hooks.Stop;
  else hooks.Stop = kept;
  return { ...settings, hooks };
}

/**
 * The hook itself. POSIX sh and curl, nothing else, so it runs on any Mac
 * or Linux box without a runtime on PATH. It forwards the raw Stop payload
 * to every Readback listener on this machine and lets the extension decide
 * what to say: the hook knows nothing about JSON or windows. A listener that
 * refuses the connection is gone, so its endpoint file is removed.
 */
export function hookScript(endpointsDir: string): string {
  return `#!/bin/sh
# Readback: Claude Code Stop hook. Installed by the Readback VS Code
# extension; edits are overwritten on its next activation.
# Readback condenses replies by running claude itself. That run carries this
# marker, and a hook that sees it does nothing, so a reply about a reply can
# never be read.
[ -n "$READBACK_HOOK" ] && exit 0
dir=${shellQuote(endpointsDir)}
[ -d "$dir" ] || exit 0
payload=$(cat)
for f in "$dir"/*; do
  [ -f "$f" ] || continue
  read -r port token < "$f" || continue
  printf '%s' "$payload" | curl -s -o /dev/null -m 5 -X POST \\
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" \\
    --data-binary @- "http://127.0.0.1:$port/turn"
  [ $? -eq 7 ] && rm -f "$f"
done
exit 0
`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
