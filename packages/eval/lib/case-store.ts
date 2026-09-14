// Locates evaluation cases on disk.
//
// A case is one evaluation workspace: an iteration directory holding
// `evals.json`, per-eval gradings, and supporting evidence.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

/** The committed case root, `<workspace>/packages/eval/cases`. */
export function getCasesRoot(): string {
  return fileURLToPath(new URL("../cases", import.meta.url));
}

export async function getWorkspaceRootFromHere(): Promise<string> {
  return getWorkspaceRoot(fileURLToPath(new URL(".", import.meta.url)));
}

export interface EvalCase {
  id: string;
  prompt: string;
  expected_output?: string;
  assertions: string[];
}

export interface EvalSet {
  skill_name?: string;
  cli_contract?: number;
  model?: string;
  reasoning?: string;
  evals: EvalCase[];
}

/** Read an eval-set file (`evals.json`). */
export async function readEvalSet(path: string): Promise<EvalSet> {
  return JSON.parse(await readFile(path, "utf8")) as EvalSet;
}

/**
 * Resolve a case by id, iteration name, or path.
 *
 * Accepts an absolute path, a path relative to the working directory, a path
 * under the committed case root, or a bare case id. A bare case id resolves to
 * the directory that holds `evals.json`, preferring the newest iteration.
 */
export async function resolveCase(idOrPath: string): Promise<string> {
  const roots = [resolve(idOrPath), join(getCasesRoot(), idOrPath)];

  for (const root of roots) {
    const info = await stat(root).catch(() => undefined);
    if (!info?.isDirectory()) continue;

    // The path may be the case root holding iteration directories.
    const iterations = (await readdir(root, { withFileTypes: true }))
      .filter(
        (entry) => entry.isDirectory() && /^iteration-\d+$/.test(entry.name),
      )
      .map((entry) => entry.name)
      .toSorted();

    return iterations.length > 0 ? join(root, iterations.at(-1)!) : root;
  }

  throw new Error(`No case directory found for "${idOrPath}".`);
}

/** List the case ids available under the committed case root. */
export async function listCases(): Promise<string[]> {
  // The root is absent until a Case is added, so treat it as empty.
  const entries = await readdir(getCasesRoot(), { withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}
