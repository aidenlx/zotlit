// Resolves an Indexed Key and builds side-effect-free Template data.

import { Data, Effect, Stream } from "effect";
import { dirname } from "node:path/posix";

import {
  buildAnnotationsTemplateData,
  buildFilenameContext,
  buildNoteContextFromSource,
  citekeysToCiteTemplateData,
  withAnnotationCitation,
} from "@zotlit/db";
import type {
  AnnotationSources,
  CitationTemplateData,
  CitationVariant,
  ContractRoot,
  Item,
  NoteResolvers,
  NoteSource,
} from "@zotlit/db";
import { TemplateError } from "@zotlit/templates/facade";
import { resolveExcerptImageContext } from "@zotlit/workbench/explorer";
import { citationExampleData } from "@zotlit/workbench/render";
import type { CitationExampleId } from "@zotlit/workbench/render";

import { annotationCitation } from "@/lib/annotation-render";
import { normalizeFolderPath } from "@/lib/ensure-folder";
import { creatorSummary } from "@/lib/item-summary";
import { FileManager } from "@/lib/obsidian-file-manager";
import { Vault } from "@/lib/obsidian-vault";
import { itemFacets } from "@/services/note-feature/context";
import { NoteIndex } from "@/services/note-index/service";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { CITATION_TEMPLATE_NAME } from "@/services/template/defaults";
import { InertTemplateError } from "@/services/template/errors";
import {
  buildObsidianInertNoteResolvers,
  findExistingLitNote,
} from "@/services/template/inert-resolver-host";
import type { Template } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import { syncTemplate } from "./sync-template";

/**
 * The object one Citation's data is built from: a built-in example set, or an
 * Indexed Key naming a live Item.
 */
export type CitationSelector =
  | { readonly key: string }
  | { readonly example: CitationExampleId };

export type TemplateDataLoadResult =
  | { kind: "data"; data: object }
  | { kind: "not-found" }
  | { kind: "no-parent-item" }
  | { kind: "annotation-required" }
  | { kind: "annotation-attachment-missing" };

/** {@link TemplateDataLoadResult} with the Citation Template data typed. */
export type CitationDataLoadResult =
  | { kind: "data"; data: CitationTemplateData }
  | Exclude<TemplateDataLoadResult, { kind: "data" }>;

/** The services Template data of a root reads. */
export type TemplateDataServices =
  | ZoteroReads
  | NoteIndex
  | PluginSettings
  | Template
  | ZoteroPref
  | Vault
  | FileManager;

/**
 * Template data for a caller outside Effect: an edge handle `build.ts` binds
 * over the bridge (`bindTemplateData`). A load resolves with its result and
 * rejects with what failed, as a read or a Template does.
 */
export interface TemplateDataLoader {
  /** `settings`, when given, are the ones the data reads in place of the plugin's. */
  load(
    indexedKey: string,
    root: ContractRoot,
    options?: { settings?: Readonly<Settings> },
  ): Promise<TemplateDataLoadResult>;
  loadCitation(
    selector: CitationSelector,
    variant: CitationVariant,
  ): Promise<CitationDataLoadResult>;
}

/** What a caller outside Effect passes to {@link loadTemplateData}. */
export interface TemplateDataDeps {
  readonly templateData: TemplateDataLoader;
  /** The settings the data reads in place of the plugin's: a Profile's. */
  readonly dataSettings?: Readonly<Settings>;
}

/**
 * Template data could not be built: a wait for a service, the read lease, a
 * database read, or the building itself failed with `cause`.
 */
export class TemplateDataError extends Data.TaggedError("TemplateDataError")<{
  readonly cause: unknown;
}> {}

const failed = (cause: unknown) => new TemplateDataError({ cause });

/** A database read. */
const query = <A, E>(read: Effect.Effect<A, E>) =>
  Effect.mapError(read, (cause) => failed(cause));

/** Building data that can throw, as a Template a getter runs. */
const build = <A>(evaluate: () => A) =>
  Effect.try({ try: evaluate, catch: failed });

/** Reads under one Snapshot, released when the caller's scope closes. */
const readLease = ZoteroReads.use((reads) =>
  Effect.mapError(reads.snapshot, (cause) => failed(cause)),
);

/**
 * Scope one item's Literature Note lookups to the note the caller selected, so
 * data built for an explicit note path reports that note rather than the first
 * indexed note of the same item.
 */
