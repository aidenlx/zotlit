// Per-leaf state for one Template Data Explorer, as atoms in the plugin's view
// registry: its target and reading state, the pure transitions that change
// them, and its data load. A new target reads its data again and interrupts a
// read in progress.
import { Cause, Effect, Option, Schema, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createContext, useContext } from "react";

import { DEFAULT_CITATION_VARIANT, parseIndexedKey } from "@zotlit/db";
import {
  initialTreeState,
  setAnchor,
  setFilter as filterTree,
  toggleNode as toggleTreeNode,
} from "@zotlit/workbench/explorer";
import type { TreeState } from "@zotlit/workbench/explorer";
import {
  citationExampleData,
  DEFAULT_CITATION_EXAMPLE,
  restoreTemplateData,
  SAMPLE_ANNOTATIONS,
  sampleItemCitation,
} from "@zotlit/workbench/render";
import type { AnnotationExample } from "@zotlit/workbench/render";
import type {
  ExplorerPresentation,
  TemplateRoot,
  WorkbenchItemChoice,
} from "@zotlit/workbench/ui";
import { annotationSamples } from "@zotlit/workbench/ui";

import { withLogCategory } from "@/lib/effect-log";
import { viewRuntime } from "@/lib/view-atoms";
import { indexedKeyForClipboard } from "@/services/indexed-key/actions";
import type { TemplateDataLoadResult } from "@/services/template-workbench/data";
import { TemplateDataReads } from "@/services/template-workbench/data-reads";
import { zoteroRevisionAtom } from "@/services/zotero-reads/atoms";
import { getSampleItem } from "@/views/template-workbench/selection-data";
import type { TemplateAuthoringContext } from "@/views/template-workbench/view";

type AnnotationChoices = readonly Pick<AnnotationExample, "id" | "root">[];

/** What the Explorer shows and where its reader is in it. */
export interface ExplorerSession {
  readonly sourcePath: string | null;
  readonly presentation: ExplorerPresentation;
  readonly restore: ExplorerPresentation | null;
  readonly context: TemplateAuthoringContext | null;
  readonly item: WorkbenchItemChoice | null;
  readonly root: TemplateRoot;
  readonly annotationId: string | null;
  readonly navigation: TreeState;
  /** Section ids the reader closed; saved with the workspace. */
  readonly collapsedSections: ReadonlySet<string>;
  /** Raised by each change that reads the data again. */
  readonly revision: number;
}

/** The data one target read. */
export interface ExplorerLoad {
  /** The Item the read was for; its annotation choices stay while it does. */
  readonly itemId: string | null;
  readonly annotations: AnnotationChoices | null;
  readonly data: Record<string, unknown> | null;
  readonly status: "no-item" | "loading" | "ready" | "empty" | "error";
  readonly error: string | null;
}

/** What the Explorer renders: its session and the data its target read. */
export type ExplorerState = Omit<ExplorerSession, "revision"> &
  Omit<ExplorerLoad, "itemId">;

export interface ExplorerModel {
  readonly session: Atom.Writable<ExplorerSession>;
  readonly state: Atom.Atom<ExplorerState>;
}

const NO_PRESENTATION: ExplorerPresentation = { top: 0, left: 0, field: null };

export const EMPTY_EXPLORER_SESSION: ExplorerSession = {
  sourcePath: null,
  presentation: NO_PRESENTATION,
  restore: null,
  context: null,
  item: null,
  root: "note",
  annotationId: null,
  navigation: initialTreeState(),
  collapsedSections: new Set(),
  revision: 0,
};

