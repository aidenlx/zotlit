// Validation of a Filter Expression against the registries. The result is a
// typed tree in which every name is resolved, so that execution and the
// planner read one structure.
import { parseExpressionAst } from "@zotlit/filter-expression";
import type { BinaryOperator, ExpressionNode } from "@zotlit/filter-expression";

import type { Callee, Fault, Receiver, Role, Span } from "./fault";
export type { Span } from "./fault";
import { BUILT_IN_NAMES, customFilterValue, filterField } from "./fields";
import type {
  FieldNeeds,
  FilterValueDefinition,
  QueryItem,
  FilterField,
} from "./fields";
import {
  GLOBAL_FUNCTION_NAMES,
  GLOBAL_FUNCTIONS,
  IF_FUNCTION,
  methodOf,
  methodsNamed,
  parameterAt,
  parameterTypes,
  propertiesNamed,
  propertyOf,
  takesType,
} from "./filter-functions";
import type { FunctionDefinition } from "./filter-functions";
import type { FilterValue, FilterValueType } from "./filter-values";

/**
 * The type of a node's value as validation knows it. Each type also holds
 * null. `unknown`: the type depends on the Item.
 */
export type StaticType = FilterValueType | "unknown";

interface NodeBase extends Span {
  readonly valueType: StaticType;
}

/** One node of a validated Filter Expression. */
export type FilterNode<Item = QueryItem> = NodeBase &
  (
    | { readonly kind: "literal"; readonly value: FilterValue }
    | { readonly kind: "list"; readonly elements: readonly FilterNode<Item>[] }
    | {
        /** A built-in field, read by its bare name. */
        readonly kind: "field";
        readonly name: string;
        readonly value: FilterValueDefinition<Item>;
      }
    | {
        /** A custom field of the source, by its exact source name. */
        readonly kind: "custom-field";
        readonly name: string;
        /** The filter reads it by a bare name, not as `custom["name"]`. */
        readonly bare: boolean;
        readonly value: FilterValueDefinition<Item>;
      }
    | {
        /** A name an element expression binds: `value`, `index`, or `acc`. */
        readonly kind: "binding";
        readonly name: string;
      }
    | {
        /**
         * An element-expression method: the evaluator runs `expression` once
         * for each element of `subject` with the names of `scope` bound. The
         * further arguments are evaluated once, outside the binding.
         */
        readonly kind: "element";
        readonly name: string;
        readonly subject: FilterNode<Item>;
        readonly scope: readonly string[];
        readonly expression: FilterNode<Item>;
        readonly args: readonly FilterNode<Item>[];
      }
    | {
        readonly kind: "unary";
        readonly operator: "!" | "-";
        readonly operand: FilterNode<Item>;
      }
    | {
        readonly kind: "binary";
        readonly operator: BinaryOperator;
        readonly left: FilterNode<Item>;
        readonly right: FilterNode<Item>;
      }
    | {
        readonly kind: "if";
        readonly condition: FilterNode<Item>;
        readonly whenTrue: FilterNode<Item>;
        readonly whenFalse: FilterNode<Item> | null;
      }
    | {
        readonly kind: "function";
        readonly name: string;
        readonly definition: FunctionDefinition;
        readonly args: readonly FilterNode<Item>[];
      }
    | {
        /** The value type of the subject at execution selects the method. */
        readonly kind: "method";
        readonly name: string;
        readonly subject: FilterNode<Item>;
        readonly args: readonly FilterNode<Item>[];
      }
    | {
        readonly kind: "property";
        readonly name: string;
        readonly subject: FilterNode<Item>;
      }
    | {
        readonly kind: "index";
        readonly subject: FilterNode<Item>;
        readonly index: FilterNode<Item>;
      }
  );

/** A validated Filter Expression. */
export interface FilterPlan<Item = QueryItem> {
  readonly root: FilterNode<Item>;
  readonly warnings: readonly Extract<Fault, { kind: "constant" }>[];
  /** What hydration loads before the filter runs: one entry for each field. */
  readonly needs: readonly FieldNeeds[];
  /**
   * The custom fields the filter names. The source decides whether each one
   * exists, so the engine checks them when it has read the field vocabulary.
   */
  readonly customFields: readonly FilterCustomFieldUse[];
}

interface FilterCustomFieldUse extends Span {
  readonly name: string;
  readonly bare: boolean;
  readonly deferred?: Extract<Fault, { kind: "unknown" }>;
  /** A valid property chain to check only when the source lacks its prefix. */
  readonly dotted?: Span & { readonly name: string };
}

