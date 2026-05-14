import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const here = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@drizzle/schema": resolve(here, "drizzle/schema.ts"),
      "@drizzle/relations": resolve(here, "drizzle/relations.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
