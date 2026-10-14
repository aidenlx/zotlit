// The one Query File parser and serializer, shared by the Query File tab, the
// Query File embed, the Query Block and the sidebar. A Query File is YAML in
// the shape of an Obsidian `.base` file; the parser keeps every key it does
// not read (`formulas`, `summaries`, `properties`, and keys it does not know)
// in its place, so a save writes them back.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import { parse, stringify } from "yaml";

import type { MatchTree } from "@zotlit/templates/facade";

/** The file extension of a Query File, and the language of a Query Block. */
export const QUERY_FILE_EXTENSION = "zotquery";

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
    };

export interface QueryFileView {
  /** The Layout. */
  readonly type: string;
  readonly name: string;
  /** The Query Dataset the view reads; `undefined` where the file names none it knows. */
  readonly from: QueryFileDataset | undefined;
  readonly filters?: MatchTree;
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
   * The visible properties, as Projection Paths, in the order the view shows
   * them. Copy and CSV export write these columns; the Table, List and Cards
   * layouts show them in this order.
   */
  readonly order?: readonly string[];
  readonly problems: readonly QueryFileProblem[];
  /** The view's map as the file holds it, with every key the parser does not read. */
  readonly source: Readonly<Record<string, unknown>>;
}

export interface QueryFile {
  /** The filters for all views of the same dataset. */
  readonly filters?: MatchTree;
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

/** Wraps one condition so it binds as one operand. */
function operand(expression: string): string {
  return `(${expression})`;
}

/**
 * Reads a Bases filter. A `not` group becomes one expression condition, since
 * the Match editor has no "None of the following" group.
 */
function readFilter(value: unknown): MatchTree | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (!isMap(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  const [key] = keys as [string];
  const entries = value[key];
  if (!Array.isArray(entries)) return null;
  const read = entries.map(readFilter);
  if (read.includes(null)) return null;
  const children = read as MatchTree[];
  switch (key) {
    case "and":
      return { and: children };
    case "or":
      return { or: children };
    case "not":
      return `!${operand(
        children.map((child) => operand(filterExpression(child))).join(" || "),
      )}`;
    default:
      return null;
  }
}

/** One Filter Expression for a filter tree. */
export function filterExpression(tree: MatchTree): string {
  if (typeof tree === "string") return tree;
  const [entries, joiner, empty] =
    "and" in tree ? [tree.and, " && ", "true"] : [tree.or, " || ", "false"];
  if (entries.length === 0) return empty;
  if (entries.length === 1) return filterExpression(entries[0]!);
  return entries.map((entry) => operand(filterExpression(entry))).join(joiner);
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
    const filters = readFilter(source.filters);
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
    const filters = readFilter(value.filters);
    if (filters === null)
      problems.push({
        code: "invalid-value",
        key: "filters",
        value: value.filters,
      });
    else file.filters = filters;
  }
  if (value.views !== undefined && !Array.isArray(value.views))
    problems.push({ code: "invalid-value", key: "views", value: value.views });
  file.views = Array.isArray(value.views) ? value.views.map(readView) : [];
  if (file.views.length === 0 && problems.length === 0)
    problems.push({ code: "no-views" });
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

function writeFilter(tree: MatchTree | undefined): unknown {
  if (tree === undefined || typeof tree === "string") return tree;
  return "and" in tree
    ? { and: tree.and.map(writeFilter) }
    : { or: tree.or.map(writeFilter) };
}

function writeView(view: QueryFileView): Entries {
  return merged(view.source, {
    type: view.type || undefined,
    name: view.name || undefined,
    from: view.from ?? view.source.from,
    filters: writeFilter(view.filters) ?? view.source.filters,
    sort: view.sort?.map((sort) => ({ ...sort })) ?? view.source.sort,
    groupBy: view.groupBy ? { ...view.groupBy } : view.source.groupBy,
    groupOrder: view.groupOrder ? [...view.groupOrder] : view.source.groupOrder,
    limit: view.limit ?? view.source.limit,
    order: view.order ? [...view.order] : view.source.order,
  });
}

/** What a toolbar control changes in one view. A key set to `undefined` is removed. */
export type QueryFileViewEdit = Partial<
  Pick<QueryFileView, "sort" | "groupBy" | "groupOrder" | "order" | "limit">
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
  // New filters for all views go first, where a `.base` file has them.
  const source = Object.hasOwn(file.source, "filters")
    ? file.source
    : { filters: undefined, ...file.source };
  const entries = merged(source, {
    filters: writeFilter(file.filters) ?? file.source.filters,
    views: file.views.map(writeView),
  });
  return stringify(entries, { lineWidth: 0 });
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

interface FilterLeaf extends FilterLocation {
  readonly from: number;
  readonly to: number;
}

/**
 * The Filter Expression of a filter tree, with the place of each condition in
 * it. A lone condition sits in the editor's root group, so its path is `[0]`.
 */
function composeFilter(
  tree: MatchTree,
  at: FilterLocation & { readonly offset: number },
): { text: string; leaves: FilterLeaf[] } {
  const { section, path, offset } = at;
  if (typeof tree === "string")
    return {
      text: tree,
      leaves: [{ section, path, from: offset, to: offset + tree.length }],
    };
  const [entries, joiner, empty] =
    "and" in tree ? [tree.and, " && ", "true"] : [tree.or, " || ", "false"];
  if (entries.length === 0) return { text: empty, leaves: [] };
  if (entries.length === 1)
    return composeFilter(entries[0]!, { section, path: [...path, 0], offset });
  let text = "";
  const leaves: FilterLeaf[] = [];
  entries.forEach((entry, index) => {
    if (index > 0) text += joiner;
    text += "(";
    const part = composeFilter(entry, {
      section,
      path: [...path, index],
      offset: offset + text.length,
    });
    text += `${part.text})`;
    leaves.push(...part.leaves);
  });
  return { text, leaves };
}

function composeSection(
  tree: MatchTree,
  section: FilterSection,
  offset: number,
) {
  return composeFilter(tree, {
    section,
    path: typeof tree === "string" ? [0] : [],
    offset,
  });
}

function composeView(
  file: QueryFile,
  view: QueryFileView,
): { text: string; leaves: FilterLeaf[] } | undefined {
  const sections: [MatchTree, FilterSection][] = [];
  if (
    file.filters !== undefined &&
    (view.from ?? "annotations") === allViewsDataset(file)
  )
    sections.push([file.filters, "all"]);
  if (view.filters !== undefined) sections.push([view.filters, "view"]);
  if (sections.length === 0) return undefined;
  if (sections.length === 1) {
    const [[tree, section]] = sections as [[MatchTree, FilterSection]];
    return composeSection(tree, section, 0);
  }
  let text = "";
  const leaves: FilterLeaf[] = [];
  sections.forEach(([tree, section], index) => {
    if (index > 0) text += " && ";
    text += "(";
    const part = composeSection(tree, section, text.length);
    text += `${part.text})`;
    leaves.push(...part.leaves);
  });
  return { text, leaves };
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
 * The file with new filters: for all views when `viewName` is `null`, else
 * for the view of that name. `undefined` removes the filters.
 */
export function withFilters(
  file: QueryFile,
  viewName: string | null,
  filters: MatchTree | undefined,
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
  if (viewName === null) return set(file);
  return {
    ...file,
    views: file.views.map((view) =>
      view.name === viewName ? set(view) : view,
    ),
  };
}
