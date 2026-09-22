/**
 * Installing Readback's hooks into Claude Code's user settings, and into
 * Codex CLI's hooks file, which has the same `hooks` shape.
 *
 * Merge, never overwrite: people keep other hooks in this file. Our entry is
 * recognised by its command, which ends in the hook script's fixed path, so
 * install is idempotent and uninstall removes exactly ours. Everything else
 * in the file, including hooks we do not understand, is left byte-for-byte
 * as parsed.
 */

/** The script on disk: POSIX sh everywhere but Windows, PowerShell there. */
export function hookScriptName(platform: string = process.platform): string {
  return platform === "win32" ? "hook.ps1" : "hook.sh";
}

/**
 * The events the hook is registered for. Stop carries the finished reply.
 * MessageDisplay carries each assistant message as its lines complete, which
 * is how the notes Claude writes between tool calls can be read before the
 * turn ends. PreToolUse is what tells a note from the reply: it follows a
 * note, Stop follows the reply. All run the same script; the extension
 * tells them apart.
 */
export const HOOK_EVENTS = ["Stop", "MessageDisplay", "PreToolUse"] as const;

/**
 * Which agent's hooks file an entry is for. Codex CLI (`~/.codex/hooks.json`)
 * has Stop with the same `last_assistant_message`, `session_id` and `cwd`,
 * but no MessageDisplay and no `prompt_id`, so it gets the Stop entry only:
 * finished replies, no notes between tool calls. Codex has no exec form;
 * on Windows it takes a `commandWindows` string instead.
 */
export interface HookTarget {
  flavour: "claude" | "codex";
  events: readonly string[];
}

export const CLAUDE_TARGET: HookTarget = { flavour: "claude", events: HOOK_EVENTS };
export const CODEX_TARGET: HookTarget = { flavour: "codex", events: ["Stop"] };

