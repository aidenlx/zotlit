// Resolves an Indexed Key and builds side-effect-free Template data.

import type { App } from "obsidian";

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
import { citationExampleData } from "@zotlit/workbench/render";
import type { CitationExampleId } from "@zotlit/workbench/render";

import { annotationCitation } from "@/lib/annotation-render";
import { Data, Effect, Stream } from "@/lib/effect";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { creatorSummary } from "@/lib/item-summary";
import { itemFacets } from "@/services/note-feature/context";
import type { PlainNoteIndex } from "@/services/note-index/plain";
import type { PlainPluginSettings } from "@/services/settings/plain";
import type { Settings } from "@/services/settings/schema";
import { CITATION_TEMPLATE_NAME } from "@/services/template/defaults";
import { InertTemplateError } from "@/services/template/errors";
import {
  buildObsidianInertNoteResolvers,
  findExistingLitNote,
  resolveObsidianExcerptImageContext,
} from "@/services/template/inert-resolver-host";
import type { TemplateService } from "@/services/template/service";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

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

export interface TemplateDataDeps {
  app: App;
  /** Each root reads its Item's bundle through a lease. */
  zoteroReads: Pick<PlainZoteroReads, "acquireRead">;
  noteIndex: Pick<
    PlainNoteIndex,
    "getNotesByItemKey" | "getImportedNoteByNoteKey" | "whenIndexed"
  >;
  settings: Pick<PlainPluginSettings, "current">;
  templates: Pick<TemplateService, "ready" | "render" | "renderCitation">;
  zoteroPref: Pick<PlainZoteroPref, "dataDir" | "baseAttachmentPath">;
}

/**
 * Template data could not be built: a wait for a service, the read lease, a
 * database read, or the building itself failed with `cause`.
 */
export class TemplateDataError extends Data.TaggedError("TemplateDataError")<{
  readonly cause: unknown;
}> {}

const failed = (cause: unknown) => new TemplateDataError({ cause });

/** A wait or read outside Effect that the data depends on. */
const attempt = <A>(evaluate: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: evaluate, catch: failed });

/** A database read. */
const query = <A, E>(read: Effect.Effect<A, E>) =>
  Effect.mapError(read, failed);

/** Building data that can throw, as a Template a getter runs. */
const build = <A>(evaluate: () => A) =>
  Effect.try({ try: evaluate, catch: failed });

/** Reads under one Snapshot, released when the caller's scope closes. */
const readLease = (deps: Pick<TemplateDataDeps, "zoteroReads">) =>
  acquireAsyncDisposable(() => deps.zoteroReads.acquireRead()).pipe(
    Effect.map((lease) => lease.reads),
    Effect.mapError((error) => failed(error.cause)),
  );

/**
 * Scope one item's Literature Note lookups to the note the caller selected, so
 * data built for an explicit note path reports that note rather than the first
 * indexed note of the same item.
 */
export function withSelectedNote(
  deps: TemplateDataDeps,
  selection: { key: string; path: string },
): TemplateDataDeps {
  return {
    ...deps,
    noteIndex: {
      whenIndexed: () => deps.noteIndex.whenIndexed(),
      getImportedNoteByNoteKey: (key) =>
        deps.noteIndex.getImportedNoteByNoteKey(key),
      getNotesByItemKey: (key) => {
        const notes = deps.noteIndex.getNotesByItemKey(key);
        return key === selection.key
          ? notes.filter((file) => file.path === selection.path)
          : notes;
      },
    },
  };
}

