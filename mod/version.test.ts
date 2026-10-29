import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const plugin = read(".claude-plugin/plugin.json");
const pkg = read("package.json");

describe("plugin manifest", () => {
  it("plugin and extension share one version", () => {
    expect(plugin.version).toBe(pkg.version);
  });

  it("the key is the only userConfig field and is sensitive", () => {
    expect(Object.keys(plugin.userConfig)).toEqual(["speechify_api_key"]);
    expect(plugin.userConfig.speechify_api_key.sensitive).toBe(true);
  });
});
