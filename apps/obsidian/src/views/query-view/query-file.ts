// The one Query File parser and serializer, shared by the Query File tab, the
// Query File embed, the Query Block and the sidebar. A Query File is YAML in
// the shape of an Obsidian `.base` file; the parser keeps every key it does
// not read (`summaries`, and keys it does not know) in its place, so a save
// writes them back.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import * as v from "valibot";
import { parse, stringify } from "yaml";

import {
  composeFilterTree,
  joinComposed,
  readFilterTree,
} from "@zotlit/filter-expression";
import type {
  ComposedFilter,
  FilterLeaf,
  FilterTree,
} from "@zotlit/filter-expression";
import { FORMULA_SEGMENT, nameDictionary } from "@zotlit/item-query";
import type { NameDictionary } from "@zotlit/item-query";

/** The file extension of a Query File, and the language of a Query Block. */
export const QUERY_FILE_EXTENSION = "zotquery";

/** The first `base`, `base 1`, `base 2`, … name that `taken` does not hold. */
export function untitledName(
  base: string,
  taken: (name: string) => boolean,
): string {
  for (let index = 0; ; index++) {
    const name = index === 0 ? base : `${base} ${index}`;
    if (!taken(name)) return name;
  }
}

/** The most rows a new Query File's view shows. */
export const NEW_QUERY_FILE_LIMIT = 100;

/** The Query Datasets a view can read. */
export const QUERY_FILE_DATASETS = [
  "annotations",
  "attachments",
  "items",
] as const;
export type QueryFileDataset = (typeof QUERY_FILE_DATASETS)[number];

export type QueryFileDirection = "ASC" | "DESC";

/** The value of one group in a Manual group order. */
export type QueryFileGroupValue = string | null;

export interface QueryFileSort {
  readonly property: string;
  readonly direction: QueryFileDirection;
}

/**
 * Something in the file that the parser could not read. The file still opens;
 * the view says what is wrong.
 */
export type QueryFileProblem =
  | { readonly code: "invalid-yaml"; readonly message: string }
  | { readonly code: "not-a-map" }
  | { readonly code: "no-views" }
  | { readonly code: "missing-key"; readonly key: string }
  | {
      readonly code: "invalid-value";
      readonly key: string;
      readonly value: unknown;
    }
  /** Two views have one name, which a link to a view or a view choice cannot tell apart. */
  | { readonly code: "duplicate-view-name"; readonly name: string };

/** The width in pixels of each resized column of a view, by property path. */
export type ColumnSizes = Readonly<Record<string, number>>;

export interface QueryFileView {
  /** The Layout. */
  readonly type: string;
  readonly name: string;
  /** The Query Dataset the view reads; `undefined` where the file names none it knows. */
  readonly from: QueryFileDataset | undefined;
  readonly filters?: FilterTree;
  readonly sort?: readonly QueryFileSort[];
  /**
   * The group path. Groups follow the query order of their first rows; `DESC`
   * reverses them.
   */
  readonly groupBy?: QueryFileSort;
  /**
   * The Manual group order: the values of the groups shown, in the order they
   * show; a group whose value is not listed is hidden. `null` is the group of
   * the rows that have no value. `undefined` while the groups follow
   * `groupBy.direction`.
   */
  readonly groupOrder?: readonly QueryFileGroupValue[];
  readonly limit?: number;
  /**
   * The visible properties, as Projection Paths, `formula.<name>` or
   * `vault.literatureNote`, in the order the view shows them. Copy and CSV
   * export write these columns but the Literature Note Property; the Table, List and
   * Cards layouts show them in this order.
   */
  readonly order?: readonly string[];
  /**
   * The width in pixels of each column the researcher resized, by property
   * path, as Bases keeps it. A column without an entry takes its auto width.
   */
  readonly columnSize?: ColumnSizes;
  readonly problems: readonly QueryFileProblem[];
  /** The view's map as the file holds it, with every key the parser does not read. */
  readonly source: Readonly<Record<string, unknown>>;
}

