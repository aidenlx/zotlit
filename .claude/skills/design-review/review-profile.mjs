// Writes the Default profile under the id `review` to the path given, so the
// docs Workbench opens it with the Match tab enabled. Reads the built
// `@zotlit/workbench` (run its build first).
import { writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) throw new Error("usage: review-profile.mjs <output.md>");
const { DEFAULT_PROFILE_SOURCE } = await import(
  new URL(
    "../../../packages/workbench/dist/src/render/default-profile.mjs",
    import.meta.url,
  ).href
);
writeFileSync(
  out,
  DEFAULT_PROFILE_SOURCE.replace(/^id: default$/m, "id: review").replace(
    /^name: Default$/m,
    "name: Review",
  ),
);
