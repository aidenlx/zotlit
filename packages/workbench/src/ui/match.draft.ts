import type { Span } from "#/language/span";
import type { ReactNode } from "react";

import { filterGroup } from "@zotlit/filter-expression";
import type {
  FilterGroupKind,
  FilterPath,
  FilterTree,
} from "@zotlit/filter-expression";

// Preserve nested Match trees and expression rows through labelled edits.

/** A leaf the visual rows cannot show: its Filter Expression, as written. */
export interface ExpressionCondition {
  kind: "expression";
  text: string;
}

/**
 * A row a condition kind shows with its own controls. `kind` names its entry
 * in the vocabulary; `"group"` and `"expression"` belong to the editor.
 */
export interface LabelledRow {
  kind: string;
}

/** A condition the editor shows as one row. */
export type RowCondition<Row extends LabelledRow> = Row | ExpressionCondition;
/** `all`: every condition must hold; `any`: one must; `none`: none may. */
export type GroupMatch = "all" | "any" | "none";
export interface ConditionGroup<Row extends LabelledRow> {
  kind: "group";
  match: GroupMatch;
  conditions: EditorCondition<Row>[];
}
export type EditorCondition<Row extends LabelledRow> =
  | ConditionGroup<Row>
  | RowCondition<Row>;

/** A child's position in the tree: the index at each nesting level. */
export type ConditionPath = readonly number[];

/**
 * A stored filter: a Filter Tree, whose `and`, `or`, and `not` groups the
 * editor shows as "All", "Any", and "None" groups.
 */
export type MatchFilter = FilterTree;

const GROUP_MATCH: Record<FilterGroupKind, GroupMatch> = {
  and: "all",
  or: "any",
  not: "none",
};

/** The controls of one labelled row, wired to its value. */
export interface ConditionControlProps<Row extends LabelledRow> {
  condition: Row;
  onChange: (next: Row) => void;
}

/** One thing a condition can test: its label, its controls, and its expression text. */
export interface MatchConditionKind<Row extends LabelledRow> {
  kind: Row["kind"];
  /** The name the kind picker shows, in the reader's language. */
  label: string;
  /** The icon the kind picker shows before the chosen kind's name, if any. */
  icon?: ReactNode;
  /** Muted text after the name in the kind picker's list, such as a field's path. */
  detail?: string;
  /**
   * A row of this kind at its starting value. It has no value yet, so it
   * stores nothing until the user gives it one.
   */
  fresh: () => Row;
  /** The row one Filter Expression leaf reads as, or `null` when it is not this kind. */
  parse: (text: string) => Row | null;
  /** The Filter Expression a row of this kind stores; `null` while the row has no value. */
  format: (row: Row) => string | null;
  /** The operator control, shown after the kind picker. */
  renderOperator?: (props: ConditionControlProps<Row>) => ReactNode;
  /** The value control. */
  renderValue: (props: ConditionControlProps<Row>) => ReactNode;
}

/** The conditions a Match editor offers, which its caller supplies. */
export interface MatchVocabulary<Row extends LabelledRow> {
  kinds: readonly MatchConditionKind<Row>[];
  /** The kind of a placeholder row: what "Add condition" adds and a new group starts with. */
  newKind: Row["kind"];
  /**
   * What keeps one row from being saved, as the reader reads it. `path` is
   * the row's place in the stored filter; a row that stores nothing is not
   * asked.
   */
  issue?: (condition: RowCondition<Row>, path: FilterPath) => string | null;
  /**
   * The Faults an expression row underlines in `text`, its Filter
   * Expression as typed. A row asks again only when this function, the text
   * or the place changes, so a host keeps one function while its Faults stay
   * the same.
   * @param path The row's place in the stored filter.
   */
  faults?: (text: string, path: FilterPath) => readonly Span[];
}

export function isGroup<Row extends LabelledRow>(
  node: EditorCondition<Row>,
): node is ConditionGroup<Row> {
  return node.kind === "group";
}

export function isExpression<Row extends LabelledRow>(
  node: RowCondition<Row>,
): node is ExpressionCondition {
  return node.kind === "expression";
}

function kindOf<Row extends LabelledRow>(
  vocabulary: MatchVocabulary<Row>,
  kind: Row["kind"],
): MatchConditionKind<Row> {
  const entry = vocabulary.kinds.find((entry) => entry.kind === kind);
  if (!entry) throw new Error(`Unknown Match condition kind: ${kind}`);
  return entry;
}

/** A row of `kind` at its starting value. */
export function freshRow<Row extends LabelledRow>(
  vocabulary: MatchVocabulary<Row>,
  kind: Row["kind"],
): Row {
  return kindOf(vocabulary, kind).fresh();
}

