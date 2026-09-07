// Compiles the `workbench_*` Messages of the root catalog into the Paraglide
// facade the `ui` subpath reads; every other Message stays with its own host.
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
    outdir: "src/ui/paraglide",
    keep: isWorkbenchMessage,
  }),
);
