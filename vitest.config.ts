import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "mod/**/*.test.ts"],
    environment: "node",
  },
});
