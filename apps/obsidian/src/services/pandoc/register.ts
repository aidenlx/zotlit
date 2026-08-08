// Registers the Native Pandoc Workflow CLI surface.
//
// Flag and command help text is localized: it is UI text a user reads while
// discovering the command. The response is the machine surface the filter
// parses, so its error codes and messages stay literal English.

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

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";
import { resolveIndexedKey } from "@/services/note-index/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  createPandocIntegrationHandlers,
  PANDOC_FILES_COMMAND,
  PANDOC_GUIDE_COMMAND,
} from "./integration";
import { resolveCitations } from "./resolve";
import type { ResolveDocument, ResolvedItem } from "./resolve";

const logger = getLogger(["pandoc", "resolve"]);

export const RESOLVE_COMMAND = "zotlit:resolve";

export interface PandocResolveDeps {
  app: App;
  db: Pick<DatabaseService, "acquireRead" | "activeReadMode">;
  zoteroPref: Pick<ZoteroPrefService, "ready" | "dataDir">;
}

function resolveFlags(): CliFlags {
  return {
    file: {
      value: "<absolute-path>",
      description: m.cli_flag_file_desc(),
      required: true,
    },
  } satisfies Record<"file", CliFlag>;
}

export function registerPandocResolve(
  plugin: Plugin,
  deps: PandocResolveDeps,
): void {
  const integration = createPandocIntegrationHandlers(plugin.manifest.version);
  plugin.registerCliHandler(
    PANDOC_FILES_COMMAND,
    m.cli_pandoc_files_desc(),
    null,
    integration[PANDOC_FILES_COMMAND],
  );
  plugin.registerCliHandler(
    PANDOC_GUIDE_COMMAND,
    m.cli_pandoc_guide_desc(),
    null,
    integration[PANDOC_GUIDE_COMMAND],
  );
  plugin.registerCliHandler(
    RESOLVE_COMMAND,
    m.cli_resolve_desc(),
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
