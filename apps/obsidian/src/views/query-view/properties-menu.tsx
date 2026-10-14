// The Properties popover of the Query View toolbar: tick the properties the
// view shows, drag them into order, or type a Projection Path to add one. The
// order saves to the view's `order` key. A Formula of the file shows as the
// property `formula.<name>`; "Add formula" and its row's edit button open the
// Formula dialog. Each row shows its property's Display Name, and its rename
// button opens the dialog that sets it.
import { useMemo, useState } from "react";
import { useStore } from "zustand";

import { Chooser, useChooserQuery } from "@/components/chooser";
import type { ChooserGroup, ChooserRow } from "@/components/chooser-logic";
import { Icon } from "@/components/obsidian/icon";
import { useObsidianApp } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";

import { DisplayNameModal } from "./display-name-dialog";
import { FormulaModal } from "./formula-dialog";
import { NotUsed } from "./sort-control";
import { TOOLBAR_LABEL } from "./toolbar-popover";
import type { QueryView } from "./view";
import { useViewProperties } from "./view-properties";
import type { PropertyEntry } from "./view-properties";

const trigger =
  "clickable-icon zt:inline-flex zt:min-w-0 zt:items-center zt:gap-1 zt:rounded-(--clickable-icon-radius) zt:px-1.5 zt:py-1 zt:text-muted-foreground zt:hover:bg-muted zt:hover:text-foreground zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus zt:focus-visible:outline-none zt:data-open:bg-muted zt:data-open:text-foreground";

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
  if (!current || !properties) return null;
  const order = current.order ?? [];
  const setOrder = (next: readonly string[]) =>
    view.document.editView({ order: next });
  return (
    <Chooser value={order} onValueChange={setOrder}>
      <Chooser.Trigger
        className={trigger}
        aria-label={m.query_view_properties()}
        data-query-properties=""
      >
        <Icon name="list" />
        <span className={TOOLBAR_LABEL}>{m.query_view_properties()}</span>
      </Chooser.Trigger>
      <Chooser.Popup className="zt:min-w-60" data-query-properties-popup="">
        <Chooser.Input
          placeholder={m.query_view_properties_search()}
          clearLabel={m.query_view_clear_search()}
        />
        <PropertyList
          entries={properties.entries}
          order={order}
          setOrder={setOrder}
          formulas={Object.keys(formulas ?? {})}
          openFormula={(name) => new FormulaModal(app, view, name).open()}
          rename={(property) =>
            new DisplayNameModal(app, view, property).open()
          }
        />
      </Chooser.Popup>
    </Chooser>
  );
}

function PropertyList({
  entries,
  order,
  setOrder,
  formulas,
  openFormula,
  rename,
}: {
  /** The Properties of the view, the visible ones first. */
  entries: readonly PropertyEntry[];
  order: readonly string[];
  setOrder: (next: readonly string[]) => void;
  /** The names of the file's Formulas. */
  formulas: readonly string[];
  /** Open the Formula dialog: `null` adds one. */
  openFormula: (name: string | null) => void;
  /** Open the dialog that renames a property. */
  rename: (property: string) => void;
}) {
  const query = useChooserQuery().trim();
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
    const actions: ChooserRow[] = [
      {
        value: "zt:add-formula",
        label: m.query_view_formula_add(),
        action: (close) => {
          close();
          openFormula(null);
        },
      },
    ];
    if (query !== "" && !byPath.has(query))
      actions.push({
        value: "zt:add-property",
        label: m.query_view_properties_add({ name: query }),
        action: () => setOrder([...order, query]),
      });
    if (order.length > 0)
      actions.push({
        value: "zt:hide-all",
        label: m.query_view_properties_hide_all(),
        action: () => setOrder([]),
      });
    return [{ items: rows }, { items: actions }];
  }, [entries, byPath, order, query, setOrder, openFormula]);

  return (
    <Chooser.List
      groups={groups}
      aria-label={m.query_view_properties()}
      emptyLabel={m.query_view_properties_empty()}
    >
      {(row) => {
        const entry = byPath.get(row.value);
        return row.action || !entry ? (
          <Chooser.Action
            key={row.value}
            value={row.value}
            icon={
              row.value === "zt:hide-all"
                ? "eye-off"
                : row.value === "zt:add-formula"
                  ? "function-square"
                  : "plus"
            }
          >
            {row.label}
          </Chooser.Action>
        ) : (
          <Chooser.Item
            key={row.value}
            value={row.value}
            data-query-property={row.value}
            draggable={order.includes(row.value)}
            className={cn(dragging === row.value && "zt:opacity-50")}
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
          >
            <span className="zt:inline-flex zt:max-w-full zt:items-center zt:gap-1 zt:align-middle">
              <PropertyName entry={entry} />
              <RowButton
                icon="text-cursor-input"
                tooltip={m.query_view_property_rename()}
                data-query-property-rename={row.value}
                onClick={() => rename(row.value)}
              />
              <FormulaRowParts
                entry={entry}
                formulas={formulas}
                openFormula={openFormula}
              />
            </span>
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

/** A Formula row's mark of a mistake, and its button that edits the Formula. */
function FormulaRowParts({
  entry: { formula: name, issue },
  formulas,
  openFormula,
}: {
  entry: PropertyEntry;
  formulas: readonly string[];
  openFormula: (name: string | null) => void;
}) {
  if (name === null || !formulas.includes(name)) return null;
  return (
    <>
      {issue !== null && (
        <span
          className="zt:inline-flex zt:text-(--text-error)"
          data-query-formula-issue={issue}
          {...tooltipAttrs(issue)}
        >
          <Icon name="alert-triangle" size={14} />
        </span>
      )}
      <RowButton
        icon="pencil"
        tooltip={m.query_view_formula_edit()}
        data-query-formula-edit={name}
        onClick={() => openFormula(name)}
      />
    </>
  );
}

/**
 * A row's property: the name the Table header shows (its Display Name, else
 * its field label) before its path, else its path alone.
 */
function PropertyName({ entry: { path, label } }: { entry: PropertyEntry }) {
  if (label === path) return <>{path}</>;
  return (
    <>
      <span data-query-property-name="">{label}</span>
      <span className="zt:text-(--text-faint)">{path}</span>
    </>
  );
}

/** A button at the end of a row, which closes the popover before it acts. */
function RowButton({
  icon,
  tooltip,
  onClick,
  ...data
}: {
  icon: string;
  tooltip: string;
  onClick: () => void;
} & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      className="clickable-icon zt:p-0.5"
      {...data}
      {...tooltipAttrs(tooltip)}
      onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
        onClick();
      }}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}
