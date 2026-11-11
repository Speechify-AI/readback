import { describe, expect, it } from "vitest";
import { endpointFolders, endpointPort, extensionListening, type EndpointDeps } from "./extension.ts";

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

  const dir = "/h/.readback/endpoints";
  const cwd = "/h/code/readback";

  it("reads the folders under the first line, none meaning an older extension", () => {
    expect(endpointFolders("4000 a\n/w/one\n/w/two\n")).toEqual(["/w/one", "/w/two"]);
    expect(endpointFolders("4000 a\n")).toBeNull();
    expect(endpointFolders("4000 a")).toBeNull();
    expect(endpointFolders("4000 a\n-\n")).toEqual([]);
  });

  it("yields to a window with no folder open only a reply from home", async () => {
    const project = deps({ "100": "4000 a\n-\n" }, [4000]);
    expect(await extensionListening(project, dir, cwd, "/h")).toBe(false);
    expect(project.probed).toEqual([]);
    const home = deps({ "100": "4000 a\n-\n" }, [4000]);
    expect(await extensionListening(home, dir, "/h", "/h")).toBe(true);
  });

  it("is listening when one window answers, a 404 included", async () => {
    const d = deps({ "100": "4000 a\n", "200": "4001 b\n" }, [4001]);
    expect(await extensionListening(d, dir, cwd, "/h")).toBe(true);
    expect(d.probed).toEqual([4000, 4001]);
  });

  it("yields only to a window whose project this is; one that names none is an older extension, yielded to", async () => {
    const other = deps({ "100": "4000 a\n/h/code/other\n" }, [4000]);
    expect(await extensionListening(other, dir, cwd, "/h")).toBe(false);
    expect(other.probed).toEqual([]);
    const same = deps({ "100": "4000 a\n/h/code/other\n/h/code/readback/src\n" }, [4000]);
    expect(await extensionListening(same, dir, cwd, "/h")).toBe(true);
    const older = deps({ "100": "4000 a\n" }, [4000]);
    expect(await extensionListening(older, dir, cwd, "/h")).toBe(true);
  });

  it("is not listening with no directory, no files, a stale file or junk", async () => {
    expect(await extensionListening(deps({}, []), "/elsewhere", cwd, "/h")).toBe(false);
    expect(await extensionListening(deps({}, []), dir, cwd, "/h")).toBe(false);
    expect(await extensionListening(deps({ "100": "4000 a\n" }, []), dir, cwd, "/h")).toBe(false);
    expect(await extensionListening(deps({ "100": "junk", sub: "" }, [4000]), dir, cwd, "/h")).toBe(false);
  });
});