type FilterFailure = Extract<
  Fault,
  {
    readonly kind:
      | "plain"
      | "unknown"
      | "arity"
      | "argument-type"
      | "unreadable";
  }
> & { readonly at: Span };
export type FilterProblem =
  | FilterFailure
  | Extract<Fault, { readonly kind: "syntax" }>;

class Invalid extends Error {
  constructor(readonly problem: FilterFailure) {
    super(problem.kind);
  }
}

const quote = (text: string): string => JSON.stringify(text);

const HINTS = {
  custom: 'Name one custom field, such as custom["review.status"].',
  regexp:
    "Write a regular expression as /pattern/flags with JavaScript syntax, such as /^the /i, and the flags d, g, i, m, s, u, v, and y at most once each.",
} as const;

/**
 * Validate a Filter Expression against the field and function registries.
 * A custom field is checked against the source later; see
 * {@link FilterPlan.customFields}.
 */
export interface FilterRegistry<Item> {
  readonly field: (name: string) => FilterField<Item> | undefined;
  readonly custom: (name: string) => {
    value: FilterValueDefinition<Item>;
    needs: FieldNeeds;
  };
  readonly prefix?: string;
  readonly equalityField?: (name: string, literal: string) => string;
}

export function planFilter<Item = QueryItem>(
  text: string,
  registry: FilterRegistry<Item> = {
    field: filterField,
    custom: customFilterValue,
  } as FilterRegistry<Item>,
): FilterPlan<Item> | FilterProblem {
  const { ast, error } = parseExpressionAst(text);
  if (!ast) {
    return { kind: "syntax", fault: error };
  }
  const needs: FieldNeeds[] = [];
  const customFields: FilterCustomFieldUse[] = [];
  try {
    const warnings: Extract<Fault, { kind: "constant" }>[] = [];
    const root = new Validator(
      { needs, customFields, warnings },
      registry,
    ).node(ast);
    warnings.sort((a, b) => a.at.from - b.at.from);
    return { root, needs, customFields, warnings };
  } catch (thrown) {
    if (thrown instanceof Invalid) return thrown.problem;
    throw thrown;
  }
}

/**
 * Whether a custom field has a bare form in a Filter Expression: its name is
 * one identifier of the grammar and no built-in field, function, or keyword
 * has that name. The check is the same for every Library and every Item.
 */
export function hasBareForm(customFieldName: string): boolean {
  if (RESERVED_NAMES.has(customFieldName)) return false;
  const { ast } = parseExpressionAst(customFieldName);
  return ast?.type === "identifier" && ast.name === customFieldName;
}

/** The bare names that always mean a built-in; a keyword parses as a literal. */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  ...BUILT_IN_NAMES,
  ...GLOBAL_FUNCTION_NAMES,
]);

function fail(fault: FilterFailure): never {
  throw new Invalid(fault);
}

const arity = (
  callee: Callee,
  at: Span,
  given: number,
): Extract<Fault, { readonly kind: "arity" }> => ({
  kind: "arity",
  callee,
  at,
  given,
});

const argumentType = <Item>(
  callee: Callee,
  args: readonly FilterNode<Item>[],
  wrong: {
    readonly index: number;
    readonly found: string;
    readonly expected: string;
  },
): Extract<Fault, { readonly kind: "argument-type" }> => ({
  kind: "argument-type",
  callee,
  at: { from: args[wrong.index]!.from, to: args[wrong.index]!.to },
  ...wrong,
});

const unreadable = (
  name: string,
  at: Span,
): Extract<Fault, { readonly kind: "unreadable" }> => ({
  kind: "unreadable",
  name,
  at,
});
function unknown(fact: {
  readonly role: Role;
  readonly name: string;
  readonly at: Span;
  readonly receiver?: Receiver;
}): FilterFailure {
  const { role, name, at, receiver } = fact;
  return {
    kind: "unknown",
    role,
    name,
    at: { from: at.from, to: at.to },
    ...(receiver ? { receiver } : {}),
  };
}

function receiver<Item>(subject: FilterNode<Item>): Receiver {
  const field = receiverField(subject);
  return {
    type: subject.valueType,
    at: { from: subject.from, to: subject.to },
    ...(field ? { field } : {}),
  };
}

function receiverField<Item>(node: FilterNode<Item>): string | undefined {
  switch (node.kind) {
    case "field":
      return node.name;
    case "element":
    case "method":
    case "property":
    case "index":
      return receiverField(node.subject);
    default:
      return undefined;
  }
}

