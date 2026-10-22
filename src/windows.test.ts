import { describe, expect, it } from "vitest";
import { relatedToWorkspace } from "./windows.ts";

describe("relatedToWorkspace", () => {
  const home = "/Users/me";
  const folders = ["/Users/me/code/customers/tools/readback"];

  it("accepts the folder itself and anything inside it", () => {
    expect(relatedToWorkspace("/Users/me/code/customers/tools/readback", folders, home)).toBe(true);
    expect(relatedToWorkspace("/Users/me/code/customers/tools/readback/src", folders, home)).toBe(true);
  });

  it("accepts a parent: the monorepo root is the same project", () => {
    expect(relatedToWorkspace("/Users/me/code/customers", folders, home)).toBe(true);
  });

  it("rejects a sibling project and a lookalike prefix", () => {
    expect(relatedToWorkspace("/Users/me/code/customers/tools/soundbites", folders, home)).toBe(false);
    expect(relatedToWorkspace("/Users/me/code/customers/tools/readback2", folders, home)).toBe(false);
  });

  it("gives a turn from home to the windows with no folder open, not to every project", () => {
    expect(relatedToWorkspace("/Users/me", folders, home)).toBe(false);
    expect(relatedToWorkspace("/", folders, home)).toBe(false);
    expect(relatedToWorkspace("/Users/me", [], home)).toBe(true);
    expect(relatedToWorkspace("/", [], home)).toBe(true);
    expect(relatedToWorkspace("/Users/me/code", [], home)).toBe(false);
  });

  it("rejects no cwd and no folders", () => {
    expect(relatedToWorkspace(null, folders, home)).toBe(false);
    expect(relatedToWorkspace("/x", [], home)).toBe(false);
  });
});
