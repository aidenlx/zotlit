// Resolves an Indexed Key and builds side-effect-free Template data.

import { Effect } from "effect";
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
import { creatorSummary } from "@/lib/item-summary";
import { itemFacets } from "@/services/note-feature/context";
import type { NoteIndex } from "@/services/note-index/service";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import { CITATION_TEMPLATE_NAME } from "@/services/template/defaults";
import { InertTemplateError } from "@/services/template/errors";
import {
  buildObsidianInertNoteResolvers,
  findExistingLitNote,
  resolveObsidianExcerptImageContext,
} from "@/services/template/inert-resolver-host";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import { readDisplayRef } from "@/services/zotero-reads/display-ref";
import type {
  ZoteroReadsApi,
  ZoteroReadsService,
} from "@/services/zotero-reads/service";

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
  zoteroReads: Pick<ZoteroReadsService, "acquireRead">;
  noteIndex: Pick<
    NoteIndex,
    "getNotesByItemKey" | "getImportedNoteByNoteKey" | "whenIndexed"
  >;
  settings: Pick<SettingsService, "loaded">;
  templates: Pick<TemplateService, "ready" | "render" | "renderCitation">;
  zoteroPref: Pick<
    ZoteroPrefService,
    "ready" | "dataDir" | "baseAttachmentPath"
  >;
}

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

export async function loadTemplateData(
  deps: TemplateDataDeps,
  indexedKey: string,
  root: ContractRoot,
): Promise<TemplateDataLoadResult> {
  if (root === "citation") {
    return await loadCitationData(deps, { key: indexedKey }, "main");
  }
  const [settings] = await Promise.all([
    deps.settings.loaded,
    deps.noteIndex.whenIndexed(),
    deps.zoteroPref.ready,
    deps.templates.ready,
  ]);
  if (root === "annotation") {
    await using lease = await deps.zoteroReads.acquireRead();
    const selected = await readAnnotationSources(lease.reads, indexedKey);
    if (selected.kind !== "sources") return selected;
    const { sources, item } = selected;
    const resolvers = await createInertResolvers(deps, settings, item);
    const data = buildAnnotationsTemplateData(sources, resolvers.annotation)
      .values()
      .next().value;
    if (!data) return { kind: "not-found" };
    return {
      kind: "data",
      data: withAnnotationCitation(data, () =>
        renderAnnotationCitation(data.parentItem, data.pageLabel, deps),
      ),
    };
  }

  const selected = await (async () => {
    await using lease = await deps.zoteroReads.acquireRead();
    return await readNoteItemSource(lease.reads, indexedKey);
  })();
  if (selected.kind !== "source") return selected;
  const { source } = selected;
  if (root === "filename") {
    const { itemTags, itemCollections } = itemFacets(source);
    return {
      kind: "data",
      data: buildFilenameContext({
        item: source.item,
        tags: itemTags,
        collections: itemCollections,
        authorsShort: creatorSummary,
      }),
    };
  }

  const resolvers = await createInertResolvers(deps, settings, source.item);

  return {
    kind: "data",
    data: buildNoteContextFromSource(source, resolvers),
  };
}

/**
 * The Citation Template data one example set or one chosen Item produces:
 * `zt.citations` with `zt.items` beside it, under `variant`. A chosen Item
 * yields a one-item set with no locator, prefix, or suffix — what the
 * suggester inserts for a plain Enter. An example set reads nothing from the
 * database.
 */
