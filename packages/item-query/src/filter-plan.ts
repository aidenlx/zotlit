// Validation of a Filter Expression against the registries. The result is a
// typed tree in which every name is resolved, so that execution and the
// planner read one structure.
import { parseExpressionAst } from "@zotlit/filter-expression";
import type { BinaryOperator, ExpressionNode } from "@zotlit/filter-expression";

import type { Callee, Fault, Receiver, Role, Span } from "./fault";
export type { Span } from "./fault";
import { BUILT_IN_NAMES, customFilterValue, filterField } from "./fields";
import type { FieldNeeds, FilterValueDefinition } from "./fields";
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
export type FilterNode = NodeBase &
  (
    | { readonly kind: "literal"; readonly value: FilterValue }
    | { readonly kind: "list"; readonly elements: readonly FilterNode[] }
    | {
        /** A built-in field, read by its bare name. */
        readonly kind: "field";
        readonly name: string;
        readonly value: FilterValueDefinition;
      }
    | {
        /** A custom field of the source, by its exact source name. */
        readonly kind: "custom-field";
        readonly name: string;
        /** The filter reads it by a bare name, not as `custom["name"]`. */
        readonly bare: boolean;
        readonly value: FilterValueDefinition;
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
        readonly subject: FilterNode;
        readonly scope: readonly string[];
        readonly expression: FilterNode;
        readonly args: readonly FilterNode[];
      }
    | {
        readonly kind: "unary";
        readonly operator: "!" | "-";
        readonly operand: FilterNode;
      }
    | {
        readonly kind: "binary";
        readonly operator: BinaryOperator;
        readonly left: FilterNode;
        readonly right: FilterNode;
      }
    | {
        readonly kind: "if";
        readonly condition: FilterNode;
        readonly whenTrue: FilterNode;
        readonly whenFalse: FilterNode | null;
      }
    | {
        readonly kind: "function";
        readonly name: string;
        readonly definition: FunctionDefinition;
        readonly args: readonly FilterNode[];
      }
    | {
        /** The value type of the subject at execution selects the method. */
        readonly kind: "method";
        readonly name: string;
        readonly subject: FilterNode;
        readonly args: readonly FilterNode[];
      }
    | {
        readonly kind: "property";
        readonly name: string;
        readonly subject: FilterNode;
      }
    | {
        readonly kind: "index";
        readonly subject: FilterNode;
        readonly index: FilterNode;
      }
  );

/** A validated Filter Expression. */
export interface FilterPlan {
  readonly root: FilterNode;
  readonly warnings: readonly Extract<Fault, { kind: "constant" }>[];
  /** What hydration loads before the filter runs: one entry for each field. */
  readonly needs: readonly FieldNeeds[];
  /**
   * The custom fields the filter names. The source decides whether each one
   * exists, so the engine checks them when it has read the field vocabulary.
   */
  readonly customFields: readonly (Span & {
    readonly name: string;
    readonly bare: boolean;
  })[];
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
export function planFilter(text: string): FilterPlan | FilterProblem {
  const { ast, error } = parseExpressionAst(text);
  if (!ast) {
    return { kind: "syntax", fault: error };
  }
  const needs: FieldNeeds[] = [];
  const customFields: (Span & { name: string; bare: boolean })[] = [];
  try {
    const warnings: Extract<Fault, { kind: "constant" }>[] = [];
    const root = new Validator(needs, customFields, warnings).node(ast);
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

const argumentType = (
  callee: Callee,
  args: readonly FilterNode[],
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

function receiver(subject: FilterNode): Receiver {
  const field = receiverField(subject);
  return {
    type: subject.valueType,
    at: { from: subject.from, to: subject.to },
    ...(field ? { field } : {}),
  };
}

function receiverField(node: FilterNode): string | undefined {
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
function mismatch(
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest">,
  args: readonly FilterNode[],
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

class Validator {
  readonly #needs: FieldNeeds[];
  readonly #customFields: (Span & { name: string; bare: boolean })[];
  /** The names the enclosing element expressions bind, innermost last. */
  readonly #scopes: (readonly string[])[] = [];

  constructor(
    needs: FieldNeeds[],
    customFields: (Span & { name: string; bare: boolean })[],
    readonly warnings: Extract<Fault, { kind: "constant" }>[],
  ) {
    this.#needs = needs;
    this.#customFields = customFields;
  }

  node(ast: ExpressionNode): FilterNode {
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
        const left = this.node(ast.left);
        const right = this.node(ast.right);
        const equality = ast.operator === "==" || ast.operator === "!=";
        const ordering = ["<", "<=", ">", ">="].includes(ast.operator);
        const nonNull = (node: FilterNode) =>
          node.kind === "list" ||
          (node.kind === "literal" && node.value !== null);
        if (
          (ordering || (equality && (nonNull(left) || nonNull(right)))) &&
          left.valueType !== "unknown" &&
          right.valueType !== "unknown" &&
          left.valueType !== right.valueType
        ) {
          this.warnings.push({
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
        if (isCustomRoot(ast.object)) {
          return this.#customField(ast.property, span, false);
        }
        return this.#property(this.node(ast.object), ast.property, span);
      case "array-access": {
        if (isCustomRoot(ast.object)) {
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

  #identifier(name: string, span: Span): FilterNode {
    // Inside an element expression, a bound name comes before every field.
    if (this.#scopes.some((scope) => scope.includes(name))) {
      return {
        ...span,
        kind: "binding",
        name,
        valueType: name === "index" ? "number" : "unknown",
      };
    }
    const field = filterField(name);
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
    return this.#customField(name, span, true);
  }

  #customField(name: string, span: Span, bare: boolean): FilterNode {
    const { value, needs } = customFilterValue(name);
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

  #property(subject: FilterNode, name: string, span: Span): FilterNode {
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
  ): FilterNode {
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
  ): FilterNode {
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
    subject: FilterNode,
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
      subject: FilterNode;
      args: readonly ExpressionNode[];
    },
    span: Span,
  ): FilterNode {
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
    let expression: FilterNode | null = null;
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
      subject: FilterNode;
      args: readonly FilterNode[];
    },
    span: Span,
  ): FilterNode {
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

  #callee(name: string, subject: FilterNode): Callee {
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
