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
  TFile,
} from "obsidian";

import {
  getCitekeyByItemKey,
  getItemsByKey,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";
import { resolveIndexedKey } from "@/services/note-index/service";
import type { ProfileReader } from "@/services/profile/service";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  CSL_COMMAND,
  flagsInvalidResponse,
  resolveCslStyle,
  resolveDocumentCslStyle,
} from "./csl";
import type { CslResponse, DocumentStyleRead } from "./csl";
import {
  documentPresentation,
  effectivePresentation,
  styleSourceOf,
  vaultPresentation,
} from "./document-presentation";
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
  settings: Pick<SettingsService, "current">;
  profile: ProfileReader;
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
      description: "CSL ID of the Zotero-installed style; pass this or file",
    },
    file: {
      value: "<absolute-path>",
      description:
        "Absolute path to the Markdown file whose style to resolve; pass this or style",
    },
  } satisfies Record<"style" | "file", CliFlag>;
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
    "Materialize the CSL file of one Zotero-installed style or of one note's style, for the ZotLit Pandoc filter",
    cslFlags(),
    async (params) => {
      await deps.zoteroPref.ready;
      await deps.profile.ready;
      const { dataDir } = deps.zoteroPref;
      // A native run carries no vault Citation Locale: the installed style
      // keeps the locale behavior Zotero installed it with.
      const ports = {
        resolve: (styleId: string) =>
          resolveInstalledStyle(dataDir, { styleId }),
      };
      const { style, file } = params;
      let response: CslResponse;
      if (style !== undefined && file === undefined)
        response = await resolveCslStyle(style, ports);
      else if (file !== undefined && style === undefined)
        response = await resolveDocumentCslStyle(file, {
          ...ports,
          readStyle: (absolutePath) => readDocumentStyle(deps, absolutePath),
        });
      else response = flagsInvalidResponse();
      return JSON.stringify(response, null, 2);
    },
  );
}

/**
 * The style one note renders with in Obsidian, read through the boundary every
 * in-app surface and the built-in export read it through.
 */
function readDocumentStyle(
  { app, settings, profile }: PandocResolveDeps,
  absolutePath: string,
): DocumentStyleRead {
  const file = vaultFile(app, absolutePath);
  if (!file) return { kind: "file-not-found" };
  const declared = documentPresentation(app.metadataCache, file, profile);
  if (declared.kind === "unusable") return declared;
  const { styleId } = effectivePresentation(
    declared.presentation,
    vaultPresentation(settings.current),
  );
  return { kind: "read", styleId, source: styleSourceOf(declared) };
}

/** The note at an absolute path, with the links Obsidian's cache holds for it. */
function readDocument(app: App, absolutePath: string): ResolveDocument | null {
  const file = vaultFile(app, absolutePath);
  if (!file) return null;
  return {
    sourcePath: file.path,
    links: app.metadataCache.getFileCache(file)?.links ?? [],
  };
}

/** Desktop-only plugin: the adapter is always a `FileSystemAdapter`. */
function vaultFile(app: App, absolutePath: string): TFile | null {
  if (!isAbsolute(absolutePath)) return null;
  const basePath = (app.vault.adapter as FileSystemAdapter).getBasePath();
  return app.vault.getFileByPath(
    normalizePath(relative(basePath, absolutePath)),
  );
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