export async function loadCitationData(
  deps: Pick<TemplateDataDeps, "zoteroReads" | "settings">,
  selector: CitationSelector,
  variant: CitationVariant,
): Promise<CitationDataLoadResult> {
  if ("example" in selector) {
    return {
      kind: "data",
      data: citationExampleData(selector.example, variant),
    };
  }
  await deps.settings.loaded;
  await using lease = await deps.zoteroReads.acquireRead();
  const selected = await readNoteItem(lease.reads, selector.key);
  if (selected.kind !== "item") return selected;
  const { item } = selected;
  const citationKey =
    "citationKey" in item.fields ? (item.fields.citationKey ?? null) : null;
  return {
    kind: "data",
    data: citekeysToCiteTemplateData([{ citationKey, item }], variant),
  };
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

async function createInertResolvers(
  deps: TemplateDataDeps,
  settings: Readonly<Settings>,
  item: Item | null,
): Promise<NoteResolvers> {
  const litNote = item
    ? findExistingLitNote(deps.noteIndex, {
        indexedKey: item.indexedKey,
      })
    : null;
  const excerptImages = await resolveObsidianExcerptImageContext({
    app: deps.app,
    settings,
    litNotePath: litNote?.path ?? null,
  });
  return buildObsidianInertNoteResolvers({
    noteIndex: deps.noteIndex,
    fileManager: deps.app.fileManager,
    vault: deps.app.vault,
    zoteroPref: deps.zoteroPref,
    sourcePath: litNote?.path ?? "",
    excerptImages,
  });
}

type AnnotationResult =
  | { kind: "sources"; sources: AnnotationSources; item: Item | null }
  | { kind: "not-found" }
  | { kind: "annotation-required" }
  | { kind: "annotation-attachment-missing" };

/**
 * The {@link AnnotationSources} of the Annotation an Indexed Key names, with
 * its parent Item, `null` for a standalone attachment.
 */
async function readAnnotationSources(
  reads: ZoteroReadsApi,
  indexedKey: string,
): Promise<AnnotationResult> {
  const selected = await Effect.runPromise(reads.ItemType({ indexedKey }));
  if (!selected) return { kind: "not-found" };
  if (selected.itemType !== "annotation")
    return { kind: "annotation-required" };
  const sources = await Effect.runPromise(
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
}

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
async function resolveNoteItemID(
  reads: ZoteroReadsApi,
  indexedKey: string,
): Promise<NoteItemTarget> {
  const run = Effect.runPromise;
  const selected = await run(reads.ItemType({ indexedKey }));
  if (!selected) return { kind: "not-found" };
  const { libraryID, key, itemType } = selected;
  let parentItemID: number | null;
  if (itemType === "annotation") {
    const sources = await run(
      reads.AnnotationSources({ libraryID, keys: [key], username: null }),
    );
    const attachment = sources.attachments[0];
    if (!attachment) return { kind: "annotation-attachment-missing" };
    parentItemID = attachment.parentItemID;
  } else if (itemType === "attachment") {
    const [attachment] = await run(
      reads.AttachmentsByKeys({ libraryID, keys: [key] }),
    );
    if (!attachment) return { kind: "not-found" };
    parentItemID = attachment.parentItemID;
  } else if (itemType === "note") {
    const [note] = await run(reads.NoteBodies({ libraryID, keys: [key] }));
    if (!note) return { kind: "not-found" };
    parentItemID = note.parentItemID;
  } else {
    const items = await run(
      reads.ItemsByIndexedKeys({ indexedKeys: [indexedKey] }),
    );
    const item = items.values().next().value;
    return item
      ? { kind: "target", itemID: item.itemID, item, missing: "not-found" }
      : { kind: "not-found" };
  }
  if (!parentItemID) return { kind: "no-parent-item" };
  return { kind: "target", itemID: parentItemID, missing: "no-parent-item" };
}

/**
 * {@link resolveNoteItemID}'s Item, read as a {@link NoteSource}. Pass
 * Snapshot-bound reads.
 */
async function readNoteItemSource(
  reads: ZoteroReadsApi,
  indexedKey: string,
): Promise<
  | { kind: "source"; source: NoteSource }
  | Exclude<NoteItemResult, { kind: "item" }>
> {
  const target = await resolveNoteItemID(reads, indexedKey);
  if (target.kind !== "target") return target;
  const source = await Effect.runPromise(
    reads.NoteSource({ itemID: target.itemID }),
  );
  return source ? { kind: "source", source } : { kind: target.missing };
}

/** {@link resolveNoteItemID}'s Item alone. Pass Snapshot-bound reads. */
async function readNoteItem(
  reads: ZoteroReadsApi,
  indexedKey: string,
): Promise<NoteItemResult> {
  const target = await resolveNoteItemID(reads, indexedKey);
  if (target.kind !== "target") return target;
  if (target.item) return { kind: "item", item: target.item };
  const ref = await readDisplayRef(reads, target.itemID);
  const item =
    ref &&
    (
      await Effect.runPromise(
        reads.ItemsByIndexedKeys({ indexedKeys: [ref.indexedKey] }),
      )
    ).get(ref.indexedKey);
  return item ? { kind: "item", item } : { kind: target.missing };
}