export function makeExplorerModel(): ExplorerModel {
  const session = Atom.make(EMPTY_EXPLORER_SESSION);
  const revision = Atom.map(session, (current) => current.revision);
  const loaded = viewRuntime.atom((get) => {
    get(revision);
    get(zoteroRevisionAtom);
    const current = get.once(session);
    const previous = get
      .self<AsyncResult.AsyncResult<ExplorerLoad>>()
      .pipe(Option.flatMap((result) => AsyncResult.value(result)));
    return loadExplorerData(
      current,
      sameItemAnnotations(previous, current.item),
    );
  });
  const state = Atom.make((get): ExplorerState => {
    const { revision: _, ...current } = get(session);
    const result = get(loaded);
    if (AsyncResult.isFailure(result)) {
      return {
        ...current,
        annotations: null,
        data: null,
        status: "error",
        error: errorMessage(Cause.squash(result.cause)),
      };
    }
    // Each load emits its first state at once, so the latest value is this
    // target's.
    const { itemId: _item, ...load } = Option.getOrElse(
      AsyncResult.value(result),
      (): ExplorerLoad => ({
        itemId: null,
        annotations: null,
        data: null,
        status: "loading",
        error: null,
      }),
    );
    return { ...current, ...load };
  });
  return { session, state };
}

/**
 * Holds every atom of `model` in `registry` until the returned release runs.
 * A leaf holds its model from construction to close: Obsidian sets its state
 * before it opens.
 */
export function holdExplorerModel(
  registry: AtomRegistry.AtomRegistry,
  model: ExplorerModel,
): () => void {
  const releases = [registry.mount(model.session), registry.mount(model.state)];
  return () => {
    for (const release of releases) release();
  };
}

const sameItemAnnotations = (
  previous: Option.Option<ExplorerLoad>,
  item: WorkbenchItemChoice | null,
): AnnotationChoices | null =>
  Option.match(previous, {
    onNone: () => null,
    onSome: (load) =>
      load.itemId === (item?.id ?? null) ? load.annotations : null,
  });

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

// Transitions: each takes the session it changes and returns the next one.

/** Read the target's data again. */
export const refresh = (session: ExplorerSession): ExplorerSession => ({
  ...session,
  revision: session.revision + 1,
});

/**
 * Show `root` of `item`, anchored at `annotationId`. A new Item starts its
 * navigation over; a new root or annotation moves its anchor. Either resets
 * the scroll position.
 */
export const setTarget =
  (
    item: WorkbenchItemChoice | null,
    root: TemplateRoot,
    annotationId: string | null = null,
  ) =>
  (session: ExplorerSession): ExplorerSession => {
    const anchor = root === "note" ? null : (annotationId ?? root);
    const newItem = session.item?.id !== item?.id;
    const moved =
      newItem || session.root !== root || session.annotationId !== annotationId;
    return refresh({
      ...session,
      item,
      root,
      annotationId,
      navigation: newItem
        ? initialTreeState(anchor)
        : moved
          ? setAnchor(session.navigation, anchor)
          : session.navigation,
      ...(moved ? { presentation: NO_PRESENTATION, restore: null } : {}),
    });
  };

/** Follow the authoring context of the editor this Explorer serves. */
export const setContext =
  (context: TemplateAuthoringContext) =>
  (session: ExplorerSession): ExplorerSession => {
    const previous = session.context;
    const next = { ...session, context, sourcePath: context.path };
    // Display-only editor changes leave an Explorer's own annotation navigation intact.
    if (
      !previous ||
      previous.item?.id !== context.item?.id ||
      previous.root !== context.root
    )
      return setTarget(
        context.item,
        context.root,
        context.root === "annotation" ? context.annotationId : null,
      )(next);
    if (
      session.root === "annotation" &&
      previous.annotationId !== context.annotationId
    )
      return setTarget(context.item, "annotation", context.annotationId)(next);
    // The Citation set names the same fields whichever it is, so a new set
    // reloads their values and leaves the reader's navigation where it is.
    if (
      session.root === "citation" &&
      (previous.citation?.variant !== context.citation?.variant ||
        previous.citation?.example !== context.citation?.example)
    )
      return refresh(next);
    return next;
  };

/** Keep the context a pinned Explorer shows; only field insertion follows the editor. */
export const keepPinnedContext =
  (context: TemplateAuthoringContext) =>
  (session: ExplorerSession): ExplorerSession =>
    session.context
      ? {
          ...session,
          context: {
            ...session.context,
            canInsertField:
              session.context.path === context.path && context.canInsertField,
          },
        }
      : session;

