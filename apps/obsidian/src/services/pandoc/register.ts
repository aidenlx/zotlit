// Registers the Native Pandoc Workflow CLI surface.
//
// Command, flag, and response text is all hardcoded English: an agent-facing
// contract surface, not localized UI. See apps/obsidian/policies/cli-text.md.

import { Effect, Layer } from "effect";
import { isAbsolute, relative } from "node:path";
import { normalizePath } from "obsidian";
import type { App, CliData, CliFlag, CliFlags, TFile } from "obsidian";

import type { VersionedCliHost } from "@/lib/cli-command";
import {
  catchRejection,
  cliMap,
  cliNotApplicable,
  cliParams,
  cliValue,
  cliVariants,
  decodeCliParams,
  rejectionText,
} from "@/lib/cli-params";
import type { CliParamName } from "@/lib/cli-params";
import { withLogCategory } from "@/lib/effect-log";
import { ObsidianEnv } from "@/lib/obsidian-env";
import { PluginHost } from "@/lib/plugin-host";
import { resolveIndexedKey } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import type { ProfileOperations } from "@/services/profile/service";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

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
  profileReaderOf,
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

export const RESOLVE_COMMAND = "zotlit:resolve";
export { CSL_COMMAND };

export interface PandocResolveDeps {
  app: App;
  /** The vault's folder on disk, which the CLI's absolute paths start with. */
  basePath: string;
  reads: Pick<ZoteroReads["Service"], "current" | "reads">;
  zoteroPref: Pick<ZoteroPref["Service"], "current">;
  settings: Pick<PluginSettings["Service"], "current">;
  profile: Pick<Profile["Service"], "loaded" | "profileOf">;
}

/** The `zotlit:resolve`, `zotlit:csl` and Pandoc integration commands. */
export const layerPandocResolve: Layer.Layer<
  never,
  never,
  PluginHost | ObsidianEnv | ZoteroReads | ZoteroPref | PluginSettings | Profile
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    registerPandocResolve(host, {
      app: host.app,
      basePath: (yield* ObsidianEnv).basePath,
      reads: yield* ZoteroReads,
      zoteroPref: yield* ZoteroPref,
      settings: yield* PluginSettings,
      profile: yield* Profile,
    });
  }),
);

