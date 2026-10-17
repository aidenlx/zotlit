// The Properties a Query View knows, one entry each: its label, its kind
// and what ZotLit Query says is wrong with a Formula Property, whether
// the view's Query Dataset can read it, and its place in the Visible
// Properties. The Layouts, copy and CSV, the Properties popover, the Sort
// and Group controls and the Filter conditions all read these entries, so a
// Property shows the same label and the same marks in each. A vault property,
// `vault.<name>`, is one the vault answers rather than ZotLit Query; the
// Literature Note Property is the first of them, and it shows, moves and
// resizes in the Table as the others do.
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import { useMemo } from "react";
import { useStore } from "zustand";

import { cellProperties } from "@zotlit/item-query";
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";

import { NON_VAULT_PROPERTY_KEYS } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";

import { DATASETS } from "./datasets";
import {
  QUERY_FILE_DATASETS,
  displayName,
  formulaName,
  formulaProperty,
  isVaultProperty,
  vaultProperty,
} from "./query-file";
import type { QueryFile, QueryFileDataset, QueryFileView } from "./query-file";
import { formulaIssuesOf } from "./results";
import { groupPaths } from "./rows";
import type { QueryView } from "./view";

/**
 * The path of the Literature Note Property, the first vault property. The
 * vault's Note Index answers it, not ZotLit Query, so no query reads it, and
 * only the Table shows it.
 */
export const LITERATURE_NOTE = "vault.literatureNote";

/**
 * Whether a vault property can take the name `name`: not one of Obsidian's
 * reserved keys, such as `tags`, nor one of ZotLit's system keys, such as
 * `zotero-key`, which re-key a note or fight Zotero over its tags.
 */
export function isVaultPropertyName(name: string): boolean {
  return name !== "" && !NON_VAULT_PROPERTY_KEYS.has(name);
}

/**
 * What a Property is, by the namespace of its path: a field of the Query
 * Dataset, read by its Projection Path; a Formula Property, `formula.<name>`;
 * or a vault property, `vault.<name>`, which the vault answers and ZotLit
 * Query never reads. In these namespaces of the view a dot only names the
 * namespace.
 */
export type PropertyKind = "field" | "formula" | "vault";

/** The settings of a view that decide its Properties. */
type PropertySettings = Pick<
  QueryFileView,
  "from" | "order" | "sort" | "groupBy"
> &
  Partial<Pick<QueryFileView, "type">>;

/** The kind of `path`, read once with the name of the Formula it shows. */
function classify(path: string): {
  kind: PropertyKind;
  formula: string | null;
} {
  if (isVaultProperty(path)) return { kind: "vault", formula: null };
  const formula = formulaName(path);
  return { kind: formula === null ? "field" : "formula", formula };
}

/** One Property of a view. */
export interface PropertyEntry {
  /** The Projection Path, `formula.<name>` or `vault.<name>`, as the file names it. */
  readonly path: string;
  /** Its Display Name, else its field label, else its path. */
  readonly label: string;
  /** The Display Name the file gives it; else `null`. */
  readonly displayName: string | null;
  readonly kind: PropertyKind;
  /**
   * Whether it is part of another field: a member of a field, as `date.year`
   * is, or a field of a parent record, as `item.title` is. Only a field's
   * Projection Path nests, by its dots. The Properties popover lists a
   * nested Property only while the researcher searches.
   */
  readonly nested: boolean;
  /** The name of the Formula it shows, where `kind` is `"formula"`; else `null`. */
  readonly formula: string | null;
  /** What ZotLit Query names as wrong in its Formula; else `null`. */
  readonly issue: string | null;
  /**
   * Whether the view's Query Dataset can read it: the dataset lists it, or
   * no dataset does, as for a Formula or a path the researcher typed. The
   * Literature Note Property fits where the Layout shows it: a Table of Items.
   * Another vault property fits a view of Items.
   */
  readonly fits: boolean;
  /** Its place in the Visible Properties; `null` where the view hides it. */
  readonly place: number | null;
}

/** The settings of a view that its dataset lacks, which the view does not use. */
export interface UnusedSettings {
  /** The sort properties. */
  readonly sort: readonly string[];
  /** The group property, or `null`. */
  readonly groupBy: string | null;
  /** The visible properties. */
  readonly order: readonly string[];
}