export interface QueryFile {
  /** The filters for all views of the same dataset. */
  readonly filters?: FilterTree;
  /**
   * The Formulas: each name with its Filter Expression text. A view shows a
   * Formula as the property `formula.<name>`.
   */
  readonly formulas?: NameDictionary<string>;
  /**
   * The settings of each property, by the text of its `order` entry: a bare
   * Projection Path for a field, `formula.<name>` for a Formula,
   * `vault.literatureNote` for the Literature Note Property. Its
   * `displayName` is the property's Display Name; the parser keeps the other
   * keys as the file holds them.
   */
  readonly properties?: NameDictionary<unknown>;
  /** The views, the default view first. */
  readonly views: readonly QueryFileView[];
  readonly problems: readonly QueryFileProblem[];
  /** The file's map as it holds it, with every key the parser does not read. */
  readonly source: Readonly<Record<string, unknown>>;
}

type Entries = Record<string, unknown>;

function isMap(value: unknown): value is Entries {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDirection(value: unknown): QueryFileDirection | null {
  if (value === undefined) return "ASC";
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return upper === "ASC" || upper === "DESC" ? upper : null;
}

function readSort(value: unknown): QueryFileSort | null {
  if (!isMap(value) || typeof value.property !== "string") return null;
  const direction = readDirection(value.direction);
  return direction ? { property: value.property, direction } : null;
}

/** One column width: a whole number of pixels above zero. */
const ColumnWidth = v.pipe(v.number(), v.integer(), v.minValue(1));

/**
 * The column widths of a view. A width only changes how the Table looks, so
 * an entry that is not a width is dropped and a value that is not a map is
 * left unread, with no problem: the view still runs.
 */
function readColumnSize(value: unknown): ColumnSizes | undefined {
  if (!isMap(value)) return undefined;
  const sizes = Object.entries(value).filter(
    (entry): entry is [string, number] => v.is(ColumnWidth, entry[1]),
  );
  return sizes.length > 0 ? Object.fromEntries(sizes) : undefined;
}

function readView(value: unknown): QueryFileView {
  const source = isMap(value) ? value : {};
  const problems: QueryFileProblem[] = [];
  const invalid = (key: string) =>
    problems.push({ code: "invalid-value", key, value: source[key] });
  const text = (key: string): string => {
    const entry = source[key];
    if (entry === undefined || entry === null || entry === "") {
      problems.push({ code: "missing-key", key });
      return "";
    }
    if (typeof entry !== "string") {
      invalid(key);
      return JSON.stringify(entry);
    }
    return entry;
  };

  const type = text("type");
  const name = text("name");
  let from: QueryFileDataset | undefined;
  const fromText = text("from");
  if (fromText !== "") {
    if ((QUERY_FILE_DATASETS as readonly string[]).includes(fromText))
      from = fromText as QueryFileDataset;
    else if (typeof source.from === "string") invalid("from");
  }

  const view: {
    -readonly [K in keyof QueryFileView]: QueryFileView[K];
  } = { type, name, from, problems, source };

  if (source.filters !== undefined) {
    const filters = readFilterTree(source.filters);
    if (filters === null) invalid("filters");
    else view.filters = filters;
  }
  if (source.sort !== undefined) {
    const sort = Array.isArray(source.sort) ? source.sort.map(readSort) : null;
    if (sort === null || sort.includes(null)) invalid("sort");
    else view.sort = sort as QueryFileSort[];
  }
  if (source.groupBy !== undefined) {
    const groupBy = readSort(source.groupBy);
    if (groupBy === null) invalid("groupBy");
    else view.groupBy = groupBy;
  }
  if (source.groupOrder !== undefined) {
    const order = source.groupOrder;
    if (
      Array.isArray(order) &&
      order.every((value) => value === null || typeof value === "string")
    )
      view.groupOrder = order as QueryFileGroupValue[];
    else invalid("groupOrder");
  }
  if (source.limit !== undefined) {
    const { limit } = source;
    if (typeof limit === "number" && Number.isInteger(limit) && limit > 0)
      view.limit = limit;
    else invalid("limit");
  }
  if (source.order !== undefined) {
    const { order } = source;
    if (
      Array.isArray(order) &&
      order.every((entry) => typeof entry === "string" && entry !== "")
    )
      view.order = order as string[];
    else invalid("order");
  }
  const columnSize = readColumnSize(source.columnSize);
  if (columnSize) view.columnSize = columnSize;
  return view;
}

/** Reads a Query File's text. It never throws: what it cannot read is a problem. */
export function parseQueryFile(text: string): QueryFile {
  let value: unknown;
  try {
    value = parse(text);
  } catch (error) {
    return {
      views: [],
      problems: [
        {
          code: "invalid-yaml",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      source: {},
    };
  }
  if (value === null || value === undefined) value = {};
  if (!isMap(value))
    return { views: [], problems: [{ code: "not-a-map" }], source: {} };

  const problems: QueryFileProblem[] = [];
  const file: { -readonly [K in keyof QueryFile]: QueryFile[K] } = {
    views: [],
    problems,
    source: value,
  };
  if (value.filters !== undefined) {
    const filters = readFilterTree(value.filters);
    if (filters === null)
      problems.push({
        code: "invalid-value",
        key: "filters",
        value: value.filters,
      });
    else file.filters = filters;
  }
  if (value.formulas !== undefined) {
    const { formulas } = value;
    if (
      isMap(formulas) &&
      Object.values(formulas).every((text) => typeof text === "string")
    )
      file.formulas = nameDictionary(
        Object.entries(formulas as Record<string, string>),
      );
    else
      problems.push({
        code: "invalid-value",
        key: "formulas",
        value: formulas,
      });
  }
  if (value.properties !== undefined) {
    const { properties } = value;
    if (isMap(properties))
      file.properties = nameDictionary(Object.entries(properties));
    else
      problems.push({
        code: "invalid-value",
        key: "properties",
        value: properties,
      });
  }
  if (value.views !== undefined && !Array.isArray(value.views))
    problems.push({ code: "invalid-value", key: "views", value: value.views });
  file.views = Array.isArray(value.views) ? value.views.map(readView) : [];
  if (file.views.length === 0 && problems.length === 0)
    problems.push({ code: "no-views" });
  const names = new Set<string>();
  const duplicates = new Set<string>();
  for (const { name } of file.views)
    if (name) (names.has(name) ? duplicates : names).add(name);
  for (const name of duplicates)
    problems.push({ code: "duplicate-view-name", name });
  return file;
}

/**
 * Writes `entries` over `source`: a key `source` holds keeps its place, a new
 * one goes after them, and an `undefined` one is dropped.
 */
function merged(source: Readonly<Entries>, entries: Entries): Entries {
  const out: Entries = {};
  for (const key of Object.keys(source)) {
    const value = Object.hasOwn(entries, key) ? entries[key] : source[key];
    if (value !== undefined) out[key] = value;
  }
  for (const [key, value] of Object.entries(entries))
    if (!Object.hasOwn(source, key) && value !== undefined) out[key] = value;
  return out;
}

function writeView(view: QueryFileView): Entries {
  return merged(view.source, {
    type: view.type || undefined,
    name: view.name || undefined,
    from: view.from ?? view.source.from,
    filters: view.filters ?? view.source.filters,
    sort: view.sort?.map((sort) => ({ ...sort })) ?? view.source.sort,
    groupBy: view.groupBy ? { ...view.groupBy } : view.source.groupBy,
    groupOrder: view.groupOrder ? [...view.groupOrder] : view.source.groupOrder,
    limit: view.limit ?? view.source.limit,
    order: view.order ? [...view.order] : view.source.order,
    columnSize: view.columnSize
      ? { ...view.columnSize }
      : view.source.columnSize,
  });
}

/** What a toolbar control changes in one view. A key set to `undefined` is removed. */
export type QueryFileViewEdit = Partial<
  Pick<
    QueryFileView,
    "sort" | "groupBy" | "groupOrder" | "order" | "limit" | "columnSize"
  >
>;

/**
 * The file with one view changed. A grouping that takes another property
 * drops the Manual group order, since its values name the old groups. A key
 * the edit sets is no longer a problem of the view.
 */
export function editView(
  file: QueryFile,
  view: QueryFileView,
  edit: QueryFileViewEdit,
): QueryFile {
  const changes: {
    -readonly [K in keyof QueryFileViewEdit]: QueryFileViewEdit[K];
  } = { ...edit };
  if (
    Object.hasOwn(edit, "groupBy") &&
    edit.groupBy?.property !== view.groupBy?.property
  )
    changes.groupOrder = undefined;
  const source: Entries = { ...view.source };
  for (const [key, value] of Object.entries(changes))
    if (value === undefined) delete source[key];
  const problems = view.problems.filter(
    (problem) =>
      !(
        problem.code === "invalid-value" && Object.hasOwn(changes, problem.key)
      ),
  );
  const next: QueryFileView = { ...view, ...changes, source, problems };
  return {
    ...file,
    views: file.views.map((candidate) =>
      candidate === view ? next : candidate,
    ),
  };
}

/** Writes a Query File's text. A key the parser kept stays where it was. */
export function serializeQueryFile(file: QueryFile): string {
  // New filters for all views go first, and new Formulas and properties
  // before the views, where a `.base` file has them.
  let source: Entries = Object.hasOwn(file.source, "filters")
    ? file.source
    : { filters: undefined, ...file.source };
  for (const added of ["formulas", "properties"]) {
    if (Object.hasOwn(source, added)) continue;
    const keys = Object.keys(source);
    const at = keys.includes("views") ? keys.indexOf("views") : keys.length;
    const before = source;
    source = Object.fromEntries([
      ...keys.slice(0, at).map((key) => [key, before[key]]),
      [added, undefined],
      ...keys.slice(at).map((key) => [key, before[key]]),
    ]);
  }
  const entries = merged(source, {
    filters: file.filters ?? file.source.filters,
    formulas: file.formulas ?? file.source.formulas,
    properties: file.properties ?? file.source.properties,
    views: file.views.map(writeView),
  });
  return stringify(entries, { lineWidth: 0 });
}

const FORMULA_PREFIX = `${FORMULA_SEGMENT}.`;

/** The Projection Path a view shows a Formula as. */
export function formulaProperty(name: string): string {
  return `${FORMULA_PREFIX}${name}`;
}

/** The name of the Formula that `property` shows; `null` for a field. */
export function formulaName(property: string): string | null {
  return property.startsWith(FORMULA_PREFIX)
    ? property.slice(FORMULA_PREFIX.length)
    : null;
}

/**
 * The file with the Formula `name` set to `text`: an existing one changes in
 * place, a new one goes after the others.
 */
export function withFormula(
  file: QueryFile,
  name: string,
  text: string,
): QueryFile {
  return {
    ...file,
    formulas: nameDictionary([
      ...Object.entries(file.formulas ?? {}),
      [name, text],
    ]),
    problems: validKey(file.problems, "formulas"),
  };
}

/** `problems` without the one that names `key` as an invalid value. */
function validKey(
  problems: readonly QueryFileProblem[],
  key: "formulas" | "properties",
): QueryFileProblem[] {
  return problems.filter(
    (problem) => !(problem.code === "invalid-value" && problem.key === key),
  );
}

/** `dictionary` without the entry `name`. */
function without<V>(
  dictionary: NameDictionary<V> | undefined,
  name: string,
): NameDictionary<V> {
  return nameDictionary(
    Object.entries(dictionary ?? {}).filter(([entry]) => entry !== name),
  );
}

/** The file without its top-level `key`. */
function withoutKey(
  file: QueryFile,
  key: "formulas" | "properties",
): QueryFile {
  const { [key]: _dropped, ...source } = file.source;
  const { [key]: _none, ...rest } = file;
  return { ...rest, source };
}

/** The file with `properties` as its property settings; an empty map leaves the file without the key. */
function withProperties(
  file: QueryFile,
  properties: NameDictionary<unknown>,
): QueryFile {
  if (Object.keys(properties).length === 0)
    return withoutKey(file, "properties");
  return {
    ...file,
    properties,
    problems: validKey(file.problems, "properties"),
  };
}

/**
 * The file without the Formula `name`, which also leaves the visible
 * properties of every view and the file's property settings. The `formulas`
 * key goes with the last Formula.
 */
export function removeFormula(file: QueryFile, name: string): QueryFile {
  const formulas = without(file.formulas, name);
  const property = formulaProperty(name);
  let next = file;
  for (const view of file.views)
    if (view.order?.includes(property))
      next = editView(next, view, {
        order: view.order.filter((entry) => entry !== property),
      });
  if (next.properties && Object.hasOwn(next.properties, property))
    next = withProperties(next, without(next.properties, property));
  if (Object.keys(formulas).length > 0) return { ...next, formulas };
  return withoutKey(next, "formulas");
}

/**
 * The Display Name of `property`, as its `order` entry names it; `undefined`
 * where the file gives it none.
 */
export function displayName(
  file: QueryFile,
  property: string,
): string | undefined {
  const settings = file.properties?.[property];
  if (!Object.hasOwn(file.properties ?? {}, property) || !isMap(settings))
    return undefined;
  const { displayName: name } = settings;
  return typeof name === "string" && name !== "" ? name : undefined;
}

/**
 * The file with the Display Name of `property` set to `name`; `undefined`
 * removes it. The property's other settings stay; a property left with none
 * leaves `properties`, and the key goes with the last one.
 */
export function withDisplayName(
  file: QueryFile,
  property: string,
  name: string | undefined,
): QueryFile {
  if (name === undefined && displayName(file, property) === undefined)
    return file;
  const properties = new Map(Object.entries(file.properties ?? {}));
  const entry = properties.get(property);
  const current: Entries = isMap(entry) ? entry : {};
  const { displayName: _old, ...settings } = current;
  // A name that changes keeps its place among the property's settings.
  if (name !== undefined)
    properties.set(property, { ...current, displayName: name });
  else if (Object.keys(settings).length > 0) properties.set(property, settings);
  else properties.delete(property);
  return withProperties(file, nameDictionary(properties));
}

/** The text of a new Query File: one Annotations view of the whole library. */
export function newQueryFileText(viewName: string): string {
  return serializeQueryFile({
    views: [
      {
        type: "annotations",
        name: viewName,
        from: "annotations",
        groupBy: { property: "item.indexedKey", direction: "ASC" },
        limit: NEW_QUERY_FILE_LIMIT,
        problems: [],
        source: {},
      },
    ],
    problems: [],
    source: {},
  });
}

/**
 * The Query Dataset the filters for all views are written for: the dataset of
 * the first view. They apply to the views of that dataset alone, since each
 * dataset names its fields in its own way.
 */
export function allViewsDataset(file: QueryFile): QueryFileDataset {
  return file.views[0]?.from ?? "annotations";
}

/** Which filters a condition belongs to: the file's, or the view's own. */
export type FilterSection = "all" | "view";

/** One condition of the filters, where the Match editor shows it. */
export interface FilterLocation {
  readonly section: FilterSection;
  /** The condition's position as the Match editor counts it. */
  readonly path: readonly number[];
}

/** A condition of the filters, with the message the Match editor marks it with. */
export interface ConditionIssue extends FilterLocation {
  readonly message: string;
}

/** The Filter Expression of one view's filters, with each condition's place. */
function composeView(
  file: QueryFile,
  view: QueryFileView,
): ComposedFilter<FilterLocation & FilterLeaf> | undefined {
  const sections: [FilterTree, FilterSection][] = [];
  if (
    file.filters !== undefined &&
    (view.from ?? "annotations") === allViewsDataset(file)
  )
    sections.push([file.filters, "all"]);
  if (view.filters !== undefined) sections.push([view.filters, "view"]);
  if (sections.length === 0) return undefined;
  // Each section's leaves carry their section, so the joined text keeps it.
  const parts = sections.map(([tree, section]) => {
    const { text, leaves } = composeFilterTree(tree);
    return { text, leaves: leaves.map((leaf) => ({ ...leaf, section })) };
  });
  return joinComposed(parts, " && ");
}

/**
 * The Filter Expression of one view: the filters for all views of its dataset
 * and the view's own filters, both of which must hold. `undefined` where
 * neither names one.
 */
export function viewFilter(
  file: QueryFile,
  view: QueryFileView,
): string | undefined {
  return composeView(file, view)?.text;
}

/**
 * The condition that a fault at `span` of the view's Filter Expression marks,
 * or `null` when the span does not fall inside one condition.
 */
export function locateFilterFault(
  file: QueryFile,
  view: QueryFileView,
  span: { readonly from: number; readonly to: number },
): FilterLocation | null {
  const leaf = composeView(file, view)?.leaves.find(
    ({ from, to }) => from <= span.from && span.to <= to,
  );
  return leaf ? { section: leaf.section, path: leaf.path } : null;
}

/**
 * The file with new filters: for all views when `index` is `null`, else for
 * the view at that place. `undefined` removes the filters.
 */
export function withFilters(
  file: QueryFile,
  index: number | null,
  filters: FilterTree | undefined,
): QueryFile {
  const set = <T extends { readonly source: Readonly<Entries> }>(
    target: T,
  ): T => {
    const { filters: _dropped, ...source } = target.source;
    return {
      ...target,
      filters,
      source: filters === undefined ? source : target.source,
    };
  };
  if (index === null) return set(file);
  return {
    ...file,
    views: file.views.map((view, at) => (at === index ? set(view) : view)),
  };
}
