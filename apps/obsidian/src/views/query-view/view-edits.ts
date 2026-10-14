// The edits the view menu and "Configure view" make to a Query File's views,
// as plain functions from one file to the next. Each one leaves every key it
// does not touch where it was, so a save writes them back.
import { ANNOTATIONS, ATTACHMENTS, ITEMS } from "@zotlit/item-query";

import { layoutsFor } from "./layouts";
import { editView, NEW_QUERY_FILE_LIMIT } from "./query-file";
import type {
  QueryFile,
  QueryFileDataset,
  QueryFileView,
  QueryFileViewEdit,
} from "./query-file";
import { groupPaths } from "./rows";
import { datasetProperties } from "./visible-properties";

/** A file after an edit, and the view to show in it. */
export interface ViewEdit {
  readonly file: QueryFile;
  readonly name: string;
}

/**
 * The characters a view name cannot hold: `#` and `|` would break an embed
 * link such as `![[Figures.zotquery#Yellow highlights]]`.
 */
export const VIEW_NAME_RESERVED = ["#", "|"] as const;

/** Why a name cannot stand for the view at `index` (`null` for a new view). */
export type ViewNameIssue = "empty" | "taken" | "invalid";

export function viewNameIssue(
  file: QueryFile,
  index: number | null,
  name: string,
): ViewNameIssue | null {
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if (VIEW_NAME_RESERVED.some((character) => trimmed.includes(character)))
    return "invalid";
  if (file.views.some((view, at) => at !== index && view.name === trimmed))
    return "taken";
  return null;
}

/** `base`, or `base 2`, `base 3`, … where the file already has a view of that name. */
export function freeViewName(file: QueryFile, base: string): string {
  const taken = new Set(file.views.map((view) => view.name));
  let name = base;
  for (let index = 2; taken.has(name); index++) name = `${base} ${index}`;
  return name;
}

function withViews(
  file: QueryFile,
  views: readonly QueryFileView[],
): QueryFile {
  return { ...file, views };
}

function replaced(
  file: QueryFile,
  index: number,
  view: QueryFileView,
): QueryFile {
  return withViews(
    file,
    file.views.map((candidate, at) => (at === index ? view : candidate)),
  );
}

/**
 * A new view of `dataset` at the end of the list, drawn by the first layout
 * of that dataset, with the new-file limit.
 */
export function addView(
  file: QueryFile,
  base: string,
  dataset: QueryFileDataset = "annotations",
): ViewEdit {
  const name = freeViewName(file, base);
  const view: QueryFileView = {
    type: layoutsFor({ from: dataset })[0]?.type ?? "annotations",
    name,
    from: dataset,
    limit: NEW_QUERY_FILE_LIMIT,
    problems: [],
    source: {},
  };
  return { file: withViews(file, [...file.views, view]), name };
}

export function renameView(
  file: QueryFile,
  index: number,
  name: string,
): QueryFile {
  return replaced(file, index, { ...file.views[index]!, name: name.trim() });
}

/** A copy of the view right after it, under a free name. */
export function duplicateView(file: QueryFile, index: number): ViewEdit {
  const view = file.views[index]!;
  const name = freeViewName(file, view.name);
  const copy: QueryFileView = {
    ...view,
    name,
    source: structuredClone(view.source),
  };
  const views = [...file.views];
  views.splice(index + 1, 0, copy);
  return { file: withViews(file, views), name };
}

/** The file without the view, and the view before it to show next. */
export function deleteView(file: QueryFile, index: number): ViewEdit {
  const views = file.views.filter((_, at) => at !== index);
  const next = views[Math.max(0, index - 1)];
  return { file: withViews(file, views), name: next?.name ?? "" };
}

/** The view moved to `to`; a move to `0` makes it the default view. */
export function moveView(file: QueryFile, from: number, to: number): QueryFile {
  const views = [...file.views];
  const [view] = views.splice(from, 1);
  views.splice(to, 0, view!);
  return withViews(file, views);
}

/** A layout key of the view set to `value`, or removed for `undefined`. */
export function setViewOption(
  file: QueryFile,
  index: number,
  { key, value }: { key: string; value: unknown },
): QueryFile {
  const view = file.views[index]!;
  const source: Record<string, unknown> = { ...view.source };
  if (value === undefined) delete source[key];
  else source[key] = value;
  return replaced(file, index, { ...view, source });
}

export function setViewLayout(
  file: QueryFile,
  index: number,
  type: string,
): QueryFile {
  return replaced(file, index, { ...file.views[index]!, type });
}

/** What a change of dataset took off a view, since the new dataset lacks it. */
export interface DatasetRemovals {
  /** The sort properties taken off. */
  readonly sort: readonly string[];
  /** The group property taken off, or `null`. */
  readonly groupBy: string | null;
  /** The visible properties taken off. */
  readonly order: readonly string[];
}

/** A file after a change of dataset, and what the change took off the view. */
export interface DatasetEdit {
  readonly file: QueryFile;
  readonly removed: DatasetRemovals;
}

const SORTABLE: Record<QueryFileDataset, readonly string[]> = {
  annotations: ANNOTATIONS.sortableFields,
  attachments: ATTACHMENTS.sortableFields,
  items: ITEMS.sortableFields,
};

/**
 * The view set to read `dataset`. A layout that cannot show the dataset
 * gives way to the dataset's first layout. The filters stay as they are: a
 * condition the new dataset cannot read shows the filter's diagnostic. The
 * sort keys, the grouping and the visible properties the dataset lacks come
 * off, and the edit names them, so the view runs and the researcher sees
 * what changed.
 */
export function setViewDataset(
  file: QueryFile,
  index: number,
  dataset: QueryFileDataset,
): DatasetEdit {
  const view = file.views[index]!;
  const layouts = layoutsFor({ from: dataset });
  const type = layouts.some((layout) => layout.type === view.type)
    ? view.type
    : (layouts[0]?.type ?? view.type);
  const sortable = new Set(SORTABLE[dataset]);
  const properties = new Set(datasetProperties(dataset));
  const sort = view.sort ?? [];
  const order = view.order ?? [];
  const keepsGroup =
    !view.groupBy || groupPaths(dataset).includes(view.groupBy.property);
  const removed: DatasetRemovals = {
    sort: sort
      .filter(({ property }) => !sortable.has(property))
      .map(({ property }) => property),
    groupBy: keepsGroup ? null : view.groupBy!.property,
    order: order.filter((property) => !properties.has(property)),
  };
  const edit: {
    -readonly [K in keyof QueryFileViewEdit]: QueryFileViewEdit[K];
  } = {};
  if (removed.sort.length > 0) {
    const kept = sort.filter(({ property }) => sortable.has(property));
    edit.sort = kept.length > 0 ? kept : undefined;
  }
  if (!keepsGroup) edit.groupBy = undefined;
  if (removed.order.length > 0) {
    const kept = order.filter((property) => properties.has(property));
    edit.order = kept.length > 0 ? kept : undefined;
  }
  const edited = editView(file, view, edit).views[index]!;
  return {
    file: replaced(file, index, {
      ...edited,
      type,
      from: dataset,
      problems: edited.problems.filter(
        (problem) =>
          !(problem.code === "invalid-value" && problem.key === "from"),
      ),
    }),
    removed,
  };
}
