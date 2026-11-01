import { describe, expect, it } from "vitest";
import { IDLE_TEXT, LONG_TOOL_MS, longToolText, longToolWorthSaying, permissionText, permissionWorthSaying } from "./alerts.ts";

describe("alerts", () => {
  it("names the tool call a permission prompt waits on", () => {
    expect(permissionText("Bash", { command: "npm install\nnpm test" })).toBe("Claude is waiting for your permission to run npm install.");
    expect(permissionText("Edit", { file_path: "/a/b/marks.ts" })).toBe("Claude is waiting for your permission to edit marks.ts.");
  });

  it("speaks only a real main-loop call the engine will ask about", () => {
    expect(permissionWorthSaying({ tool_use_id: "t1" }, "ask")).toBe(true);
    expect(permissionWorthSaying({ tool_use_id: "t1" }, "allow")).toBe(false);
    expect(permissionWorthSaying({}, "ask")).toBe(false);
    expect(permissionWorthSaying({ tool_use_id: "t1", agentId: "a" }, "ask")).toBe(false);
  });

  it("rounds a long command's time so the renders are few", () => {
    expect(longToolText(31_000)).toBe("A command finished after about 30 seconds.");
    expect(longToolText(44_000)).toBe("A command finished after about 40 seconds.");
    expect(longToolText(110_000)).toBe("A command finished after about 110 seconds.");
    expect(longToolText(150_000)).toBe("A command finished after about 3 minutes.");
  });

  it("announces only the main loop's long Bash calls that did not wait on a prompt", () => {
    expect(longToolWorthSaying({ tool: "Bash" }, LONG_TOOL_MS, false)).toBe(true);
    expect(longToolWorthSaying({ tool: "Bash" }, LONG_TOOL_MS - 1, false)).toBe(false);
    expect(longToolWorthSaying({ tool: "Bash" }, LONG_TOOL_MS, true)).toBe(false);
    expect(longToolWorthSaying({ tool: "Read" }, LONG_TOOL_MS, false)).toBe(false);
    expect(longToolWorthSaying({ tool: "Bash", agentId: "a" }, LONG_TOOL_MS, false)).toBe(false);
  });

  it("has one idle sentence", () => {
    expect(IDLE_TEXT).toMatch(/waiting for you/);
  });
});
