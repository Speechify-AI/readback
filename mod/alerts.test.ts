import { describe, expect, it } from "vitest";
import { permissionText, permissionWorthSaying, promptWaiting } from "./alerts.ts";

describe("alerts", () => {
  it("names the tool call a permission prompt waits on", () => {
    expect(permissionText("Bash", { command: "npm install\nnpm test" })).toBe("Claude is waiting for your permission to run npm install.");
    expect(permissionText("Edit", { file_path: "/a/b/marks.ts" })).toBe("Claude is waiting for your permission to edit marks.ts.");
  });

  it("speaks when the main loop's prompt has waited, not on another notification or a subagent's", () => {
    expect(promptWaiting({ notification_type: "permission_prompt" })).toBe(true);
    expect(promptWaiting({ notification_type: "idle_prompt" })).toBe(false);
    expect(promptWaiting({ notification_type: "permission_prompt", agent_id: "a" })).toBe(false);
  });

  it("remembers only a real main-loop call whose verdict is ask", () => {
    expect(permissionWorthSaying({ tool_use_id: "t1" }, "ask")).toBe(true);
    expect(permissionWorthSaying({ tool_use_id: "t1" }, "allow")).toBe(false);
    expect(permissionWorthSaying({}, "ask")).toBe(false);
    expect(permissionWorthSaying({ tool_use_id: "t1", agentId: "a" }, "ask")).toBe(false);
  });
});
