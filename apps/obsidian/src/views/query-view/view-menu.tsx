// The view menu of a Query View's toolbar: a search field over the file's
// views, a row per view to switch to it, drag to reorder, and the rows that
// add a view and configure the one on screen. A right-click on a view row
// offers the per-view actions that "Configure view" also has.
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

import { addViewActions, openConfigureView } from "./configure-view";
import type { QueryView } from "./view";

/** The drag payload of a view row: its place in the file's list. */
const VIEW_ROW_DRAG_TYPE = "application/x-zotlit-query-view";

const ADD_ROW = "action:add";
const CONFIGURE_ROW = "action:configure";

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
        })),
      },
      {
        items: [
          {
            value: ADD_ROW,
            label: m.query_view_add_view(),
            action: (close) => {
              close();
              view.addView();
              const added = view.state.getState();
              if (added.file && added.view)
                openConfigureView(app, view, {
                  name: added.view.name,
                  focusName: true,
                });
            },
          },
          ...(current
            ? [
                {
                  value: CONFIGURE_ROW,
                  label: m.query_view_configure_view(),
                  action: (close: () => void) => {
                    close();
                    openConfigureView(app, view, { name: current.name });
                  },
                },
              ]
            : []),
        ],
      },
    ],
    [views, current, view, app],
  );

  if (!file || views.length === 0) return null;
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
        className="clickable-icon zt:flex zt:items-center zt:gap-1 zt:font-semibold zt:data-open:bg-muted"
        aria-label={m.query_view_views()}
        data-query-view-menu=""
        // A right-click configures the view on screen, as in Bases.
        onContextMenu={(event) => {
          if (!current) return;
          event.preventDefault();
          openConfigureView(app, view, { name: current.name });
        }}
      >
        <span>{current?.name ?? views[0]!.name}</span>
        <Icon name="chevrons-up-down" size={14} />
      </Chooser.Trigger>
      <Chooser.Popup ref={popup} data-query-view-list="">
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
                  icon={row.value === ADD_ROW ? "plus" : "settings-2"}
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
                  view.moveView(Number(from), index);
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
