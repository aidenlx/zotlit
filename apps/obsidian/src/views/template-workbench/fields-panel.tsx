// The Fields panel shows the Template Data Explorer's tree over the leaf's own chosen Item, derived from the one read every surface shares.
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import type { WorkbenchDocumentAtoms } from "@zotlit/workbench/document";
import { initialTreeState, setAnchor } from "@zotlit/workbench/explorer";
import type { DisplayNode, TreeState } from "@zotlit/workbench/explorer";
import {
  citationExampleData,
  restoreTemplateData,
  sampleItemCitation,
} from "@zotlit/workbench/render";
import { chooseAnnotation, visibleSectionIds } from "@zotlit/workbench/ui";
import type {
  ExplorerPresentation,
  TemplateRoot,
  WorkbenchHost,
  WorkbenchInsertTarget,
  WorkbenchModel,
} from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { javascriptTemplatesEnabledAtom } from "@/services/template/atoms";
import {
  createExplorerActions,
  ExplorerActionsContext,
} from "@/views/template-data-explorer/actions";
import type { ExplorerActions } from "@/views/template-data-explorer/actions";
import { Explorer } from "@/views/template-data-explorer/Explorer";
import { exportTarget } from "@/views/template-data-explorer/export-file";
import type { TemplateDataExportTarget } from "@/views/template-data-explorer/export-file";
import {
  ExplorerModelContext,
  inNoteAnnotations,
  NO_PRESENTATION,
  toggleSections,
} from "@/views/template-data-explorer/model";
import type {
  ExplorerLoad,
  ExplorerSession,
  ExplorerState,
  ExplorerSurface,
} from "@/views/template-data-explorer/model";

import { copyToClipboard } from "./host";
import type { TemplateWorkbenchModel, WorkbenchItemRead } from "./model";
import type { TemplateWorkbenchView } from "./view";

type FieldsData = Omit<ExplorerLoad, "itemId">;

/** Where the reader was on one root of one Item. */
interface FieldsPlace {
  readonly annotationId: string | null;
  readonly navigation: TreeState;
  readonly presentation: ExplorerPresentation;
  readonly restore: ExplorerPresentation | null;
}

/** What the panel owns; the Item, the annotation and the data are the editor's. */
export interface FieldsLocal {
  /** The reader's place on each root of the Item named by `item`. */
  readonly places: {
    readonly item: string | null;
    readonly byRoot: Partial<Record<TemplateRoot, FieldsPlace>>;
  };
  readonly collapsedSections: ReadonlySet<string>;
}

const NO_FIELDS: FieldsLocal = {
  places: { item: null, byRoot: {} },
  collapsedSections: new Set(),
};

/** The Fields panel's atoms over one leaf's host model. */
export interface FieldsPanelModel extends ExplorerSurface {
  /**
   * The panel's place on each root and its closed sections; held while the
   * leaf lives, so hiding the panel keeps them. The root it shows is the host
   * model's.
   */
  readonly local: Atom.Writable<FieldsLocal>;
  /** The root the panel shows. */
  readonly root: Atom.Atom<TemplateRoot>;
  /** What an export from the panel saves; null when nothing can be. */
  readonly exportTarget: Atom.Atom<TemplateDataExportTarget | null>;
  /** Whether the editor can take a field now: it holds a caret and is writable. */
  readonly canInsert: Atom.Atom<boolean>;
}

const statusOf = (
  read: Exclude<WorkbenchItemRead, { status: "ready" }>,
): FieldsData => ({
  annotations: null,
  data: null,
  status: read.status === "empty" ? "no-item" : read.status,
  error: read.error,
});

const dataOf = (data: Record<string, unknown>): FieldsData => ({
  annotations: null,
  data,
  status: Object.keys(data).length ? "ready" : "empty",
  error: null,
});

/**
 * The panel's atoms over `model` and the reader's choices in `workbench`. The
 * editor takes a field while its document
 * takes edits and `editor.insertTarget` names a place in it, which the caret
 * in the view state and the document's slices decide.
 */
