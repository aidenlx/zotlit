// Rewrites every Template Directory Profile entry's packed partials from the partial entries.
//
// Run after editing a partial entry, then run the Directory suite to confirm
// the drift check passes and to update the rendered samples.
//
// @see docs/template-directory/README.md

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  readTemplateDirectory,
  templateDirectoryRoot,
} from "../src/lib/template-directory/read.ts";
import { repackTemplateDirectory } from "../src/lib/template-directory/repack.ts";

const root = await templateDirectoryRoot();
const changes = repackTemplateDirectory(await readTemplateDirectory(root));
for (const [path, content] of changes) {
  await writeFile(join(root, path), content);
  console.log(`Re-packed ${path}`);
}
if (changes.size === 0) console.log("Every Profile entry is already packed.");
