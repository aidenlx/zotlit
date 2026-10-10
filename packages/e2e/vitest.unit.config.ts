import { defineConfig } from "vitest/config";

// The pure logic of the measurement script: no Obsidian, so it runs in
// `pnpm test`. The End-to-end Run keeps `vitest.config.ts`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
