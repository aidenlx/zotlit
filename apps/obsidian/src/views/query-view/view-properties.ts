// The Properties a Query View knows, one entry each: its label, whether it
// is a Formula Property and what ZotLit Query says is wrong with it, whether
// the view's Query Dataset can read it, and its place in the Visible
// Properties. The Layouts, copy and CSV, the Properties popover and the Sort
// and Group controls all read these entries, so a Property shows the same
// label and the same marks in each.
import { useMemo } from "react";
import { useStore } from "zustand";

import { cellProperties } from "@zotlit/item-query";
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";

import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";

import { DATASETS } from "./datasets";
import {
  QUERY_FILE_DATASETS,
  displayName,
  formulaName,
  formulaProperty,
} from "./query-file";
import type { QueryFile, QueryFileDataset, QueryFileView } from "./query-file";
import { groupPaths } from "./rows";
import type { QueryView } from "./view";

/** One Property of a view. */
export interface PropertyEntry {
  /** The Projection Path, as the file names it. */
  readonly path: string;
  /** Its Display Name, else its field label, else its path. */
  readonly label: string;
  /** The name of the Formula it shows, for `formula.<name>`; else `null`. */
  readonly formula: string | null;
  /** What ZotLit Query names as wrong in its Formula; else `null`. */
  readonly issue: string | null;
  /**
   * Whether the view's Query Dataset can read it: the dataset lists it, or
   * no dataset does, as for a Formula or a path the researcher typed.
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
   * Every Property the view knows: the Visible Properties in their order,
   * then the file's other Formula Properties, then the dataset's other fields.
   */
  readonly entries: readonly PropertyEntry[];
  /**
   * The Properties each record shows, as the Layouts, copy and CSV write
   * them: the Visible Properties the dataset can read. A view that shows
   * none gives the fields ZotLit Query projects by default.
   */
  readonly columns: readonly PropertyEntry[];
  /** What the view keeps in its file but does not use. */
  readonly unused: UnusedSettings;
  /** The entry of `path`, which the view may not know, such as a sort of another dataset. */
  entry(path: string): PropertyEntry;
}

/**
 * The Properties of `view` in `file`. `formulaIssues` gives, by Formula
 * name, the message of each Formula the last run left out.
 */
export function viewProperties(
  file: QueryFile | null,
  view: Pick<QueryFileView, "from" | "order" | "sort" | "groupBy">,
  formulaIssues: Readonly<Record<string, string>> = {},
): ViewProperties {
  const dataset = view.from ?? "annotations";
  const order = view.order ?? [];
  const known = new Map<string, PropertyEntry>();
  const entry = (path: string): PropertyEntry => {
    let found = known.get(path);
    if (!found) {
      const formula = formulaName(path);
      const place = order.indexOf(path);
      found = {
        path,
        label: (file && displayName(file, path)) ?? fieldLabel(path),
        formula,
        issue:
          formula !== null && Object.hasOwn(formulaIssues, formula)
            ? formulaIssues[formula]!
            : null,
        fits: fitsDataset(path, dataset),
        place: place === -1 ? null : place,
      };
      known.set(path, found);
    }
    return found;
  };
  const paths = new Set([
    ...order,
    ...Object.keys(file?.formulas ?? {}).map(formulaProperty),
    ...datasetProperties(dataset),
  ]);
  const entries = [...paths].map(entry);
  const shown = entries.filter((each) => each.place !== null && each.fits);
  const properties = datasetProperties(dataset);
  const columns =
    shown.length > 0
      ? shown
      : DATASETS[dataset].engine.defaultFields
          .filter((field) => properties.includes(field))
          .map(entry);
  return { entries, columns, unused: unusedSettings(view), entry };
}

/** The Properties of the view on screen, as the last run marks them. */
export function useViewProperties(view: QueryView): ViewProperties | null {
  const file = useStore(view.state, (s) => s.file);
  const shown = useStore(view.state, (s) => s.view);
  const faults = useStore(view.state, (s) => s.formulaIssues);
  return useMemo(
    () => (shown ? viewProperties(file, shown, faults) : null),
    [file, shown, faults],
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
      (property) => !fitsDataset(property, dataset),
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
