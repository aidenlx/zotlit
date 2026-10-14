// The edits the view menu and "Configure view" make to a Query File's views,
// as plain functions from one file to the next. Each one leaves every key it
// does not touch where it was, so a save writes them back.
import { NEW_QUERY_FILE_LIMIT } from "./query-file";
import type { QueryFile, QueryFileView } from "./query-file";

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

/** A new Annotations view at the end of the list, with the new-file limit. */
export function addView(file: QueryFile, base: string): ViewEdit {
  const name = freeViewName(file, base);
  const view: QueryFileView = {
    type: "annotations",
    name,
    from: "annotations",
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
