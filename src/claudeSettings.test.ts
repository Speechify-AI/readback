import { describe, expect, it } from "vitest";
import { hasHook, hookScript, withHook, withoutHook, type ClaudeSettings } from "./claudeSettings.ts";

const script = "/Users/me/.readback/hook.sh";

describe("withHook", () => {
  it("adds a Stop group beside existing hooks without touching them", () => {
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
    expect(after.hooks?.PreToolUse).toBe(before.hooks?.PreToolUse);
    const stop = after.hooks?.Stop;
    expect(Array.isArray(stop) && stop.length).toBe(2);
    expect(JSON.stringify(stop)).toContain("heard");
  });

  it("creates the hooks object when there is none", () => {
    const after = withHook({}, script);
    expect(hasHook(after, script)).toBe(true);
  });

  it("is idempotent", () => {
    const once = withHook({}, script);
    expect(withHook(once, script)).toBe(once);
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
  });

  it("removes the Stop key entirely when ours was the only hook", () => {
    const after = withoutHook(withHook({}, script), script);
    expect(after.hooks?.Stop).toBeUndefined();
  });

  it("leaves settings without hooks alone", () => {
    const settings: ClaudeSettings = { theme: "dark" };
    expect(withoutHook(settings, script)).toBe(settings);
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