/**
 * The tree of a stored filter. A leaf that one condition kind reads becomes
 * that row; any other leaf — a blank, a problem, or an expression that
 * combines tests — stays as written in an expression row. A lone leaf sits
 * in an "All" group, and a group with no conditions — or no filter at all —
 * shows a placeholder row.
 */
export function fromFilter<Row extends LabelledRow>(
  filter: MatchFilter | undefined,
  vocabulary: MatchVocabulary<Row>,
): ConditionGroup<Row> {
  const node: EditorCondition<Row> =
    filter === undefined
      ? { kind: "group", match: "all", conditions: [] }
      : editorNode(filter, vocabulary);
  return settle(
    isGroup(node) ? node : { kind: "group", match: "all", conditions: [node] },
    vocabulary,
  );
}

function editorNode<Row extends LabelledRow>(
  filter: MatchFilter,
  vocabulary: MatchVocabulary<Row>,
): EditorCondition<Row> {
  if (typeof filter === "string")
    return (
      asLabelled({ kind: "expression", text: filter }, vocabulary) ?? {
        kind: "expression",
        text: filter,
      }
    );
  const [kind, entries] = filterGroup(filter);
  return {
    kind: "group",
    match: GROUP_MATCH[kind],
    conditions: entries.map((entry) => editorNode(entry, vocabulary)),
  };
}

/** What an editor tree stores, and where each of its rows sits in it. */
export interface StoredFilter {
  /** `undefined` when the tree stores nothing. */
  readonly filter: MatchFilter | undefined;
  /** The place in `filter` of each row that stores a condition, by its editor path. */
  readonly places: ReadonlyMap<string, FilterPath>;
}

/** The key of an editor path in {@link StoredFilter.places}. */
export const placeKey = (path: ConditionPath): string => path.join(".");

/**
 * The filter a tree stores: rows as their kind writes them, expression rows
 * as typed. A row with no value, a blank expression row, and a group that
 * keeps no condition store nothing, so the places of later rows close up.
 */
export function storedFilter<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  vocabulary: MatchVocabulary<Row>,
): StoredFilter {
  const places = new Map<string, FilterPath>();
  const visit = (
    group: ConditionGroup<Row>,
    path: ConditionPath,
    place: FilterPath,
  ): MatchFilter | undefined => {
    const entries: MatchFilter[] = [];
    group.conditions.forEach((node, index) => {
      const at = [...path, index];
      const next = [...place, entries.length];
      let stored: MatchFilter | undefined;
      if (isGroup(node)) stored = visit(node, at, next);
      else {
        stored = isExpression(node)
          ? node.text.trim() === ""
            ? undefined
            : node.text
          : (kindOf(vocabulary, node.kind).format(node) ?? undefined);
        if (stored !== undefined) places.set(placeKey(at), next);
      }
      if (stored !== undefined) entries.push(stored);
    });
    if (entries.length === 0) return undefined;
    switch (group.match) {
      case "all":
        return { and: entries };
      case "any":
        return { or: entries };
      case "none":
        return { not: entries };
    }
  };
  return { filter: visit(root, [], []), places };
}

/**
 * Whether `vocabulary` offers the kind of every labelled row in `root`. Rows
 * belong to the vocabulary that made them, so a tree that does not fit reads
 * again from its stored filter.
 */
export function fitsVocabulary<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  vocabulary: MatchVocabulary<Row>,
): boolean {
  return root.conditions.every((node) =>
    isGroup(node)
      ? fitsVocabulary(node, vocabulary)
      : isExpression(node) ||
        vocabulary.kinds.some((entry) => entry.kind === node.kind),
  );
}

/** Whether `root` stores `filter`, so that reading `filter` again changes nothing. */
export function storesFilter<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  filter: MatchFilter | undefined,
  vocabulary: MatchVocabulary<Row>,
): boolean {
  return (
    JSON.stringify(storedFilter(root, vocabulary).filter) ===
    JSON.stringify(filter)
  );
}

/** A row of the vocabulary's placeholder kind, which stores nothing yet. */
export function placeholderRow<Row extends LabelledRow>(
  vocabulary: MatchVocabulary<Row>,
): Row {
  return freshRow(vocabulary, vocabulary.newKind);
}

/**
 * `root` as the editor shows it: a nested group with no conditions left goes
 * away, and a root with no conditions left shows one placeholder row.
 */
export function settle<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  vocabulary: MatchVocabulary<Row>,
): ConditionGroup<Row> {
  const prune = (group: ConditionGroup<Row>): ConditionGroup<Row> => ({
    ...group,
    conditions: group.conditions.flatMap((child): EditorCondition<Row>[] => {
      if (!isGroup(child)) return [child];
      const pruned = prune(child);
      return pruned.conditions.length === 0 ? [] : [pruned];
    }),
  });
  const pruned = prune(root);
  return pruned.conditions.length === 0
    ? { ...pruned, conditions: [placeholderRow(vocabulary)] }
    : pruned;
}

