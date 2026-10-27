// The installed Effect module used by the held card-preparation probe.
import { createRequire } from "node:module";
import { join } from "node:path";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

export async function annotationPreparationModule(): Promise<string> {
  const root = await getWorkspaceRoot(import.meta.dirname);
  return createRequire(join(root, "apps/obsidian/package.json")).resolve(
    "effect/Effect",
  );
}