export interface ViewProperties {
  /**
   * The Visible Properties in their order, an entry's `place` its index: what
   * the Layouts, copy and CSV and the run show, and what the Properties
   * popover ticks. A view without `order` shows the fields ZotLit Query
   * projects by default. An empty `order`, as "Hide all" leaves it, shows
   * none, as in Bases. Else it shows the Properties of `order` the dataset
   * can read; where these are none, as for an `order` of another dataset
   * kept across a dataset change, it shows the default fields. The Literature
   * Note Property counts among those the Table can show: a Table whose
   * `order` holds only it and fields of another dataset shows only it, and
   * another Layout, which cannot show it, shows the default fields for an
   * `order` of only the Literature Note Property.
   */
  readonly visible: readonly PropertyEntry[];
  /**
   * The Visible Properties that ZotLit Query reads, in their order: what the
   * run asks for. The Literature Note Property and the other vault
   * properties are no value of a row, so they are not among them.
   */
  readonly queried: readonly PropertyEntry[];
  /**
   * Every Property the view knows: the Visible Properties in their order,
   * then the file's other Formula Properties, then the dataset's other fields.
   */
  readonly entries: readonly PropertyEntry[];
  /** What the view keeps in its file but does not use. */
  readonly unused: UnusedSettings;
  /** The entry of `path`, which the view may not know, such as a sort of another dataset. */
  entry(path: string): PropertyEntry;
  /**
   * The entry of a path the view knew a moment ago, such as a row the
   * Properties popover keeps after a tick hides it, or the Property of one
   * of its pages: the entry of `path`, whether the view still lists it or
   * not, or `null` once its subject leaves the file, as a Formula the file
   * no longer defines does.
   */
  kept(path: string): PropertyEntry | null;
  /**
   * The `order` to write for the Visible Properties `next`: `next`, then the
   * unused visible properties, which a switch back to their dataset shows
   * again. An empty `next` writes an empty `order`, so the view shows none.
   */
  orderOf(next: readonly string[]): string[];
}

/** What a view knows of its Properties beside its file. */
export interface KnownProperties {
  /** By Formula name, the message of each Formula the last run left out. */
  readonly formulaIssues?: Readonly<Record<string, string>>;
  /**
   * The names the vault properties of a view of Items take, which it knows
   * after the Literature Note Property.
   */
  readonly vaultNames?: readonly string[];
}

/** The Properties of `view` in `file`. */
export function viewProperties(
  file: QueryFile | null,
  view: PropertySettings,
  { formulaIssues = {}, vaultNames = [] }: KnownProperties = {},
): ViewProperties {
  const dataset = view.from ?? "annotations";
  const properties = datasetProperties(dataset);
  // Only a Table of Items shows the Literature Note Property, at the end of
  // a view that names no `order` of its own, as it did before it could move.
  const showsNote = view.type === "table" && dataset === "items";
  const fits = (path: string) =>
    path === LITERATURE_NOTE
      ? showsNote
      : isVaultProperty(path)
        ? dataset === "items"
        : fitsDataset(path, dataset);
  const defaults = [
    ...DATASETS[dataset].engine.defaultFields.filter((field) =>
      properties.includes(field),
    ),
    ...(showsNote ? [LITERATURE_NOTE] : []),
  ];
  const fitting = [...new Set((view.order ?? []).filter(fits))];
  const shown =
    view.order === undefined
      ? defaults
      : view.order.length === 0
        ? []
        : fitting.length > 0
          ? fitting
          : defaults;
  const known = new Map<string, PropertyEntry>();
  const entry = (path: string): PropertyEntry => {
    let found = known.get(path);
    if (!found) {
      const { kind, formula } = classify(path);
      const place = shown.indexOf(path);
      const named = (file && displayName(file, path)) ?? null;
      found = {
        path,
        label: named ?? fieldLabel(path),
        displayName: named,
        kind,
        nested: kind === "field" && path.includes("."),
        formula,
        issue:
          formula !== null && Object.hasOwn(formulaIssues, formula)
            ? formulaIssues[formula]!
            : null,
        fits: fits(path),
        place: place === -1 ? null : place,
      };
      known.set(path, found);
    }
    return found;
  };
  const paths = new Set([
    ...shown,
    ...Object.keys(file?.formulas ?? {}).map(formulaProperty),
    ...(showsNote ? [LITERATURE_NOTE] : []),
    ...(dataset === "items"
      ? vaultNames.map((name) => vaultProperty(name))
      : []),
    ...datasetProperties(dataset),
  ]);
  const unused = unusedSettings(view);
  // A view that cannot show a vault property keeps it in `order`, so a
  // switch back to a Table of Items shows it again, as a Layout other than
  // the Table keeps the Literature Note Property; it is no setting the
  // dataset lacks, so it is not among the unused ones.
  const keptForTable = (view.order ?? []).filter(
    (property) => isVaultProperty(property) && !fits(property),
  );
  const visible = shown.map(entry);
  const entries = [...paths].map(entry);
  return {
    visible,
    queried: visible.filter(({ kind }) => kind !== "vault"),
    entries,
    unused,
    entry,
    // A field or a path the researcher typed has no definition in the file
    // to lose; a Formula does, and leaves the entries once neither the file
    // defines it nor the view shows it.
    kept: (path) =>
      paths.has(path) || classify(path).kind !== "formula" ? entry(path) : null,
    orderOf: (next) =>
      next.length === 0
        ? []
        : [
            ...next,
            ...[...unused.order, ...keptForTable].filter(
              (property) => !next.includes(property),
            ),
          ],
  };
}

/**
 * The Properties of the view on screen, as the last run marks them, with the
 * vault properties of `vaultNames` among those it knows.
 */
