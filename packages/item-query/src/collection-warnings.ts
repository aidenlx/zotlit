import { Effect } from "effect";

import { readLibraries } from "@zotlit/db/item-query";

import type { Span } from "./fault";
import type { FilterNode } from "./filter-plan";
import { nearCollectionMatches } from "./near-match";
import type { QuerySources } from "./query-sources";
import type { TargetLibrary } from "./request";

export interface CollectionWarning {
  readonly kind: "unknown-collection";
  readonly path: string;
  readonly at: Span;
  readonly suggestions: readonly string[];
}

/** Inspect every branch, including the predicates of Relation Lists. */
export const collectionWarnings = Effect.fnUntraced(function* <Item>(
  root: FilterNode<Item> | undefined,
  libraries: readonly TargetLibrary[],
  sources: QuerySources,
) {
  const warnings = new Map<string, CollectionWarning>();
  const visit = (node: FilterNode<Item>) => {
    if (node.kind === "method" && ["contains", "within"].includes(node.name)) {
      const subject = node.subject;
      const collections =
        subject.kind === "field"
          ? subject.name === "collections" ||
            subject.name.endsWith(".collections")
          : subject.kind === "property" &&
            subject.name === "collections" &&
            subject.subject.recordDataset === "items";
      const literal = node.args[0];
      if (
        collections &&
        literal?.kind === "literal" &&
        typeof literal.value === "string" &&
        !warnings.has(literal.value)
      ) {
        warnings.set(literal.value, {
          kind: "unknown-collection",
          path: literal.value,
          at: { from: literal.from, to: literal.to },
          suggestions: [],
        });
      }
    }
    switch (node.kind) {
      case "binary":
        visit(node.left);
        visit(node.right);
        break;
      case "unary":
        visit(node.operand);
        break;
      case "list":
        node.elements.forEach(visit);
        break;
      case "if":
        visit(node.condition);
        visit(node.whenTrue);
        if (node.whenFalse) visit(node.whenFalse);
        break;
      case "element":
        visit(node.expression);
        visit(node.subject);
        node.args.forEach(visit);
        break;
      case "method":
        visit(node.subject);
        node.args.forEach(visit);
        break;
      case "function":
        node.args.forEach(visit);
        break;
      case "property":
        visit(node.subject);
        break;
      case "index":
        visit(node.subject);
        visit(node.index);
        break;
    }
  };
  if (root) visit(root);
  if (warnings.size > 0) {
    const paths: string[] = [];
    for (const library of libraries) {
      for (const path of (yield* sources.collectionPaths(library)).values())
        paths.push(path.join("/"));
    }
    for (const [path, warning] of warnings) {
      if (paths.includes(path)) warnings.delete(path);
      else
        warnings.set(path, {
          ...warning,
          suggestions: nearCollectionMatches(path, [...new Set(paths)]),
        });
    }
  }
  if (warnings.size > 0) {
    const others = (yield* readLibraries())
      .filter(
        (library) =>
          !libraries.some((target) => target.libraryID === library.libraryID),
      )
      .toSorted((a, b) => (a.groupID ?? -1) - (b.groupID ?? -1));
    for (const library of others) {
      const paths = yield* sources.collectionPaths(library);
      const selector =
        library.groupID === null ? "personal" : `group:${library.groupID}`;
      for (const path of new Set(
        [...paths.values()].map((path) => path.join("/")),
      )) {
        const warning = warnings.get(path);
        if (warning)
          warnings.set(path, {
            ...warning,
            suggestions: [...warning.suggestions, `library=${selector}`],
          });
      }
    }
  }
  return [...warnings.values()];
});