export const withSelectedNote = (selection: { key: string; path: string }) =>
  Effect.updateService(NoteIndex, (index) => ({
    ...index,
    getNotesByItemKey: (key: string) =>
      key === selection.key
        ? Effect.map(index.getNotesByItemKey(key), (notes) =>
            notes.filter((file) => file.path === selection.path),
          )
        : index.getNotesByItemKey(key),
  }));

/** Build data under `settings` in place of the saved settings. */
export const withSettings = (settings: Readonly<Settings>) =>
  Effect.updateService(PluginSettings, (service) => ({
    ...service,
    current: Effect.succeed(settings),
  }));

/** The Template data of one root for the object an Indexed Key names. */
export const readTemplateData = Effect.fn("TemplateData.read")(function* (
  indexedKey: string,
  root: ContractRoot,
): Effect.fn.Return<
  TemplateDataLoadResult,
  TemplateDataError,
  TemplateDataServices
> {
  if (root === "citation") {
    return yield* readCitationData({ key: indexedKey }, "main");
  }
  const [settings] = yield* Effect.all(
    [
      PluginSettings.use((service) => service.current),
      NoteIndex.use((index) => index.whenIndexed),
    ],
    { concurrency: "unbounded" },
  );
  if (root === "annotation") {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const reads = yield* readLease;
        const selected = yield* readAnnotationSources(reads, indexedKey);
        if (selected.kind !== "sources") return selected;
        const { sources, item } = selected;
        const resolvers = yield* createInertResolvers(settings, item);
        const data = yield* build(
          () =>
            buildAnnotationsTemplateData(sources, resolvers.annotation)
              .values()
              .next().value,
        );
        if (!data) return { kind: "not-found" } as const;
        const templates = yield* syncTemplate;
        return {
          kind: "data",
          data: withAnnotationCitation(data, () =>
            renderAnnotationCitation(
              data.parentItem,
              data.pageLabel,
              templates,
            ),
          ),
        } as const;
      }),
    );
  }

  const selected = yield* Effect.scoped(
    Effect.flatMap(readLease, (reads) => readNoteItemSource(reads, indexedKey)),
  );
  if (selected.kind !== "source") return selected;
  const { source } = selected;
  if (root === "filename") {
    const { itemTags, itemCollections } = itemFacets(source);
    return {
      kind: "data",
      data: yield* build(() =>
        buildFilenameContext({
          item: source.item,
          tags: itemTags,
          collections: itemCollections,
          authorsShort: creatorSummary,
        }),
      ),
    };
  }

  const resolvers = yield* createInertResolvers(settings, source.item);

  return {
    kind: "data",
    data: yield* build(() => buildNoteContextFromSource(source, resolvers)),
  };
});

/**
 * The Citation Template data one example set or one chosen Item produces:
 * `zt.citations` with `zt.items` beside it, under `variant`. A chosen Item
 * yields a one-item set with no locator, prefix, or suffix — what the
 * suggester inserts for a plain Enter. An example set reads nothing from the
 * database.
 */
export const readCitationData = Effect.fn("TemplateData.readCitation")(
  function* (
    selector: CitationSelector,
    variant: CitationVariant,
  ): Effect.fn.Return<CitationDataLoadResult, TemplateDataError, ZoteroReads> {
    if ("example" in selector) {
      return {
        kind: "data",
        data: yield* build(() =>
          citationExampleData(selector.example, variant),
        ),
      };
    }
    const selected = yield* Effect.scoped(
      Effect.flatMap(readLease, (reads) => readNoteItem(reads, selector.key)),
    );
    if (selected.kind !== "item") return selected;
    const { item } = selected;
    const citationKey =
      "citationKey" in item.fields ? (item.fields.citationKey ?? null) : null;
    return {
      kind: "data",
      data: yield* build(() =>
        citekeysToCiteTemplateData([{ citationKey, item }], variant),
      ),
    };
  },
);

/** {@link readTemplateData} for a caller outside Effect, through its handle. */
export function loadTemplateData(
  deps: TemplateDataDeps,
  indexedKey: string,
  root: ContractRoot,
): Promise<TemplateDataLoadResult> {
  return deps.templateData.load(indexedKey, root, {
    settings: deps.dataSettings,
  });
}

/** {@link readCitationData} for a caller outside Effect, through its handle. */
export function loadCitationData(
  deps: TemplateDataDeps,
  selector: CitationSelector,
  variant: CitationVariant,
): Promise<CitationDataLoadResult> {
  return deps.templateData.loadCitation(selector, variant);
}

