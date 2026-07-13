// Presentational root for the Template Data Explorer: db-not-ready, no-item, and tree states.
import { useContext } from "react";

import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import { SearchInput } from "@/components/obsidian/search-input";
import { tooltipAttrs } from "@/lib/utils";
import * as m from "@/paraglide/messages";

import { ExplorerActionsContext } from "./actions";
import { DisplayTree } from "./DisplayTree";
import { useExplorerStore } from "./store";

export function Explorer(): React.ReactElement {
  const dbReady = useExplorerStore((s) => s.dbReady);
  const itemLabel = useExplorerStore((s) => s.itemLabel);
  const nodes = useExplorerStore((s) => s.nodes);
  const anchor = useExplorerStore((s) => s.anchor);
  const filterQuery = useExplorerStore((s) => s.filterQuery);
  const matchedKeys = useExplorerStore((s) => s.matchedKeys);
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
      ) : nodes === null ? (
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
          <div className="zt:flex zt:shrink-0 zt:flex-col zt:gap-1.5 zt:border-b zt:border-border zt:bg-background zt:px-2 zt:py-2">
            <div className="zt:flex zt:items-center zt:gap-1">
              <Icon
                name="braces"
                className="zt:size-3.5 zt:shrink-0 zt:text-faint"
              />
              <span
                className="zt:min-w-0 zt:flex-1 zt:truncate zt:text-xs zt:font-medium zt:text-foreground"
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
            <SearchInput
              className="zt:w-full"
              value={filterQuery}
              onChange={(next) => actions.onFilter(next)}
              placeholder={m.template_data_explorer_filter_placeholder()}
            />
          </div>
          <div className="zt:min-h-0 zt:flex-1 zt:overflow-auto zt:py-1 zt:pr-2 zt:pl-1">
            <DisplayTree
              nodes={nodes}
              matchedKeys={matchedKeys}
              onToggle={(key) => actions.onToggle(key)}
              onCopyValue={(node) => actions.onCopyValue(node)}
              onTemplateMenu={(node, event) =>
                actions.onTemplateMenu(node, event)
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
