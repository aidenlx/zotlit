import { loadEnvFile } from "node:process";
import { defineConfig } from "drizzle-kit";

loadEnvFile();

if (!process.env.ZOTERO_DB_URL) {
  throw new Error("ZOTERO_DB_URL is not set");
}

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.ZOTERO_DB_URL },
  introspect: { casing: "preserve" },
});
