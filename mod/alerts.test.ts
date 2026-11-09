import { describe, expect, it } from "vitest";
import { mainLoopCall, permissionText, promptWaiting, waitingCall, type PendingCall } from "./alerts.ts";

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

  it("remembers only a real main-loop call", () => {
    expect(mainLoopCall({ tool_use_id: "t1" })).toBe(true);
    expect(mainLoopCall({})).toBe(false);
    expect(mainLoopCall({ tool_use_id: "t1", agentId: "a" })).toBe(false);
  });

  it("picks the latest unsaid call, the one the message names first", () => {
    const call = (tool: string, said = false): PendingCall => ({ tool, input: {}, said });
    const calls = [["a", call("Bash")], ["b", call("Edit")], ["c", call("Read", true)]] as const;
    expect(waitingCall(calls, "Claude needs your permission to use Bash")?.[0]).toBe("a");
    expect(waitingCall(calls, "Claude needs your permission")?.[0]).toBe("b");
    expect(waitingCall(calls, "Claude needs your permission to use Read")?.[0]).toBe("b");
    expect(waitingCall([["c", call("Read", true)]], "")).toBeUndefined();
  });
});
