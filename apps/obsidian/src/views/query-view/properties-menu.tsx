// The Properties popover of the Query View toolbar: tick the properties the
// view shows, drag them into order, or type a Projection Path to add one. The
// order saves to the view's `order` key. A Formula of the file shows as the
// property `formula.<name>`. It is laid out as the Bases Properties menu: a
// search field, a row per property — checkbox, type icon, name, chevron — and
// "Add formula" and "Hide all" pinned under the list. The chevron, or the
// right arrow key on the highlighted row, opens the property's actions: the
// dialog that sets its Display Name and, for a Formula, the Formula dialog.
// Alt with an up or down arrow moves the highlighted property in the order.
import { Menu } from "obsidian";
import type { IconName } from "obsidian";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useStore } from "zustand";

import {
  Chooser,
  useChooserQuery,
  useChooserScope,
} from "@/components/chooser";
import type { ChooserGroup, ChooserRow } from "@/components/chooser-logic";
import { Icon } from "@/components/obsidian/icon";
import { useObsidianApp } from "@/lib/app-context";
import { registerKeymap } from "@/lib/disposables";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";

import { DisplayNameModal } from "./display-name-dialog";
import { FormulaModal } from "./formula-dialog";
import { propertyIcon } from "./property-icon";
import { NotUsed } from "./sort-control";
import { ToolbarButtonContent, toolbarButtonClass } from "./toolbar-button";
import { popoverFallbacks } from "./toolbar-popover";
import type { QueryView } from "./view";
import { useViewProperties } from "./view-properties";
import type { PropertyEntry } from "./view-properties";

/** `order` with `moved` placed where `target` stands. */
function reordered(
  order: readonly string[],
  moved: string,
  target: string,
): string[] {
  const next = order.filter((property) => property !== moved);
  const at = next.indexOf(target);
  if (at < 0) return [...order];
  // Dropped on a property below its old place, it goes after that property.
  const after = order.indexOf(moved) < order.indexOf(target);
  next.splice(after ? at + 1 : at, 0, moved);
  return next;
}

export function PropertiesMenu({ view }: { view: QueryView }) {
  const current = useStore(view.state, (s) => s.view);
  const formulas = useStore(view.state, (s) => s.file?.formulas);
  const properties = useViewProperties(view);
  const app = useObsidianApp();
  const popup = useRef<HTMLDivElement>(null);
  if (!current || !properties) return null;
  const order = current.order ?? [];
  const setOrder = (next: readonly string[]) =>
    view.document.editView({ order: next });
  const dataset = current.from ?? "annotations";
  const formulaNames = Object.keys(formulas ?? {});

  /**
   * The actions of a property, as the submenu a Bases row's chevron opens.
   * An Obsidian menu stands under the popover's top layer, so the popover
   * steps aside while the menu stands, and comes back when the menu closes
   * with no action run.
   */
  const openActions = (entry: PropertyEntry, row: HTMLElement) => {
    const box = row.getBoundingClientRect();
    const doc = row.doc;
    let ran = false;
    const run = (act: () => void) => () => {
      ran = true;
      act();
    };
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(m.query_view_property_rename())
        .setIcon("text-cursor-input")
        .onClick(run(() => new DisplayNameModal(app, view, entry.path).open())),
    );
    const formula = entry.formula;
    if (formula !== null && formulaNames.includes(formula))
      menu.addItem((item) =>
        item
          .setTitle(m.query_view_formula_edit())
          .setIcon("pencil")
          .onClick(run(() => new FormulaModal(app, view, formula).open())),
      );
    menu.onHide(() => {
      if (!ran) popup.current?.showPopover();
    });
    popup.current?.hidePopover();
    menu.showAtPosition({ x: box.right, y: box.top }, doc);
  };

  return (
    <Chooser value={order} onValueChange={setOrder}>
      <Chooser.Trigger
        className={toolbarButtonClass}
        aria-label={m.query_view_properties()}
        data-query-properties=""
      >
        <ToolbarButtonContent icon="list" label={m.query_view_properties()} />
      </Chooser.Trigger>
      <Chooser.Popup
        ref={popup}
        className={cn(
          "zt:[max-height:min(--spacing(120),calc(100%_-_--spacing(2)))] zt:min-w-60",
          popoverFallbacks,
        )}
        data-query-properties-popup=""
      >
        <Chooser.Input
          placeholder={m.query_view_properties_search()}
          clearLabel={m.query_view_clear_search()}
        />
        <PropertyList
          entries={properties.entries}
          order={order}
          setOrder={setOrder}
          iconOf={(entry) => propertyIcon(dataset, entry)}
          openFormula={() => new FormulaModal(app, view, null).open()}
          openActions={openActions}
          list={popup}
        />
      </Chooser.Popup>
    </Chooser>
  );
}

