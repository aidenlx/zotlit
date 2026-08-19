import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.e2e.ts"],
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