/** `root` with the group at `path` replaced by `fn`'s result. */
export function updateGroup<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
  fn: (group: ConditionGroup<Row>) => ConditionGroup<Row>,
): ConditionGroup<Row> {
  if (path.length === 0) return fn(root);
  const [index, ...rest] = path;
  return {
    ...root,
    conditions: root.conditions.map((child, at) =>
      at === index && isGroup(child) ? updateGroup(child, rest, fn) : child,
    ),
  };
}

/** `root` with the condition at `path` replaced by `next`. */
export function replaceAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
  next: EditorCondition<Row>,
): ConditionGroup<Row> {
  const index = path.at(-1)!;
  return updateGroup(root, path.slice(0, -1), (group) => ({
    ...group,
    conditions: group.conditions.map((child, at) =>
      at === index ? next : child,
    ),
  }));
}

/** `root` without the condition at `path`. */
export function removeAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
): ConditionGroup<Row> {
  const index = path.at(-1)!;
  return updateGroup(root, path.slice(0, -1), (group) => ({
    ...group,
    conditions: group.conditions.filter((_, at) => at !== index),
  }));
}

/** `root` with `child` appended to the group at `path`. */
export function appendAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
  child: EditorCondition<Row>,
): ConditionGroup<Row> {
  return updateGroup(root, path, (group) => ({
    ...group,
    conditions: [...group.conditions, child],
  }));
}

/** Whether `path` is `prefix` or names a node inside it. */
export function pathStartsWith(
  path: ConditionPath,
  prefix: ConditionPath,
): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((at, depth) => path[depth] === at)
  );
}

export function samePath(a: ConditionPath, b: ConditionPath): boolean {
  return a.length === b.length && pathStartsWith(a, b);
}

function nodeAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
): EditorCondition<Row> | undefined {
  let node: EditorCondition<Row> | undefined = root;
  for (const index of path)
    node = node && isGroup(node) ? node.conditions[index] : undefined;
  return node;
}

/** A place in a Match tree: the index in the group at `group`. */
export interface ConditionPlace {
  group: ConditionPath;
  index: number;
}

/**
 * `root` with the condition at `from` moved to `to`: into the group at
 * `to.group`, at `to.index` among that group's conditions once the moved one
 * has left. `to.group` names the group as it sits before the move. A group the move
 * empties stays here; the editor's {@link settle} removes it. A move to the
 * condition's own place, a group moved into itself, or a path that names no
 * node answers `root` itself.
 */
export function moveAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  from: ConditionPath,
  { group: toGroup, index }: ConditionPlace,
): ConditionGroup<Row> {
  const node = nodeAt(root, from);
  const target = nodeAt(root, toGroup);
  if (from.length === 0 || !node || !target || !isGroup(target)) return root;
  if (pathStartsWith(toGroup, from)) return root;
  const parent = from.slice(0, -1);
  const removed = from.at(-1)!;
  if (samePath(parent, toGroup) && index === removed) return root;
  // The target's step at the depth of `from` shifts back once `from` leaves.
  const shifted = toGroup.map((at, depth) =>
    depth === parent.length && pathStartsWith(toGroup, parent) && at > removed
      ? at - 1
      : at,
  );
  return updateGroup(removeAt(root, from), shifted, (group) => {
    const conditions = [...group.conditions];
    conditions.splice(Math.max(0, Math.min(index, conditions.length)), 0, node);
    return { ...group, conditions };
  });
}

/** A labelled row as an expression row: its meaning, as text. */
export function asExpression<Row extends LabelledRow>(
  condition: Row,
  vocabulary: MatchVocabulary<Row>,
): ExpressionCondition {
  return {
    kind: "expression",
    text: kindOf(vocabulary, condition.kind).format(condition) ?? "",
  };
}

/**
 * An expression row as a labelled row, when one condition kind reads its
 * text; `null` while it reads as anything else.
 */
export function asLabelled<Row extends LabelledRow>(
  condition: ExpressionCondition,
  vocabulary: MatchVocabulary<Row>,
): Row | null {
  for (const kind of vocabulary.kinds) {
    const row = kind.parse(condition.text);
    if (row) return row;
  }
  return null;
}

/** A new group: "All" of one placeholder row. */
export function freshGroup<Row extends LabelledRow>(
  vocabulary: MatchVocabulary<Row>,
): ConditionGroup<Row> {
  return {
    kind: "group",
    match: "all",
    conditions: [placeholderRow(vocabulary)],
  };
}