/**
 * Render the annotation root's `citation` field, labeling its failure with the
 * Template that raised it: the getter runs the Citation Template, so a fault
 * that names no Template belongs to it.
 */
function renderAnnotationCitation(
  parentItem: Parameters<typeof annotationCitation>[0],
  pageLabel: string | null,
  templates: Parameters<typeof annotationCitation>[2],
): string | null {
  try {
    return annotationCitation(parentItem, pageLabel, templates);
  } catch (error) {
    if (error instanceof InertTemplateError) {
      if (error.templateName !== undefined) throw error;
      throw new InertTemplateError(error.message, CITATION_TEMPLATE_NAME, {
        cause: error,
      });
    }
    if (error instanceof TemplateError) throw error;
    throw new TemplateError(
      error instanceof Error ? error.message : String(error),
      CITATION_TEMPLATE_NAME,
      { cause: error },
    );
  }
}

/**
 * The folder the user's attachment setting picks for the note at
 * `sourcePath`: `folderPath`, or Obsidian's own attachment folder when the
 * setting is empty. `"/"` names the vault root.
 */
const attachmentFolder = (
  fileManager: FileManager["Service"],
  folderPath: string | null,
  sourcePath?: string,
) =>
  folderPath
    ? Effect.succeed(normalizeFolderPath(folderPath))
    : fileManager
        .getAvailablePathForAttachment("zotlit-attachment", sourcePath)
        .pipe(
          Effect.map((path) => normalizeFolderPath(dirname(path))),
          Effect.mapError(({ cause }) => cause),
        );

const createInertResolvers = Effect.fnUntraced(function* (
  settings: Readonly<Settings>,
  item: Item | null,
): Effect.fn.Return<
  NoteResolvers,
  TemplateDataError,
  NoteIndex | ZoteroPref | Vault | FileManager
> {
  const index = yield* NoteIndex;
  const vault = yield* Vault;
  const fileManager = yield* FileManager;
  const { dataDir, baseAttachmentPath } = yield* (yield* ZoteroPref).current;
  const context = yield* Effect.context<never>();
  const runSync = Effect.runSyncWith(context);
  const runPromise = Effect.runPromiseWith(context);
  // The resolvers run synchronously while a Template renders.
  const noteIndex = {
    getNotesByItemKey: (key: string) => runSync(index.getNotesByItemKey(key)),
    getImportedNoteByNoteKey: (key: string) =>
      runSync(index.getImportedNoteByNoteKey(key)),
  };
  const litNote = item
    ? yield* build(() =>
        findExistingLitNote(noteIndex, {
          indexedKey: item.indexedKey,
        }),
      )
    : null;
  const litNotePath = litNote?.path ?? null;
  const excerptImages = yield* Effect.tryPromise({
    try: () =>
      resolveExcerptImageContext({
        attachmentImport: settings["attachment.import"],
        attachmentFolderPath: settings["attachment.folder-path"],
        litNotePath,
        resolveAttachmentFolderPath: (folderPath, sourcePath) =>
          runPromise(attachmentFolder(fileManager, folderPath, sourcePath)),
      }),
    catch: failed,
  });
  return yield* build(() =>
    buildObsidianInertNoteResolvers({
      noteIndex,
      fileManager: {
        generateMarkdownLink: (...[file, sourcePath, subpath, alias]) =>
          runSync(
            fileManager.generateMarkdownLink(file, sourcePath, {
              ...(subpath === undefined ? {} : { subpath }),
              ...(alias === undefined ? {} : { alias }),
            }),
          ),
      },
      vault: { getFileByPath: (path) => runSync(vault.getFileByPath(path)) },
      zoteroPref: { dataDir, baseAttachmentPath },
      sourcePath: litNotePath ?? "",
      excerptImages,
    }),
  );
});

type AnnotationResult =
  | { kind: "sources"; sources: AnnotationSources; item: Item | null }
  | { kind: "not-found" }
  | { kind: "annotation-required" }
  | { kind: "annotation-attachment-missing" };

/**
 * The {@link AnnotationSources} of the Annotation an Indexed Key names, with
 * its parent Item, `null` for a standalone attachment.
 */
