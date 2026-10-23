// What the ZotLit oxlint plugins share: the rule type and the AST they read.
import type { RuleTester } from "oxlint/plugins-dev";

export type Rule = Parameters<RuleTester["run"]>[1];

/** The fields these rules read; every ESTree node fits it. */
export interface AstNode {
  readonly type: string;
  readonly parent?: AstNode | null;
  readonly name?: unknown;
  readonly value?: unknown;
  readonly computed?: boolean;
  readonly generator?: boolean;
  readonly kind?: string;
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly callee?: AstNode;
  readonly arguments?: readonly AstNode[];
  readonly superClass?: AstNode | null;
}

/** `<object>.<name>`, where `object` names one of `objects` and `name` matches. */
export function isMemberOf(
  node: AstNode | undefined,
  objects: ReadonlySet<string>,
  name: (property: string) => boolean,
): boolean {
  return (
    node?.type === "MemberExpression" &&
    !node.computed &&
    node.object?.type === "Identifier" &&
    objects.has(node.object.name as string) &&
    node.property?.type === "Identifier" &&
    typeof node.property.name === "string" &&
    name(node.property.name)
  );
}
