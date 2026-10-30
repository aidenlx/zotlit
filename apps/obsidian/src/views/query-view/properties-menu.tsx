// The Properties popover of the Query View toolbar: tick the properties the
// view shows, drag them into order, or type a Projection Path to add one. The
// order saves to the view's `order` key. A Formula of the file shows as the
// property `formula.<name>`. It is laid out as the Bases Properties menu: a
// search field, a row per property — checkbox, type icon, name, chevron — and
// "Add formula" and "Hide all" pinned under the list. The chevron, or the
// right arrow key on the highlighted row, opens the property's page in the
// popover: its Display Name and, for a Formula, its text. "Add formula" opens
// a page too. Alt with an up or down arrow moves the highlighted property in
// the order.
import type { IconName } from "obsidian";
import { useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  Chooser,
  chooserIconButton,
  useChooserPage,
  useChooserQuery,
  useChooserScope,
} from "@/components/chooser";
import type { ChooserGroup, ChooserRow } from "@/components/chooser-logic";
import { Icon } from "@/components/obsidian/icon";
import { registerKeymap } from "@/lib/disposables";
import * as m from "@/lib/i18n/generated/messages";
import { composing } from "@/lib/ime";
import { cn, tooltipAttrs } from "@/lib/utils";

import { useQueryViewState } from "./model";
import { propertyIcon } from "./property-icon";
import { NewFormulaPage, PropertyPage } from "./property-page";
import { LITERATURE_NOTE, vaultName, vaultProperty } from "./query-file";
import { ToolbarButtonContent, toolbarButtonClass } from "./toolbar-button";
import { popoverFallbacks } from "./toolbar-popover";
import { useVaultPropertyNames } from "./vault-cell";
import type { QueryView } from "./view";
import { isVaultPropertyName, useViewProperties } from "./view-properties";
import type { PropertyEntry, ViewProperties } from "./view-properties";

/** The page "Add formula" opens; a property's page is named by its path. */
const NEW_FORMULA_PAGE = "zt:new-formula";

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
  const current = useQueryViewState(view, (s) => s.view);
  // The popover lists the names the Literature Notes give their properties.
  const { literatureNotes } = view.tableDeps;
  const names = useVaultPropertyNames(literatureNotes);
  const properties = useViewProperties(view, names);
  if (!current || !properties) return null;
  // The popover ticks the properties the Layouts show; a change writes
  // them, with the unused ones the view keeps.
  const order = properties.visible.map((entry) => entry.path);
  const setOrder = (next: readonly string[]) =>
    view.document.editView({ order: properties.orderOf(next) });
  const dataset = current.from ?? "annotations";

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
          properties={properties}
          order={order}
          setOrder={setOrder}
          iconOf={(entry) =>
            propertyIcon(dataset, entry, (name) =>
              literatureNotes.propertyType(name),
            )
          }
          pages={view.can.propertyPages}
          vaults={dataset === "items"}
        />
        <Chooser.Page>
          {(page) => {
            if (page === NEW_FORMULA_PAGE)
              return <NewFormulaPage view={view} />;
            // A tick on the page that hides its Property keeps the page.
            const entry = properties.kept(page);
            if (!entry) return <Chooser.PageGone />;
            const shown = order.includes(page);
            return (
              <PropertyPage
                view={view}
                entry={entry}
                shown={shown}
                onShownChange={(show) =>
                  setOrder(
                    show
                      ? [...order, page]
                      : order.filter((path) => path !== page),
                  )
                }
              />
            );
          }}
        </Chooser.Page>
      </Chooser.Popup>
    </Chooser>
  );
}

