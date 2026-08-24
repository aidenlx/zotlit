// Registers the Native Pandoc Workflow CLI surface.
//
// Command, flag, and response text is all hardcoded English: an agent-facing
// contract surface, not localized UI. See apps/obsidian/policies/cli-text.md.

import { isAbsolute, relative } from "node:path";
import { normalizePath } from "obsidian";
import type {
  App,
  CliFlag,
  CliFlags,
  FileSystemAdapter,
  Plugin,
} from "obsidian";

import {
  getCitekeyByItemKey,
  getItemsByKey,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";
import { resolveIndexedKey } from "@/services/note-index/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { CSL_COMMAND, resolveCslStyle } from "./csl";
import {
  createPandocIntegrationHandlers,
  PANDOC_FILES_COMMAND,
  PANDOC_GUIDE_COMMAND,
} from "./integration";
import { resolveCitations } from "./resolve";
import type { ResolveDocument, ResolvedItem } from "./resolve";
import { resolveInstalledStyle } from "./styles";

const logger = getLogger(["pandoc", "resolve"]);

export const RESOLVE_COMMAND = "zotlit:resolve";
export { CSL_COMMAND };

export interface PandocResolveDeps {
  app: App;
  db: Pick<DatabaseService, "acquireRead" | "activeReadMode">;
  zoteroPref: Pick<ZoteroPrefService, "ready" | "dataDir">;
}

function resolveFlags(): CliFlags {
  return {
    file: {
      value: "<absolute-path>",
      description: "Absolute path to the Markdown file",
      required: true,
    },
  } satisfies Record<"file", CliFlag>;
}

function cslFlags(): CliFlags {
  return {
    style: {
      value: "<csl-id>",
      description: "CSL ID of the Zotero-installed style",
      required: true,
    },
  } satisfies Record<"style", CliFlag>;
}

export function registerPandocResolve(
  plugin: Plugin,
  deps: PandocResolveDeps,
): void {
  const integration = createPandocIntegrationHandlers(plugin.manifest.version);
  plugin.registerCliHandler(
    PANDOC_FILES_COMMAND,
    "Return the version-matched ZotLit Pandoc integration pair",
    null,
    integration[PANDOC_FILES_COMMAND],
  );
  plugin.registerCliHandler(
    PANDOC_GUIDE_COMMAND,
    "Print the ZotLit Pandoc CLI guide",
    null,
    integration[PANDOC_GUIDE_COMMAND],
  );
  plugin.registerCliHandler(
    RESOLVE_COMMAND,
    "Resolve the literature note links of one file to citation keys, for the ZotLit Pandoc filter",
    resolveFlags(),
    async (params) => {
      await deps.zoteroPref.ready;
      const response = await resolveCitations(params.file ?? "", {
        readDocument: (absolutePath) => readDocument(deps.app, absolutePath),
        resolveIndexedKey: (linkpath, sourcePath) =>
          resolveIndexedKey(linkpath, sourcePath, deps.app),
        database: {
          describe: () => ({
            dataDir: deps.zoteroPref.dataDir,
            readMode: deps.db.activeReadMode,
          }),
          read: (indexedKeys) =>
            readItems(deps.db, indexedKeys).catch((error: unknown) => {
              logger.warn("Cannot read the Zotero database", { error });
              return null;
            }),
        },
      });
      return JSON.stringify(response, null, 2);
    },
  );
  plugin.registerCliHandler(
    CSL_COMMAND,
    "Materialize the CSL file of one Zotero-installed style, for the ZotLit Pandoc filter",
    cslFlags(),
    async (params) => {
      await deps.zoteroPref.ready;
      // A native run carries no vault Citation Locale: the installed style
      // keeps the locale behavior Zotero installed it with.
      const response = await resolveCslStyle(params.style ?? "", {
        resolve: (styleId) =>
          resolveInstalledStyle(deps.zoteroPref.dataDir, { styleId }),
      });
      return JSON.stringify(response, null, 2);
    },
  );
}

/** Desktop-only plugin: the adapter is always a `FileSystemAdapter`. */
function readDocument(app: App, absolutePath: string): ResolveDocument | null {
  if (!isAbsolute(absolutePath)) return null;
  const basePath = (app.vault.adapter as FileSystemAdapter).getBasePath();
  const file = app.vault.getFileByPath(
    normalizePath(relative(basePath, absolutePath)),
  );
  if (!file) return null;
  return {
    sourcePath: file.path,
    links: app.metadataCache.getFileCache(file)?.links ?? [],
  };
}

/** One read lease per invocation, however many links the document carries. */
async function readItems(
  db: PandocResolveDeps["db"],
  indexedKeys: readonly string[],
): Promise<ReadonlyMap<string, ResolvedItem>> {
  using lease = await db.acquireRead();
  const items = new Map<string, ResolvedItem>();
  for (const indexedKey of new Set(indexedKeys)) {
    const selector = resolveIndexedKeyLibrary(lease.client, indexedKey);
    if (!selector) continue;
    const { libraryID, key } = selector;
    const item = getItemsByKey(lease.client, libraryID, [key])[0];
    if (!item) continue;
    items.set(indexedKey, {
      citationKey: getCitekeyByItemKey(lease.client, libraryID, key),
      // Every item type `getItemsByKey` can return carries `title`; the check
      // is what narrows Zotero's field union, which includes child items.
      title: ("title" in item.fields ? item.fields.title : null) ?? item.key,
    });
  }
  return items;
}
