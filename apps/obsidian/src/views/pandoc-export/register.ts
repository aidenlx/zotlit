import { Effect, FileSystem } from "effect";
import { writeFile } from "node:fs/promises";
// Registers the built-in export command and drives one export end to end:
// modal → resolution → bibliography → engine → chosen destination.
import { basename, join } from "node:path";
import type { App, FileSystemAdapter, Plugin, TFile } from "obsidian";

import { parseIndexedKey, USER_LIBRARY_ID } from "@zotlit/db";
import type { Library } from "@zotlit/db";

import { AbortError } from "@/lib/abort-error";
import { citationStyleLabel } from "@/lib/citation-style";
import { valueOr } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice, LazyNotice } from "@/lib/notice";
import { requestProfileSwitch } from "@/lib/profile-recovery";
import { ZoteroHttp } from "@/lib/zotero-http";
import type { PlainCitationLookup } from "@/services/citation-index/plain";
import { CitationParse } from "@/services/citation-parse/service";
import type { ManagedBinaryHandle } from "@/services/managed-binary/handle";
import { resolveIndexedKey } from "@/services/note-index/service";
import {
  fetchBibliography,
  LOCAL_API_PREF,
} from "@/services/pandoc/bibliography";
import type { BibliographyItemRef } from "@/services/pandoc/bibliography";
import {
  documentPresentation,
  effectivePresentation,
  styleSourceOf,
  vaultPresentation,
} from "@/services/pandoc/document-presentation";
import type { CitationEngine } from "@/services/pandoc/engine";
import { describeError, exportCitedDocument } from "@/services/pandoc/export";
import type { ExportPorts } from "@/services/pandoc/export";
import { resolveInstalledStyle } from "@/services/pandoc/styles";
import type { CslStyleRequest } from "@/services/pandoc/styles";
import type { ProfileReader } from "@/services/profile/service";
import type { PluginSettings } from "@/services/settings/service";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";

import { openPandocExportModal } from "./modal";
import { showEngineMissing, showExportFailure } from "./notices";
import type { ExportProblem } from "./notices";

const logger = getLogger(["views", "pandoc-export"]);

export interface PandocExportDeps {
  citationParse: Pick<CitationParse["Service"], "parse">;
  app: App;
  fileSystem: FileSystem.FileSystem;
  db: Pick<PlainZoteroReads, "reads">;
  /** Resolves the literal citation keys of the exported document. */
  citationLookup: Pick<PlainCitationLookup, "read">;
  pandocEngine: Pick<
    ManagedBinaryHandle<CitationEngine>,
    "binary" | "runSync" | "runPromise"
  >;
  zoteroPref: Pick<PlainZoteroPref, "dataDir" | "httpPort" | "get">;
  /** The `ZoteroHttp` loopback client the bibliography is fetched over. */
  zoteroHttp: ZoteroHttp["Service"];
  settings: Pick<PluginSettings["Service"], "current">;
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">;
  profile: ProfileReader;
  /** Opens the settings page the engine install lives on. */
  openSettings: () => void;
}

export function registerPandocExport(
  plugin: Pick<Plugin, "addCommand" | "app">,
  deps: PandocExportDeps,
): void {
  plugin.addCommand({
    id: "pandoc-export",
    name: m.command_pandoc_export_name(),
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file?.extension !== "md") return false;
      if (checking) return true;
      void runPandocExport(file, deps);
      return true;
    },
  });
}

/**
 * One export, from the dialog to the written file, with its outcome shown as
 * a notice. The engine is the one prerequisite the command cannot supply
 * itself, so its absence is answered with the settings page that installs it.
 */
export async function runPandocExport(
  file: TFile,
  deps: PandocExportDeps,
): Promise<void> {
  const outcome = await exportWithCitations(file, deps);
  switch (outcome.kind) {
    case "engine-missing":
      showEngineMissing(deps.openSettings);
      return;
    case "failed":
      showExportFailure(outcome.problem);
      return;
    case "exported":
      new BaseNotice(
        m.notice_pandoc_export_done({
          file: basename(outcome.destination),
          style: outcome.styleTitle,
        }),
      );
      return;
    case "stopped":
      return;
  }
}