/** The editor this Explorer served left; it can no longer insert fields. */
export const loseEditor = (session: ExplorerSession): ExplorerSession =>
  session.context
    ? { ...session, context: { ...session.context, canInsertField: false } }
    : session;

/** The source note moved from `oldPath` to `path`. */
export const moveSource =
  (
    oldPath: string,
    path: string,
    editorContext: TemplateAuthoringContext | null,
  ) =>
  (session: ExplorerSession): ExplorerSession =>
    session.sourcePath !== oldPath
      ? session
      : {
          ...session,
          sourcePath: path,
          ...(session.context?.path === oldPath
            ? {
                context: {
                  ...session.context,
                  path,
                  canInsertField:
                    editorContext?.path === path &&
                    editorContext.canInsertField,
                },
              }
            : {}),
        };

export const setNavigation =
  (navigation: TreeState) =>
  (session: ExplorerSession): ExplorerSession => ({ ...session, navigation });

export const setFilter =
  (query: string) =>
  (session: ExplorerSession): ExplorerSession => ({
    ...session,
    navigation: filterTree(session.navigation, query),
  });

export const toggleNode =
  (key: string) =>
  (session: ExplorerSession): ExplorerSession => ({
    ...session,
    navigation: toggleTreeNode(session.navigation, key),
  });

export const setCollapsedSections =
  (collapsedSections: ReadonlySet<string>) =>
  (session: ExplorerSession): ExplorerSession => ({
    ...session,
    collapsedSections,
  });

export const setPresentation =
  (presentation: ExplorerPresentation) =>
  (session: ExplorerSession): ExplorerSession => ({ ...session, presentation });

export const clearRestore = (session: ExplorerSession): ExplorerSession => ({
  ...session,
  restore: null,
});

// Saved state: each field decoded on its own, so one bad field leaves the others.

const decode =
  <A>(schema: Schema.Codec<A>) =>
  (value: unknown): A | null =>
    Option.getOrNull(Schema.decodeUnknownOption(schema)(value));

const decodeString = decode(Schema.String);
const decodeRoot = decode(Schema.Literals(["filename", "annotation", "note"]));
const decodeNumber = decode(Schema.Finite);
const strings = (value: unknown): ReadonlySet<string> =>
  new Set(
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [],
  );

/** What the workspace layout holds for one Explorer. */
export interface SavedExplorer {
  readonly itemIndexedKey: string | null;
  readonly anchorAnnotationKey: string | null;
  readonly root: "filename" | "annotation" | "note";
  readonly collapsedSections: ReadonlySet<string>;
  readonly sourceFile: string | null;
}

/** The saved Explorer in `state`; `null` when it names no target at all. */
export function readSavedExplorer(state: unknown): SavedExplorer | null {
  if (!state || typeof state !== "object") return null;
  const value = state as Record<string, unknown>;
  if (!Object.hasOwn(value, "itemIndexedKey")) return null;
  const anchorAnnotationKey = decodeString(value.anchorAnnotationKey);
  return {
    itemIndexedKey: decodeString(value.itemIndexedKey),
    anchorAnnotationKey,
    root:
      decodeRoot(value.root) ?? (anchorAnnotationKey ? "annotation" : "note"),
    collapsedSections: strings(value.collapsedSections),
    sourceFile: decodeString(value.sourceFile),
  };
}

/** What a workspace history entry holds for one Explorer: where its reader was. */
export interface EphemeralExplorer {
  /** The target the entry was taken on; another target ignores it. */
  readonly context: string;
  readonly navigation: TreeState;
  readonly presentation: ExplorerPresentation;
}

