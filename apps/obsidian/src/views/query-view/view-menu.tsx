// The view menu of a Query View's toolbar, as a Bases view menu is built: a
// search field over the file's views, a row per view (its layout icon, its
// name, and a chevron that configures it) to switch to it, drag to reorder,
// and the row that adds a view. The chevron, ArrowRight on a highlighted row
// and a right-click on a row open "Configure view" for that view as a page of
// the popover, as Bases does; a right-click on the button opens it for the
// view on screen.
//
// A host without views of its own (`displayOnly`, ADR 0071) gets the menu as
// a Layout switch: a row per Layout the host offers, and no view to add or
// configure. A host that offers one Layout, as the Library View, gets no menu
// at all (ADR 0075).
//
// It stands on the Chooser, the one popover that filters as the user types
// (ADR 0044).
//
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
// @see apps/obsidian/docs/adr/0075-the-papers-layout-is-a-query-view-layout-the-library-view-offers-with-the-table.md
import { useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import {
  Chooser,
  chooserIconButton,
  useChooserOpenPage,
  useChooserPage,
} from "@/components/chooser";
import type { ChooserGroup, ChooserRow } from "@/components/chooser-logic";
import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";

import { ConfigureViewFields, viewActions } from "./configure-view";
import { layoutOf, layoutsFor } from "./layouts";
import { ToolbarButtonContent, toolbarButtonClass } from "./toolbar-button";
import { popoverFallbacks } from "./toolbar-popover";
import type { QueryView } from "./view";

/** The drag payload of a view row: its place in the file's list. */
const VIEW_ROW_DRAG_TYPE = "application/x-zotlit-query-view";

const ADD_ROW = "action:add";

export function ViewMenu({ view }: { view: QueryView }) {
  return view.can.views ? (
    <ViewSwitch view={view} />
  ) : (
    <LayoutSwitch view={view} />
  );
}

function ViewSwitch({ view }: { view: QueryView }) {
  const file = useStore(view.state, (s) => s.file);
  const current = useStore(view.state, (s) => s.view);
  const popup = useRef<HTMLDivElement>(null);

  const views = useMemo(() => file?.views ?? [], [file]);
  const currentIndex = current ? views.indexOf(current) : -1;

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
      <ViewMenuTrigger view={view} />
      <Chooser.Popup
        ref={popup}
        // "Configure view" holds more than the list, as the Properties
        // popover does.
        className={cn(
          "zt:[max-height:min(--spacing(120),calc(100%_-_--spacing(2)))]",
          popoverFallbacks,
        )}
        data-query-view-list=""
      >
        <Chooser.Input
          placeholder={m.query_view_search_views()}
          clearLabel={m.query_view_clear_search()}
        />
        <ViewList view={view} />
        <Chooser.Page>
          {(name) => <ConfigureViewPage view={view} name={name} />}
        </Chooser.Page>
      </Chooser.Popup>
    </Chooser>
  );
}

/** The menu as a switch between the Layouts the host offers for the view on screen. */
function LayoutSwitch({ view }: { view: QueryView }) {
  const file = useStore(view.state, (s) => s.file);
  const current = useStore(view.state, (s) => s.view);
  const popup = useRef<HTMLDivElement>(null);
  const offered = view.layouts;
  const layouts = useMemo(
    () => (current ? layoutsFor(current, offered) : []),
    [current, offered],
  );
  const groups = useMemo<ChooserGroup<ChooserRow>[]>(
    () => [
      {
        items: layouts.map((layout) => ({
          value: layout.type,
          label: layout.name(),
        })),
      },
    ],
    [layouts],
  );
  // One Layout leaves nothing to switch to.
  if (!file || !current || layouts.length <= 1) return null;
  const index = file.views.indexOf(current);
  const shown = layoutOf(current);
  return (
    <Chooser
      value={[current.type]}
      onValueChange={(next) => {
        const picked = next.find((type) => type !== current.type);
        if (picked !== undefined) view.document.setViewLayout(index, picked);
        popup.current?.hidePopover();
      }}
    >
      <Chooser.Trigger
        className={cn(toolbarButtonClass, "zt:shrink zt:text-foreground")}
        aria-label={m.query_view_layout()}
        data-query-view-menu=""
      >
        <ToolbarButtonContent
          icon={shown?.icon}
          label={shown?.name() ?? current.type}
          keepLabel
          chevron
        />
      </Chooser.Trigger>
      <Chooser.Popup
        ref={popup}
        className={popoverFallbacks}
        data-query-view-list=""
      >
        <Chooser.List groups={groups} label={m.query_view_layout()}>
          {(row) => (
            <Chooser.Item
              key={row.value}
              value={row.value}
              icon={
                layoutsFor(current).find((layout) => layout.type === row.value)
                  ?.icon
              }
              className="zt:data-selected:[font-weight:var(--font-medium)]"
              data-query-view-layout-option={row.value}
            >
              {row.label}
            </Chooser.Item>
          )}
        </Chooser.List>
      </Chooser.Popup>
    </Chooser>
  );
}

