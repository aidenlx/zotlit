// Validation of a Filter Expression against the registries. The result is a
// typed tree in which every name is resolved, so that execution and the
// planner read one structure.
import { parseExpressionAst } from "@zotlit/filter-expression";
import type { BinaryOperator, ExpressionNode } from "@zotlit/filter-expression";

import type { ItemQueryErrorCode } from "./error";
import {
  BUILT_IN_NAMES,
  customFilterValue,
  DEFAULT_FIELDS,
  filterField,
} from "./fields";
import type { FieldNeeds, FilterValueDefinition } from "./fields";
import {
  GLOBAL_FUNCTION_NAMES,
  GLOBAL_FUNCTIONS,
  IF_FUNCTION,
  METHOD_NAMES,
  methodOf,
  methodsNamed,
  parameterAt,
  propertiesNamed,
  PROPERTY_NAMES,
  propertyOf,
} from "./filter-functions";
import type { FunctionDefinition } from "./filter-functions";
import type { FilterValue, FilterValueType } from "./filter-values";

/** A part of the filter text, in UTF-16 offsets; `to` is exclusive. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

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

export interface FilterProblem {
  readonly code: ItemQueryErrorCode;
  readonly span: Span;
  readonly message: string;
  readonly hint: string;
}

class Invalid extends Error {
  constructor(readonly problem: FilterProblem) {
    super(problem.message);
  }
}

const quote = (text: string): string => JSON.stringify(text);

const HINTS = {
  syntax:
    'Write one Filter Expression, such as itemType == "book" && tags.contains("to-read"). Omit the filter to match every Item.',
  field: `Use a field of the Item Query Schema, such as ${DEFAULT_FIELDS.join(", ")}. Field names are case-sensitive. Reach a custom field with custom["exact name"].`,
  filterable:
    "Use a field that the Item Query Schema lists as filterable, such as title, itemType, tags, or collections.",
  custom: 'Name one custom field, such as custom["review.status"].',
  global: `Use a global function: ${GLOBAL_FUNCTION_NAMES.join(", ")}. Function names are case-sensitive.`,
  method: `Use a method of the Item Query Schema: ${METHOD_NAMES.join(", ")}. Function names are case-sensitive.`,
  property: `Use a property of the Item Query Schema: ${PROPERTY_NAMES.join(", ")}.`,
} as const;

/**
 * Validate a Filter Expression against the field and function registries.
 * A custom field is checked against the source later; see
 * {@link FilterPlan.customFields}.
 */
