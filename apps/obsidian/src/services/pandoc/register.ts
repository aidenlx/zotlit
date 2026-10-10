// Registers the Native Pandoc Workflow CLI surface.
//
// Command, flag, and response text is all hardcoded English: an agent-facing
// contract surface, not localized UI. See apps/obsidian/policies/cli-text.md.

import { Effect } from "effect";
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
import * as v from "valibot";

import {
  cliNotApplicable,
  cliParams,
  cliValue,
  cliVariants,
  decodeCliParams,
  rejectionText,
} from "@/lib/cli-params";
import type { CliParamName } from "@/lib/cli-params";
import { getLogger } from "@/lib/log";
import { resolveIndexedKey } from "@/services/note-index/service";
import type { ProfileReader } from "@/services/profile/service";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import {
  CSL_COMMAND,
  CSL_SELECTOR_MESSAGE,
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
import type { ResolveDocument, ResolvedItem, ResolveResponse } from "./resolve";
import { resolveInstalledStyle } from "./styles";

const logger = getLogger(["pandoc", "resolve"]);

export const RESOLVE_COMMAND = "zotlit:resolve";
export { CSL_COMMAND };

export interface PandocResolveDeps {
  app: App;
  reads: Pick<ZoteroReadsService, "ready" | "activeReadMode">;
  zoteroPref: Pick<ZoteroPrefService, "ready" | "dataDir">;
  settings: Pick<SettingsService, "current">;
  profile: ProfileReader;
}

const resolveParams = v.pipe(
  cliParams({ file: cliValue("file") }),
  v.transform(({ file }) => file),
);

function resolveFlags(): CliFlags {
  return {
    file: {
      value: "<absolute-path>",
      description: "Absolute path to the Markdown file",
      required: true,
    },
  } satisfies Record<CliParamName<typeof resolveParams>, CliFlag>;
}

const cslParams = cliVariants(
  ({ style }) => (style === undefined ? "file" : "style"),
  {
    style: cliParams({
      style: cliValue("style"),
      file: cliNotApplicable(CSL_SELECTOR_MESSAGE),
    }),
    file: cliParams({ file: cliValue("file") }, { file: CSL_SELECTOR_MESSAGE }),
  },
);

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
  } satisfies Record<CliParamName<typeof cslParams>, CliFlag>;
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
      const request = decodeCliParams(params, resolveParams, {
        command: RESOLVE_COMMAND,
      });
      if (request.kind === "invalid") {
        return JSON.stringify(
          {
            errors: [
              { code: "flags-invalid", message: rejectionText(request) },
            ],
          } satisfies ResolveResponse,
          null,
          2,
        );
      }
      await deps.zoteroPref.ready;
      const response = await resolveCitations(request.value, {
        readDocument: (absolutePath) => readDocument(deps.app, absolutePath),
        resolveIndexedKey: (linkpath, sourcePath) =>
          resolveIndexedKey(linkpath, sourcePath, deps.app),
        database: {
          describe: () => ({
            dataDir: deps.zoteroPref.dataDir,
            readMode: deps.reads.activeReadMode,
          }),
          read: (indexedKeys) =>
            readItems(deps.reads, indexedKeys).catch((error: unknown) => {
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
      const request = decodeCliParams(params, cslParams, {
        command: CSL_COMMAND,
      });
      if (request.kind === "invalid") {
        return JSON.stringify(
          flagsInvalidResponse(rejectionText(request)),
          null,
          2,
        );
      }
      await deps.zoteroPref.ready;
      await deps.profile.ready;
      const { dataDir } = deps.zoteroPref;
      // A native run carries no vault Citation Locale: the installed style
      // keeps the locale behavior Zotero installed it with.
      const ports = {
        resolve: (styleId: string) =>
          resolveInstalledStyle(dataDir, { styleId }),
      };
      const selected = request.value;
      const response: CslResponse =
        "style" in selected
          ? await resolveCslStyle(selected.style, ports)
          : await resolveDocumentCslStyle(selected.file, {
              ...ports,
              readStyle: (absolutePath) =>
                readDocumentStyle(deps, absolutePath),
            });
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

/** One database read per invocation, however many links the document carries. */
async function readItems(
  reads: PandocResolveDeps["reads"],
  indexedKeys: readonly string[],
): Promise<ReadonlyMap<string, ResolvedItem>> {
  const { reads: api } = await reads.ready;
  const unique = [...new Set(indexedKeys)];
  const found = await Effect.runPromise(
    api.ItemsByIndexedKeys({ indexedKeys: unique }),
  );
  const items = new Map<string, ResolvedItem>();
  for (const indexedKey of unique) {
    const item = found.get(indexedKey);
    if (!item) continue;
    items.set(indexedKey, {
      citationKey:
        ("citationKey" in item.fields ? item.fields.citationKey : null) ?? null,
      // Every item type `ItemsByIndexedKeys` can return carries `title`; the
      // check is what narrows Zotero's field union, which includes child items.
      title: ("title" in item.fields ? item.fields.title : null) ?? item.key,
    });
  }
  return items;
}
