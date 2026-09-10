/**
 * The loopback listener the hook posts to.
 *
 * One per VS Code window, on 127.0.0.1 and a random port, guarded by a
 * random bearer token. The port and token are published in one small file
 * per window under the endpoints directory, which is how the hook finds
 * every window; the file is removed on deactivate and by the hook itself
 * when the connection is refused.
 *
 * The listener does not decide anything. It checks the token, parses the
 * body, and hands the object to `onPayload`. Which window should speak is
 * the extension's call, because it knows the workspace folders.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

export interface Listener {
  port: number;
  token: string;
  endpointFile: string;
  close(): void;
}

const MAX_BODY_BYTES = 2_000_000;

export function startListener(
  endpointsDir: string,
  onPayload: (payload: unknown) => void,
): Promise<Listener> {
  const token = randomBytes(24).toString("hex");
  const server: Server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/turn") {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400).end();
        return;
      }
      res.writeHead(204).end();
      onPayload(payload);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("listener bound to no port"));
        return;
      }
      mkdirSync(endpointsDir, { recursive: true });
      const endpointFile = join(endpointsDir, String(process.pid));
      writeFileSync(endpointFile, `${address.port} ${token}\n`, { mode: 0o600 });
      resolve({
        port: address.port,
        token,
        endpointFile,
        close: () => {
          rmSync(endpointFile, { force: true });
          server.close();
        },
      });
    });
  });
}
