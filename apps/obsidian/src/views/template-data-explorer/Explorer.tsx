// Presentational root for the Template Data Explorer: db-not-ready, no-item, and tree states.
import { useContext } from "react";

import { DataExplorer } from "@zotlit/workbench/ui";
import type { DataExplorerProps } from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { tooltipAttrs } from "@/lib/utils";

import { ExplorerActionsContext } from "./actions";
import { useExplorerStore, useExplorerStoreApi } from "./store";

export function Explorer({
  explorer,
}: {
  explorer: Omit<
    DataExplorerProps,
    | "data"
    | "root"
    | "variant"
    | "navigation"
    | "onVariantChange"
    | "onNavigationChange"
  >;
}): React.ReactElement {
  const store = useExplorerStoreApi();
  const state = useExplorerStore((s) => s);
  const { item, root, status, error, data, context, navigation, variant } =
    state;
  const itemLabel = item?.title ?? item?.id;
  const anchor =
    root === "annotation"
      ? { label: m.workbench_fields_root_annotation() }
      : null;
  const actions = useContext(ExplorerActionsContext);

  return (
    <div className="zt:flex zt:h-full zt:flex-col zt:overflow-hidden">
      {status === "loading" ? (
        <p role="status" className="zt:p-3">
          {m.workbench_loading_item()}
        </p>
      ) : status === "error" ? (
        <div role="alert" className="pane-empty zt:p-3">
          <p>{error ?? m.workbench_example_missing_item()}</p>
          <button onClick={() => actions.onRefresh()}>
            {m.workbench_example_retry()}
          </button>
          <button onClick={() => actions.onChooseItem()}>
            {m.template_data_explorer_choose_item()}
          </button>
        </div>
      ) : status === "no-item" ? (
        <div className="pane-empty zt:flex zt:flex-col zt:items-center zt:gap-3 zt:p-4 zt:text-center">
          <p>{m.template_data_explorer_empty_hint()}</p>
          <button className="mod-cta" onClick={() => actions.onChooseItem()}>
            {m.template_data_explorer_choose_item()}
          </button>
        </div>
      ) : (
        <>
          <div className="zt:flex zt:shrink-0 zt:flex-col zt:gap-1.5 zt:border-b zt:border-border zt:bg-background zt:px-3 zt:py-2">
            <div className="zt:flex zt:items-center zt:gap-1">
              <Icon
                name="file-text"
                className="zt:size-3.5 zt:shrink-0 zt:text-faint"
              />
              <span
                className="zt:line-clamp-2 zt:min-w-0 zt:flex-1 zt:text-sm zt:leading-normal zt:text-foreground"
                {...(itemLabel ? tooltipAttrs(itemLabel) : {})}
              >
                {itemLabel}
              </span>
              <IconButton
                icon="arrow-left-right"
                onClick={() => actions.onChooseItem()}
                {...tooltipAttrs(m.template_data_explorer_choose_item())}
              />
              <IconButton
                icon="refresh-ccw"
                onClick={() => actions.onRefresh()}
                {...tooltipAttrs(m.template_data_explorer_refresh_tooltip())}
              />
            </div>
            {anchor && (
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
            )}
          </div>
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
            variant={variant}
            onVariantChange={state.setVariant}
            onNavigationChange={state.setNavigation}
          />
        </>
      )}
    </div>
  );
}
