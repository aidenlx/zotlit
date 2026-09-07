// A `node:fs` view for a Paraglide compile in which each root catalog file
// carries only the Messages the compiling package owns.
import * as fs from "node:fs";
import { join } from "node:path";

export const WORKBENCH_MESSAGE_PREFIX = "workbench_";

export const isWorkbenchMessage: MessageFilter = (key) =>
  key.startsWith(WORKBENCH_MESSAGE_PREFIX);

/** Shared compiler options for each host-owned message namespace. */
export function namespaceCompileOptions({
  workspaceRoot,
  packageRoot,
  outdir,
  keep,
}: {
  workspaceRoot: string;
  packageRoot: string;
  outdir: string;
  keep: MessageFilter;
}) {
  return {
    project: join(workspaceRoot, "project.inlang"),
    outdir: join(packageRoot, outdir),
    strategy: ["baseLocale" as const],
    outputStructure: "message-modules" as const,
    emitTsDeclarations: true,
    fs: filteredMessageFs(keep),
  };
}

/** Whether a Message key belongs to the compiling package. */
export type MessageFilter = (key: string) => boolean;

/** A root catalog file: `messages/<locale>.json`. */
const CATALOG_FILE = /[\\/]messages[\\/][^\\/]+\.json$/;

/**
 * Wraps `node:fs` so every read of a root catalog file returns the Messages
 * `keep` accepts, with the JSON schema reference kept. Pass it as the `fs`
 * option of Paraglide's `compile()` and its bundler plugins.
 */
export function filteredMessageFs(keep: MessageFilter): typeof fs {
  function filter(data: string | Buffer): string {
    const catalog = JSON.parse(String(data)) as Record<string, unknown>;
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(catalog).filter(
          ([key]) => key === "$schema" || keep(key),
        ),
      ),
      null,
      2,
    );
  }
  const isCatalog = (path: unknown): boolean =>
    (typeof path === "string" || path instanceof URL) &&
    CATALOG_FILE.test(path.toString());
  const same = <T extends string | Buffer>(data: T, text: string): T =>
    (typeof data === "string" ? text : Buffer.from(text)) as T;

  return {
    ...fs,
    readFileSync(path, options) {
      const data = fs.readFileSync(path, options);
      return isCatalog(path) ? same(data, filter(data)) : data;
    },
    promises: {
      ...fs.promises,
      async readFile(path, options) {
        const data = await fs.promises.readFile(path, options);
        return isCatalog(path) ? same(data, filter(data)) : data;
      },
    },
  } as typeof fs;
}