function ViewMenuTrigger({ view }: { view: QueryView }) {
  const file = useStore(view.state, (s) => s.file);
  const current = useStore(view.state, (s) => s.view);
  const openPage = useChooserOpenPage();
  const shown = current ?? file?.views[0];
  if (!shown) return null;
  return (
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
        openPage(current.name);
      }}
    >
      <ToolbarButtonContent
        icon={layoutOf(shown)?.icon}
        label={shown.name}
        keepLabel
        chevron
      />
    </Chooser.Trigger>
  );
}

function ViewList({ view }: { view: QueryView }) {
  const file = useStore(view.state, (s) => s.file);
  const { openPage } = useChooserPage();
  const views = useMemo(() => file?.views ?? [], [file]);
  const groups = useMemo<ChooserGroup<ChooserRow>[]>(
    () => [
      {
        items: views.map((candidate, index) => ({
          value: String(index),
          label: candidate.name,
          next: () => openPage(candidate.name),
        })),
      },
      {
        // "Add view" stays in reach below a long list of views.
        pinned: true,
        items: [
          {
            value: ADD_ROW,
            label: m.query_view_add_view(),
            action: () => {
              view.document.addView();
              const added = view.state.getState();
              if (added.file && added.view) openPage(added.view.name);
            },
          },
        ],
      },
    ],
    [views, view, openPage],
  );

  return (
    <Chooser.List
      groups={groups}
      label={m.query_view_views()}
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
                className={cn(
                  chooserIconButton,
                  "zt:-m-(--size-2-2) zt:ms-auto",
                )}
                data-query-view-configure={row.label}
                {...tooltipAttrs(m.query_view_configure_view())}
                onClick={(event) => {
                  event.stopPropagation();
                  openPage(row.label);
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
            // A right-click configures the view, as the chevron does.
            onContextMenu={(event) => {
              event.preventDefault();
              openPage(row.label);
            }}
          >
            {row.label}
          </Chooser.Item>
        );
      }}
    </Chooser.List>
  );
}

/**
 * "Configure view" for one view, as a page of the view menu. Its menu sets
 * the view as the one the file opens on, duplicates it and deletes it.
 */
function ConfigureViewPage({ view, name }: { view: QueryView; name: string }) {
  const { back, replacePage } = useChooserPage();
  // The name the view holds now, which a rename on this page moves.
  const [current, setCurrent] = useState(name);
  // The menu reads the view's place in the file as it stands.
  const file = useStore(view.state, (s) => s.file);
  const index =
    file?.views.findIndex((candidate) => candidate.name === current) ?? -1;
  // A view that leaves the file leaves no page to show.
  if (file && index < 0) return <Chooser.PageGone />;
  return (
    <>
      <Chooser.PageHeader
        title={m.query_view_configure_view()}
        backLabel={m.query_view_back()}
        closeLabel={m.query_view_close()}
        actions={
          <Chooser.PageMenu
            label={m.query_view_more_options()}
            items={viewActions({
              view,
              index,
              after: { duplicated: replacePage, deleted: back },
            })}
          />
        }
      />
      <Chooser.PageForm data-query-configure-view={current}>
        <ConfigureViewFields
          view={view}
          name={current}
          onRenamed={setCurrent}
        />
      </Chooser.PageForm>
    </>
  );
}