function PropertyList({
  properties,
  order,
  setOrder,
  iconOf,
  pages,
  vaults,
}: {
  /** The Properties of the view, the visible ones first. */
  properties: ViewProperties;
  order: readonly string[];
  setOrder: (next: readonly string[]) => void;
  /** The type icon of a property. */
  iconOf: (entry: PropertyEntry) => string;
  /**
   * Whether a property opens its page, and a new Formula its own: not where
   * the host keeps no Display Name and no Formula.
   */
  pages: boolean;
  /** Whether the view can show vault properties: a view of Items. */
  vaults: boolean;
}) {
  const query = useChooserQuery().trim();
  const { scope, activeValue } = useChooserScope();
  const { page, openPage } = useChooserPage();
  const [dragging, setDragging] = useState<string | null>(null);
  // The rows keep the places they had when the list opened, as in the Bases
  // Properties menu: a tick neither moves a row nor takes it away. The list
  // sorts again, the visible properties first, on a search, on a move, on
  // "Hide all" and on the way back from a page.
  const [moves, resort] = useReducer((count: number) => count + 1, 0);
  const sortKey = `${moves}:${page === null}:${query}`;
  const sortOf = (key: string) => ({
    key,
    paths: listedProperties(properties, query).map((entry) => entry.path),
  });
  const [sorted, setSorted] = useState(() => sortOf(sortKey));
  let paths = sorted.paths;
  if (sorted.key !== sortKey) {
    const next = sortOf(sortKey);
    paths = next.paths;
    setSorted(next);
  }
  const rows = useMemo(
    () => listedProperties(properties, query, paths),
    [properties, query, paths],
  );
  const byPath = useMemo(
    () => new Map(rows.map((entry) => [entry.path, entry])),
    [rows],
  );
  // Two fields can share a label, such as "Type": their rows also show the
  // path, so the reader can tell them apart.
  const sharedLabels = useMemo(() => {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const { label } of properties.entries)
      (seen.has(label) ? shared : seen).add(label);
    return shared;
  }, [properties]);
  // What the keys and a row's `next` read at the moment they run.
  const keys = useRef({ order, setOrder, page });
  keys.current = { order, setOrder, page };
  const groups = useMemo<ChooserGroup<ChooserRow>[]>(() => {
    const items = rows.map((entry): ChooserRow => ({
      ...propertyRow(entry),
      // The right arrow opens the property's page.
      ...(pages && { next: () => openPage(entry.path) }),
    }));
    const actions: ChooserRow[] = [];
    const typedVault = vaultName(query);
    if (
      query !== "" &&
      !byPath.has(query) &&
      (typedVault === null || isVaultPropertyName(typedVault))
    )
      actions.push({
        value: "zt:add-property",
        label: m.query_view_properties_add({ name: query }),
        action: () => setOrder([...order, query]),
      });
    // A name typed without the namespace is a new vault property too.
    const vault = vaultProperty(query);
    if (
      vaults &&
      typedVault === null &&
      isVaultPropertyName(query) &&
      !byPath.has(vault)
    )
      actions.push({
        value: "zt:add-vault-property",
        label: m.query_view_properties_add_vault({ name: query }),
        action: () => setOrder([...order, vault]),
      });
    if (pages)
      actions.push({
        value: "zt:add-formula",
        label: m.query_view_formula_add(),
        action: () => openPage(NEW_FORMULA_PAGE),
      });
    actions.push({
      value: "zt:hide-all",
      label: m.query_view_properties_hide_all(),
      action: () => {
        setOrder([]);
        resort();
      },
    });
    return [{ items }, { items: actions, pinned: true }];
  }, [rows, byPath, order, query, setOrder, openPage, pages, vaults]);

  // Alt with an up or down arrow moves the highlighted visible property one
  // place in the order, as in the Bases Properties menu.
  useLayoutEffect(() => {
    const move = (step: number) => (event: KeyboardEvent) => {
      // A page's fields keep their own keys.
      if (composing(event) || keys.current.page !== null) return;
      const path = activeValue();
      const { order: now, setOrder: save } = keys.current;
      const at = path === null ? -1 : now.indexOf(path);
      if (at < 0) return false;
      const to = Math.min(Math.max(at + step, 0), now.length - 1);
      if (to !== at) {
        const next = [...now];
        next.splice(to, 0, ...next.splice(at, 1));
        save(next);
        resort();
      }
      return false;
    };
    const stack = new DisposableStack();
    stack.use(registerKeymap(scope, ["Alt"], "ArrowUp", move(-1)));
    stack.use(registerKeymap(scope, ["Alt"], "ArrowDown", move(1)));
    return () => stack.dispose();
  }, [scope, activeValue]);

  return (
    <Chooser.List
      groups={groups}
      label={m.query_view_properties()}
      emptyLabel={m.query_view_properties_empty()}
    >
      {(row) => {
        const entry = byPath.get(row.value);
        if (row.action || !entry)
          return (
            <Chooser.Action
              key={row.value}
              value={row.value}
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
              if (dragging !== null && dragging !== row.value) {
                setOrder(reordered(order, dragging, row.value));
                resort();
              }
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
            end={
              pages && (
                <button
                  type="button"
                  tabIndex={-1}
                  className={cn(chooserIconButton, "zt:-m-(--size-2-2)")}
                  data-query-property-more={row.value}
                  {...tooltipAttrs(m.query_view_property_edit())}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    openPage(entry.path);
                  }}
                >
                  <RowIcon name="chevron-right" />
                </button>
              )
            }
          >
            <span data-query-property-name="">{entry.label}</span>
            {/* A Vault Property also shows its path, so `citekey (note)` reads
                as the note's `vault.citekey`, as the Sort select shows it. */}
            {(sharedLabels.has(entry.label) ||
              (entry.kind === "vault" && entry.path !== LITERATURE_NOTE)) &&
              entry.label !== entry.path && (
                <span className="zt:text-(--text-faint)"> {entry.path}</span>
              )}
          </Chooser.Item>
        );
      }}
    </Chooser.List>
  );
}

/** An icon of a row, at the size Obsidian draws a menu icon. */
function RowIcon({ name, className }: { name: IconName; className?: string }) {
  return <Icon name={name} size="s" className={cn("zt:shrink-0", className)} />;
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

/**
 * The Properties the popover lists, in their order: the view's entries as
 * they come, the visible ones first, less the nested ones, a member of a
 * field or a field of a parent record, which come only while the user
 * searches or while the view shows them. The popover keeps what this gives
 * until the list sorts again, so a tick neither moves a row nor takes it
 * away, even from a Property the view no longer knows, such as a path the
 * user typed. `before` is what the list gave when it last sorted: its
 * Properties keep their places, unless their subject left the file, as a
 * deleted Formula has; one it lacks, such as a new Formula, goes last.
 */
export function listedProperties(
  properties: Pick<ViewProperties, "entries" | "kept">,
  query: string,
  before?: readonly string[],
): PropertyEntry[] {
  const listable = (entry: PropertyEntry) =>
    entry.place !== null || query !== "" || !entry.nested;
  if (before === undefined) return properties.entries.filter(listable);
  const kept = before.flatMap((path) => properties.kept(path) ?? []);
  const known = new Set(before);
  return [
    ...kept,
    ...properties.entries.filter(
      (entry) => !known.has(entry.path) && listable(entry),
    ),
  ];
}