function takesCount(
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest">,
  count: number,
): boolean {
  const least = definition.parameters.length;
  const most = least + (definition.optional?.length ?? 0);
  return count >= least && (definition.rest !== undefined || count <= most);
}

/** A type that validation knows and that is not null. */
function isDefinite(
  type: StaticType,
): type is Exclude<FilterValueType, "null"> {
  return type !== "unknown" && type !== "null";
}

/**
 * The argument at `index` has a type that the parameter does not take, or is
 * a string literal outside the texts that the parameter takes.
 */
function mismatch<Item>(
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest">,
  args: readonly FilterNode<Item>[],
): { index: number; found: string; expected: string } | null {
  for (const [index, arg] of args.entries()) {
    const parameter = parameterAt(definition, index);
    if (!parameter) continue;
    if (isDefinite(arg.valueType) && !takesType(parameter, arg.valueType)) {
      return {
        index,
        found: `a ${arg.valueType}`,
        expected: parameterTypes(parameter)
          .map((type) => `a ${type}`)
          .join(" or "),
      };
    }
    if (
      parameter.values &&
      arg.kind === "literal" &&
      typeof arg.value === "string" &&
      !parameter.values.includes(arg.value)
    ) {
      return {
        index,
        found: quote(arg.value),
        expected: `one of ${parameter.values.map(quote).join(", ")}`,
      };
    }
  }
  return null;
}

class Validator<Item> {
  readonly #needs: FieldNeeds[];
  readonly #customFields: FilterCustomFieldUse[];
  readonly #warnings: Extract<Fault, { kind: "constant" }>[];
  /** The names the enclosing element expressions bind, innermost last. */
  readonly #scopes: (readonly string[])[] = [];

  constructor(
    {
      needs,
      customFields,
      warnings,
    }: {
      needs: FieldNeeds[];
      customFields: FilterCustomFieldUse[];
      warnings: Extract<Fault, { kind: "constant" }>[];
    },
    readonly registry: FilterRegistry<Item>,
  ) {
    this.#needs = needs;
    this.#customFields = customFields;
    this.#warnings = warnings;
  }

