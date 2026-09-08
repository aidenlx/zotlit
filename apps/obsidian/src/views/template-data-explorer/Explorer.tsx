// Presentational root for the Template Data Explorer: db-not-ready, no-item, and tree states.
import { useContext } from "react";

import { DataExplorer } from "@zotlit/workbench/ui";
import type { DataExplorerProps } from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { tooltipAttrs } from "@/lib/utils";

import { ExplorerActionsContext } from "./actions";
import { useExplorerStore } from "./store";

export function Explorer({
  explorer,
}: {
  explorer: Omit<DataExplorerProps, "data" | "root">;
}): React.ReactElement {
  const dbReady = useExplorerStore((s) => s.dbReady);
  const itemLabel = useExplorerStore((s) => s.itemLabel);
  const anchor = useExplorerStore((s) => s.anchor);
  const data = useExplorerStore((s) => s.data);
  const itemVanished = useExplorerStore((s) => s.itemVanished);
  const actions = useContext(ExplorerActionsContext);

  return (
    <div className="zt:flex zt:h-full zt:flex-col zt:overflow-hidden">
      {!dbReady ? (
        <div className="pane-empty zt:p-2">
          {m.template_data_explorer_loading_db()}
        </div>
      ) : itemVanished ? (
        <div className="pane-empty zt:flex zt:flex-col zt:items-center zt:gap-3 zt:p-4 zt:text-center">
          <p className="zt:text-muted-foreground">
            {m.template_data_explorer_item_vanished()}
          </p>
          <button className="mod-cta" onClick={() => actions.onChooseItem()}>
            {m.template_data_explorer_choose_item()}
          </button>
        </div>
      ) : data === null ? (
        <div className="pane-empty zt:flex zt:flex-col zt:items-center zt:gap-3 zt:p-4 zt:text-center">
          <p className="zt:text-muted-foreground">
            {m.template_data_explorer_empty_hint()}
          </p>
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
            data={data}
            root={anchor ? "annotation" : "note"}
          />
        </>
      )}
    </div>
  );
}
