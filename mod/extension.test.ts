import { describe, expect, it } from "vitest";
import { endpointPort, extensionListening, type EndpointDeps } from "./extension.ts";

const deps = (files: Record<string, string>, alive: number[]): EndpointDeps & { probed: number[] } => {
  const probed: number[] = [];
  return {
    probed,
    list: async (dir) => {
      if (dir !== "/h/.readback/endpoints") throw new Error("ENOENT");
      return Object.keys(files).map((name) => ({ name, kind: name === "sub" ? "dir" : "file" }));
    },
    read: async (path) => {
      const text = files[path.slice("/h/.readback/endpoints/".length)];
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
    fetch: async (url) => {
      const port = Number(new URL(url).port);
      probed.push(port);
      if (!alive.includes(port)) throw new Error("ECONNREFUSED");
      return { status: 404 };
    },
  };
};

describe("the extension's endpoints", () => {
  it("reads the port off a `port token` line and nothing else", () => {
    expect(endpointPort("54755 b921b358\n")).toBe(54755);
    expect(endpointPort("54755")).toBeNull();
    expect(endpointPort("")).toBeNull();
    expect(endpointPort("0 tok")).toBeNull();
    expect(endpointPort("70000 tok")).toBeNull();
    expect(endpointPort("port tok")).toBeNull();
  });

  it("is listening when one window answers, a 404 included", async () => {
    const d = deps({ "100": "4000 a\n", "200": "4001 b\n" }, [4001]);
    expect(await extensionListening(d, "/h/.readback/endpoints")).toBe(true);
    expect(d.probed).toEqual([4000, 4001]);
  });

  it("is not listening with no directory, no files, a stale file or junk", async () => {
    expect(await extensionListening(deps({}, []), "/elsewhere")).toBe(false);
    expect(await extensionListening(deps({}, []), "/h/.readback/endpoints")).toBe(false);
    expect(await extensionListening(deps({ "100": "4000 a\n" }, []), "/h/.readback/endpoints")).toBe(false);
    expect(await extensionListening(deps({ "100": "junk", sub: "" }, [4000]), "/h/.readback/endpoints")).toBe(false);
  });
});
