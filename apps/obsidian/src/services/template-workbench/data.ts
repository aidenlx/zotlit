// Resolves an Indexed Key and builds side-effect-free Template data.

import { type App } from "obsidian";
import TurndownService from "turndown";

import {
  buildFilenameContext,
  CollectionCache,
  fetchNoteContext,
  fetchAnnotationsTemplateData,
  getAnnotationsByKey,
  getAttachmentByKey,
  getCurrentUsername,
  getItemsByID,
  getItemsByKey,
  getNoteByKey,
  resolveIndexedKeyLibrary,
  resolveItemTags,
  withAnnotationCitation,
  type Annotation,
  type ContractRoot,
  type Item,
  type NoteResolvers,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";
import { TemplateError } from "@zotlit/templates/facade";

import { annotationCitation } from "@/lib/annotation-render";
import { type DatabaseService } from "@/services/database/service";
import { type NoteIndex } from "@/services/note-index/service";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";
import { InertTemplateError } from "@/services/template/errors";
import {
  buildInertNoteResolvers,
  findExistingLitNote,
  resolveExcerptImageContext,
} from "@/services/template/inert-resolvers";
import { type TemplateService } from "@/services/template/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

/** The Template the annotation root's `citation` getter renders. */
const CITE_TEMPLATE = "cite";

export type TemplateDataLoadResult =
  | { kind: "data"; data: object }
  | { kind: "not-found" }
  | { kind: "no-parent-item" }
  | { kind: "annotation-required" };

export interface TemplateDataDeps {
  app: App;
  db: Pick<DatabaseService, "acquireRead">;
  noteIndex: Pick<
    NoteIndex,
    | "getNotesByItemKey"
    | "getNotesByCitekey"
    | "getImportedNoteByNoteKey"
    | "whenIndexed"
  >;
  settings: Pick<SettingsService, "loaded">;
  templates: Pick<TemplateService, "ready" | "render" | "compileErrors">;
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
      username: getCurrentUsername(lease.client),
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
  const citationKey =
    item && "citationKey" in item.fields
      ? (item.fields.citationKey ?? null)
      : null;
  const litNote = item
    ? findExistingLitNote(deps.noteIndex, {
        indexedKey: item.indexedKey,
        citationKey,
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

type AnnotationResult =
  | { kind: "annotation"; annotation: Annotation; item: Item | null }
  | { kind: "not-found" }
  | { kind: "annotation-required" };

function resolveAnnotation(
  client: NodeDatabaseClient,
  indexedKey: string,
): AnnotationResult {
  const selector = resolveIndexedKeyLibrary(client, indexedKey);
  if (!selector) return { kind: "not-found" };
  const { key, libraryID } = selector;

  const annotation = getAnnotationsByKey(client, [key], libraryID)[0];
  if (annotation) {
    const attachment = getAttachmentByKey(
      client,
      annotation.parentKey,
      libraryID,
    );
    const item = attachment?.parentItemID
      ? (getItemsByID(client, [attachment.parentItemID])[0] ?? null)
      : null;
    return { kind: "annotation", annotation, item };
  }

  if (
    getItemsByKey(client, libraryID, [key])[0] ||
    getAttachmentByKey(client, key, libraryID) ||
    getNoteByKey(client, key, { libraryID })
  ) {
    return { kind: "annotation-required" };
  }
  return { kind: "not-found" };
}

type NoteItemResult =
  | { kind: "item"; item: Item }
  | { kind: "not-found" }
  | { kind: "no-parent-item" };

function resolveNoteItem(
  client: NodeDatabaseClient,
  indexedKey: string,
): NoteItemResult {
  const selector = resolveIndexedKeyLibrary(client, indexedKey);
  if (!selector) return { kind: "not-found" };
  const { key, libraryID } = selector;

  const item = getItemsByKey(client, libraryID, [key])[0];
  if (item) return { kind: "item", item };

  const annotation = getAnnotationsByKey(client, [key], libraryID)[0];
  if (annotation) {
    const attachment = getAttachmentByKey(
      client,
      annotation.parentKey,
      libraryID,
    );
    return resolveParentItem(client, attachment?.parentItemID ?? null);
  }

  const attachment = getAttachmentByKey(client, key, libraryID);
  if (attachment) return resolveParentItem(client, attachment.parentItemID);

  const note = getNoteByKey(client, key, { libraryID });
  if (note) return resolveParentItem(client, note.parentItemID);

  return { kind: "not-found" };
}

function resolveParentItem(
  client: NodeDatabaseClient,
  parentItemID: number | null,
): NoteItemResult {
  if (!parentItemID) return { kind: "no-parent-item" };
  const item = getItemsByID(client, [parentItemID])[0];
  return item ? { kind: "item", item } : { kind: "no-parent-item" };
}