const readAnnotationSources = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  indexedKey: string,
): Effect.fn.Return<AnnotationResult, TemplateDataError> {
  const selected = yield* query(reads.ItemType({ indexedKey }));
  if (!selected) return { kind: "not-found" };
  if (selected.itemType !== "annotation")
    return { kind: "annotation-required" };
  const sources = yield* query(
    reads.AnnotationSources({
      libraryID: selected.libraryID,
      keys: [selected.key],
    }),
  );
  const [attachment] = sources.attachments;
  if (!attachment) return { kind: "annotation-attachment-missing" };
  const item =
    sources.parentItems.find(
      ({ itemID }) => itemID === attachment.parentItemID,
    ) ?? null;
  return { kind: "sources", sources, item };
});

type NoteItemResult =
  | { kind: "item"; item: Item }
  | { kind: "not-found" }
  | { kind: "no-parent-item" }
  | { kind: "annotation-attachment-missing" };

/** Where {@link resolveNoteItemID} found the Item, and what its absence means. */
type NoteItemTarget =
  | {
      kind: "target";
      itemID: number;
      /** The Item itself, when the Indexed Key named it directly. */
      item?: Item;
      /** The outcome when no live Item has the id. */
      missing: "not-found" | "no-parent-item";
    }
  | Exclude<NoteItemResult, { kind: "item" }>;

/**
 * The id of the Item an Indexed Key names, or of the parent Item of the
 * attachment, note, or annotation it names. Pass Snapshot-bound reads, so
 * every step reads one database state.
 */
const resolveNoteItemID = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  indexedKey: string,
): Effect.fn.Return<NoteItemTarget, TemplateDataError> {
  const selected = yield* query(reads.ItemType({ indexedKey }));
  if (!selected) return { kind: "not-found" };
  const { libraryID, key, itemType } = selected;
  let parentItemID: number | null;
  if (itemType === "annotation") {
    const sources = yield* query(
      reads.AnnotationSources({ libraryID, keys: [key], username: null }),
    );
    const attachment = sources.attachments[0];
    if (!attachment) return { kind: "annotation-attachment-missing" };
    parentItemID = attachment.parentItemID;
  } else if (itemType === "attachment") {
    const [attachment] = yield* query(
      reads.AttachmentsByKeys({ libraryID, keys: [key] }),
    );
    if (!attachment) return { kind: "not-found" };
    parentItemID = attachment.parentItemID;
  } else if (itemType === "note") {
    const [note] = yield* query(reads.NoteBodies({ libraryID, keys: [key] }));
    if (!note) return { kind: "not-found" };
    parentItemID = note.parentItemID;
  } else {
    const items = yield* query(
      reads.ItemsByIndexedKeys({ indexedKeys: [indexedKey] }),
    );
    const item = items.values().next().value;
    return item
      ? { kind: "target", itemID: item.itemID, item, missing: "not-found" }
      : { kind: "not-found" };
  }
  if (!parentItemID) return { kind: "no-parent-item" };
  return { kind: "target", itemID: parentItemID, missing: "no-parent-item" };
});

/**
 * {@link resolveNoteItemID}'s Item, read as a {@link NoteSource}. Pass
 * Snapshot-bound reads.
 */
const readNoteItemSource = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  indexedKey: string,
): Effect.fn.Return<
  | { kind: "source"; source: NoteSource }
  | Exclude<NoteItemResult, { kind: "item" }>,
  TemplateDataError
> {
  const target = yield* resolveNoteItemID(reads, indexedKey);
  if (target.kind !== "target") return target;
  const source = yield* query(reads.NoteSource({ itemID: target.itemID }));
  return source ? { kind: "source", source } : { kind: target.missing };
});

/** {@link resolveNoteItemID}'s Item alone. Pass Snapshot-bound reads. */
const readNoteItem = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  indexedKey: string,
): Effect.fn.Return<NoteItemResult, TemplateDataError> {
  const target = yield* resolveNoteItemID(reads, indexedKey);
  if (target.kind !== "target") return target;
  if (target.item) return { kind: "item", item: target.item };
  // The display ref names the Item by the Indexed Key it is read by.
  const slices = yield* query(
    Stream.runCollect(reads.DisplayRefs({ itemIDs: [target.itemID] })),
  );
  const ref = slices.flat()[0]?.ref ?? null;
  const item =
    ref &&
    (yield* query(
      reads.ItemsByIndexedKeys({ indexedKeys: [ref.indexedKey] }),
    )).get(ref.indexedKey);
  return item ? { kind: "item", item } : { kind: target.missing };
});