const resolveParams = cliParams({ file: cliValue("file") }).pipe(
  cliMap(({ file }) => file),
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
  host: VersionedCliHost,
  deps: PandocResolveDeps,
): void {
  const integration = createPandocIntegrationHandlers(host.manifest.version);
  host.registerCliCommand(PANDOC_FILES_COMMAND, {
    description: "Return the version-matched ZotLit Pandoc integration pair",
    flags: null,
    handler: integration[PANDOC_FILES_COMMAND],
  });
  host.registerCliCommand(PANDOC_GUIDE_COMMAND, {
    description: "Print the ZotLit Pandoc CLI guide",
    flags: null,
    handler: integration[PANDOC_GUIDE_COMMAND],
  });
  host.registerCliCommand(RESOLVE_COMMAND, {
    description:
      "Resolve the literature note links of one file to citation keys, for the ZotLit Pandoc filter",
    flags: resolveFlags(),
    handler: Effect.fn("PandocCli.resolve")(
      function* (params: CliData) {
        const file = yield* decodeCliParams(params, resolveParams, {
          command: RESOLVE_COMMAND,
        });
        const response = yield* resolveCitations(file, {
          readDocument: (absolutePath) => readDocument(deps, absolutePath),
          resolveIndexedKey: (linkpath, sourcePath) =>
            resolveIndexedKey(linkpath, sourcePath, deps.app),
          database: {
            describe: () =>
              Effect.zipWith(
                deps.zoteroPref.current,
                deps.reads.current,
                ({ dataDir }, { activeReadMode }) => ({
                  dataDir,
                  readMode: activeReadMode,
                }),
              ),
            read: (indexedKeys) => {
              const unreadable = (error: unknown) =>
                Effect.logWarning("Cannot read the Zotero database").pipe(
                  Effect.annotateLogs({ error }),
                  withLogCategory("pandoc", "resolve"),
                  Effect.as(null),
                );
              return readItems(deps.reads, indexedKeys).pipe(
                Effect.catch(unreadable),
                Effect.catchDefect(unreadable),
              );
            },
          },
        });
        return JSON.stringify(response, null, 2);
      },
      catchRejection((rejection) =>
        JSON.stringify(
          {
            errors: [
              { code: "flags-invalid", message: rejectionText(rejection) },
            ],
          } satisfies ResolveResponse,
          null,
          2,
        ),
      ),
    ),
  });
  host.registerCliCommand(CSL_COMMAND, {
    description:
      "Materialize the CSL file of one Zotero-installed style or of one note's style, for the ZotLit Pandoc filter",
    flags: cslFlags(),
    handler: Effect.fn("PandocCli.csl")(
      function* (params: CliData) {
        const selected = yield* decodeCliParams(params, cslParams, {
          command: CSL_COMMAND,
        });
        const { dataDir } = yield* deps.zoteroPref.current;
        const settings = yield* deps.settings.current;
        const run = Effect.runSyncWith(yield* Effect.context<never>());
        const profile = profileReaderOf(deps.profile, run);
        // A native run carries no vault Citation Locale: the installed style
        // keeps the locale behavior Zotero installed it with.
        const ports = {
          resolve: (styleId: string) =>
            resolveInstalledStyle(dataDir, { styleId }),
        };
        const response: CslResponse = yield* Effect.promise(() =>
          "style" in selected
            ? resolveCslStyle(selected.style, ports)
            : resolveDocumentCslStyle(selected.file, {
                ...ports,
                readStyle: (absolutePath) =>
                  readDocumentStyle(
                    {
                      app: deps.app,
                      basePath: deps.basePath,
                      settings,
                      profile,
                    },
                    absolutePath,
                  ),
              }),
        );
        return JSON.stringify(response, null, 2);
      },
      catchRejection((rejection) =>
        JSON.stringify(flagsInvalidResponse(rejectionText(rejection)), null, 2),
      ),
    ),
  });
}

/**
 * The style one note renders with in Obsidian, read through the boundary every
 * in-app surface and the built-in export read it through.
 */
function readDocumentStyle(
  {
    app,
    basePath,
    settings,
    profile,
  }: {
    app: App;
    basePath: string;
    settings: Readonly<Settings>;
    profile: Pick<ProfileOperations, "loaded" | "profileOf">;
  },
  absolutePath: string,
): DocumentStyleRead {
  const file = vaultFile(app, basePath, absolutePath);
  if (!file) return { kind: "file-not-found" };
  const declared = documentPresentation(app.metadataCache, file, profile);
  if (declared.kind === "unusable") return declared;
  const { styleId } = effectivePresentation(
    declared.presentation,
    vaultPresentation(settings),
  );
  return { kind: "read", styleId, source: styleSourceOf(declared) };
}

/** The note at an absolute path, with the links Obsidian's cache holds for it. */
function readDocument(
  { app, basePath }: Pick<PandocResolveDeps, "app" | "basePath">,
  absolutePath: string,
): ResolveDocument | null {
  const file = vaultFile(app, basePath, absolutePath);
  if (!file) return null;
  return {
    sourcePath: file.path,
    links: app.metadataCache.getFileCache(file)?.links ?? [],
  };
}

/** The vault file at an absolute path under `basePath`. */
function vaultFile(
  app: App,
  basePath: string,
  absolutePath: string,
): TFile | null {
  if (!isAbsolute(absolutePath)) return null;
  return app.vault.getFileByPath(
    normalizePath(relative(basePath, absolutePath)),
  );
}

/** One database read per invocation, however many links the document carries. */
const readItems = Effect.fn("PandocCli.readItems")(function* (
  reads: PandocResolveDeps["reads"],
  indexedKeys: readonly string[],
) {
  const { reads: api } = reads;
  const unique = [...new Set(indexedKeys)];
  const found = yield* api.ItemsByIndexedKeys({ indexedKeys: unique });
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
});
