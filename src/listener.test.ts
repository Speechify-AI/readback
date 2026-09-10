import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startListener, type Listener } from "./listener.ts";

let listener: Listener | null = null;
afterEach(() => {
  listener?.close();
  listener = null;
});

describe("startListener", () => {
  it("publishes port and token, accepts a bearer post, refuses the rest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "readback-"));
    const received: unknown[] = [];
    listener = await startListener(dir, (p) => received.push(p));

    const [port, token] = readFileSync(listener.endpointFile, "utf8").trim().split(" ");
    expect(Number(port)).toBe(listener.port);
    expect(token).toBe(listener.token);

    const url = `http://127.0.0.1:${listener.port}/turn`;
    const ok = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ hook_event_name: "Stop", last_assistant_message: "hi" }),
    });
    expect(ok.status).toBe(204);
    expect(received).toEqual([{ hook_event_name: "Stop", last_assistant_message: "hi" }]);

    const noAuth = await fetch(url, { method: "POST", body: "{}" });
    expect(noAuth.status).toBe(401);
    const badJson = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{" });
    expect(badJson.status).toBe(400);
    const wrongPath = await fetch(`http://127.0.0.1:${listener.port}/x`, { method: "POST" });
    expect(wrongPath.status).toBe(404);

    const file = listener.endpointFile;
    listener.close();
    listener = null;
    expect(existsSync(file)).toBe(false);
  });
});
