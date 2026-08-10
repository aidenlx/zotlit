// Resolves an Indexed Key and builds side-effect-free Template data.

import type { App } from "obsidian";
import TurndownService from "turndown";

import {
  buildFilenameContext,
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
import type { Annotation, ContractRoot, Item, NoteResolvers } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { TemplateError } from "@zotlit/templates/facade";

import { annotationCitation } from "@/lib/annotation-render";
import type { DatabaseService } from "@/services/database/service";
import type { NoteIndex } from "@/services/note-index/service";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import { InertTemplateError } from "@/services/template/errors";
import {
  buildInertNoteResolvers,
  findExistingLitNote,
  resolveExcerptImageContext,
} from "@/services/template/inert-resolvers";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

/** The Template the annotation root's `citation` getter renders. */
const CITE_TEMPLATE = "cite";

export type TemplateDataLoadResult =
  | { kind: "data"; data: object }
  | { kind: "not-found" }
  | { kind: "no-parent-item" }
  | { kind: "annotation-required" }
  | { kind: "annotation-attachment-missing" };

export interface TemplateDataDeps {
  app: App;
  db: Pick<DatabaseService, "acquireRead">;
  noteIndex: Pick<
    NoteIndex,
    "getNotesByItemKey" | "getImportedNoteByNoteKey" | "whenIndexed"
  >;
  settings: Pick<SettingsService, "loaded">;
  templates: Pick<TemplateService, "ready" | "render">;
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
 * Render the annotation root's `citation` field, labeling its failure with the
 * Template that raised it: the getter runs the `cite` Template, so a fault
 * that names no Template belongs to `cite`.
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
      throw new InertTemplateError(error.message, CITE_TEMPLATE, {
        cause: error,
      });
    }
    if (error instanceof TemplateError) throw error;
    throw new TemplateError(
      error instanceof Error ? error.message : String(error),
      CITE_TEMPLATE,
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
  const excerptImages = await resolveExcerptImageContext({
    app: deps.app,
    settings,
    litNotePath: litNote?.path ?? null,
  });
  return buildInertNoteResolvers({
    noteIndex: deps.noteIndex,
    fileManager: deps.app.fileManager,
    vault: deps.app.vault,
    zoteroPref: deps.zoteroPref,
    Turndown: TurndownService,
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
