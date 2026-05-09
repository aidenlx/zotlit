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
  // we use .js config instead of .ts because
  // drizzle-kit jiti loader have trouble passing nested keys through
  // to validator like `introspect.casing` here
  introspect: { casing: "preserve" },
});
