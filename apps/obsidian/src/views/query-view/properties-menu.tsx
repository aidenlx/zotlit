// The Properties popover of the Query View toolbar: tick the properties the
// view shows, drag them into order, or type a Projection Path to add one. The
// order saves to the view's `order` key.
import { useMemo, useState } from "react";
import { useStore } from "zustand";

import { Chooser, useChooserQuery } from "@/components/chooser";
import type { ChooserGroup, ChooserRow } from "@/components/chooser-logic";
import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";

import type { QueryFileDataset } from "./query-file";
import { TOOLBAR_LABEL } from "./toolbar-popover";
import type { QueryView } from "./view";
import { datasetProperties, propertyChoices } from "./visible-properties";

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
  if (!current) return null;
  const order = current.order ?? [];
  const setOrder = (next: readonly string[]) => view.editView({ order: next });
  return (
    <Chooser value={order} onValueChange={setOrder}>
      <Chooser.Trigger
        className={trigger}
        aria-label={m.settings_profile_properties_name()}
        data-query-properties=""
      >
        <Icon name="list" />
        <span className={TOOLBAR_LABEL}>
          {m.settings_profile_properties_name()}
        </span>
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
        />
      </Chooser.Popup>
    </Chooser>
  );
}

function PropertyList({
  dataset,
  order,
  setOrder,
}: {
  dataset: QueryFileDataset;
  order: readonly string[];
  setOrder: (next: readonly string[]) => void;
}) {
  const query = useChooserQuery().trim();
  const [dragging, setDragging] = useState<string | null>(null);
  const groups = useMemo<ChooserGroup<ChooserRow>[]>(() => {
    const properties = datasetProperties(dataset);
    const rows = propertyChoices(properties, order, query).map(
      (property): ChooserRow => ({ value: property, label: property }),
    );
    const actions: ChooserRow[] = [];
    if (query !== "" && !properties.includes(query) && !order.includes(query))
      actions.push({
        value: "zt:add-property",
        label: m.query_view_properties_add({ name: query }),
        action: () => setOrder([...order, query]),
      });
    if (order.length > 0)
      actions.push({
        value: "zt:hide-all",
        label: m.query_view_group_hide_all(),
        action: () => setOrder([]),
      });
    return actions.length > 0
      ? [{ items: rows }, { items: actions }]
      : [{ items: rows }];
  }, [dataset, order, query, setOrder]);

  return (
    <Chooser.List
      groups={groups}
      aria-label={m.settings_profile_properties_name()}
    >
      {(row) =>
        row.action ? (
          <Chooser.Action
            key={row.value}
            value={row.value}
            icon={row.value === "zt:hide-all" ? "eye-off" : "plus"}
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
            {row.label}
          </Chooser.Item>
        )
      }
    </Chooser.List>
  );
}
