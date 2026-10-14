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
import { formulaIssue, formulaProperty } from "./query-file";
import type { QueryFile, QueryFileDataset } from "./query-file";
import { NotUsed } from "./sort-control";
import { TOOLBAR_LABEL } from "./toolbar-popover";
import { propertyLabel } from "./value-text";
import type { QueryView } from "./view";
import {
  datasetProperties,
  fitsDataset,
  propertyChoices,
} from "./visible-properties";

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
  const file = useStore(view.state, (s) => s.file);
  const formulas = file?.formulas;
  const issues = useStore(view.state, (s) => s.formulaIssues);
  const app = useObsidianApp();
  if (!current) return null;
  const order = current.order ?? [];
  const setOrder = (next: readonly string[]) => view.editView({ order: next });
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
          dataset={current.from ?? "annotations"}
          order={order}
          setOrder={setOrder}
          formulas={Object.keys(formulas ?? {})}
          issues={issues}
          openFormula={(name) => new FormulaModal(app, view, name).open()}
          file={file}
          rename={(property) =>
            new DisplayNameModal(app, view, property).open()
          }
        />
      </Chooser.Popup>
    </Chooser>
  );
}

function PropertyList({
  dataset,
  order,
  setOrder,
  formulas,
  issues,
  openFormula,
  file,
  rename,
}: {
  dataset: QueryFileDataset;
  order: readonly string[];
  setOrder: (next: readonly string[]) => void;
  /** The names of the file's Formulas. */
  formulas: readonly string[];
  /** The Formulas the last run left out, with their messages. */
  issues: Readonly<Record<string, string>>;
  /** Open the Formula dialog: `null` adds one. */
  openFormula: (name: string | null) => void;
  /** The file whose Display Names the rows show. */
  file: QueryFile | null;
  /** Open the dialog that renames a property. */
  rename: (property: string) => void;
}) {
  const query = useChooserQuery().trim();
  const [dragging, setDragging] = useState<string | null>(null);
  const groups = useMemo<ChooserGroup<ChooserRow>[]>(() => {
    const properties = datasetProperties(dataset);
    const choices = propertyChoices(properties, order, query);
    // The Formulas the view does not show come after those it shows.
    const hidden = formulas
      .map(formulaProperty)
      .filter((property) => !order.includes(property));
    const rows = [
      ...choices.slice(0, order.length),
      ...hidden,
      ...choices.slice(order.length),
    ].map((property) => propertyRow(file, property));
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
    if (query !== "" && !properties.includes(query) && !order.includes(query))
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
  }, [dataset, order, query, setOrder, formulas, openFormula, file]);

  return (
    <Chooser.List
      groups={groups}
      aria-label={m.query_view_properties()}
      emptyLabel={m.query_view_properties_empty()}
    >
      {(row) =>
        row.action ? (
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
              <PropertyName file={file} property={row.value} />
              <RowButton
                icon="text-cursor-input"
                tooltip={m.query_view_property_rename()}
                data-query-property-rename={row.value}
                onClick={() => rename(row.value)}
              />
              <FormulaRowParts
                property={row.value}
                formulas={formulas}
                issues={issues}
                openFormula={openFormula}
              />
            </span>
            {order.includes(row.value) && !fitsDataset(row.value, dataset) && (
              <span data-query-property-unused="">
                {" "}
                <NotUsed />
              </span>
            )}
          </Chooser.Item>
        )
      }
    </Chooser.List>
  );
}

/**
 * The row of `property` in the popover. The search matches its label, so the
 * label holds the name the row shows (its Display Name, else its field
 * label) and its path.
 */
export function propertyRow(
  file: QueryFile | null,
  property: string,
): ChooserRow {
  const name = propertyLabel(file, property);
  return {
    value: property,
    label: name === property ? property : `${name} ${property}`,
  };
}

/** A Formula row's mark of a mistake, and its button that edits the Formula. */
function FormulaRowParts({
  property,
  formulas,
  issues,
  openFormula,
}: {
  property: string;
  formulas: readonly string[];
  issues: Readonly<Record<string, string>>;
  openFormula: (name: string | null) => void;
}) {
  const name = formulas.find((entry) => formulaProperty(entry) === property);
  if (name === undefined) return null;
  const issue = formulaIssue(issues, property);
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
function PropertyName({
  file,
  property,
}: {
  file: QueryFile | null;
  property: string;
}) {
  const name = propertyLabel(file, property);
  if (name === property) return <>{property}</>;
  return (
    <>
      <span data-query-property-name="">{name}</span>
      <span className="zt:text-(--text-faint)">{property}</span>
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
