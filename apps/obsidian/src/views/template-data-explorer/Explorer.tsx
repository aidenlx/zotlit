// Presentational root for the Template Data Explorer: db-not-ready, no-item, and tree states.
import { useContext } from "react";

import {
  DataExplorer,
  useWorkbenchHost,
  visibleSectionIds,
} from "@zotlit/workbench/ui";
import type {
  DataExplorerProps,
  WorkbenchItemChoice,
} from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";
import type { ItemLookup } from "@/services/item-lookup/service";
import {
  ItemSelectionList,
  AnnotationSelectionList,
  selectionName,
} from "@/views/template-workbench/selection";
import {
  templateWorkbenchButton,
  selectionBar,
  selectionControl,
  selectionHint,
} from "@/views/template-workbench/theme";

import { ExplorerActionsContext } from "./actions";
import { useExplorerStore, useExplorerStoreApi } from "./store";

const sidebarBar = selectionBar({ placement: "sidebar" });

export function Explorer({
  explorer,
  onSelectAnnotation,
  onChooseAnnotation,
  onSelectItem,
  onSearchItem,
  lookup,
}: {
  onSelectAnnotation: (id: string) => void;
  onChooseAnnotation: () => void;
  onSelectItem: (item: WorkbenchItemChoice) => void;
  onSearchItem: () => void;
  lookup: Pick<ItemLookup, "search">;
  explorer: Omit<
    DataExplorerProps,
    | "data"
    | "root"
    | "collapsedSections"
    | "navigation"
    | "onCollapsedSectionsChange"
    | "onNavigationChange"
  >;
}): React.ReactElement {
  const store = useExplorerStoreApi();
  const state = useExplorerStore((s) => s);
  const { root, status, error, data, context, navigation, collapsedSections } =
    state;
  const host = useWorkbenchHost();
  const shownSections = visibleSectionIds(data, {
    m: host.messages,
    root,
    locale: host.getLocale(),
  });
  const allCollapsed =
    shownSections.length > 0 &&
    shownSections.every((id) => collapsedSections.has(id));
  const showAnnotationSelector = root === "annotation";
  const anchor =
    root === "annotation"
      ? { label: m.workbench_fields_root_annotation() }
      : null;
  const actions = useContext(ExplorerActionsContext);
  const name = selectionName({
    item: state.item && {
      ...state.item,
      title:
        (root === "note" && typeof data?.title === "string"
          ? data.title
          : state.item.title) ?? null,
    },
    annotation:
      root === "annotation" && data && state.annotationId
        ? { id: state.annotationId, root: data }
        : null,
    annotationMode: root === "annotation",
  });

  return (
    <div className="zt:flex zt:h-full zt:flex-col zt:overflow-auto">
      {status === "loading" && !showAnnotationSelector ? (
        <p role="status" className={cn(selectionHint, "zt:p-3")}>
          {m.workbench_loading_item()}
        </p>
      ) : status === "error" && !showAnnotationSelector ? (
        <div
          role="alert"
          className="pane-empty zt:flex zt:min-w-0 zt:flex-col zt:items-start zt:gap-1.5 zt:p-3"
        >
          <p className={selectionHint}>
            {error ?? m.workbench_example_missing_item()}
          </p>
          <div className="zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-2">
            <button
              className={templateWorkbenchButton}
              onClick={() => actions.onRefresh()}
            >
              {m.workbench_example_retry()}
            </button>
            <button
              className={templateWorkbenchButton}
              onClick={() => actions.onChooseItem()}
            >
              {m.template_data_explorer_choose_item()}
            </button>
          </div>
        </div>
      ) : status === "no-item" ? (
        root === "annotation" ? (
          <AnnotationSelectionList
            current={state.annotations ?? []}
            onSelect={onSelectAnnotation}
            onSearch={onChooseAnnotation}
          />
        ) : (
          <ItemSelectionList
            lookup={lookup}
            onSelect={onSelectItem}
            onSearch={onSearchItem}
          />
        )
      ) : (
        <>
          <div
            className={
              anchor
                ? "zt:flex zt:shrink-0 zt:flex-col zt:gap-3 zt:border-b zt:border-border zt:px-3 zt:py-2"
                : "zt-workbench-sidebar-control zt:shrink-0 zt:justify-end zt:px-3 zt:py-2"
            }
          >
            <div className={sidebarBar.row({ className: "zt:flex-1" })}>
              {name && <p className={sidebarBar.caption()}>{name}</p>}
              <button
                className={sidebarBar.trigger()}
                aria-label={
                  root === "annotation"
                    ? m.workbench_choose_annotation()
                    : m.workbench_choose_item()
                }
                onClick={
                  root === "annotation"
                    ? onChooseAnnotation
                    : () => actions.onChooseItem()
                }
              >
                <Icon name="search" />
                <span>
                  {root === "annotation"
                    ? m.workbench_choose_annotation()
                    : m.workbench_choose_item()}
                </span>
              </button>
              <IconButton
                icon={allCollapsed ? "chevrons-up-down" : "chevrons-down-up"}
                className={selectionControl({ kind: "icon" })}
                onClick={() => actions.onToggleSections()}
                {...tooltipAttrs(
                  allCollapsed
                    ? m.workbench_explorer_expand_all()
                    : m.workbench_explorer_collapse_all(),
                )}
              />
            </div>
            {anchor && (
              <div className="zt:flex zt:min-w-0 zt:flex-col zt:gap-1.5">
                <nav className="zt:flex zt:min-w-0 zt:items-center zt:gap-1.5">
                  <IconButton
                    icon="corner-left-up"
                    className="zt:shrink-0"
                    onClick={() => actions.onBackToNoteRoot()}
                    {...tooltipAttrs(
                      m.template_data_explorer_back_to_note_root(),
                    )}
                  />
                  <div className="zt:flex zt:min-w-0 zt:items-center zt:gap-1 zt:text-xs">
                    <span className="zt:shrink-0 zt:text-muted-foreground">
                      {m.template_data_explorer_note_root()}
                    </span>
                    <Icon
                      name="chevron-right"
                      className="zt:size-3 zt:shrink-0 zt:text-faint"
                    />
                    <span
                      className="zt:min-w-0 zt:truncate zt:font-medium zt:text-accent-foreground"
                      {...tooltipAttrs(anchor.label)}
                    >
                      {anchor.label}
                    </span>
                  </div>
                </nav>
              </div>
            )}
          </div>
          {status === "loading" ? (
            <p role="status" className={cn(selectionHint, "zt:p-3")}>
              {m.workbench_loading_item()}
            </p>
          ) : status === "error" ? (
            <div
              role="alert"
              className="pane-empty zt:flex zt:min-w-0 zt:flex-col zt:items-start zt:gap-1.5 zt:p-3"
            >
              <p className={selectionHint}>
                {error ?? m.workbench_example_missing_item()}
              </p>
              <button
                className={templateWorkbenchButton}
                onClick={() => actions.onRefresh()}
              >
                {m.workbench_example_retry()}
              </button>
            </div>
          ) : (
            <DataExplorer
              {...explorer}
              restore={state.restore}
              onRestored={() => store.setState({ restore: null })}
              onPresentationChange={(presentation) =>
                store.setState({ presentation })
              }
              data={data}
              root={root}
              disabled={!context?.canInsertField}
              navigation={navigation}
              collapsedSections={collapsedSections}
              onCollapsedSectionsChange={state.setCollapsedSections}
              onNavigationChange={state.setNavigation}
            />
          )}
        </>
      )}
    </div>
  );
}