export function makeFieldsPanelModel(
  model: TemplateWorkbenchModel,
  workbench: Pick<WorkbenchModel, "choices" | "examples">,
  editor: {
    readonly document: WorkbenchDocumentAtoms;
    readonly insertTarget: () => WorkbenchInsertTarget | null;
  },
): FieldsPanelModel {
  const local = Atom.make(NO_FIELDS);
  // The editor's root, unless the reader moved the panel to another; a new
  // editor root or Item drops that one.
  const root = Atom.make(
    (get): TemplateRoot => get(model.fieldsRoot) ?? get(model.view).root,
  );
  const annotationId = Atom.make((get) =>
    get(root) === "annotation"
      ? (get(workbench.examples).example?.id ?? null)
      : null,
  );
  /**
   * The panel's session: the editor's Item and annotation, with the reader's
   * own place on the root the panel shows. A new Item starts every root over.
   */
  const session = Atom.writable(
    (get): ExplorerSession => {
      const { places, collapsedSections } = get(local);
      const { item } = get(model.view);
      const shown = get(root);
      const annotation = get(annotationId);
      const anchor = shown === "note" ? null : (annotation ?? shown);
      const saved =
        places.item === (item?.id ?? null) ? places.byRoot[shown] : undefined;
      const place: FieldsPlace = !saved
        ? {
            annotationId: annotation,
            navigation: initialTreeState(anchor),
            presentation: NO_PRESENTATION,
            restore: null,
          }
        : saved.annotationId === annotation
          ? saved
          : {
              annotationId: annotation,
              navigation: setAnchor(saved.navigation, anchor),
              presentation: NO_PRESENTATION,
              restore: null,
            };
      return {
        item: item && { id: item.id, title: get(model.title) },
        root: shown,
        collapsedSections,
        revision: 0,
        ...place,
      };
    },
    (ctx, next: ExplorerSession) => {
      const current = ctx.get(local);
      const item = next.item?.id ?? null;
      ctx.set(local, {
        ...current,
        collapsedSections: next.collapsedSections,
        places: {
          item,
          byRoot: {
            ...(current.places.item === item ? current.places.byRoot : {}),
            [next.root]: {
              annotationId: next.annotationId,
              navigation: next.navigation,
              presentation: next.presentation,
              restore: next.restore,
            },
          },
        },
      });
    },
  );
  /** The data of the panel's root, from the one read every surface shares. */
  const data = Atom.make((get): FieldsData => {
    const target = get(root);
    const read = get(model.read);
    if (target === "citation") {
      const { variant, citationExample } = get(workbench.choices);
      if (citationExample)
        return dataOf({ ...citationExampleData(citationExample, variant) });
      return read.status === "ready"
        ? dataOf({ ...sampleItemCitation(read.snapshot, variant) })
        : statusOf(read);
    }
    if (target === "annotation") {
      const { current, example } = get(workbench.examples);
      const annotations = current.map(({ id, root }) => ({ id, root }));
      if (example)
        return {
          ...dataOf(restoreTemplateData(example.root, example.descriptors)),
          annotations,
        };
      return read.status === "ready"
        ? { annotations, data: null, status: "empty", error: null }
        : statusOf(read);
    }
    return read.status === "ready"
      ? dataOf(
          restoreTemplateData(
            read.snapshot.roots[target],
            read.snapshot.descriptors[target],
          ),
        )
      : statusOf(read);
  });
  const state = Atom.make((get): ExplorerState => {
    const { revision: _, ...current } = get(session);
    const permission = get(javascriptTemplatesEnabledAtom);
    const engines: ExplorerState["engines"] =
      AsyncResult.isSuccess(permission) && permission.value
        ? ["liquid", "eta"]
        : ["liquid"];
    return { ...current, ...get(data), engines };
  });
  const exportable = Atom.make((get) => {
    const { current, example } = get(workbench.examples);
    const indexedKey = example?.root.indexedKey;
    return exportTarget(
      get(model.view).item,
      get(root),
      typeof indexedKey === "string" &&
        current.some((entry) => entry.id === example?.id)
        ? indexedKey
        : null,
    );
  });
  const canInsert = Atom.make((get) => {
    if (get(editor.document.readOnly)) return false;
    get(model.view);
    get(editor.document.slices);
    return editor.insertTarget() !== null;
  });
  return {
    local,
    root,
    session,
    state,
    exportTarget: exportable,
    canInsert,
  };
}

