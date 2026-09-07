// Compiles the site's Messages from the root catalog into the typed Paraglide
// facade; the `workbench_*` namespace is `@zotlit/workbench/ui`'s own compile.
import { compile } from "@inlang/paraglide-js";
import { resolve } from "node:path";

import {
  isWorkbenchMessage,
  namespaceCompileOptions,
} from "@zotlit/config/paraglide";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

const packageRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);

await compile(
  namespaceCompileOptions({
    packageRoot,
    workspaceRoot,
    outdir: "src/paraglide",
    keep: (key) => !isWorkbenchMessage(key),
  }),
);
