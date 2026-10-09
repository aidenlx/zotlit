import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";
import type { TestProject } from "vitest/node";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { openPairedEnvironment } from "./paired-environment.ts";
import type { PairedEnvironment } from "./paired-environment.ts";
import { isObsidianReachable } from "./vault-script.ts";

type PairedContext = Omit<PairedEnvironment, typeof Symbol.asyncDispose>;

declare module "vitest" {
  interface ProvidedContext {
    pairedEnvironment: PairedContext | null;
  }
}

/** Launch once before test collection; keep ownership in the main process. */
export default async function setup(project: TestProject) {
  const root = await getWorkspaceRoot(import.meta.dirname);
  const directory = join(root, ".scratch", "e2e-results");
  const log = join(directory, "paired-startup.log");
  await rm(log, { force: true });
  if (!(await isObsidianReachable(root))) {
    project.provide("pairedEnvironment", null);
    return;
  }
  console.log("Paired Run: checking Zotero launch and Local API readiness");
  try {
    const environment = await openPairedEnvironment(root);
    const { layout, vaultPath, vaultId, baseUrl, debuggerPort } = environment;
    project.provide("pairedEnvironment", {
      layout,
      vaultPath,
      vaultId,
      baseUrl,
      debuggerPort,
    });
    console.log("Paired Run: ready");
    return async () => await environment[Symbol.asyncDispose]();
  } catch (error) {
    await mkdir(directory, { recursive: true });
    await writeFile(log, inspect(error, { depth: 8 }));
    throw new Error(
      `Paired Run setup failed before test collection. Diagnostics: ${log}`,
      { cause: error },
    );
  }
}
