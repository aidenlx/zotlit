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

export interface ModuleStatement extends AstNode {
  readonly importKind?: string;
  readonly exportKind?: string;
  readonly specifiers?: readonly {
    readonly importKind?: string;
    readonly exportKind?: string;
  }[];
  readonly source?: {
    readonly value?: unknown;
  };
}

export interface ModuleProgram extends AstNode {
  readonly body?: readonly ModuleStatement[];
}

/** An import, re-export or `export *`: a statement with a module source. */
export function hasSource(node: ModuleStatement): boolean {
  return (
    node.type === "ImportDeclaration" ||
    node.type === "ExportNamedDeclaration" ||
    node.type === "ExportAllDeclaration"
  );
}

function isEffectModule(source: string): boolean {
  return (
    source === "effect" ||
    source.startsWith("effect/") ||
    source === "@/lib/effect" ||
    source.startsWith("@/lib/effect-")
  );
}

/**
 * A type-only import of the Effect bridge names the seam a legacy file holds,
 * not Effect code in the file (policies/services.md → Bridge).
 */
function isBridgeType(statement: ModuleStatement, source: string): boolean {
  return (
    statement.type === "ImportDeclaration" &&
    statement.importKind === "type" &&
    source === "@/lib/effect-bridge"
  );
}

/**
 * Whether a module imports Effect: any import or re-export from `effect`,
 * `@/lib/effect` or one of their submodules, but not a type-only import of the
 * bridge. `importsEffectValue` is the stricter test: it skips every type-only
 * import.
 */
export function importsEffect(statements: readonly ModuleStatement[]): boolean {
  return statements.some((statement) => {
    if (!hasSource(statement)) return false;
    const source = statement.source?.value;
    return (
      typeof source === "string" &&
      isEffectModule(source) &&
      !isBridgeType(statement, source)
    );
  });
}

/**
 * A statement that brings in types only: `import type`, `export type … from`,
 * or an import or re-export whose every specifier is `type`. It loads no
 * module code.
 */
function isTypeOnly(statement: ModuleStatement): boolean {
  if (statement.importKind === "type" || statement.exportKind === "type")
    return true;
  const specifiers = statement.specifiers ?? [];
  return (
    specifiers.length > 0 &&
    specifiers.every(
      (specifier) =>
        specifier.importKind === "type" || specifier.exportKind === "type",
    )
  );
}

/**
 * Whether a module runs Effect code: a value import or re-export from
 * `effect`, `effect/*`, `@effect/*`, `@/lib/effect` or `@/lib/effect-*` (the
 * repo's own Effect modules, the bridge included). A type-only import does not
 * count, so a legacy file that names an Effect module's type stays a legacy
 * file (`src/lib/modal-answer.ts`).
 */
export function importsEffectValue(
  statements: readonly ModuleStatement[],
): boolean {
  return statements.some((statement) => {
    if (!hasSource(statement) || isTypeOnly(statement)) return false;
    const source = statement.source?.value;
    return (
      typeof source === "string" &&
      (isEffectModule(source) || source.startsWith("@effect/"))
    );
  });
}
