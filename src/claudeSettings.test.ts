import { describe, expect, it } from "vitest";
import { HOOK_EVENTS, hasHook, hookScript, withHook, withoutHook, type ClaudeSettings } from "./claudeSettings.ts";

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
