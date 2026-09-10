/**
 * Installing Readback's hooks into Claude Code's user settings.
 *
 * Merge, never overwrite: people keep other hooks in this file. Our entry is
 * recognised by its command, which ends in the hook script's fixed path, so
 * install is idempotent and uninstall removes exactly ours. Everything else
 * in the file, including hooks we do not understand, is left byte-for-byte
 * as parsed.
 */

export const HOOK_SCRIPT_NAME = "hook.sh";

/**
 * The events the hook is registered for. Stop carries the finished reply.
 * MessageDisplay carries each assistant message as its lines complete, which
 * is how the notes Claude writes between tool calls can be read before the
 * turn ends. PreToolUse is what tells a note from the reply: it follows a
 * note, Stop follows the reply. All run the same script; the extension
 * tells them apart.
 */
export const HOOK_EVENTS = ["Stop", "MessageDisplay", "PreToolUse"] as const;

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
  hooks?: { [event: string]: unknown };
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

/** The entry Readback wants present under each event. */
export function hookEntry(scriptPath: string): HookGroup {
  return { hooks: [{ type: "command", command: JSON.stringify(scriptPath), async: true }] };
}

function groupsHaveHook(groups: unknown, scriptPath: string): boolean {
  if (!Array.isArray(groups)) return false;
  return groups.some(
    (group) =>
      isHookGroup(group) &&
      group.hooks.some((h) => isHookCommand(h) && isReadbackCommand(h.command, scriptPath)),
  );
}

/**
 * True when every event has our entry. An install from before MessageDisplay
 * was added counts as missing, so the setup card offers the upgrade.
 */
export function hasHook(settings: ClaudeSettings, scriptPath: string): boolean {
  return HOOK_EVENTS.every((event) => groupsHaveHook(settings.hooks?.[event], scriptPath));
}

/** A copy of `settings` with our entry present exactly once under each event. */
export function withHook(settings: ClaudeSettings, scriptPath: string): ClaudeSettings {
  if (hasHook(settings, scriptPath)) return settings;
  const hooks = { ...(settings.hooks ?? {}) };
  for (const event of HOOK_EVENTS) {
    const existing = hooks[event];
    if (groupsHaveHook(existing, scriptPath)) continue;
    const groups: unknown[] = Array.isArray(existing) ? [...existing] : [];
    groups.push(hookEntry(scriptPath));
    hooks[event] = groups;
  }
  return { ...settings, hooks };
}

/** A copy of `settings` with our entries gone and nothing else touched. */
export function withoutHook(settings: ClaudeSettings, scriptPath: string): ClaudeSettings {
  if (!settings.hooks) return settings;
  const hooks = { ...settings.hooks };
  let changed = false;
  for (const event of HOOK_EVENTS) {
    const groups = hooks[event];
    if (!Array.isArray(groups) || !groupsHaveHook(groups, scriptPath)) continue;
    changed = true;
    const kept = groups
      .map((group: unknown) => {
        if (!isHookGroup(group)) return group;
        const inner = group.hooks.filter(
          (h) => !(isHookCommand(h) && isReadbackCommand(h.command, scriptPath)),
        );
        return inner.length === group.hooks.length ? group : { ...group, hooks: inner };
      })
      .filter((group: unknown) => !isHookGroup(group) || group.hooks.length > 0);
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  return changed ? { ...settings, hooks } : settings;
}

/**
 * The hook itself. POSIX sh and curl, nothing else, so it runs on any Mac
 * or Linux box without a runtime on PATH. It forwards the raw payload of
 * whichever event fired it to every Readback listener on this machine and
 * lets the extension decide what to say: the hook knows nothing about JSON,
 * events or windows. A listener that refuses the connection is gone, so its
 * endpoint file is removed.
 */
export function hookScript(endpointsDir: string): string {
  return `#!/bin/sh
# Readback: Claude Code hook (Stop, MessageDisplay, PreToolUse). Installed by
# the Readback VS Code extension; edits are overwritten on its next activation.
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