/** The Explorer's part of an ephemeral state; `null` when it holds none. */
export function readEphemeralExplorer(
  input: unknown,
): EphemeralExplorer | null {
  if (!input || typeof input !== "object") return null;
  const payload = (input as Record<string, unknown>).zotlitDataExplorer;
  if (!payload || typeof payload !== "object") return null;
  const state = payload as Record<string, unknown>;
  const context = decodeString(state.context);
  const raw = state.navigation;
  if (context === null || !raw || typeof raw !== "object") return null;
  const navigation = raw as Record<string, unknown>;
  const presentation =
    state.presentation && typeof state.presentation === "object"
      ? (state.presentation as Record<string, unknown>)
      : {};
  return {
    context,
    navigation: {
      anchorKey: decodeString(navigation.anchorKey),
      filterQuery: decodeString(navigation.filterQuery) ?? "",
      expanded: strings(navigation.expanded),
      filterCollapsed: strings(navigation.filterCollapsed),
      noteRootExpanded:
        navigation.noteRootExpanded === null
          ? null
          : strings(navigation.noteRootExpanded),
      preFilterExpanded:
        navigation.preFilterExpanded === null
          ? null
          : strings(navigation.preFilterExpanded),
    },
    presentation: {
      top: Math.max(0, decodeNumber(presentation.top) ?? 0),
      left: Math.max(0, decodeNumber(presentation.left) ?? 0),
      field: decodeString(presentation.field),
    },
  };
}

// The data load.

/** The annotation choices a note root's data lists. */
const annotationChoices = (
  itemId: string,
  data: unknown,
): AnnotationChoices => {
  const values = (data as Record<string, unknown>).annotations;
  return Array.isArray(values)
    ? values.flatMap((value: unknown) => {
        if (
          !value ||
          typeof value !== "object" ||
          !("key" in value) ||
          typeof value.key !== "string"
        )
          return [];
        const id = annotationIndexedKey(itemId, value.key);
        return id ? [{ id, root: value as Record<string, unknown> }] : [];
      })
    : [];
};

/**
 * The data of `session`'s target, with the annotation choices it lists: what
 * shows at once — the loading state, or a sample's own data — then what the
 * reads give. A failed read gives the `error` status; it never fails.
 */
