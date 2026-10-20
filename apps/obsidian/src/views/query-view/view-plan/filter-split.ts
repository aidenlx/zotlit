// The split of one view's filters, made once for each plan of the view: the
// conditions the vault answers, the ones it cannot answer apart from ZotLit
// Query, and the Filter Expression ZotLit Query runs in their place, with
// where a fault in that text lands. Each leaf of the filters is parsed once,
// and one walker of its syntax tree decides whether a condition reads a
// vault property. Part of the View Plan; nothing else reads it.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import {
  composeFilterTree,
  filterGroup,
  joinComposed,
  parseExpressionAst,
} from "@zotlit/filter-expression";
import type {
  ComposedFilter,
  ExpressionNode,
  FilterLeaf,
  FilterTree,
} from "@zotlit/filter-expression";
import type { Span } from "@zotlit/workbench/language";

import type { PlacedFault } from "@/views/query-view/expression-faults";
import { allViewsDataset } from "@/views/query-view/query-file";
import type {
  FilterLocation,
  FilterSection,
  QueryFile,
  QueryFileView,
} from "@/views/query-view/query-file";

/** A vault property in a condition: its name, and where the condition's text reads it. */
export interface VaultRead {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

/**
 * One condition of a view's filters that reads a vault property and must
 * hold for every row, where the Match editor shows it.
 */
export interface VaultCondition extends FilterLocation {
  /** Its Filter Expression. */
  readonly text: string;
  /**
   * Where the text reads each vault property; `null` where it reads anything
   * else of the row as well, such as a Zotero field or `this`, or names a
   * vault property it does not spell out.
   */
  readonly reads: readonly VaultRead[] | null;
  /** The text of the condition it is a conjunct of, and where it starts there. */
  readonly within: ConditionLeaf;
}

/** A fault in one condition, with its place in the condition's text. */
export interface ConditionFault extends FilterLocation {
  readonly fault: PlacedFault;
}

/** The Filter Expression ZotLit Query runs, and the condition a fault in it marks. */
export interface EngineFilter {
  readonly text: string;
  /** The condition a fault at `span` marks; `null` where the span falls inside no one condition. */
  locate(span: Span): ConditionFault | null;
}

/** One view's filters, split between the vault and ZotLit Query. */
export interface FilterSplit {
  /** The conditions the vault answers, in the order of the filters. */
  readonly vault: readonly VaultCondition[];
  /**
   * The conditions that read a vault property but need not hold for every
   * row, such as one inside an `or` or a `not` group, which the vault cannot
   * answer apart from ZotLit Query.
   */
  readonly stranded: readonly FilterLocation[];
  /**
   * The filters without the vault conditions, and `keys`, the condition on
   * the Indexed Key that stands for them, on a line of its own after the
   * others. `undefined` where neither names a condition ZotLit Query reads.
   */
  engine(keys: string | null): EngineFilter | undefined;
}

/**
 * A condition of a section that must hold for every row: where it sits in
 * the text of its leaf, and whether it reads a vault property.
 */
interface Conjunct {
  readonly from: number;
  readonly to: number;
  /** `undefined` where it reads no vault property. */
  readonly vault: VaultCondition | undefined;
}

/**
 * The text of a leaf's condition, and where the leaf's text starts in it: a
 * leaf may hold one conjunct of its condition alone.
 */
export interface ConditionLeaf {
  readonly text: string;
  readonly offset: number;
}

type Composed = ComposedFilter<FilterLocation & FilterLeaf & ConditionLeaf>;

/** Split the filters of one view: the file's for all views of its dataset, then its own. */
export function splitFilters(
  file: QueryFile,
  view: QueryFileView,
): FilterSplit {
  const vault: VaultCondition[] = [];
  const stranded: FilterLocation[] = [];
  const parts: Composed[] = [];
  for (const [tree, section] of filterSections(file, view)) {
    const split = splitSection(tree, section);
    vault.push(...split.vault);
    stranded.push(...split.stranded);
    if (split.engine) parts.push(split.engine);
  }
  const filters = parts.length === 0 ? undefined : joinComposed(parts, " && ");
  return {
    vault,
    stranded,
    engine(keys) {
      const composed = withKeys(filters, keys);
      if (!composed) return undefined;
      return {
        text: composed.text,
        locate: ({ from, to }) => {
          const leaf = composed.leaves.find(
            (leaf) => leaf.from <= from && to <= leaf.to,
          );
          if (!leaf) return null;
          const by = leaf.offset - leaf.from;
          return {
            section: leaf.section,
            path: leaf.path,
            fault: {
              text: leaf.text,
              span: { from: from + by, to: to + by },
            },
          };
        },
      };
    },
  };
}

/** The filters of one view: the file's for all views of its dataset, then its own. */
function filterSections(
  file: QueryFile,
  view: QueryFileView,
): [FilterTree, FilterSection][] {
  const sections: [FilterTree, FilterSection][] = [];
  if (
    file.filters !== undefined &&
    (view.from ?? "annotations") === allViewsDataset(file)
  )
    sections.push([file.filters, "all"]);
  if (view.filters !== undefined) sections.push([view.filters, "view"]);
  return sections;
}

/**
 * The split of one section. The conditions that must each hold for every
 * row are the section itself where it is one condition, else the leaves of
 * its root `and` group, each leaf split at the `&&` of its top level. A
 * vault condition is one of these, or it is stranded.
 */
function splitSection(
  tree: FilterTree,
  section: FilterSection,
): {
  vault: VaultCondition[];
  stranded: FilterLocation[];
  engine: Composed | null;
} {
  const vault: VaultCondition[] = [];
  const stranded: FilterLocation[] = [];
  // A leaf that is its whole condition is the text it spans.
  const at = <T extends FilterLeaf & Partial<ConditionLeaf>>(
    composed: ComposedFilter<T>,
  ): Composed => ({
    text: composed.text,
    leaves: composed.leaves.map((leaf) => ({
      ...leaf,
      section,
      text: leaf.text ?? composed.text.slice(leaf.from, leaf.to),
      offset: leaf.offset ?? 0,
    })),
  });
  // A leaf that keeps some of its conjuncts composes them alone, each one a
  // leaf at the leaf's path; `null` where it keeps none.
  const heldLeaf = (text: string, path: readonly number[]) => {
    const conjuncts = leafConjuncts(text, section, path);
    const kept = conjuncts.filter((conjunct) => {
      if (conjunct.vault) vault.push(conjunct.vault);
      return !conjunct.vault;
    });
    if (kept.length === conjuncts.length)
      return { text, leaves: [{ path, from: 0, to: text.length }] };
    if (kept.length === 0) return null;
    return joinComposed(
      kept.map(({ from, to }) => ({
        text: text.slice(from, to),
        leaves: [{ path, from: 0, to: to - from, text, offset: from }],
      })),
      " && ",
    );
  };
  // A leaf of a nested group is stranded where it reads a vault property.
  // `composed` holds the leaves of the group, at their paths in `tree`.
  const strandedLeaves = (composed: ComposedFilter) => {
    for (const { path, from, to } of composed.leaves) {
      const { ast } = parseExpressionAst(composed.text.slice(from, to));
      if (ast !== null && vaultUse(ast, 0).names)
        stranded.push({ section, path });
    }
    return composed;
  };

  if (typeof tree === "string") {
    const engine = heldLeaf(tree, [0]);
    return { vault, stranded, engine: engine && at(engine) };
  }
  const [kind, entries] = filterGroup(tree);
  if (kind !== "and")
    return {
      vault,
      stranded,
      engine: at(strandedLeaves(composeFilterTree(tree))),
    };
  const kept = entries.flatMap((entry, index) => {
    if (typeof entry === "string") {
      const composed = heldLeaf(entry, [index]);
      return composed === null ? [] : [composed];
    }
    // An entry composed alone counts its paths from itself; in `tree` they
    // sit under its index.
    const { text, leaves } = composeFilterTree(entry);
    return [
      strandedLeaves({
        text,
        leaves: leaves.map((leaf) => ({
          ...leaf,
          path: [index, ...leaf.path],
        })),
      }),
    ];
  });
  // A section that hands every condition to ZotLit Query composes as it is.
  if (vault.length === 0)
    return { vault, stranded, engine: at(composeFilterTree(tree)) };
  return {
    vault,
    stranded,
    engine: kept.length === 0 ? null : at(joinComposed(kept, " && ")),
  };
}

/**
 * The operands of the `&&` chain at the top level of one leaf, past any
 * parentheses around them, each with the vault condition it is; the whole
 * leaf where it is no such chain, and a leaf that does not parse reads no
 * vault property.
 */
function leafConjuncts(
  text: string,
  section: FilterSection,
  path: readonly number[],
): Conjunct[] {
  const { ast } = parseExpressionAst(text);
  if (ast === null) return [{ from: 0, to: text.length, vault: undefined }];
  const operands = (node: ExpressionNode): ExpressionNode[] =>
    node.type === "group"
      ? operands(node.expression)
      : node.type === "binary" && node.operator === "&&"
        ? [...operands(node.left), ...operands(node.right)]
        : [node];
  return operands(ast).map((node) => {
    const { from, to } = node;
    const use = vaultUse(node, from);
    return {
      from,
      to,
      vault: use.names
        ? {
            section,
            path,
            text: text.slice(from, to),
            reads: use.reads,
            within: { text, offset: from },
          }
        : undefined,
    };
  });
}

/**
 * How a condition reads the vault: whether it names `vault` at all, and the
 * vault properties it reads, as `vault.name` or `vault["name"]`, at their
 * places from `offset`; `reads` is `null` where it reads anything else of
 * the row, such as a Zotero field or `this`, or names a vault property it
 * does not spell out. The one walker that tells a vault condition.
 */
function vaultUse(
  node: ExpressionNode,
  offset: number,
): { names: boolean; reads: VaultRead[] | null } {
  const reads: VaultRead[] = [];
  let names = false;
  const isVault = (node: ExpressionNode) =>
    node.type === "identifier" && node.name === "vault";
  const read = (name: string, { from, to }: ExpressionNode) => {
    names = true;
    reads.push({ name, from: from - offset, to: to - offset });
    return true;
  };
  // Whether the node reads nothing but vault properties it spells out. Every
  // part is visited, so `names` sees each `vault`.
  const all = (nodes: readonly ExpressionNode[]) =>
    nodes.map(visit).every(Boolean);
  const visit = (node: ExpressionNode): boolean => {
    switch (node.type) {
      case "identifier":
        if (node.name === "vault") names = true;
        return false;
      case "object-access":
        return isVault(node.object)
          ? read(node.property, node)
          : visit(node.object);
      case "array-access":
        if (isVault(node.object) && node.index.type === "string")
          return read(node.index.value, node);
        return all([node.object, node.index]);
      case "binary":
        return all([node.left, node.right]);
      case "unary":
        return visit(node.operand);
      case "call":
        // A function, such as `date(...)`, is named by its identifier.
        if (node.callee.type === "identifier") {
          if (node.callee.name === "vault") names = true;
          return all(node.args);
        }
        return all([node.callee, ...node.args]);
      case "array":
        return all(node.elements);
      case "group":
        return visit(node.expression);
      default:
        return true;
    }
  };
  const alone = visit(node);
  return { names, reads: alone ? reads : null };
}

/**
 * The filters and `keys`, which must both hold. A long list of keys on a
 * line of its own stays out of the line a fault in the filters shows.
 */
function withKeys(
  filters: Composed | undefined,
  keys: string | null,
): Composed | undefined {
  if (!keys) return filters;
  const condition = { text: keys, leaves: [] };
  return filters ? joinComposed([filters, condition], "\n&& ") : condition;
}