export function planFilter(text: string): FilterPlan | FilterProblem {
  const { ast, error } = parseExpressionAst(text);
  if (!ast) {
    return {
      code: "invalid-filter",
      span: error,
      message:
        text.trim() === ""
          ? "The filter is empty."
          : `The filter has a syntax error at position ${error.from}.`,
      hint: HINTS.syntax,
    };
  }
  const needs: FieldNeeds[] = [];
  const customFields: (Span & { name: string; bare: boolean })[] = [];
  try {
    const root = new Validator(needs, customFields).node(ast);
    return { root, needs, customFields };
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

function fail(
  code: ItemQueryErrorCode,
  span: Span,
  text: { message: string; hint: string },
): never {
  throw new Invalid({ code, span: { from: span.from, to: span.to }, ...text });
}

function describeCount(
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest">,
): string {
  const least = definition.parameters.length;
  const most = least + (definition.optional?.length ?? 0);
  const plural = (count: number) =>
    `${count} argument${count === 1 ? "" : "s"}`;
  if (definition.rest) return `at least ${plural(least)}`;
  return least === most ? plural(least) : `${least} to ${plural(most)}`;
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
    if (!parameter || parameter.type === "any") continue;
    if (isDefinite(arg.valueType) && arg.valueType !== parameter.type) {
      return {
        index,
        found: `a ${arg.valueType}`,
        expected: `a ${parameter.type}`,
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

/** The message of a {@link mismatch} in a call of `name`. */
function describeMismatch(
  name: string,
  wrong: { index: number; found: string; expected: string },
): string {
  return `Argument ${wrong.index + 1} of ${name} is ${wrong.found}; ${name} takes ${wrong.expected} there.`;
}

class Validator {
  constructor(
    private readonly needs: FieldNeeds[],
    private readonly customFields: (Span & { name: string; bare: boolean })[],
  ) {}

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
        return fail("invalid-filter", span, {
          message:
            "A Filter Expression of Item Query takes no regular expression.",
          hint: "Match text with contains, startsWith, or endsWith.",
        });
      case "array":
        return {
          ...span,
          kind: "list",
          elements: ast.elements.map((element) => this.node(element)),
          valueType: "list",
        };
      case "identifier":
        return this.identifier(ast.name, span);
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
          return this.customField(ast.property, span, false);
        }
        return this.property(this.node(ast.object), ast.property, span);
      case "array-access": {
        if (isCustomRoot(ast.object)) {
          if (ast.index.type !== "string") {
            return fail("invalid-filter", ast.index, {
              message:
                "custom takes the name of one custom field as a quoted string.",
              hint: HINTS.custom,
            });
          }
          return this.customField(ast.index.value, span, false);
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
        return this.call(ast, span);
    }
  }

  private identifier(name: string, span: Span): FilterNode {
    const field = filterField(name);
    if (field?.filterable) {
      this.needs.push(field.needs);
      return {
        ...span,
        kind: "field",
        name,
        value: field.value,
        valueType: field.value.type,
      };
    }
    if (name === "custom") {
      return fail("unfilterable-field", span, {
        message:
          "custom is the set of all custom fields; a filter reads one of them.",
        hint: HINTS.custom,
      });
    }
    if (field) {
      return fail("unfilterable-field", span, {
        message: `A filter cannot read ${quote(name)}.`,
        hint: HINTS.filterable,
      });
    }
    if (GLOBAL_FUNCTION_NAMES.includes(name)) {
      return fail("unknown-field", span, {
        message: `${quote(name)} is a function, not a field.`,
        hint: `Call it with arguments, such as ${name}(...). ${HINTS.field}`,
      });
    }
    // Outside the built-in names: the bare form of a custom field.
    return this.customField(name, span, true);
  }

  private customField(name: string, span: Span, bare: boolean): FilterNode {
    const { value, needs } = customFilterValue(name);
    this.needs.push(needs);
    this.customFields.push({ ...span, name, bare });
    return {
      ...span,
      kind: "custom-field",
      name,
      bare,
      value,
      valueType: value.type,
    };
  }

  private property(subject: FilterNode, name: string, span: Span): FilterNode {
    const named = propertiesNamed(name);
    const nameSpan = { from: span.to - name.length, to: span.to };
    if (named.length === 0) {
      return fail("unknown-property", nameSpan, {
        message: `${quote(name)} is not a property of a value.`,
        hint: HINTS.property,
      });
    }
    const type = subject.valueType;
    if (isDefinite(type) && !propertyOf(type, name)) {
      return fail("unknown-property", nameSpan, {
        message: `A ${type} has no property ${quote(name)}.`,
        hint: `${quote(name)} is a property of a ${named.map(([owner]) => owner).join(" or a ")}. ${HINTS.property}`,
      });
    }
    return {
      ...span,
      kind: "property",
      name,
      subject,
      valueType: commonType(named.map(([, property]) => property.returns)),
    };
  }

  private call(
    ast: Extract<ExpressionNode, { type: "call" }>,
    span: Span,
  ): FilterNode {
    const { callee } = ast;
    if (callee.type === "identifier") {
      return this.globalCall(
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
      const args = ast.args.map((arg) => this.node(arg));
      return this.methodCall(
        { name: callee.property, nameSpan, subject, args },
        span,
      );
    }
    return fail("invalid-filter", callee, {
      message: "A call needs the name of a function before its arguments.",
      hint: `${HINTS.global} Call a method on a value, such as title.lower().`,
    });
  }

  private globalCall(
    call: { name: string; nameSpan: Span; args: readonly ExpressionNode[] },
    span: Span,
  ): FilterNode {
    const { name, nameSpan } = call;
    const definition = name === "if" ? IF_FUNCTION : GLOBAL_FUNCTIONS.get(name);
    if (!definition) {
      const isMethod = methodsNamed(name).length > 0;
      return fail("unknown-function", nameSpan, {
        message: `${quote(name)} is not a global function of Item Query.`,
        hint: isMethod
          ? `${name} is a method: call it on a value, such as value.${name}(...).`
          : HINTS.global,
      });
    }
    // Every argument is validated, also in a branch that never runs.
    const args = call.args.map((arg) => this.node(arg));
    if (!takesCount(definition, args.length)) {
      return fail("wrong-argument-count", span, {
        message: `${name} takes ${describeCount(definition)}, not ${args.length}.`,
        hint: `Call ${signature(name, definition)}.`,
      });
    }
    const wrong = mismatch(definition, args);
    if (wrong) {
      return fail("wrong-argument-type", args[wrong.index]!, {
        message: describeMismatch(name, wrong),
        hint: `Call ${signature(name, definition)}.`,
      });
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

  private methodCall(
    call: {
      name: string;
      nameSpan: Span;
      subject: FilterNode;
      args: readonly FilterNode[];
    },
    span: Span,
  ): FilterNode {
    const { name, nameSpan, subject, args } = call;
    const named = methodsNamed(name);
    if (named.length === 0) {
      const isGlobal = GLOBAL_FUNCTION_NAMES.includes(name);
      return fail("unknown-function", nameSpan, {
        message: `${quote(name)} is not a method of Item Query.`,
        hint: isGlobal
          ? `${name} is a global function: call it as ${name}(...).`
          : HINTS.method,
      });
    }
    // A subject of a known type has one method; another subject takes the
    // method of the value type each Item gives it.
    const type = subject.valueType;
    let candidates = named.map(([, method]) => method);
    if (isDefinite(type)) {
      const method = methodOf(type, name);
      if (!method) {
        return fail("unknown-function", nameSpan, {
          message: `A ${type} has no method ${quote(name)}.`,
          hint: `${name} is a method of a ${named.map(([owner]) => owner).join(" or a ")}. ${HINTS.method}`,
        });
      }
      candidates = [method];
    }
    const fitting = candidates.filter((method) =>
      takesCount(method, args.length),
    );
    if (fitting.length === 0) {
      return fail("wrong-argument-count", span, {
        message: `${name} takes ${describeCount(candidates[0]!)}, not ${args.length}.`,
        hint: `Call ${signature(`value.${name}`, candidates[0]!)}.`,
      });
    }
    if (fitting.every((method) => mismatch(method, args) !== null)) {
      const wrong = mismatch(fitting[0]!, args)!;
      return fail("wrong-argument-type", args[wrong.index]!, {
        message: describeMismatch(name, wrong),
        hint: `Call ${signature(`value.${name}`, fitting[0]!)}.`,
      });
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

function signature(
  name: string,
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest">,
): string {
  const parts = [
    ...definition.parameters.map((parameter) => parameter.name),
    ...(definition.optional ?? []).map((parameter) => `${parameter.name}?`),
    ...(definition.rest ? [`...${definition.rest.name}`] : []),
  ];
  return `${name}(${parts.join(", ")})`;
}
