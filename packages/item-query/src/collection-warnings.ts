import { Effect } from "effect";

import { readCollectionPaths, readLibraries } from "@zotlit/db/item-query";
import type { CollectionPaths } from "@zotlit/db/item-query";

import type { Span } from "./fault";
import type { FilterNode } from "./filter-plan";
import { nearCollectionMatches } from "./near-match";
import { parentFieldSubject } from "./parent-records";
import { annotationVocabulary } from "./record-vocabularies";
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
  pathsOf: (library: TargetLibrary) => CollectionPaths | undefined,
) {
  const paths = [
    ...new Set(
      libraries.flatMap((library) =>
        [...(pathsOf(library)?.values() ?? [])].map((path) => path.join("/")),
      ),
    ),
  ];
  const warnings = new Map<string, CollectionWarning>();
  const visit = (node: FilterNode<Item>) => {
    if (node.kind === "method" && ["contains", "within"].includes(node.name)) {
      const subject = node.subject;
      const collections = parentFieldSubject(
        subject,
        "collections",
        annotationVocabulary(),
      );
      const literal = node.args[0];
      if (
        collections &&
        literal?.kind === "literal" &&
        typeof literal.value === "string" &&
        !paths.includes(literal.value) &&
        !warnings.has(literal.value)
      ) {
        warnings.set(literal.value, {
          kind: "unknown-collection",
          path: literal.value,
          at: { from: literal.from, to: literal.to },
          suggestions: nearCollectionMatches(literal.value, paths),
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
    const others = (yield* readLibraries())
      .filter(
        (library) =>
          !libraries.some((target) => target.libraryID === library.libraryID),
      )
      .toSorted((a, b) => (a.groupID ?? -1) - (b.groupID ?? -1));
    for (const library of others) {
      const paths = yield* readCollectionPaths(library);
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
