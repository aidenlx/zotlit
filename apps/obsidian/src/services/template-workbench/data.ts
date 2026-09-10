// Resolves an Indexed Key and builds side-effect-free Template data.

import type { App } from "obsidian";

import {
  buildFilenameContext,
  citekeysToCiteTemplateData,
  CollectionCache,
  fetchNoteContext,
  fetchAnnotationsTemplateData,
  getAnnotationsByKey,
  getAttachmentByKey,
  getZoteroIdentity,
  getItemsByID,
  getItemTypeByKey,
  getItemsByKey,
  getNoteByKey,
  resolveIndexedKeyLibrary,
  resolveItemTags,
  withAnnotationCitation,
} from "@zotlit/db";
import type {
  Annotation,
  CitationTemplateData,
  CitationVariant,
  ContractRoot,
  Item,
  NoteResolvers,
} from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { TemplateError } from "@zotlit/templates/facade";
import { citationExampleData } from "@zotlit/workbench/render";
import type { CitationExampleId } from "@zotlit/workbench/render";

import { annotationCitation } from "@/lib/annotation-render";
import { creatorSummary } from "@/lib/item-summary";
import type { DatabaseService } from "@/services/database/service";
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
  db: Pick<DatabaseService, "acquireRead">;
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
  using lease = await deps.db.acquireRead();
  if (root === "annotation") {
    const selected = resolveAnnotation(lease.client, indexedKey);
    if (selected.kind !== "annotation") return selected;
    const resolvers = await createInertResolvers(deps, settings, selected.item);
    const data = fetchAnnotationsTemplateData(
      lease.client,
      [selected.annotation],
      { resolvers: resolvers.annotation },
    ).get(selected.annotation.key);
    if (!data) return { kind: "not-found" };
    return {
      kind: "data",
      data: withAnnotationCitation(data, () =>
        renderAnnotationCitation(data.parentItem, data.pageLabel, deps),
      ),
    };
  }

  const selected = resolveNoteItem(lease.client, indexedKey);
  if (selected.kind !== "item") return selected;

  const item = selected.item;
  if (root === "filename") {
    const collectionCache = new CollectionCache();
    return {
      kind: "data",
      data: buildFilenameContext({
        item,
        tags: resolveItemTags(lease.client, item.itemID, new Map()),
        collections:
          collectionCache
            .byItemIDs(lease.client, item.libraryID, [item.itemID])
            .get(item.itemID) ?? [],
        authorsShort: creatorSummary,
      }),
    };
  }

  const resolvers = await createInertResolvers(deps, settings, item);

  return {
    kind: "data",
    data: fetchNoteContext(lease.client, item, {
      resolvers,
      collectionCache: new CollectionCache(),
      username: getZoteroIdentity(lease.client).username,
    }),
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
  deps: Pick<TemplateDataDeps, "db" | "settings">,
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
  using lease = await deps.db.acquireRead();
  const selected = resolveNoteItem(lease.client, selector.key);
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

type ClassifiedObject =
  | { kind: "item"; item: Item }
  | { kind: "annotation"; annotation: Annotation }
  | { kind: "attachment"; parentItemID: number | null }
  | { kind: "note"; parentItemID: number | null }
  | { kind: "not-found" }
  | { kind: "annotation-attachment-missing" };

function classifyObject(
  client: NodeDatabaseClient,
  indexedKey: string,
): ClassifiedObject {
  const selector = resolveIndexedKeyLibrary(client, indexedKey);
  if (!selector) return { kind: "not-found" };
  const { key, libraryID } = selector;
  const itemType = getItemTypeByKey(client, libraryID, key);
  if (itemType === null) return { kind: "not-found" };

  if (itemType === "annotation") {
    const annotation = getAnnotationsByKey(client, [key], libraryID)[0];
    return annotation
      ? { kind: "annotation", annotation }
      : { kind: "annotation-attachment-missing" };
  }
  if (itemType === "attachment") {
    const attachment = getAttachmentByKey(client, key, libraryID);
    return attachment
      ? { kind: "attachment", parentItemID: attachment.parentItemID }
      : { kind: "not-found" };
  }
  if (itemType === "note") {
    const note = getNoteByKey(client, key, { libraryID });
    return note
      ? { kind: "note", parentItemID: note.parentItemID }
      : { kind: "not-found" };
  }

  const item = getItemsByKey(client, libraryID, [key])[0];
  return item ? { kind: "item", item } : { kind: "not-found" };
}

type AnnotationResult =
  | { kind: "annotation"; annotation: Annotation; item: Item | null }
  | { kind: "not-found" }
  | { kind: "annotation-required" }
  | { kind: "annotation-attachment-missing" };

function resolveAnnotation(
  client: NodeDatabaseClient,
  indexedKey: string,
): AnnotationResult {
  const selected = classifyObject(client, indexedKey);
  if (selected.kind === "annotation-attachment-missing") return selected;
  if (selected.kind === "not-found") return selected;
  if (selected.kind !== "annotation") return { kind: "annotation-required" };

  const attachment = getAttachmentByKey(
    client,
    selected.annotation.parentKey,
    selected.annotation.libraryID,
  );
  const item = attachment?.parentItemID
    ? (getItemsByID(client, [attachment.parentItemID])[0] ?? null)
    : null;
  return { ...selected, item };
}

type NoteItemResult =
  | { kind: "item"; item: Item }
  | { kind: "not-found" }
  | { kind: "no-parent-item" }
  | { kind: "annotation-attachment-missing" };

function resolveNoteItem(
  client: NodeDatabaseClient,
  indexedKey: string,
): NoteItemResult {
  const selected = classifyObject(client, indexedKey);
  if (
    selected.kind === "not-found" ||
    selected.kind === "annotation-attachment-missing" ||
    selected.kind === "item"
  ) {
    return selected;
  }
  if (selected.kind === "annotation") {
    const attachment = getAttachmentByKey(
      client,
      selected.annotation.parentKey,
      selected.annotation.libraryID,
    );
    if (!attachment) return { kind: "annotation-attachment-missing" };
    return resolveParentItem(client, attachment.parentItemID);
  }
  return resolveParentItem(client, selected.parentItemID);
}

function resolveParentItem(
  client: NodeDatabaseClient,
  parentItemID: number | null,
): NoteItemResult {
  if (!parentItemID) return { kind: "no-parent-item" };
  const item = getItemsByID(client, [parentItemID])[0];
  return item ? { kind: "item", item } : { kind: "no-parent-item" };
}