function PropertyList({
  entries,
  order,
  setOrder,
  iconOf,
  openFormula,
  openActions,
  list,
}: {
  /** The Properties of the view, the visible ones first. */
  entries: readonly PropertyEntry[];
  order: readonly string[];
  setOrder: (next: readonly string[]) => void;
  /** The type icon of a property. */
  iconOf: (entry: PropertyEntry) => string;
  /** Open the Formula dialog to add a Formula. */
  openFormula: () => void;
  /** Open the actions of a property, beside its row. */
  openActions: (entry: PropertyEntry, row: HTMLElement) => void;
  /** The popup the rows stand in. */
  list: RefObject<HTMLDivElement | null>;
}) {
  const query = useChooserQuery().trim();
  const { scope, activeValue } = useChooserScope();
  const [dragging, setDragging] = useState<string | null>(null);
  const byPath = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry])),
    [entries],
  );
  const groups = useMemo<ChooserGroup<ChooserRow>[]>(() => {
    // The properties of the parent records come only while the user searches.
    const rows = entries
      .filter(
        (entry) =>
          entry.place !== null ||
          entry.formula !== null ||
          query !== "" ||
          !entry.path.includes("."),
      )
      .map(propertyRow);
    const actions: ChooserRow[] = [];
    if (query !== "" && !byPath.has(query))
      actions.push({
        value: "zt:add-property",
        label: m.query_view_properties_add({ name: query }),
        action: () => setOrder([...order, query]),
      });
    actions.push(
      {
        value: "zt:add-formula",
        label: m.query_view_formula_add(),
        action: (close) => {
          close();
          openFormula();
        },
      },
      {
        value: "zt:hide-all",
        label: m.query_view_properties_hide_all(),
        action: () => setOrder([]),
      },
    );
    return [{ items: rows }, { items: actions, pinned: true }];
  }, [entries, byPath, order, query, setOrder, openFormula]);

  // The keys of a Bases Properties menu: the right arrow opens the
  // highlighted property's actions, and Alt with an up or down arrow moves a
  // visible property one place in the order.
  const keys = useRef({ order, setOrder, byPath, openActions, list });
  keys.current = { order, setOrder, byPath, openActions, list };
  useLayoutEffect(() => {
    const rowOf = (path: string) =>
      keys.current.list.current?.querySelector<HTMLElement>(
        `[data-query-property="${CSS.escape(path)}"]`,
      ) ?? null;
    const move = (step: number) => (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const path = activeValue();
      const { order: now, setOrder: save } = keys.current;
      const at = path === null ? -1 : now.indexOf(path);
      if (at < 0) return false;
      const to = Math.min(Math.max(at + step, 0), now.length - 1);
      if (to !== at) {
        const next = [...now];
        next.splice(to, 0, ...next.splice(at, 1));
        save(next);
      }
      return false;
    };
    const stack = new DisposableStack();
    stack.use(
      registerKeymap(scope, [], "ArrowRight", (event) => {
        if (event.isComposing) return;
        const path = activeValue();
        const entry = path === null ? undefined : keys.current.byPath.get(path);
        const row = path === null ? null : rowOf(path);
        // Elsewhere the key moves the caret in the search field.
        if (!entry || !row) return;
        keys.current.openActions(entry, row);
        return false;
      }),
    );
    stack.use(registerKeymap(scope, ["Alt"], "ArrowUp", move(-1)));
    stack.use(registerKeymap(scope, ["Alt"], "ArrowDown", move(1)));
    return () => stack.dispose();
  }, [scope, activeValue]);

  return (
    <Chooser.List
      groups={groups}
      aria-label={m.query_view_properties()}
      emptyLabel={m.query_view_properties_empty()}
    >
      {(row) => {
        const entry = byPath.get(row.value);
        if (row.action || !entry)
          return (
            <Chooser.Action
              key={row.value}
              value={row.value}
              className={rowSpacing}
              data-query-properties-action={row.value.slice("zt:".length)}
              leading={
                <RowIcon
                  className="zt:text-(--icon-color)"
                  name={
                    row.value === "zt:hide-all"
                      ? "eye-off"
                      : row.value === "zt:add-formula"
                        ? "square-function"
                        : "plus"
                  }
                />
              }
            >
              {row.label}
            </Chooser.Action>
          );
        const shown = order.includes(row.value);
        return (
          <Chooser.Item
            key={row.value}
            value={row.value}
            data-query-property={row.value}
            data-hidden={shown ? undefined : ""}
            draggable={shown}
            className={cn(
              rowSpacing,
              "zt:data-hidden:text-(--text-faint) zt:data-hidden:[--icon-color:var(--text-faint)]",
              dragging === row.value && "zt:opacity-50",
            )}
            onDragStart={(event) => {
              setDragging(row.value);
              event.dataTransfer?.setData("text/plain", row.value);
              if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (dragging !== null && order.includes(row.value))
                event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging !== null && dragging !== row.value)
                setOrder(reordered(order, dragging, row.value));
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
            leading={
              <>
                {/* The row's `aria-selected` reports the tick, and a click
                    anywhere on the row ticks it: the box neither takes focus
                    from the search field nor ticks a second time. */}
                <input
                  type="checkbox"
                  checked={shown}
                  readOnly
                  tabIndex={-1}
                  aria-hidden
                  className="zt:m-0 zt:shrink-0"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => event.preventDefault()}
                />
                <TypeIcon entry={entry} icon={iconOf(entry)} grab={shown} />
              </>
            }
            trailing={
              <button
                type="button"
                tabIndex={-1}
                className="clickable-icon zt:-m-(--size-2-2) zt:shrink-0 zt:p-(--size-2-2)"
                data-query-property-more={row.value}
                {...tooltipAttrs(m.query_view_property_edit())}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  const at = event.currentTarget.closest<HTMLElement>(
                    "[data-query-property]",
                  );
                  if (at) openActions(entry, at);
                }}
              >
                <RowIcon name="chevron-right" />
              </button>
            }
          >
            <span data-query-property-name="">{entry.label}</span>
            {entry.place !== null && !entry.fits && (
              <span data-query-property-unused="">
                {" "}
                <NotUsed />
              </span>
            )}
          </Chooser.Item>
        );
      }}
    </Chooser.List>
  );
}

