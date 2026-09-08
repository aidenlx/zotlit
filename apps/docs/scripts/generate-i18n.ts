// Compiles the site's Messages from the root catalog into the typed Paraglide
// facade; the `workbench_*` namespace is `@zotlit/workbench/ui`'s own compile.
import { compile } from "@inlang/paraglide-js";
import { resolve } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  isWorkbenchMessage,
  namespaceCompileOptions,
} from "@zotlit/config/paraglide";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

const packageRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);

const options = await yargs(hideBin(process.argv))
  .scriptName("generate:i18n")
  .option("output-structure", {
    choices: ["message-modules", "locale-modules"] as const,
    default: "message-modules" as const,
    description: "Group generated messages by message or locale.",
  })
  .option("is-server", {
    type: "string",
    description: "JavaScript expression used to detect the server runtime.",
  })
  .strict()
  .help()
  .parse();

await compile({
  ...namespaceCompileOptions({
    packageRoot,
    workspaceRoot,
    outdir: "src/paraglide",
    keep: (key) => !isWorkbenchMessage(key),
  }),
  outputStructure: options["output-structure"],
  ...(options["is-server"] === undefined
    ? {}
    : { isServer: options["is-server"] }),
});
