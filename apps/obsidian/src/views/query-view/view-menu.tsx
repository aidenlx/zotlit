// The view menu of a Query View's toolbar, as a Bases view menu is built: a
// search field over the file's views, a row per view (its layout icon, its
// name, and a chevron that configures it) to switch to it, drag to reorder,
// and the row that adds a view. ArrowRight on a highlighted row configures it
// as the chevron does. A right-click on a view row offers the per-view
// actions that "Configure view" also has.
//
// It stands on the Chooser, the one popover that filters as the user types
// (ADR 0044).
//
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
import { Menu } from "obsidian";
import { useMemo, useRef } from "react";
import { useStore } from "zustand";

import { Chooser } from "@/components/chooser";
import type { ChooserGroup, ChooserRow } from "@/components/chooser-logic";
import { Icon } from "@/components/obsidian/icon";
import { useObsidianApp } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";

import { addViewActions, openConfigureView } from "./configure-view";
import { layoutOf } from "./layouts";
import { ToolbarButtonContent, toolbarButtonClass } from "./toolbar-button";
import { popoverFallbacks } from "./toolbar-popover";
import type { QueryView } from "./view";

/** The drag payload of a view row: its place in the file's list. */
const VIEW_ROW_DRAG_TYPE = "application/x-zotlit-query-view";

const ADD_ROW = "action:add";

export function ViewMenu({ view }: { view: QueryView }) {
  const app = useObsidianApp();
  const file = useStore(view.state, (s) => s.file);
  const current = useStore(view.state, (s) => s.view);
  const popup = useRef<HTMLDivElement>(null);

  const views = useMemo(() => file?.views ?? [], [file]);
  const currentIndex = current ? views.indexOf(current) : -1;
  const groups = useMemo<ChooserGroup<ChooserRow>[]>(
    () => [
      {
        items: views.map((candidate, index) => ({
          value: String(index),
          label: candidate.name,
          next: (close: () => void) => {
            close();
            openConfigureView(app, view, { name: candidate.name });
          },
        })),
      },
      {
        items: [
          {
            value: ADD_ROW,
            label: m.query_view_add_view(),
            action: (close) => {
              close();
              view.document.addView();
              const added = view.state.getState();
              if (added.file && added.view)
                openConfigureView(app, view, {
                  name: added.view.name,
                  focusName: true,
                });
            },
          },
        ],
      },
    ],
    [views, view, app],
  );

  if (!file || views.length === 0) return null;
  const shown = current ?? views[0]!;
  return (
    <Chooser
      value={currentIndex === -1 ? [] : [String(currentIndex)]}
      onValueChange={(next) => {
        // A tick on another row adds it to the selection; a tick on the row
        // on screen takes it away, which leaves that view as it is.
        const picked = next.find((value) => value !== String(currentIndex));
        const name = picked === undefined ? undefined : views[Number(picked)];
        if (name) view.pickView(name.name);
        popup.current?.hidePopover();
      }}
    >
      <Chooser.Trigger
        // The switcher keeps its name on a narrow toolbar and gives way
        // first when the row runs out of room. It reads in the normal ink.
        className={cn(toolbarButtonClass, "zt:shrink zt:text-foreground")}
        aria-label={m.query_view_views()}
        data-query-view-menu=""
        // A right-click configures the view on screen, as in Bases.
        onContextMenu={(event) => {
          if (!current) return;
          event.preventDefault();
          openConfigureView(app, view, { name: current.name });
        }}
      >
        <ToolbarButtonContent
          icon={layoutOf(shown)?.icon}
          label={shown.name}
          keepLabel
          chevron
        />
      </Chooser.Trigger>
      <Chooser.Popup
        ref={popup}
        className={popoverFallbacks}
        data-query-view-list=""
      >
        <Chooser.Input
          placeholder={m.query_view_search_views()}
          clearLabel={m.query_view_clear_search()}
        />
        <Chooser.List
          groups={groups}
          aria-label={m.query_view_views()}
          emptyLabel={m.query_view_no_views_match()}
        >
          {(row) => {
            if (row.action)
              return (
                <Chooser.Action
                  key={row.value}
                  value={row.value}
                  icon="plus"
                  data-query-view-action={row.value.slice("action:".length)}
                >
                  {row.label}
                </Chooser.Action>
              );
            const index = Number(row.value);
            return (
              <Chooser.Item
                key={row.value}
                value={row.value}
                icon={layoutOf(views[index]!)?.icon ?? "table"}
                // The view on screen reads in the medium weight, as Bases
                // marks it, in place of a tick.
                className="zt:data-selected:[font-weight:var(--font-medium)]"
                end={
                  <button
                    type="button"
                    // The pointer's way in; ArrowRight is the keyboard's.
                    tabIndex={-1}
                    className="clickable-icon zt:-m-(--size-2-2) zt:ms-auto zt:shrink-0"
                    data-query-view-configure={row.label}
                    {...tooltipAttrs(m.query_view_configure_view())}
                    onClick={(event) => {
                      event.stopPropagation();
                      row.next?.(() => popup.current?.hidePopover());
                    }}
                  >
                    <Icon
                      name="chevron-right"
                      size="var(--icon-s)"
                      strokeWidth="var(--icon-s-stroke-width)"
                    />
                  </button>
                }
                data-query-view-row={row.label}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(VIEW_ROW_DRAG_TYPE, row.value);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes(VIEW_ROW_DRAG_TYPE))
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  const from = event.dataTransfer.getData(VIEW_ROW_DRAG_TYPE);
                  if (from === "") return;
                  event.preventDefault();
                  view.document.moveView(Number(from), index);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const menu = new Menu();
                  menu.addItem((item) =>
                    item
                      .setTitle(m.query_view_configure_view())
                      .setIcon("settings-2")
                      .onClick(() => {
                        popup.current?.hidePopover();
                        openConfigureView(app, view, { name: row.label });
                      }),
                  );
                  addViewActions(menu, { view, index });
                  menu.showAtMouseEvent(event.nativeEvent);
                }}
              >
                {row.label}
              </Chooser.Item>
            );
          }}
        </Chooser.List>
      </Chooser.Popup>
    </Chooser>
  );
}
