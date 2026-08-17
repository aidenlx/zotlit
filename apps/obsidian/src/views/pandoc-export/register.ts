// Registers the built-in export command and drives one export end to end:
// modal → resolution → bibliography → engine → chosen destination.

import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { requestUrl } from "obsidian";
import type { App, FileSystemAdapter, Plugin, TFile } from "obsidian";

import { parseIndexedKey, resolveIndexedKeyLibrary } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice, LazyNotice } from "@/lib/notice";
import type { DatabaseService } from "@/services/database/service";
import { resolveIndexedKey } from "@/services/note-index/service";
import {
  fetchBibliography,
  LOCAL_API_PREF,
} from "@/services/pandoc/bibliography";
import type {
  BibliographyItemRef,
  BibliographyTransport,
} from "@/services/pandoc/bibliography";
import { describeError, exportCitedDocument } from "@/services/pandoc/export";
import type { ExportPorts } from "@/services/pandoc/export";
import type { PandocEngineService } from "@/services/pandoc/service";
import { resolveInstalledStyle } from "@/services/pandoc/styles";
import type { CslStyleRequest } from "@/services/pandoc/styles";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { openPandocExportModal } from "./modal";
import { showEngineMissing, showExportFailure } from "./notices";

const logger = getLogger(["views", "pandoc-export"]);

export interface PandocExportDeps {
  app: App;
  db: Pick<DatabaseService, "acquireRead">;
  pandocEngine: Pick<PandocEngineService, "getStatus" | "getEngine">;
  zoteroPref: Pick<ZoteroPrefService, "ready" | "dataDir" | "get">;
  settings: Pick<SettingsService, "current">;
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
  const { app, pandocEngine, zoteroPref, settings } = deps;
  if (pandocEngine.getStatus().kind !== "installed") {
    showEngineMissing(deps.openSettings);
    return;
  }
  await zoteroPref.ready;

  const choices = await openPandocExportModal(app, {
    dataDir: zoteroPref.dataDir,
    referencesStyleId: settings.current?.["citation.references-style"] ?? null,
    notePath: absolutePath(app, file),
  });
  if (!choices) return;

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
        ...(await exportPresentation(zoteroPref.dataDir, {
          styleId: choices.styleId,
        })),
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
    m.notice_pandoc_export_done({ file: basename(choices.destination) }),
  );
}

/**
 * What the engine formats the exported run with, read through the resolver the
 * app renders with, so an export formats a dependent style exactly as Obsidian
 * does. An installed style hands over its content with the Citation Locale
 * already applied; the embedded default style takes that locale beside it.
 *
 * A selection Zotero cannot supply falls back to the embedded default style,
 * still in the Citation Locale the request named.
 */
async function exportPresentation(
  dataDir: string,
  request: CslStyleRequest,
): Promise<{ styleXml?: string; locale?: string }> {
  const style = await resolveInstalledStyle(dataDir, request);
  if (style.kind === "installed") return { styleXml: style.xml };
  if (style.kind === "failed") {
    logger.warn(
      "Exporting with the embedded style: the chosen one is unusable",
      {
        styleId: style.styleId,
        parentId: style.parentId,
        reason: style.reason,
      },
    );
    return { locale: request.locale ?? undefined };
  }
  return { locale: style.locale };
}

function exportPorts(
  deps: PandocExportDeps,
  engine: Awaited<ReturnType<PandocEngineService["getEngine"]>>,
): ExportPorts {
  const { app, db, zoteroPref } = deps;
  return {
    engine,
    dataDir: () => zoteroPref.dataDir,
    resolveIndexedKey: (linkpath, sourcePath) =>
      resolveIndexedKey(linkpath, sourcePath, app),
    readItemRefs: (indexedKeys) => readItemRefs(db, indexedKeys),
    fetchBibliography: (refs) =>
      fetchBibliography(refs, {
        request: zoteroRequest,
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

/**
 * Zotero's HTTP server over Obsidian's own transport, which reaches localhost
 * without CORS. A refusal comes back as a status; only a dead port rejects.
 */
const zoteroRequest: BibliographyTransport = async (request) => {
  const response = await requestUrl({ ...request, throw: false });
  return { status: response.status, text: response.text };
};

/** Desktop-only plugin: the adapter is always a `FileSystemAdapter`. */
function absolutePath(app: App, file: TFile): string {
  return join(
    (app.vault.adapter as FileSystemAdapter).getBasePath(),
    file.path,
  );
}
