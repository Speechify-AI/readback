import { describe, expect, it } from "vitest";
import {
  CODEX_TARGET,
  HOOK_EVENTS,
  hasHook,
  hookEntry,
  hookScript,
  hookScriptName,
  withHook,
  withoutHook,
  type ClaudeSettings,
} from "./claudeSettings.ts";

const script = "/Users/me/.readback/hook.sh";

describe("withHook", () => {
  it("adds a group under each event beside existing hooks without touching them", () => {
    const before: ClaudeSettings = {
      permissions: { allow: ["Bash(npm test:*)"] },
      hooks: {
        PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "python3 x.py" }] }],
        Stop: [{ hooks: [{ type: "command", command: "heard", async: true }] }],
      },
    };
    const after = withHook(before, script);
    expect(hasHook(after, script)).toBe(true);
    expect(after.permissions).toBe(before.permissions);
    const stop = after.hooks?.Stop;
    expect(Array.isArray(stop) && stop.length).toBe(2);
    expect(JSON.stringify(stop)).toContain("heard");
    const display = after.hooks?.MessageDisplay;
    expect(Array.isArray(display) && display.length).toBe(1);
    const pre = after.hooks?.PreToolUse;
    expect(Array.isArray(pre) && pre.length).toBe(2);
    expect(JSON.stringify(pre)).toContain("python3 x.py");
  });

  it("creates the hooks object when there is none", () => {
    const after = withHook({}, script);
    expect(hasHook(after, script)).toBe(true);
    expect(Object.keys(after.hooks ?? {})).toEqual([...HOOK_EVENTS]);
  });

  it("is idempotent", () => {
    const once = withHook({}, script);
    expect(withHook(once, script)).toBe(once);
  });

  it("upgrades an install that only had the Stop entry", () => {
    const old: ClaudeSettings = { hooks: { Stop: [{ hooks: [{ type: "command", command: JSON.stringify(script), async: true }] }] } };
    expect(hasHook(old, script)).toBe(false);
    const after = withHook(old, script);
    expect(hasHook(after, script)).toBe(true);
    expect(Array.isArray(after.hooks?.Stop) && after.hooks.Stop.length).toBe(1);
  });

  it("quotes the script path so a space in the home dir survives", () => {
    const after = withHook({}, "/Users/Jo Bloggs/.readback/hook.sh");
    expect(JSON.stringify(after)).toContain('\\"/Users/Jo Bloggs/.readback/hook.sh\\"');
  });
});

describe("withoutHook", () => {
  it("removes only our command and drops the group if it is empty", () => {
    const settings = withHook(
      { hooks: { Stop: [{ hooks: [{ type: "command", command: "heard" }] }] } },
      script,
    );
    const after = withoutHook(settings, script);
    expect(hasHook(after, script)).toBe(false);
    expect(JSON.stringify(after.hooks?.Stop)).toContain("heard");
    expect(Array.isArray(after.hooks?.Stop) && after.hooks.Stop.length).toBe(1);
    expect(after.hooks?.MessageDisplay).toBeUndefined();
  });

  it("removes the event keys entirely when ours was the only hook", () => {
    const after = withoutHook(withHook({}, script), script);
    expect(after.hooks?.Stop).toBeUndefined();
    expect(after.hooks?.MessageDisplay).toBeUndefined();
    expect(after.hooks?.PreToolUse).toBeUndefined();
  });

  it("leaves settings without our hooks alone", () => {
    const bare: ClaudeSettings = { theme: "dark" };
    expect(withoutHook(bare, script)).toBe(bare);
    const others: ClaudeSettings = { hooks: { Stop: [{ hooks: [{ type: "command", command: "heard" }] }] } };
    expect(withoutHook(others, script)).toBe(others);
  });
});

describe("hookScript", () => {
  it("quotes the endpoints dir and forwards stdin as the body", () => {
    const sh = hookScript("/Users/Jo Bloggs/.readback/endpoints");
    expect(sh).toContain(`dir='/Users/Jo Bloggs/.readback/endpoints'`);
    expect(sh).toContain("--data-binary @-");
    expect(sh.startsWith("#!/bin/sh")).toBe(true);
  });

  it("exits at the top inside a condensing run", () => {
    expect(hookScript("/e")).toContain('[ -n "$READBACK_HOOK" ] && exit 0');
  });
});

describe("on Windows", () => {
  const ps1 = "C:\\Users\\me\\.readback\\hook.ps1";

  it("names a PowerShell script and runs it in exec form, so the path is one argument and no shell is involved", () => {
    expect(hookScriptName("win32")).toBe("hook.ps1");
    expect(hookScriptName("darwin")).toBe("hook.sh");
    const [hook] = hookEntry(ps1, "win32").hooks;
    expect(hook).toEqual({
      type: "command",
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
      async: true,
    });
  });

  it("recognises and removes the exec-form entry", () => {
    const after = withHook({ hooks: { Stop: [{ hooks: [{ type: "command", command: "heard" }] }] } }, ps1, "win32");
    expect(hasHook(after, ps1)).toBe(true);
    const gone = withoutHook(after, ps1);
    expect(hasHook(gone, ps1)).toBe(false);
    expect(JSON.stringify(gone.hooks?.Stop)).toContain("heard");
    expect(gone.hooks?.MessageDisplay).toBeUndefined();
  });

  it("writes a PowerShell hook with the endpoints folder quoted and the loop guard first", () => {
    const text = hookScript("C:\\Users\\Jo O'Brien\\.readback\\endpoints", "win32");
    expect(text.startsWith("# Readback")).toBe(true);
    expect(text).toContain("if ($env:READBACK_HOOK) { exit 0 }");
    expect(text).toContain("$dir = 'C:\\Users\\Jo O''Brien\\.readback\\endpoints'");
    expect(text).toContain("[Console]::In.ReadToEnd()");
    expect(text).toContain("Invoke-RestMethod -Method Post");
    expect(text).not.toContain("#!/bin/sh");
  });
});

describe("for Codex", () => {
  it("adds the Stop entry only, beside what is there, and removes exactly that", () => {
    const before: ClaudeSettings = { hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: "notify.sh" }] }] } };
    const after = withHook(before, script, "darwin", CODEX_TARGET);
    expect(hasHook(after, script, CODEX_TARGET)).toBe(true);
    expect(hasHook(after, script)).toBe(false);
    expect(Object.keys(after.hooks ?? {})).toEqual(["Stop"]);
    expect(JSON.stringify(after.hooks?.Stop)).toContain("notify.sh");
    const gone = withoutHook(after, script, CODEX_TARGET);
    expect(hasHook(gone, script, CODEX_TARGET)).toBe(false);
    expect(JSON.stringify(gone.hooks?.Stop)).toContain("notify.sh");
  });

  it("on Windows writes a commandWindows string rather than exec form", () => {
    const ps1 = "C:\\Users\\me\\.readback\\hook.ps1";
    const [hook] = hookEntry(ps1, "win32", CODEX_TARGET).hooks;
    expect(hook?.args).toBeUndefined();
    expect(hook?.commandWindows).toBe(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`);
    expect(hasHook(withHook({}, ps1, "win32", CODEX_TARGET), ps1, CODEX_TARGET)).toBe(true);
  });
});