/** How one export ended. */
export type PandocExportOutcome =
  | { kind: "engine-missing" }
  | { kind: "failed"; problem: ExportProblem }
  /** The user dismissed the dialog, or the plugin unloaded during the run. */
  | { kind: "stopped" }
  | { kind: "exported"; destination: string; styleTitle: string };

/** One export, from the dialog to the written file. */
export async function exportWithCitations(
  file: TFile,
  deps: PandocExportDeps,
): Promise<PandocExportOutcome> {
  const { app, bridge, fileSystem, pandocEngine, zoteroPref, settings } = deps;
  if (pandocEngine.runSync(pandocEngine.binary.getStatus).kind !== "installed")
    return { kind: "engine-missing" };
  // A note whose own presentation property names nothing stops here: a vault
  // selection never stands in for it, in the dialog or in the exported run.
  const declared = documentPresentation(app.metadataCache, file, deps.profile);
  if (declared.kind === "unusable") {
    return {
      kind: "failed",
      problem:
        declared.property === "profile"
          ? {
              kind: "document-profile-invalid",
              stamp: declared.diagnostic.stamp,
              target: declared.target,
              recover: () => requestProfileSwitch(app, declared.target),
            }
          : {
              kind:
                declared.property === "language"
                  ? "document-language-invalid"
                  : "document-style-invalid",
            },
    };
  }
  // Where this export starts: the document's own effective Citation
  // Presentation, read through the boundary every in-app surface reads it
  // through, so the run opens on what Obsidian shows. The dialog holds the
  // style for this run alone — nothing here is written back to the note — so a
  // style the note names and Zotero cannot supply still opens the picker on
  // that style, named as the missing one it is. The Citation Locale travels to
  // citeproc through the effective CSL input; a Document Language reaches the
  // writer through the note's own `lang` metadata as well, which is what makes
  // it the exported document's language.
  const effective = effectivePresentation(
    declared.presentation,
    vaultPresentation(bridge.runSync(settings.current)),
  );
  // A literal citation key resolves through the snapshot, so this export waits
  // for its first rebuild the way every in-app surface does.

  const choices = await openPandocExportModal(app, {
    dataDir: zoteroPref.dataDir,
    fileSystem,
    bridge,
    referencesStyleId: effective.styleId,
    styleSource: styleSourceOf(declared),
    notePath: absolutePath(app, file),
  });
  if (!choices) return { kind: "stopped" };

  // A style Zotero cannot supply stops the run, whichever place selected it:
  // the run never falls back to another style.
  const style = await exportPresentation(deps, zoteroPref.dataDir, {
    styleId: choices.styleId,
    locale: effective.locale,
  });
  if (style === "released") return { kind: "stopped" };
  if (style === null) {
    const noteStyle = choices.styleId === declared.presentation.styleId;
    return {
      kind: "failed",
      problem:
        noteStyle &&
        declared.profileStyle &&
        typeof choices.styleId === "string"
          ? { kind: "profile-style-invalid", styleId: choices.styleId }
          : noteStyle
            ? { kind: "document-style-invalid" }
            : { kind: "style-invalid", style: choices.styleId ?? "" },
    };
  }

  const { title: styleTitle, ...engineStyle } = style;
  using notice = new LazyNotice();
  notice.setMessage(m.notice_pandoc_export_running());

  let output: Uint8Array;
  try {
    const engine = await pandocEngine.runPromise(pandocEngine.binary.getEngine);
    if (!engine) return { kind: "stopped" };
    const result = valueOr(
      await bridge.runPromiseExit(
        exportCitedDocument(
          {
            document: {
              sourcePath: file.path,
              links: app.metadataCache.getFileCache(file)?.links ?? [],
            },
            markdown: await app.vault.cachedRead(file),
            format: choices.format,
            ...engineStyle,
          },
          exportPorts(deps, engine),
        ).pipe(Effect.provideService(CitationParse, deps.citationParse)),
      ),
      null,
    );
    // The plugin unloaded during the export.
    if (!result) return { kind: "stopped" };
    if ("error" in result) return { kind: "failed", problem: result.error };
    output = result.output;
  } catch (error) {
    if (AbortError.test(error)) return { kind: "stopped" };
    logger.error("The Pandoc export failed", { error });
    return {
      kind: "failed",
      problem: { kind: "engine", detail: describeError(error) },
    };
  }

  // The bytes exist by now, so a refusal here is the destination's, not Pandoc's.
  try {
    await writeFile(choices.destination, output);
  } catch (error) {
    logger.error("The exported document could not be written", {
      error,
      destination: choices.destination,
    });
    return {
      kind: "failed",
      problem: { kind: "destination-unwritable", detail: describeError(error) },
    };
  }
  return {
    kind: "exported",
    destination: choices.destination,
    styleTitle,
  };
}