const loadExplorerData = (
  session: ExplorerSession,
  previousAnnotations: AnnotationChoices | null,
): Stream.Stream<ExplorerLoad, never, TemplateDataReads> =>
  Stream.suspend(() => {
    const { item, root, annotationId, context } = session;
    const itemId = item?.id ?? null;
    const load = (
      status: ExplorerLoad["status"],
      fields: Partial<Omit<ExplorerLoad, "itemId" | "status">> = {},
    ): ExplorerLoad => ({
      itemId,
      annotations: previousAnnotations,
      data: null,
      error: null,
      status,
      ...fields,
    });
    const sample =
      root === "annotation"
        ? SAMPLE_ANNOTATIONS.find(({ id }) => id === annotationId)
        : undefined;
    const snapshot = item ? getSampleItem(item.id) : null;
    // The Citation set and Variant the editor's preview renders, so the two
    // panes show the one choice. With no editor to name a set, a chosen Item
    // supplies it and the built-in default stands in for none.
    const citation =
      root === "citation"
        ? (context?.citation ?? {
            variant: DEFAULT_CITATION_VARIANT,
            example: item ? null : DEFAULT_CITATION_EXAMPLE,
          })
        : null;
    const variant = citation?.variant ?? DEFAULT_CITATION_VARIANT;
    // A built-in example set carries its own citations, so it needs no Item —
    // and it outranks the one chosen, exactly as the preview reads it.
    if (citation?.example) {
      return Stream.make(
        load("ready", {
          data: { ...citationExampleData(citation.example, citation.variant) },
        }),
      );
    }
    // A sample annotation shows its own data at once; a real Item's choices
    // arrive beside it.
    const shown = sample
      ? load("ready", {
          data: restoreTemplateData(sample.root, sample.descriptors),
          annotations: snapshot
            ? annotationSamples(snapshot, annotationId).current
            : (previousAnnotations ?? []),
        })
      : null;
    if (shown && (!item || snapshot)) return Stream.make(shown);
    if (!item) return Stream.make(load("no-item"));

    const loadRoot = (
      reads: TemplateDataReads["Service"],
      key: string,
      target: TemplateRoot,
    ): Effect.Effect<TemplateDataLoadResult, unknown> => {
      if (!item.id.startsWith("sample:"))
        return Effect.mapError(
          target === "citation"
            ? reads.readCitation({ key }, variant)
            : reads.read(key, target),
          ({ cause }) => cause,
        );
      if (!snapshot) return Effect.succeed({ kind: "not-found" });
      if (target === "citation")
        return Effect.succeed({
          kind: "data",
          data: sampleItemCitation(snapshot, variant),
        });
      if (target !== "annotation")
        return Effect.succeed({
          kind: "data",
          data: restoreTemplateData(
            snapshot.roots[target],
            snapshot.descriptors[target],
          ),
        });
      const selected = annotationSamples(snapshot, annotationId).current.find(
        ({ id, root }) => id === annotationId || root.indexedKey === key,
      );
      return Effect.succeed(
        selected
          ? {
              kind: "data",
              data: restoreTemplateData(selected.root, selected.descriptors),
            }
          : { kind: annotationId ? "not-found" : "annotation-required" },
      );
    };
    const first = shown ?? load("loading");
    const read = Effect.gen(function* () {
      const reads = yield* TemplateDataReads;
      let annotations = first.annotations;
      const failed = (cause: unknown) =>
        Effect.as(
          Effect.logWarning("Explorer data load failed", {
            cause,
            indexedKey: itemId,
            root,
          }),
          // A sample annotation already shows its data; a failed read of the
          // Item's choices leaves it in place.
          shown
            ? { ...shown, annotations }
            : load("error", { annotations, error: errorMessage(cause) }),
        );
      if (root === "annotation") {
        const note = yield* Effect.result(loadRoot(reads, item.id, "note"));
        if (note._tag === "Failure") return yield* failed(note.failure);
        if (note.success.kind === "data") {
          annotations = snapshot
            ? annotationSamples(snapshot, annotationId).current
            : annotationChoices(item.id, note.success.data);
        }
      }
      if (shown) return { ...shown, annotations };

      const key =
        root === "annotation"
          ? (annotationIndexedKey(item.id, annotationId) ?? item.id)
          : item.id;
      const result = yield* Effect.result(loadRoot(reads, key, root));
      if (result._tag === "Failure") return yield* failed(result.failure);
      if (result.success.kind !== "data") {
        yield* Effect.logDebug("Explorer data unavailable", {
          indexedKey: key,
          root,
          reason: result.success.kind,
        });
        return load(
          result.success.kind === "annotation-required" ? "empty" : "error",
          { annotations },
        );
      }
      const data = result.success.data as Record<string, unknown>;
      return load(Object.keys(data).length ? "ready" : "empty", {
        annotations,
        data,
      });
    }).pipe(withLogCategory("template-data-explorer"));
    return Stream.concat(Stream.make(first), Stream.fromEffect(read));
  });

/** Restored anchors use bare keys; copied authoring selections carry Indexed Keys. */
export function annotationIndexedKey(
  itemId: string,
  selectionId: string | null,
): string | null {
  if (!selectionId || SAMPLE_ANNOTATIONS.some(({ id }) => id === selectionId))
    return null;
  const selection: unknown = selectionId.startsWith("[")
    ? JSON.parse(selectionId)
    : selectionId;
  const key = Array.isArray(selection) ? selection[1] : selection;
  if (typeof key !== "string") return null;
  const annotation = parseIndexedKey(key);
  const item = parseIndexedKey(
    getSampleItem(itemId)?.item.indexedKey ?? itemId,
  );
  return annotation && item
    ? indexedKeyForClipboard({
        key: annotation.key,
        groupID: annotation.groupID ?? item.groupID,
      })
    : null;
}

export const ExplorerModelContext = createContext<ExplorerModel | null>(null);

export function useExplorerModel(): ExplorerModel {
  const model = useContext(ExplorerModelContext);
  if (!model) {
    throw new Error(
      "useExplorerModel must be used within ExplorerModelContext",
    );
  }
  return model;
}
