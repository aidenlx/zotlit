import { writeFile } from "node:fs/promises";
// Registers the built-in export command and drives one export end to end:
// modal → resolution → bibliography → engine → chosen destination.
import { basename, join } from "node:path";
import type { App, FileSystemAdapter, Plugin, TFile } from "obsidian";

import { parseIndexedKey, resolveIndexedKeyLibrary } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { citationStyleLabel } from "@/lib/citation-style";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { nodeFetch } from "@/lib/node-fetch";
import { BaseNotice, LazyNotice } from "@/lib/notice";
import { requestProfileSwitch } from "@/lib/profile-recovery";
import type { CitationIndex } from "@/services/citation-index/service";
import type { DatabaseService } from "@/services/database/service";
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
import { describeError, exportCitedDocument } from "@/services/pandoc/export";
import type { ExportPorts } from "@/services/pandoc/export";
import type { PandocEngineService } from "@/services/pandoc/service";
import { resolveInstalledStyle } from "@/services/pandoc/styles";
import type { CslStyleRequest } from "@/services/pandoc/styles";
import type { ProfileReader } from "@/services/profile/service";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { openPandocExportModal } from "./modal";
import { showEngineMissing, showExportFailure } from "./notices";

const logger = getLogger(["views", "pandoc-export"]);

export interface PandocExportDeps {
  app: App;
  db: Pick<DatabaseService, "acquireRead">;
  /** Resolves the literal citation keys of the exported document. */
  citationIndex: Pick<CitationIndex, "resolveCitekey" | "whenResolved">;
  pandocEngine: Pick<PandocEngineService, "getStatus" | "getEngine">;
  zoteroPref: Pick<ZoteroPrefService, "ready" | "dataDir" | "httpPort" | "get">;
  settings: Pick<SettingsService, "current">;
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
 * One export, from the dialog to the written file. The engine is the one
 * prerequisite the command cannot supply itself, so its absence is answered
 * with the settings page that installs it.
 */
export async function runPandocExport(
  file: TFile,
  deps: PandocExportDeps,
): Promise<void> {
  await deps.profile.ready;
  const { app, citationIndex, pandocEngine, zoteroPref, settings } = deps;
  if (pandocEngine.getStatus().kind !== "installed") {
    showEngineMissing(deps.openSettings);
    return;
  }
  // A note whose own presentation property names nothing stops here: a vault
  // selection never stands in for it, in the dialog or in the exported run.
  const declared = documentPresentation(app.metadataCache, file, deps.profile);
  if (declared.kind === "unusable") {
    showExportFailure(
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
    );
    return;
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
    vaultPresentation(settings.current),
  );
  await zoteroPref.ready;
  // A literal citation key resolves through the snapshot, so this export waits
  // for its first rebuild the way every in-app surface does.
  await citationIndex.whenResolved();

  const choices = await openPandocExportModal(app, {
    dataDir: zoteroPref.dataDir,
    referencesStyleId: effective.styleId,
    styleSource: styleSourceOf(declared),
    notePath: absolutePath(app, file),
  });
  if (!choices) return;

  // A style Zotero cannot supply stops the run, whichever place selected it:
  // the run never falls back to another style.
  const style = await exportPresentation(zoteroPref.dataDir, {
    styleId: choices.styleId,
    locale: effective.locale,
  });
  if (style === null) {
    const noteStyle = choices.styleId === declared.presentation.styleId;
    showExportFailure(
      noteStyle && declared.profileStyle && typeof choices.styleId === "string"
        ? { kind: "profile-style-invalid", styleId: choices.styleId }
        : noteStyle
          ? { kind: "document-style-invalid" }
          : { kind: "style-invalid", style: choices.styleId ?? "" },
    );
    return;
  }

  const { title: styleTitle, ...engineStyle } = style;
  using notice = new LazyNotice();
  notice.setMessage(m.notice_pandoc_export_running());

  let output: Uint8Array;
  try {
    const result = await exportCitedDocument(
      {
        document: {
          sourcePath: file.path,
          links: app.metadataCache.getFileCache(file)?.links ?? [],
        },
        markdown: await app.vault.cachedRead(file),
        format: choices.format,
        ...engineStyle,
      },
      exportPorts(deps, await pandocEngine.getEngine()),
    );
    if ("error" in result) {
      showExportFailure(result.error);
      return;
    }
    output = result.output;
  } catch (error) {
    logger.error("The Pandoc export failed", { error });
    showExportFailure({ kind: "engine", detail: describeError(error) });
    return;
  }

  // The bytes exist by now, so a refusal here is the destination's, not Pandoc's.
  try {
    await writeFile(choices.destination, output);
  } catch (error) {
    logger.error("The exported document could not be written", {
      error,
      destination: choices.destination,
    });
    showExportFailure({
      kind: "destination-unwritable",
      detail: describeError(error),
    });
    return;
  }
  new BaseNotice(
    m.notice_pandoc_export_done({
      file: basename(choices.destination),
      style: styleTitle,
    }),
  );
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
  dataDir: string,
  request: CslStyleRequest,
): Promise<{ styleXml?: string; locale?: string; title: string } | null> {
  const style = await resolveInstalledStyle(dataDir, request);
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
  engine: Awaited<ReturnType<PandocEngineService["getEngine"]>>,
): ExportPorts {
  const { app, citationIndex, db, zoteroPref } = deps;
  return {
    engine,
    dataDir: () => zoteroPref.dataDir,
    resolveIndexedKey: (linkpath, sourcePath) =>
      resolveIndexedKey(linkpath, sourcePath, app),
    resolveCitekey: (citekey) => citationIndex.resolveCitekey(citekey),
    readItemRefs: (indexedKeys) => readItemRefs(db, indexedKeys),
    fetchBibliography: (refs) =>
      fetchBibliography(refs, {
        fetch: nodeFetch,
        httpPort: zoteroPref.httpPort,
        localApiEnabled: zoteroPref.get(LOCAL_API_PREF) === true,
      }),
  };
}

/** One read lease per export, however many Literature Notes it cites. */
async function readItemRefs(
  db: PandocExportDeps["db"],
  indexedKeys: readonly string[],
): Promise<ReadonlyMap<string, BibliographyItemRef> | null> {
  try {
    using lease = await db.acquireRead();
    const refs = new Map<string, BibliographyItemRef>();
    for (const indexedKey of new Set(indexedKeys)) {
      const ref = placeItem(lease.client, indexedKey);
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
  client: NodeDatabaseClient,
  indexedKey: string,
): BibliographyItemRef | null {
  const parsed = parseIndexedKey(indexedKey);
  const selector = resolveIndexedKeyLibrary(client, indexedKey);
  if (!parsed || !selector) return null;
  return {
    itemKey: selector.key,
    libraryID: selector.libraryID,
    groupID: parsed.groupID,
  };
}

/** Desktop-only plugin: the adapter is always a `FileSystemAdapter`. */
function absolutePath(app: App, file: TFile): string {
  return join(
    (app.vault.adapter as FileSystemAdapter).getBasePath(),
    file.path,
  );
}