/** The Template data of one root for the object an Indexed Key names. */
export const readTemplateData = Effect.fn("TemplateData.read")(function* (
  deps: TemplateDataDeps,
  indexedKey: string,
  root: ContractRoot,
): Effect.fn.Return<TemplateDataLoadResult, TemplateDataError> {
  if (root === "citation") {
    return yield* readCitationData(deps, { key: indexedKey }, "main");
  }
  const [settings] = yield* Effect.all(
    [
      Effect.sync(() => deps.settings.current),
      attempt(() => deps.noteIndex.whenIndexed()),
      attempt(() => deps.templates.ready),
    ],
    { concurrency: "unbounded" },
  );
  if (root === "annotation") {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const reads = yield* readLease(deps);
        const selected = yield* readAnnotationSources(reads, indexedKey);
        if (selected.kind !== "sources") return selected;
        const { sources, item } = selected;
        const resolvers = yield* createInertResolvers(deps, settings, item);
        const data = yield* build(
          () =>
            buildAnnotationsTemplateData(sources, resolvers.annotation)
              .values()
              .next().value,
        );
        if (!data) return { kind: "not-found" } as const;
        return {
          kind: "data",
          data: withAnnotationCitation(data, () =>
            renderAnnotationCitation(data.parentItem, data.pageLabel, deps),
          ),
        } as const;
      }),
    );
  }

  const selected = yield* Effect.scoped(
    Effect.flatMap(readLease(deps), (reads) =>
      readNoteItemSource(reads, indexedKey),
    ),
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

  const resolvers = yield* createInertResolvers(deps, settings, source.item);

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
    deps: Pick<TemplateDataDeps, "zoteroReads" | "settings">,
    selector: CitationSelector,
    variant: CitationVariant,
  ): Effect.fn.Return<CitationDataLoadResult, TemplateDataError> {
    if ("example" in selector) {
      return {
        kind: "data",
        data: yield* build(() =>
          citationExampleData(selector.example, variant),
        ),
      };
    }
    const selected = yield* Effect.scoped(
      Effect.flatMap(readLease(deps), (reads) =>
        readNoteItem(reads, selector.key),
      ),
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

/**
 * {@link readTemplateData} for a caller outside Effect. It rejects with what
 * failed, as a read or a Template does.
 */
export function loadTemplateData(
  deps: TemplateDataDeps,
  indexedKey: string,
  root: ContractRoot,
): Promise<TemplateDataLoadResult> {
  return Effect.runPromise(
    readTemplateData(deps, indexedKey, root).pipe(
      Effect.mapError(({ cause }) => cause),
    ),
  );
}

/**
 * {@link readCitationData} for a caller outside Effect. It rejects with what
 * failed, as a read or a Template does.
 */
export function loadCitationData(
  deps: Pick<TemplateDataDeps, "zoteroReads" | "settings">,
  selector: CitationSelector,
  variant: CitationVariant,
): Promise<CitationDataLoadResult> {
  return Effect.runPromise(
    readCitationData(deps, selector, variant).pipe(
      Effect.mapError(({ cause }) => cause),
    ),
  );
}

/**
 * Render the annotation root's `citation` field, labeling its failure with the
 * Template that raised it: the getter runs the Citation Template, so a fault
 * that names no Template belongs to it.
 */
function renderAnnotationCitation(
  parentItem: Parameters<typeof annotationCitation>[0],
  pageLabel: string | null,
  deps: TemplateDataDeps,
): string | null {
  try {
    return annotationCitation(parentItem, pageLabel, deps.templates);
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

const createInertResolvers = Effect.fnUntraced(function* (
  deps: TemplateDataDeps,
  settings: Readonly<Settings>,
  item: Item | null,
): Effect.fn.Return<NoteResolvers, TemplateDataError> {
  const litNote = item
    ? yield* build(() =>
        findExistingLitNote(deps.noteIndex, {
          indexedKey: item.indexedKey,
        }),
      )
    : null;
  const excerptImages = yield* attempt(() =>
    resolveObsidianExcerptImageContext({
      app: deps.app,
      settings,
      litNotePath: litNote?.path ?? null,
    }),
  );
  return yield* build(() =>
    buildObsidianInertNoteResolvers({
      noteIndex: deps.noteIndex,
      fileManager: deps.app.fileManager,
      vault: deps.app.vault,
      zoteroPref: deps.zoteroPref,
      sourcePath: litNote?.path ?? "",
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