export function useViewProperties(
  view: QueryView,
  vaultNames?: readonly string[],
): ViewProperties | null {
  const file = useStore(view.state, (s) => s.file);
  const shown = useStore(view.state, (s) => s.view);
  const faults = useStore(view.state, formulaIssuesOf);
  return useMemo(
    () =>
      shown
        ? viewProperties(file, shown, { formulaIssues: faults, vaultNames })
        : null,
    [file, shown, faults, vaultNames],
  );
}

const cache = new Map<QueryFileDataset, readonly string[]>();

/**
 * The fields of a dataset, in the order ZotLit Query lists them: the paths
 * that give one cell each. An Annotation's position is left out; its
 * numbers mean nothing in a table.
 */
function datasetProperties(dataset: QueryFileDataset): readonly string[] {
  let properties = cache.get(dataset);
  if (!properties) {
    properties = cellProperties(DATASETS[dataset].engine).filter(
      (path) => path !== "position" && !path.startsWith("position."),
    );
    cache.set(dataset, properties);
  }
  return properties;
}

function fitsDataset(property: string, dataset: QueryFileDataset): boolean {
  return (
    datasetProperties(dataset).includes(property) ||
    !QUERY_FILE_DATASETS.some((other) =>
      datasetProperties(other).includes(property),
    )
  );
}

/**
 * What a view keeps in the file but does not use, since its dataset lacks
 * it: a sort, a grouping or a visible property of another dataset. A switch
 * back to a dataset that has them uses them again.
 */
export function unusedSettings(
  view: Pick<QueryFileView, "from" | "sort" | "groupBy" | "order">,
): UnusedSettings {
  const dataset = view.from ?? "annotations";
  // A setting of no dataset, such as formula.<name>, is the view's own: the
  // view uses it, and ZotLit Query or the view says what is wrong with it.
  const ofAnotherDataset = (has: (other: QueryFileDataset) => boolean) =>
    !has(dataset) && QUERY_FILE_DATASETS.some((other) => has(other));
  return {
    // A property of the dataset that ZotLit Query cannot sort by, such as
    // the tags of Items, is unused as well.
    sort: (view.sort ?? [])
      .map(({ property }) => property)
      .filter(
        (property) =>
          !DATASETS[dataset].engine.sortableFields.includes(property) &&
          QUERY_FILE_DATASETS.some(
            (other) =>
              DATASETS[other].engine.definition(property) !== undefined ||
              DATASETS[other].engine.sortableFields.includes(property),
          ),
      ),
    groupBy:
      view.groupBy &&
      ofAnotherDataset((other) =>
        groupPaths(other).includes(view.groupBy!.property),
      )
        ? view.groupBy.property
        : null,
    order: (view.order ?? []).filter(
      (property) =>
        !isVaultProperty(property) && !fitsDataset(property, dataset),
    ),
  };
}

/**
 * The field label of a property, without its Display Name: Zotero's label
 * for an Item field, else the label the Query Datasets give it in Sort and
 * Group, else, for a field of the Item or of the Attachment, that field's
 * name under its parent's. A path with none of these shows as it is.
 */
export function fieldLabel(property: string): string {
  if (property === LITERATURE_NOTE) return m.query_view_table_literature_note();
  return labelOf(property) ?? property;
}

function labelOf(property: string): string | undefined {
  const locale = runtime.getLocale() === "zh-CN" ? "zh-CN" : "en-US";
  const label = FIELD_LABELS[locale][property] ?? datasetLabel(property);
  if (label) return label;
  for (const [prefix, parent, of] of PARENTS) {
    if (!property.startsWith(prefix)) continue;
    const field = labelOf(property.slice(prefix.length));
    if (field === undefined) return undefined;
    // "Item Type" names the field under its parent's name already.
    const rest = field.startsWith(parent())
      ? field.slice(parent().length)
      : null;
    return of({
      property: inSentence(
        rest !== null && !/^[a-z]/i.test(rest) ? rest.trim() : field,
      ),
    });
  }
  return undefined;
}

/** The parents a dataset reads fields of, by the prefix of their paths. */
const PARENTS = [
  ["item.", m.query_view_property_item, m.query_view_property_of_item],
  [
    "attachment.",
    m.query_view_property_attachment,
    m.query_view_property_of_attachment,
  ],
] as const;

/** The label the Query Datasets give a path in Sort and Group, by path. */
let datasetLabels: ReadonlyMap<string, () => string> | null = null;

function datasetLabel(property: string): string | undefined {
  datasetLabels ??= new Map(
    Object.values(DATASETS).flatMap((spec) => [
      ...spec.sort.map(([path, label]) => [path, label] as const),
      // A grouping by a list path names one value of the list.
      ...spec.group.map(
        ({ path, label }) => [path.replace(/\[\]$/, ""), label] as const,
      ),
    ]),
  );
  return datasetLabels.get(property)?.();
}

/**
 * A label inside a sentence: each word in lower case but an acronym, so
 * "Date Added" reads "date added" and "Archive ID" reads "archive ID".
 */
function inSentence(label: string): string {
  return label
    .split(" ")
    .map((word) => (/^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(" ");
}
