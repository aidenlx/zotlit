// The Fields panel of the Template Workbench View: the Template Data
// Explorer's tree over the leaf's own choice. It derives its Item, root,
// annotation and data from the host model's one read of the chosen Item, so
// it shows the data the render reads, and inserts a field straight into the
// editor. Only its navigation is its own.
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import type { DisplayNode } from "@zotlit/workbench/explorer";
import {
  citationExampleData,
  restoreTemplateData,
  sampleItemCitation,
} from "@zotlit/workbench/render";
import {
  explorerSectionIds,
  useWorkbenchHost,
  visibleSectionIds,
} from "@zotlit/workbench/ui";
import type { TemplateRoot } from "@zotlit/workbench/ui";

import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { javascriptTemplatesEnabledAtom } from "@/services/template/atoms";
import {
  createExplorerActions,
  ExplorerActionsContext,
} from "@/views/template-data-explorer/actions";
import { Explorer } from "@/views/template-data-explorer/Explorer";
import {
  EMPTY_EXPLORER_SESSION,
  ExplorerModelContext,
  setCollapsedSections,
  setTarget,
} from "@/views/template-data-explorer/model";
import type {
  ExplorerLoad,
  ExplorerSession,
  ExplorerState,
  ExplorerSurface,
} from "@/views/template-data-explorer/model";

import { copyToClipboard } from "./host";
import { chooseAnnotation } from "./model";
import type { TemplateWorkbenchModel, WorkbenchItemRead } from "./model";
import type { TemplateWorkbenchView } from "./view";

type FieldsData = Omit<ExplorerLoad, "itemId">;

/** The Fields panel's atoms over one leaf's host model. */
export interface FieldsPanelModel extends ExplorerSurface {
  /**
   * The panel's own session: its root and navigation. Held while the leaf
   * lives, so hiding the panel keeps it.
   */
  readonly local: Atom.Writable<ExplorerSession>;
  readonly model: TemplateWorkbenchModel;
}

const statusOf = (read: WorkbenchItemRead): FieldsData => ({
  annotations: null,
  data: null,
  status:
    read.status === "empty"
      ? "no-item"
      : read.status === "ready"
        ? "error"
        : read.status,
  error: read.error,
});

const dataOf = (data: Record<string, unknown>): FieldsData => ({
  annotations: null,
  data,
  status: Object.keys(data).length ? "ready" : "empty",
  error: null,
});

export function makeFieldsPanelModel(
  model: TemplateWorkbenchModel,
): FieldsPanelModel {
  const local = Atom.make(EMPTY_EXPLORER_SESSION);
  /**
   * The panel's session: the editor's Item and chosen annotation, with the
   * panel's own root and navigation.
   */
  const session = Atom.writable(
    (get): ExplorerSession => {
      const saved = get(local);
      const { item } = get(model.view);
      const annotationId =
        saved.root === "annotation"
          ? (get(model.examples).example?.id ?? null)
          : null;
      return setTarget(
        item && { id: item.id, title: get(model.title) },
        saved.root,
        annotationId,
      )(saved);
    },
    (ctx, next: ExplorerSession) => ctx.set(local, next),
  );
  const root = Atom.map(session, (current) => current.root);
  /** The data of the panel's root, from the one read every surface shares. */
  const data = Atom.make((get): FieldsData => {
    const target = get(root);
    const read = get(model.read);
    if (target === "citation") {
      const { variant, citationExample } = get(model.picks);
      if (citationExample)
        return dataOf({ ...citationExampleData(citationExample, variant) });
      return read.snapshot
        ? dataOf({ ...sampleItemCitation(read.snapshot, variant) })
        : statusOf(read);
    }
    if (target === "annotation") {
      const { current, example } = get(model.examples);
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
    return read.snapshot
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
  return { local, session, state, model };
}

/**
 * Holds the panel's own state from the leaf's constructor to its close. A new
 * Item or a new editor root starts the panel over at that root; a root the
 * reader moved to in the panel stays until then.
 */
export function holdFieldsPanelModel(
  registry: ViewRegistryHandle,
  { local, model }: FieldsPanelModel,
): () => void {
  const release = registry.mount(local);
  let followed: readonly [string | null, TemplateRoot] | null = null;
  const stop = registry.subscribe(
    model.view,
    ({ item, root }) => {
      const id = item?.id ?? null;
      if (followed && followed[0] === id && followed[1] === root) return;
      followed = [id, root];
      registry.update(local, setTarget(item, root));
    },
    { immediate: true },
  );
  return () => {
    stop();
    release();
  };
}

/** The annotation example a row of the note root's `annotations` names. */
function annotationOfNode(
  view: TemplateWorkbenchView,
  node: DisplayNode,
): string | null {
  const { root } = view.registry.get(view.fields.state);
  if (
    root !== "note" ||
    node.path.length !== 2 ||
    node.path[0] !== "annotations" ||
    typeof node.path[1] !== "number" ||
    node.kind !== "value" ||
    !node.value ||
    typeof node.value !== "object" ||
    !("key" in node.value)
  )
    return null;
  const { key } = node.value;
  return (
    view.registry
      .get(view.model.examples)
      .current.find((example) => example.root.key === key)?.id ?? null
  );
}

/** The Explorer's tree in the leaf's left panel. */
export function FieldsPanel({ view }: { view: TemplateWorkbenchView }) {
  const { registry, fields, model } = view;
  const host = useWorkbenchHost();
  // The insertion target is the caret the editor last held.
  useAtomValue(model.view);
  useAtomValue(view.workbench.document.revision);
  const canInsert = view.insertTarget !== null && !view.controller.readOnly;
  const moveTo = (root: TemplateRoot) => {
    const { item } = registry.get(fields.state);
    registry.update(fields.session, setTarget(item, root));
  };
  const chooseExample = (id: string) => {
    registry.update(model.picks, chooseAnnotation(id));
    moveTo("annotation");
  };
  const actions = createExplorerActions({
    onChooseItem: () => view.startItemChoice(),
    onBackToNoteRoot: () => moveTo("note"),
    onToggleSections: () => {
      const { root, data, collapsedSections } = registry.get(fields.state);
      const shown = visibleSectionIds(data, {
        m: host.messages,
        root,
        locale: host.getLocale(),
      });
      const collapsed =
        shown.length > 0 && shown.every((id) => collapsedSections.has(id));
      registry.update(
        fields.session,
        setCollapsedSections(
          collapsed ? new Set() : new Set<string>(explorerSectionIds(root)),
        ),
      );
    },
    onRefresh: () => view.refresh(),
    copyTarget: () => null,
    canExport: () => false,
    onExport: () => {},
  });
  return (
    <ExplorerModelContext value={fields}>
      <ExplorerActionsContext value={actions}>
        <Explorer
          placement="panel"
          onSelectAnnotation={chooseExample}
          onChooseAnnotation={() => view.startAnnotationChoice()}
          onSelectItem={(item) => view.pickItem(item)}
          onSearchItem={() => view.startItemChoice()}
          explorer={{
            copy: copyToClipboard,
            disabled: !canInsert,
            onInsertNode: (node) => view.insertTemplateField(node),
            canExploreAnnotation: (node) =>
              annotationOfNode(view, node) !== null,
            onExploreAnnotation: (node) => {
              const id = annotationOfNode(view, node);
              if (id) chooseExample(id);
            },
          }}
        />
      </ExplorerActionsContext>
    </ExplorerModelContext>
  );
}