/** The padding and gap of a Bases menu row, from Obsidian's size variables. */
const rowSpacing = "zt:p-(--size-2-2) zt:ps-(--size-2-3) zt:gap-(--size-4-2)";

/** An icon of a row, at the size Obsidian draws a menu icon. */
function RowIcon({ name, className }: { name: IconName; className?: string }) {
  return (
    <Icon
      name={name}
      size="var(--icon-s)"
      strokeWidth="var(--icon-s-stroke-width)"
      className={cn("zt:shrink-0", className)}
    />
  );
}

/**
 * The type icon of a property's row. A Formula that ZotLit Query names as
 * wrong draws it in the error colour, the mistake as its tooltip, as Bases
 * marks a broken formula. A visible property is dragged by it.
 */
function TypeIcon({
  entry: { issue },
  icon,
  grab,
}: {
  entry: PropertyEntry;
  icon: IconName;
  grab: boolean;
}): ReactNode {
  return (
    <span
      className={cn(
        "zt:flex zt:shrink-0 zt:text-(--icon-color)",
        grab && "zt:cursor-grab zt:active:cursor-grabbing",
        issue !== null && "zt:text-(--text-error)",
      )}
      data-query-formula-issue={issue ?? undefined}
      {...(issue === null ? {} : tooltipAttrs(issue))}
    >
      <RowIcon name={icon} />
    </span>
  );
}

/**
 * The row of a Property in the popover. The search matches its label, so the
 * label holds the name the row shows (its Display Name, else its field
 * label) and its path.
 */
export function propertyRow({
  path,
  label,
}: Pick<PropertyEntry, "path" | "label">): ChooserRow {
  return { value: path, label: label === path ? path : `${label} ${path}` };
}
