import { Cause, Effect, FileSystem, Schema } from "effect";
import { writeFile } from "node:fs/promises";
// Registers the built-in export command and drives one export end to end:
// modal → resolution → bibliography → engine → chosen destination.
import { basename, join } from "node:path";
import type { App, FileSystemAdapter, Plugin, TFile } from "obsidian";

import { parseIndexedKey, USER_LIBRARY_ID } from "@zotlit/db";
import type { Library } from "@zotlit/db";

import { citationStyleLabel } from "@/lib/citation-style";
import type { EffectBridge } from "@/lib/effect-bridge";
import { awaitModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier, withProgress } from "@/lib/notifier";
import { requestProfileSwitch } from "@/lib/profile-recovery";
import { ZoteroHttp } from "@/lib/zotero-http";
import type { CitationLookup } from "@/services/citation-index/lookup-service";
import { CitationParse } from "@/services/citation-parse/service";
import type { ManagedBinaryApi } from "@/services/managed-binary/service";
import { resolveIndexedKey } from "@/services/note-index/service";
import {
  fetchBibliography,
  LOCAL_API_PREF,
} from "@/services/pandoc/bibliography";
import type { BibliographyItemRef } from "@/services/pandoc/bibliography";
import {
  documentPresentation,
  profileReaderOf,
  effectivePresentation,
  styleSourceOf,
  vaultPresentation,
} from "@/services/pandoc/document-presentation";
import type { CitationEngine } from "@/services/pandoc/engine";
import { describeError, exportCitedDocument } from "@/services/pandoc/export";
import type { ExportPorts } from "@/services/pandoc/export";
import { resolveInstalledStyle } from "@/services/pandoc/styles";
import type { CslStyleRequest } from "@/services/pandoc/styles";
import type { Profile } from "@/services/profile/service";
import type { PluginSettings } from "@/services/settings/service";
import type { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroReads } from "@/services/zotero-reads/service";

import type { PandocExportChoices } from "./modal";
import { openPandocExportModal } from "./modal";
import { engineMissingMessage, exportFailureMessage } from "./notices";
import type { ExportProblem } from "./notices";