interface HookCommand {
  type: string;
  command: string;
  /** Exec form (Claude Code): `command` is spawned directly with these arguments and no shell. */
  args?: string[];
  /** Codex: what runs on Windows instead of `command`. */
  commandWindows?: string;
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

/** Ours, whichever form it was written in: the script path is in the command string or in the arguments. */
function isReadbackHook(hook: HookCommand, scriptPath: string): boolean {
  if (isReadbackCommand(hook.command, scriptPath)) return true;
  if (typeof hook.commandWindows === "string" && isReadbackCommand(hook.commandWindows, scriptPath)) return true;
  return Array.isArray(hook.args) && hook.args.some((a) => typeof a === "string" && a.includes(scriptPath));
}

/**
 * The entry Readback wants present under each event. On Mac and Linux the
 * script is the command, quoted for the shell. On Windows it is a PowerShell
 * file run in exec form (`args` present, no shell), so the path is one
 * argument whatever it contains and no shell association is consulted;
 * `-NoProfile` keeps it quick and `-ExecutionPolicy Bypass` lets a local
 * script run.
 */
export function hookEntry(scriptPath: string, platform: string = process.platform, target: HookTarget = CLAUDE_TARGET): HookGroup {
  if (platform === "win32" && target.flavour === "codex") {
    // A Windows path cannot contain a double quote, so plain quotes are exact.
    const line = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
    return { hooks: [{ type: "command", command: line, commandWindows: line, async: true }] };
  }
  if (platform === "win32") {
    return {
      hooks: [
        {
          type: "command",
          command: "powershell.exe",
          args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
          async: true,
        },
      ],
    };
  }
  return { hooks: [{ type: "command", command: JSON.stringify(scriptPath), async: true }] };
}

function groupsHaveHook(groups: unknown, scriptPath: string): boolean {
  if (!Array.isArray(groups)) return false;
  return groups.some(
    (group) =>
      isHookGroup(group) &&
      group.hooks.some((h) => isHookCommand(h) && isReadbackHook(h, scriptPath)),
  );
}

/**
 * True when every event has our entry. An install from before MessageDisplay
 * was added counts as missing, so the setup card offers the upgrade.
 */
export function hasHook(settings: ClaudeSettings, scriptPath: string, target: HookTarget = CLAUDE_TARGET): boolean {
  return target.events.every((event) => groupsHaveHook(settings.hooks?.[event], scriptPath));
}

/** A copy of `settings` with our entry present exactly once under each event. */
export function withHook(
  settings: ClaudeSettings,
  scriptPath: string,
  platform: string = process.platform,
  target: HookTarget = CLAUDE_TARGET,
): ClaudeSettings {
  if (hasHook(settings, scriptPath, target)) return settings;
  const hooks = { ...(settings.hooks ?? {}) };
  for (const event of target.events) {
    const existing = hooks[event];
    if (groupsHaveHook(existing, scriptPath)) continue;
    const groups: unknown[] = Array.isArray(existing) ? [...existing] : [];
    groups.push(hookEntry(scriptPath, platform, target));
    hooks[event] = groups;
  }
  return { ...settings, hooks };
}

/** A copy of `settings` with our entries gone and nothing else touched. */
export function withoutHook(settings: ClaudeSettings, scriptPath: string, target: HookTarget = CLAUDE_TARGET): ClaudeSettings {
  if (!settings.hooks) return settings;
  const hooks = { ...settings.hooks };
  let changed = false;
  for (const event of target.events) {
    const groups = hooks[event];
    if (!Array.isArray(groups) || !groupsHaveHook(groups, scriptPath)) continue;
    changed = true;
    const kept = groups
      .map((group: unknown) => {
        if (!isHookGroup(group)) return group;
        const inner = group.hooks.filter(
          (h) => !(isHookCommand(h) && isReadbackHook(h, scriptPath)),
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
 * or Linux box without a runtime on PATH; on Windows the same ten lines in
 * PowerShell, which every Windows box has. It forwards the raw payload of
 * whichever event fired it to every Readback listener on this machine and
 * lets the extension decide what to say: the hook knows nothing about JSON,
 * events or windows. A listener that refuses the connection is gone, so its
 * endpoint file is removed.
 */
export function hookScript(endpointsDir: string, platform: string = process.platform): string {
  if (platform === "win32") return powershellHook(endpointsDir);
  return `#!/bin/sh
# Readback: Claude Code and Codex hook (Stop, MessageDisplay, PreToolUse). Installed by
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

/**
 * The Windows hook. Written for Windows PowerShell 5.1, which every
 * supported Windows has, and fine on PowerShell 7. Untested by us on a real
 * Windows machine as of 2026-09-22; see RUNBOOK.
 */
function powershellHook(endpointsDir: string): string {
  return `# Readback: Claude Code and Codex hook (Stop, MessageDisplay, PreToolUse). Installed by
# the Readback VS Code extension; edits are overwritten on its next activation.
# Readback condenses replies by running claude itself. That run carries this
# marker, and a hook that sees it does nothing, so a reply about a reply can
# never be read.
if ($env:READBACK_HOOK) { exit 0 }
$dir = ${powershellQuote(endpointsDir)}
if (-not (Test-Path -LiteralPath $dir)) { exit 0 }
$payload = [Console]::In.ReadToEnd()
$body = [System.Text.Encoding]::UTF8.GetBytes($payload)
foreach ($f in Get-ChildItem -LiteralPath $dir -File) {
  $line = Get-Content -LiteralPath $f.FullName -First 1
  if (-not $line) { continue }
  $port, $token = $line.Trim() -split ' ', 2
  try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/turn" -Headers @{ Authorization = "Bearer $token" } \
      -ContentType 'application/json' -Body $body -TimeoutSec 5 | Out-Null
  } catch {
    if ("$($_.Exception)" -match 'refused') { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue }
  }
}
exit 0
`;
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
