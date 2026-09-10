import { describe, expect, it } from "vitest";
import { relatedToWorkspace } from "./windows.ts";

describe("relatedToWorkspace", () => {
  const folders = ["/Users/me/code/customers/tools/readback"];

  it("accepts the folder itself and anything inside it", () => {
    expect(relatedToWorkspace("/Users/me/code/customers/tools/readback", folders)).toBe(true);
    expect(relatedToWorkspace("/Users/me/code/customers/tools/readback/src", folders)).toBe(true);
  });

  it("accepts a parent: the monorepo root is the same project", () => {
    expect(relatedToWorkspace("/Users/me/code/customers", folders)).toBe(true);
  });

  it("rejects a sibling project and a lookalike prefix", () => {
    expect(relatedToWorkspace("/Users/me/code/customers/tools/soundbites", folders)).toBe(false);
    expect(relatedToWorkspace("/Users/me/code/customers/tools/readback2", folders)).toBe(false);
  });

  it("rejects no cwd and no folders", () => {
    expect(relatedToWorkspace(null, folders)).toBe(false);
    expect(relatedToWorkspace("/x", [])).toBe(false);
  });
});