/**
 * What the engine formats the exported run with, read through the resolver the
 * app renders with, so an export formats a dependent style exactly as Obsidian
 * does, in the same effective Citation Locale. An installed style hands over its
 * content with that locale already applied; the embedded default style takes
 * the locale beside it.
 *
 * @returns what the engine formats with and the style's title, or `null` where
 *   the requested style is unusable — the document stops rather than exporting
 *   in another style.
 */
async function exportPresentation(
  deps: PandocExportDeps,
  dataDir: string,
  request: CslStyleRequest,
): Promise<
  { styleXml?: string; locale?: string; title: string } | null | "released"
> {
  const style = valueOr(
    await deps.bridge.runPromiseExit(
      resolveInstalledStyle(dataDir, request).pipe(
        Effect.provideService(FileSystem.FileSystem, deps.fileSystem),
      ),
    ),
    null,
  );
  if (style === null) return "released";
  if (style.kind === "installed")
    return { styleXml: style.xml, title: style.title };
  if (style.kind === "failed") {
    logger.warn("Stopping the export: the requested style is unusable", {
      styleId: style.styleId,
      parentId: style.parentId,
      reason: style.reason,
    });
    return null;
  }
  return { locale: style.locale, title: citationStyleLabel() };
}

function exportPorts(
  deps: PandocExportDeps,
  engine: CitationEngine,
): ExportPorts {
  const { app, citationLookup, db, zoteroPref } = deps;
  return {
    engine,
    dataDir: () => zoteroPref.dataDir,
    resolveIndexedKey: (linkpath, sourcePath) =>
      resolveIndexedKey(linkpath, sourcePath, app),
    readLookup: (request) => citationLookup.read(request),
    readItemRefs: (indexedKeys) => readItemRefs(db, indexedKeys),
    fetchBibliography: (refs) =>
      deps.bridge
        .runPromiseExit(
          fetchBibliography(refs, {
            httpPort: zoteroPref.httpPort,
            localApiEnabled: zoteroPref.get(LOCAL_API_PREF) === true,
          }).pipe(Effect.provideService(ZoteroHttp, deps.zoteroHttp)),
        )
        .then((exit) => {
          const result = valueOr(exit, null);
          if (result === null)
            throw new AbortError(
              "The plugin unloaded during the bibliography read.",
            );
          return result;
        }),
  };
}

/** One database read per export, however many Literature Notes it cites. */
async function readItemRefs(
  db: PandocExportDeps["db"],
  indexedKeys: readonly string[],
): Promise<ReadonlyMap<string, BibliographyItemRef> | null> {
  try {
    const { reads } = db;
    const libraries = await Effect.runPromise(reads.Libraries({}));
    const refs = new Map<string, BibliographyItemRef>();
    for (const indexedKey of new Set(indexedKeys)) {
      const ref = placeItem(libraries, indexedKey);
      if (ref) refs.set(indexedKey, ref);
    }
    return refs;
  } catch (error) {
    logger.warn("Cannot read the Zotero database", { error });
    return null;
  }
}

/** Both identities the two bibliography sources address one Item by. */
function placeItem(
  libraries: readonly Library[],
  indexedKey: string,
): BibliographyItemRef | null {
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return null;
  const { key: itemKey, groupID } = parsed;
  const libraryID =
    groupID == null
      ? USER_LIBRARY_ID
      : libraries.find((library) => library.groupID === groupID)?.libraryID;
  if (libraryID === undefined) return null;
  return { itemKey, libraryID, groupID };
}

/** Desktop-only plugin: the adapter is always a `FileSystemAdapter`. */
function absolutePath(app: App, file: TFile): string {
  return join(
    (app.vault.adapter as FileSystemAdapter).getBasePath(),
    file.path,
  );
}