/**
 * The annotation example the note root's `annotations` row explores. The
 * panel shows that list by its items' properties, with no row for one
 * annotation, so the row explores the view's chosen annotation, else the
 * Item's first; the view's "Choose annotation" picks another from there.
 */
function annotationOfNode(
  view: TemplateWorkbenchView,
  node: DisplayNode,
): string | null {
  const { root } = view.registry.get(view.fields.state);
  if (!inNoteAnnotations(root, node, 1)) return null;
  const { current, example } = view.registry.get(view.workbench.examples);
  return (
    current.find((entry) => entry.id === example?.id)?.id ??
    current[0]?.id ??
    null
  );
}

/** Shows `root` in the Fields panel of `view`. */
function moveTo(view: TemplateWorkbenchView, root: TemplateRoot): void {
  view.registry.set(view.model.fieldsRoot, root);
}

/** Makes `id` the annotation, and shows it in the Fields panel of `view`. */
function chooseExample(view: TemplateWorkbenchView, id: string): void {
  view.registry.update(view.workbench.choices, chooseAnnotation(id));
  moveTo(view, "annotation");
}

/**
 * The Fields panel's actions in `view`, as the standalone Explorer has them:
 * choosing, the sections, and the export and Indexed Key of the root shown.
 */
export function makeFieldsActions(
  view: TemplateWorkbenchView,
  host: Pick<WorkbenchHost, "messages" | "getLocale">,
  exportData: (target: TemplateDataExportTarget) => void,
): ExplorerActions {
  const { registry, fields } = view;
  const target = () => {
    const { status } = registry.get(fields.state);
    return status === "ready" || status === "empty"
      ? registry.get(fields.exportTarget)
      : null;
  };
  return createExplorerActions({
    onChooseItem: () => view.startItemChoice(),
    onBackToNoteRoot: () => moveTo(view, "note"),
    onToggleSections: () => {
      const { root, data } = registry.get(fields.state);
      registry.update(
        fields.session,
        toggleSections(
          visibleSectionIds(data, {
            m: host.messages,
            root,
            locale: host.getLocale(),
          }),
        ),
      );
    },
    onRefresh: () => view.refresh(),
    copyTarget: () => {
      const shown = target();
      return shown
        ? {
            indexedKey: shown.indexedKey,
            kind: shown.root === "annotation" ? "annotation" : "item",
          }
        : null;
    },
    canExport: () => target() !== null,
    onExport: () => {
      const shown = target();
      if (shown) exportData(shown);
    },
    exportLabel: () =>
      registry.get(fields.root) === "annotation" && target()?.root === "note"
        ? m.template_data_explorer_export_selected_paper()
        : m.template_data_explorer_menu_export_json(),
  });
}

/** The Explorer's tree in the leaf's Fields Panel. */
export function FieldsPanel({
  view,
  actions,
}: {
  view: TemplateWorkbenchView;
  actions: ExplorerActions;
}) {
  const canInsert = useAtomValue(view.fields.canInsert);
  return (
    <ExplorerModelContext value={view.fields}>
      <ExplorerActionsContext value={actions}>
        <Explorer
          placement="panel"
          onSelectAnnotation={(id) => chooseExample(view, id)}
          onChooseAnnotation={() => view.startAnnotationChoice()}
          onSelectItem={(item) => view.setItem(item)}
          onSearchItem={() => view.startItemChoice()}
          explorer={{
            copy: copyToClipboard,
            disabled: !canInsert,
            onInsertNode: (node, { keepOpen, kind }) =>
              view.insertTemplateField(node, { focus: !keepOpen, kind }),
            canExploreAnnotation: (node) =>
              annotationOfNode(view, node) !== null,
            onExploreAnnotation: (node) => {
              const id = annotationOfNode(view, node);
              if (id) chooseExample(view, id);
            },
          }}
        />
      </ExplorerActionsContext>
    </ExplorerModelContext>
  );
}