export interface PandocExportDeps {
  citationParse: Pick<CitationParse["Service"], "parse">;
  app: App;
  fileSystem: FileSystem.FileSystem;
  db: Pick<ZoteroReads["Service"], "reads">;
  /** Resolves the literal citation keys of the exported document. */
  citationLookup: Pick<CitationLookup["Service"], "read">;
  pandocEngine: Pick<
    ManagedBinaryApi<CitationEngine>,
    "getStatus" | "getEngine"
  >;
  zoteroPref: Pick<ZoteroPref["Service"], "current" | "get">;
  /** The `ZoteroHttp` loopback client the bibliography is fetched over. */
  zoteroHttp: ZoteroHttp["Service"];
  settings: Pick<PluginSettings["Service"], "current">;
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">;
  profile: Pick<Profile["Service"], "loaded" | "profileOf">;
  notifier: Notifier["Service"];
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
class PandocExportError extends Schema.TaggedError<
  PandocExportError,
  { readonly brand: unique symbol }
>()("PandocExportError", {
  notice: Schema.declare<DocumentFragment>(
    (value): value is DocumentFragment => value instanceof DocumentFragment,
  ),
}) {}

export function runPandocExport(
  file: TFile,
  deps: PandocExportDeps,
): Promise<unknown> {
  return deps.bridge.runPromiseExit(
    prepareExport(file, deps).pipe(
      Effect.flatMap(({ run }) =>
        withProgress(
          run.pipe(
            Effect.flatMap((outcome) => {
              if (outcome.kind === "stopped") return Effect.interrupt;
              if (
                outcome.kind === "engine-missing" ||
                outcome.kind === "failed"
              )
                return Effect.fail(
                  new PandocExportError({
                    notice:
                      outcome.kind === "engine-missing"
                        ? engineMissingMessage(deps.openSettings)
                        : exportFailureMessage(outcome.problem),
                  }),
                );
              return Effect.succeed(outcome);
            }),
          ),
          {
            loading: m.notice_pandoc_export_running(),
            success: (outcome) =>
              m.notice_pandoc_export_done({
                file: basename(outcome.destination),
                style: outcome.styleTitle,
              }),
            error: (error) => {
              if (!(error instanceof PandocExportError))
                return exportFailureMessage({
                  kind: "engine",
                  detail: describeError(error),
                });
              return error.notice;
            },
          },
        ),
      ),
      Effect.provideService(Notifier, deps.notifier),
    ),
  );
}

/** How one export ended. */
export type PandocExportOutcome =
  | { kind: "engine-missing" }
  | { kind: "failed"; problem: ExportProblem }
  /** The user dismissed the dialog, or the plugin unloaded during the run. */
  | { kind: "stopped" }
  | { kind: "exported"; destination: string; styleTitle: string };

/** One export, from the dialog to the written file. */
export const exportWithCitations = Effect.fn("exportWithCitations")(
  (file: TFile, deps: PandocExportDeps) =>
    prepareExport(file, deps).pipe(Effect.flatMap(({ run }) => run)),
);

const prepareExport = Effect.fn("prepareExport")(function* (
  file: TFile,
  deps: PandocExportDeps,
): Effect.fn.Return<{ run: Effect.Effect<PandocExportOutcome> }> {
  const { app, bridge, fileSystem, pandocEngine, zoteroPref, settings } = deps;
  const pref = yield* zoteroPref.current;
  if ((yield* pandocEngine.getStatus).kind !== "installed")
    return { run: Effect.succeed({ kind: "engine-missing" }) };
  // A note whose own presentation property names nothing stops here: a vault
  // selection never stands in for it, in the dialog or in the exported run.
  const declared = documentPresentation(
    app.metadataCache,
    file,
    profileReaderOf(
      deps.profile,
      Effect.runSyncWith(yield* Effect.context<never>()),
    ),
  );
  if (declared.kind === "unusable") {
    return {
      run: Effect.succeed({
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
      }),
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
    vaultPresentation(yield* settings.current),
  );
  // A literal citation key resolves through the snapshot, so this export waits
  // for its first rebuild the way every in-app surface does.

  const choices = yield* awaitModal<PandocExportChoices | null>((resolve) =>
    openPandocExportModal(
      app,
      {
        dataDir: pref.dataDir,
        fileSystem,
        bridge,
        referencesStyleId: effective.styleId,
        styleSource: styleSourceOf(declared),
        notePath: absolutePath(app, file),
      },
      resolve,
    ),
  );
  if (!choices) return { run: Effect.succeed({ kind: "stopped" }) };

  // A style Zotero cannot supply stops the run, whichever place selected it:
  // the run never falls back to another style.
  const style = yield* exportPresentation(deps, pref.dataDir, {
    styleId: choices.styleId,
    locale: effective.locale,
  });
  if (style === null) {
    const noteStyle = choices.styleId === declared.presentation.styleId;
    return {
      run: Effect.succeed({
        kind: "failed",
        problem:
          noteStyle &&
          declared.profileStyle &&
          typeof choices.styleId === "string"
            ? { kind: "profile-style-invalid", styleId: choices.styleId }
            : noteStyle
              ? { kind: "document-style-invalid" }
              : { kind: "style-invalid", style: choices.styleId ?? "" },
      }),
    };
  }

  const { title: styleTitle, ...engineStyle } = style;
  return {
    run: Effect.gen(function* (): Effect.fn.Return<PandocExportOutcome> {
      const conversion = yield* Effect.gen(function* () {
        const engine = yield* pandocEngine.getEngine;
        if (!engine) return yield* Effect.interrupt;
        const markdown = yield* Effect.promise(() =>
          app.vault.cachedRead(file),
        );
        const localApiEnabled =
          (yield* zoteroPref.get(LOCAL_API_PREF)) === true;
        return yield* exportCitedDocument(
          {
            document: {
              sourcePath: file.path,
              links: app.metadataCache.getFileCache(file)?.links ?? [],
            },
            markdown,
            format: choices.format,
            ...engineStyle,
          },
          exportPorts(deps, engine, { ...pref, localApiEnabled }),
        ).pipe(Effect.provideService(CitationParse, deps.citationParse));
      }).pipe(
        // This outcome keeps the engine's actual detail; its fallback depends
        // on the cause rather than the fixed fallback that recover accepts.
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
          return Effect.logError("The Pandoc export failed", cause).pipe(
            Effect.as({
              error: {
                kind: "engine" as const,
                detail: describeError(Cause.squash(cause)),
              },
            }),
          );
        }),
      );
      if ("error" in conversion)
        return { kind: "failed", problem: conversion.error };
      const written = yield* Effect.tryPromise({
        try: () => writeFile(choices.destination, conversion.output),
        catch: (error) => ({
          kind: "destination-unwritable" as const,
          detail: describeError(error),
        }),
      }).pipe(Effect.uninterruptible, Effect.result);
      if (written._tag === "Failure")
        return { kind: "failed", problem: written.failure };

      return {
        kind: "exported",
        destination: choices.destination,
        styleTitle,
      };
    }),
  };
});

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
const exportPresentation = Effect.fn("exportPresentation")(function* (
  deps: PandocExportDeps,
  dataDir: string,
  request: CslStyleRequest,
) {
  const style = yield* resolveInstalledStyle(dataDir, request).pipe(
    Effect.provideService(FileSystem.FileSystem, deps.fileSystem),
  );
  if (style.kind === "installed")
    return { styleXml: style.xml, title: style.title };
  if (style.kind === "failed") return null;
  return { locale: style.locale, title: citationStyleLabel() };
});

function exportPorts(
  deps: PandocExportDeps,
  engine: CitationEngine,
  pref: { dataDir: string; httpPort: number | null; localApiEnabled: boolean },
): ExportPorts {
  const { app, citationLookup, db } = deps;
  return {
    engine,
    dataDir: () => pref.dataDir,
    resolveIndexedKey: (linkpath, sourcePath) =>
      resolveIndexedKey(linkpath, sourcePath, app),
    readLookup: (request) => citationLookup.read(request),
    readItemRefs: (indexedKeys) => readItemRefs(db, indexedKeys),
    fetchBibliography: (refs) =>
      fetchBibliography(refs, {
        httpPort: pref.httpPort,
        localApiEnabled: pref.localApiEnabled,
      }).pipe(Effect.provideService(ZoteroHttp, deps.zoteroHttp)),
  };
}

const readItemRefs = Effect.fn("export.readItemRefs")(
  function* (db: PandocExportDeps["db"], indexedKeys: readonly string[]) {
    const libraries = yield* db.reads.Libraries({});
    const refs = new Map<string, BibliographyItemRef>();
    for (const indexedKey of new Set(indexedKeys)) {
      const ref = placeItem(libraries, indexedKey);
      if (ref) refs.set(indexedKey, ref);
    }
    return refs;
  },
  Effect.orElseSucceed(() => null),
);

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
