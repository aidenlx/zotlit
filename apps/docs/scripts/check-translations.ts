import { resolve } from "node:path";

import { scanTranslationReadiness } from "../src/lib/translation-scan.ts";

const packageRoot = resolve(import.meta.dirname, "..");
const { files, missing } = scanTranslationReadiness(packageRoot);
const placeholders = files.filter((file) => file.status === "placeholder");

if (placeholders.length > 0 || missing.length > 0) {
  console.error(
    `Translation readiness failed: ${placeholders.length} placeholder files, ${missing.length} missing files.`,
  );
  for (const file of placeholders) {
    console.error(`  placeholder (${file.kind}): ${file.path}`);
  }
  for (const path of missing) console.error(`  missing: ${path}`);
  console.error(
    "Complete and review the Chinese content, includes, metadata and UI before removing their approval markers.",
  );
  process.exitCode = 1;
} else {
  console.log(
    `Translation readiness passed: ${files.length} approved files; all Chinese counterparts are present.`,
  );
}