  node(ast: ExpressionNode): FilterNode<Item> {
    const { from, to } = ast;
    const span = { from, to };
    switch (ast.type) {
      case "group":
        return this.node(ast.expression);
      case "null":
        return { ...span, kind: "literal", value: null, valueType: "null" };
      case "boolean":
        return { ...literal(span, ast.value), valueType: "boolean" };
      case "number":
        return { ...literal(span, ast.value), valueType: "number" };
      case "string":
        return { ...literal(span, ast.value), valueType: "string" };
      case "regexp":
        return {
          ...literal(span, { type: "regexp", regexp: this.#regexp(ast) }),
          valueType: "regexp",
        };
      case "array":
        return {
          ...span,
          kind: "list",
          elements: ast.elements.map((element) => this.node(element)),
          valueType: "list",
        };
      case "identifier":
        return this.#identifier(ast.name, span);
      case "unary": {
        const operand = this.node(ast.operand);
        return {
          ...span,
          kind: "unary",
          operator: ast.operator,
          operand,
          valueType: ast.operator === "!" ? "boolean" : "number",
        };
      }
      case "binary": {
        let left = this.node(ast.left);
        let right = this.node(ast.right);
        if (
          (ast.operator === "==" || ast.operator === "!=") &&
          this.registry.equalityField
        ) {
          const replace = (
            field: FilterNode<Item>,
            literal: FilterNode<Item>,
          ) => {
            if (
              field.kind !== "field" ||
              literal.kind !== "literal" ||
              typeof literal.value !== "string"
            )
              return field;
            const name = this.registry.equalityField!(
              field.name,
              literal.value,
            );
            return name === field.name ? field : this.#identifier(name, field);
          };
          left = replace(left, right);
          right = replace(right, left);
        }
        const equality = ast.operator === "==" || ast.operator === "!=";
        const ordering = ["<", "<=", ">", ">="].includes(ast.operator);
        const nonNull = (node: FilterNode<Item>) =>
          node.kind === "list" ||
          (node.kind === "literal" && node.value !== null);
        if (
          (ordering || (equality && (nonNull(left) || nonNull(right)))) &&
          left.valueType !== "unknown" &&
          right.valueType !== "unknown" &&
          left.valueType !== right.valueType
        ) {
          this.#warnings.push({
            kind: "constant",
            value: ast.operator === "!=",
            operator: ast.operator,
            left: {
              type: left.valueType,
              at: { from: ast.left.from, to: ast.left.to },
            },
            right: {
              type: right.valueType,
              at: { from: ast.right.from, to: ast.right.to },
            },
            at: span,
          });
        }
        return {
          ...span,
          kind: "binary",
          operator: ast.operator,
          left,
          right,
          valueType: binaryType(ast.operator, left.valueType, right.valueType),
        };
      }
      case "object-access":
        if (
          this.registry.prefix &&
          ast.object.type === "identifier" &&
          ast.object.name === this.registry.prefix
        ) {
          return this.#identifier(
            `${this.registry.prefix}.${ast.property}`,
            span,
          );
        }
        if (this.#isCustomRoot(ast.object)) {
          return this.#customField(ast.property, span, false);
        }
        return this.#objectAccess(ast, span);
      case "array-access": {
        if (this.#isCustomRoot(ast.object)) {
          if (ast.index.type !== "string") {
            return fail({
              kind: "plain",
              code: "invalid-filter",
              at: { from: ast.index.from, to: ast.index.to },
              message:
                "custom takes the name of one custom field as a quoted string.",
              action: HINTS.custom,
            });
          }
          return this.#customField(ast.index.value, span, false);
        }
        return {
          ...span,
          kind: "index",
          subject: this.node(ast.object),
          index: this.node(ast.index),
          valueType: "unknown",
        };
      }
      case "call":
        return this.#call(ast, span);
    }
  }

  #objectAccess(
    ast: Extract<ExpressionNode, { type: "object-access" }>,
    span: Span,
  ): FilterNode<Item> {
    const subject = this.node(ast.object);
    // Only a chain of identifiers has the ambiguous source-field spelling.
    // Bracket access already names an exact custom field.
    let root: ExpressionNode = ast;
    const parts: string[] = [];
    while (root.type === "object-access") {
      parts.unshift(root.property);
      root = root.object;
    }
    if (
      root.type === "identifier" &&
      root.name !== "custom" &&
      root.name !== this.registry.prefix
    )
      parts.unshift(root.name);
    if (
      this.registry.prefix &&
      root.type === "identifier" &&
      root.name === this.registry.prefix &&
      parts[0] === "custom"
    )
      parts.shift();
    const useIndex =
      root.type === "identifier"
        ? this.#customFields.findIndex((use) => use.from === root.from)
        : -1;
    const use = this.#customFields[useIndex];
    let deferred = use?.deferred;
    if (!deferred) {
      try {
        const property = this.#property(subject, ast.property, span);
        if (use)
          this.#customFields[useIndex] = {
            ...use,
            dotted: { ...span, name: parts.join(".") },
          };
        return property;
      } catch (error) {
        if (
          !(error instanceof Invalid) ||
          error.problem.kind !== "unknown" ||
          error.problem.role !== "property" ||
          !use
        )
          throw error;
        deferred = error.problem;
      }
    }
    const name = parts.join(".");
    this.#customFields[useIndex] = { ...span, name, bare: use!.bare, deferred };
    return {
      ...span,
      kind: "property",
      name: ast.property,
      subject,
      valueType: "unknown",
    };
  }

  /** The RegExp of a literal, built once; a pattern or flag the engine rejects fails the query. */
  #regexp(ast: Extract<ExpressionNode, { type: "regexp" }>): RegExp {
    try {
      return new RegExp(ast.source, ast.flags);
    } catch (thrown) {
      const reason = thrown instanceof Error ? thrown.message : String(thrown);
      return fail({
        kind: "plain",
        code: "invalid-filter",
        at: { from: ast.from, to: ast.to },
        message: `The regular expression /${ast.source}/${ast.flags} is invalid: ${reason}`,
        action: HINTS.regexp,
      });
    }
  }

  #identifier(name: string, span: Span): FilterNode<Item> {
    // Inside an element expression, a bound name comes before every field.
    if (this.#scopes.some((scope) => scope.includes(name))) {
      return {
        ...span,
        kind: "binding",
        name,
        valueType: name === "index" ? "number" : "unknown",
      };
    }
    const field = this.registry.field(name);
    if (field?.filterable) {
      this.#needs.push(field.needs);
      return {
        ...span,
        kind: "field",
        name,
        value: field.value,
        valueType: field.value.type,
      };
    }
    if (name === "custom") {
      return fail(unreadable(name, span));
    }
    if (field) {
      return fail(unreadable(name, span));
    }
    if (GLOBAL_FUNCTION_NAMES.includes(name)) {
      return fail(unknown({ role: "field", name, at: span }));
    }
    // Outside the built-in names: the bare form of a custom field.
    if (this.registry.prefix && !name.startsWith(`${this.registry.prefix}.`)) {
      return fail(unknown({ role: "field", name, at: span }));
    }
    return this.#customField(
      this.registry.prefix ? name.slice(this.registry.prefix.length + 1) : name,
      span,
      true,
    );
  }

  #isCustomRoot(ast: ExpressionNode): boolean {
    if (!this.registry.prefix) return isCustomRoot(ast);
    return (
      ast.type === "object-access" &&
      ast.property === "custom" &&
      ast.object.type === "identifier" &&
      ast.object.name === this.registry.prefix
    );
  }

  #customField(name: string, span: Span, bare: boolean): FilterNode<Item> {
    const { value, needs } = this.registry.custom(name);
    this.#needs.push(needs);
    this.#customFields.push({ ...span, name, bare });
    return {
      ...span,
      kind: "custom-field",
      name,
      bare,
      value,
      valueType: value.type,
    };
  }

  #property(
    subject: FilterNode<Item>,
    name: string,
    span: Span,
  ): FilterNode<Item> {
    const named = propertiesNamed(name);
    const nameSpan = { from: span.to - name.length, to: span.to };
    if (named.length === 0) {
      return fail(
        unknown({
          role: "property",
          name,
          at: nameSpan,
          receiver: receiver(subject),
        }),
      );
    }
    const type = subject.valueType;
    if (isDefinite(type) && !propertyOf(type, name)) {
      return fail(
        unknown({
          role: "property",
          name,
          at: nameSpan,
          receiver: receiver(subject),
        }),
      );
    }
    return {
      ...span,
      kind: "property",
      name,
      subject,
      valueType: commonType(named.map(([, property]) => property.returns)),
    };
  }

  #call(
    ast: Extract<ExpressionNode, { type: "call" }>,
    span: Span,
  ): FilterNode<Item> {
    const { callee } = ast;
    if (callee.type === "identifier") {
      return this.#globalCall(
        { name: callee.name, nameSpan: callee, args: ast.args },
        span,
      );
    }
    if (callee.type === "object-access") {
      const nameSpan = {
        from: callee.to - callee.property.length,
        to: callee.to,
      };
      // `custom.name(...)` calls a method on `custom`, which a filter cannot
      // read; the subject reports it.
      const subject = this.node(callee.object);
      const call = { name: callee.property, nameSpan, subject };
      if (methodsNamed(call.name).some(([, method]) => method.scope)) {
        return this.#elementCall({ ...call, args: ast.args }, span);
      }
      const args = ast.args.map((arg) => this.node(arg));
      return this.#methodCall({ ...call, args }, span);
    }
    return fail({
      kind: "plain",
      code: "invalid-filter",
      at: { from: callee.from, to: callee.to },
      message: "A call needs the name of a function before its arguments.",
      action: `Use a global function: ${GLOBAL_FUNCTION_NAMES.join(", ")}. Call a method on a value, such as title.lower().`,
    });
  }

  #globalCall(
    call: { name: string; nameSpan: Span; args: readonly ExpressionNode[] },
    span: Span,
  ): FilterNode<Item> {
    const { name, nameSpan } = call;
    const definition = name === "if" ? IF_FUNCTION : GLOBAL_FUNCTIONS.get(name);
    if (!definition) {
      return fail(unknown({ role: "global", name, at: nameSpan }));
    }
    // Every argument is validated, also in a branch that never runs.
    const args = call.args.map((arg) => this.node(arg));
    if (!takesCount(definition, args.length)) {
      return fail(arity({ name }, span, args.length));
    }
    const wrong = mismatch(definition, args);
    if (wrong) {
      return fail(argumentType({ name }, args, wrong));
    }
    if (name === "if") {
      const [condition, whenTrue, whenFalse = null] = args;
      return {
        ...span,
        kind: "if",
        condition: condition!,
        whenTrue: whenTrue!,
        whenFalse,
        valueType:
          whenFalse && whenFalse.valueType === whenTrue!.valueType
            ? whenTrue!.valueType
            : "unknown",
      };
    }
    const global = definition as FunctionDefinition;
    return {
      ...span,
      kind: "function",
      name,
      definition: global,
      args,
      valueType: global.returns ?? "unknown",
    };
  }

  /**
   * The methods `name` can select on `subject`: one for a subject of a known
   * type; otherwise the method of the value type each Item gives it.
   */
  #candidates(
    name: string,
    nameSpan: Span,
    subject: FilterNode<Item>,
  ): readonly FunctionDefinition[] {
    const named = methodsNamed(name);
    if (named.length === 0) {
      return fail(
        unknown({
          role: "method",
          name,
          at: nameSpan,
          receiver: receiver(subject),
        }),
      );
    }
    const type = subject.valueType;
    if (!isDefinite(type)) return named.map(([, method]) => method);
    const method = methodOf(type, name);
    if (!method) {
      return fail(
        unknown({
          role: "method",
          name,
          at: nameSpan,
          receiver: receiver(subject),
        }),
      );
    }
    return [method];
  }

  /**
   * An element-expression method. The first argument is validated with the
   * names of the method's `scope` bound; the further arguments outside.
   */
  #elementCall(
    call: {
      name: string;
      nameSpan: Span;
      subject: FilterNode<Item>;
      args: readonly ExpressionNode[];
    },
    span: Span,
  ): FilterNode<Item> {
    const { name, nameSpan, subject } = call;
    const definition = this.#candidates(name, nameSpan, subject).find(
      (method) => method.scope,
    );
    const scope = definition?.scope;
    // The subject selects a same-named method without a scope.
    if (!definition || !scope) {
      const args = call.args.map((arg) => this.node(arg));
      return this.#methodCall({ ...call, args }, span);
    }
    const [first, ...others] = call.args;
    let expression: FilterNode<Item> | null = null;
    if (first) {
      this.#scopes.push(scope);
      try {
        expression = this.node(first);
      } finally {
        this.#scopes.pop();
      }
    }
    const args = others.map((arg) => this.node(arg));
    if (!expression || !takesCount(definition, args.length + 1)) {
      return fail(arity(this.#callee(name, subject), span, call.args.length));
    }
    return {
      ...span,
      kind: "element",
      name,
      subject,
      scope,
      expression,
      args,
      valueType: definition.returns ?? "unknown",
    };
  }

  #methodCall(
    call: {
      name: string;
      nameSpan: Span;
      subject: FilterNode<Item>;
      args: readonly FilterNode<Item>[];
    },
    span: Span,
  ): FilterNode<Item> {
    const { name, nameSpan, subject, args } = call;
    const candidates = this.#candidates(name, nameSpan, subject);
    const fitting = candidates.filter((method) =>
      takesCount(method, args.length),
    );
    if (fitting.length === 0) {
      return fail(arity(this.#callee(name, subject), span, args.length));
    }
    if (fitting.every((method) => mismatch(method, args) !== null)) {
      const wrong = mismatch(fitting[0]!, args)!;
      return fail(argumentType(this.#callee(name, subject), args, wrong));
    }
    return {
      ...span,
      kind: "method",
      name,
      subject,
      args,
      valueType: commonType(fitting.map((method) => method.returns)),
    };
  }

  #callee(name: string, subject: FilterNode<Item>): Callee {
    const receiver: Receiver = {
      type: subject.valueType,
      at: { from: subject.from, to: subject.to },
      ...(subject.kind === "field" ? { field: subject.name } : {}),
    };
    return { name, receiver };
  }
}

function literal(
  span: Span,
  value: FilterValue,
): Span & { kind: "literal"; value: FilterValue } {
  return { ...span, kind: "literal", value };
}

function isCustomRoot(node: ExpressionNode): boolean {
  return node.type === "identifier" && node.name === "custom";
}

function commonType(
  types: readonly (Exclude<FilterValueType, "null"> | null)[],
): StaticType {
  const [first] = types;
  return first && types.every((type) => type === first) ? first : "unknown";
}

function binaryType(
  operator: BinaryOperator,
  left: StaticType,
  right: StaticType,
): StaticType {
  switch (operator) {
    case "||":
    case "&&":
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return "boolean";
    case "+":
      if (left === "string" || right === "string") return "string";
      if (left === "list" && right === "list") return "list";
      if (left === "number" && right === "number") return "number";
      if (
        (left === "date" && right === "duration") ||
        (left === "duration" && right === "date")
      ) {
        return "date";
      }
      return "unknown";
    case "-":
      // `date - duration` is a date.
      if (left === "date" && right === "duration") return "date";
      return left === "date" ||
        left === "unknown" ||
        right === "duration" ||
        right === "unknown"
        ? "unknown"
        : "number";
    case "*":
    case "/":
    case "%":
      return "number";
  }
}
