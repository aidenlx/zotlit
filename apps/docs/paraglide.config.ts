import { resolve } from "node:path";

import type { CompilerOptions } from "@zotlit/paraglide-vite";

const packageRoot = import.meta.dirname;

export const paraglideOptions = {
  project: resolve(packageRoot, "../../project.inlang"),
  outdir: resolve(packageRoot, "src/paraglide"),
  strategy: ["baseLocale"],
  emitTsDeclarations: true,
} satisfies CompilerOptions;
