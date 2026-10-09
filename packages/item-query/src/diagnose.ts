import { parseExpressionAst } from "@zotlit/filter-expression";
import type { ExpressionNode } from "@zotlit/filter-expression";

import type { QueryDataset } from "./dataset";
import type { ItemQueryErrorCode, ItemQueryErrorLocation } from "./error";
import type {
  Callee,
  Fault,
  ItemQueryFault,
  PlainFault,
  Receiver,
  Role,
  Span,
  SyntaxFault,
} from "./fault";
import type { ValueShape } from "./fields";
import {
  GLOBAL_FUNCTION_NAMES,
  GLOBAL_FUNCTIONS,
  IF_FUNCTION,
  METHOD_ENTRIES,
  methodOf,
  METHOD_NAMES,
  methodsNamed,
  propertiesNamed,
  PROPERTY_ENTRIES,
  PROPERTY_NAMES,
  propertyOf,
  takesType,
} from "./filter-functions";
import type { FunctionDefinition } from "./filter-functions";
import { hasBareForm } from "./filter-plan";
import type { StaticType } from "./filter-plan";
import { nearMatches } from "./near-match";
import type { QueryClock } from "./query-clock";
import { COUNT_FIELDS, UNLIMITED_LIMIT } from "./request";

interface DiagnosisContext extends ItemQueryErrorLocation {
  readonly dataset: QueryDataset<any>;
}
interface WarningContext {
  readonly clock: QueryClock;
  readonly dataset: QueryDataset<any>;
}

export interface DiagnosticLocation {
  readonly argument?: string;
  readonly index?: number;
  readonly span?: Span;
  readonly path?: string;
}
export interface Diagnostic<Code extends string = string> {
  readonly code: Code;
  readonly message: string;
  readonly hint: string;
  readonly severity: "error" | "warning";
  readonly report: readonly string[];
  readonly location?: DiagnosticLocation;
  readonly excerpt?: {
    readonly before: string;
    readonly at: string;
    readonly after: string;
  };
  readonly found: string;
  readonly expected: readonly string[];
  readonly suggestions: readonly string[];
}

/** Render the faults produced by the engine during the v2 migration. */
export function diagnose(
  fault: ItemQueryFault,
  text: string,
  { dataset, ...location }: DiagnosisContext,
): Diagnostic<ItemQueryErrorCode> {
  const at = "at" in fault ? fault.at : undefined;
  const faultLocation = { ...location, ...(at ? { span: at } : {}) };
  switch (fault.kind) {
    case "syntax":
      return diagnoseSyntax(fault.fault, text, location);
    case "arity": {
      const definition = definitionOf(fault.callee);
      return renderDiagnostic(
        {
          code: "wrong-argument-count",
          message: `${fault.callee.name} takes ${describeCount(definition)}, not ${fault.given}.`,
          hint: `Call ${signature(callName(fault.callee), definition)}.`,
          location: faultLocation,
        },
        text,
      );
    }
    case "argument-type": {
      const definition = definitionOf(fault.callee);
      return renderDiagnostic(
        {
          code: "wrong-argument-type",
          message: `Argument ${fault.index + 1} of ${fault.callee.name} is ${fault.found}; ${fault.callee.name} takes ${fault.expected} there.`,
          hint: `Call ${signature(callName(fault.callee), definition)}.`,
          location: faultLocation,
        },
        text,
        { found: fault.found, expected: [fault.expected] },
      );
    }
    case "unreadable": {
      const prefix = dataset.customPrefix;
      const custom = fault.name === `${prefix}custom`;
      const expected = custom
        ? [`${prefix}custom["name"]`]
        : dataset.defaultFields.filter(
            (name) => dataset.filterField(name)?.filterable,
          );
      return renderDiagnostic(
        {
          code: "unfilterable-field",
          message: custom
            ? "custom is the set of all custom fields; a filter reads one of them."
            : `A filter cannot read ${JSON.stringify(fault.name)}.`,
          hint: custom
            ? `Name one custom field, such as ${prefix}custom["review.status"].`
            : `Use a field that the ${dataset.family} Schema lists as filterable, such as ${expected.join(", ")}.`,
          location: faultLocation,
        },
        text,
        { found: fault.name, expected },
      );
    }
    case "custom-key":
      return renderDiagnostic(
        {
          code: "invalid-filter",
          message:
            "custom takes the name of one custom field as a quoted string.",
          hint: `Name one custom field, such as ${dataset.customPrefix}custom["review.status"].`,
          location: faultLocation,
        },
        text,
      );
    case "plain": {
      const entry =
        location.argument === "fields"
          ? (projectionEntry(text, location.index) ?? text)
          : text;
      const diagnostic = renderDiagnostic(
        {
          code: fault.code,
          message: fault.message,
          hint: fault.action,
          location: faultLocation,
        },
        entry,
      );
      if (location.argument === "fields") return { ...diagnostic, location };
      return fault.code === "invalid-limit"
        ? withCountNote(diagnostic)
        : diagnostic;
    }
    case "unknown":
      return diagnoseUnknown(fault, text, { ...location, dataset });
  }
}

function definitionOf(
  callee: Callee,
): Pick<FunctionDefinition, "parameters" | "optional" | "rest"> {
  if (!callee.receiver) {
    const definition =
      callee.name === "if" ? IF_FUNCTION : GLOBAL_FUNCTIONS.get(callee.name);
    if (definition) return definition;
  } else {
    const definition =
      callee.receiver.type === "unknown" || callee.receiver.type === "null"
        ? methodsNamed(callee.name)[0]?.[1]
        : methodOf(callee.receiver.type, callee.name);
    if (definition) return definition;
  }
  throw new Error(`No registered definition for ${callee.name}.`);
}

function callName(callee: Callee): string {
  return callee.receiver ? `value.${callee.name}` : callee.name;
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

export function codeOfFault(
  fault: ItemQueryFault,
  dataset: QueryDataset<any>,
): PlainFault["code"] {
  if (fault.kind === "plain") return fault.code;
  if (fault.kind === "syntax" || fault.kind === "custom-key")
    return "invalid-filter";
  if (fault.kind === "arity") return "wrong-argument-count";
  if (fault.kind === "argument-type") return "wrong-argument-type";
  if (fault.kind === "unreadable") return "unfilterable-field";
  switch (fault.role) {
    case "global":
    case "method":
      return "unknown-function";
    case "property":
      return "unknown-property";
    case "projection-path":
      return dataset.definition(dataset.rootName(fault.name))
        ? "unknown-path"
        : "unknown-field";
    case "sortable-field":
      return dataset.definition(dataset.rootName(fault.name))
        ? "unsortable-field"
        : "unknown-field";
    case "field":
    case "custom-field":
      return "unknown-field";
  }
}

function diagnoseUnknown(
  sourceFault: Extract<Fault, { readonly kind: "unknown" }>,
  text: string,
  { dataset, ...location }: DiagnosisContext,
): Diagnostic<PlainFault["code"]> {
  const prefix = dataset.customPrefix;
  const fault =
    prefix && sourceFault.role === "field" && sourceFault.customFields
      ? { ...sourceFault, name: prefix + sourceFault.name }
      : sourceFault;
  if (
    fault.role === "projection-path" ||
    fault.role === "sortable-field" ||
    (fault.role === "custom-field" && location.argument === "fields")
  )
    return diagnoseRequestName(fault, text, { ...location, dataset });
  const candidates =
    fault.role === "custom-field"
      ? (fault.customFields ?? [])
      : candidatesFor(fault.role, fault.receiver?.type, dataset);
  const nearby = fault.dotted
    ? [`${prefix}custom[${JSON.stringify(fault.name)}]`]
    : nearMatches(fault.name, candidates);
  const receiverSwap = receiverSwapCorrection(fault, text, dataset);
  const guidance = crossRoleGuidance(fault);
  const caseCorrection = nearby[0]?.toLowerCase() === fault.name.toLowerCase();
  const hint = receiverSwap
    ? `Try: ${receiverSwap}`
    : caseCorrection
      ? suggestionAction(
          {
            role: fault.role,
            suggestion:
              fault.role === "custom-field" && !fault.dotted
                ? `${prefix}custom[${JSON.stringify(nearby[0]!)}]`
                : nearby[0]!,
            text,
            at: fault.at,
          },
          nearby.length === 1,
        )
      : guidance
        ? guidance.action
        : nearby.length > 0
          ? suggestionAction(
              {
                role: fault.role,
                suggestion:
                  fault.role === "custom-field" && !fault.dotted
                    ? `${prefix}custom[${JSON.stringify(nearby[0]!)}]`
                    : nearby[0]!,
                text,
                at: fault.at,
              },
              nearby.length === 1,
            )
          : fault.customFields?.length === 0
            ? "The connected Zotero source has no custom fields."
            : recoveryAction(fault.role, candidates, {
                receiverType: fault.receiver?.type,
                dataset,
              });
  const suggestions =
    nearby.length > 0 ? nearby : receiverSwap ? [receiverSwap] : [];
  const message = unknownMessage(fault, dataset);
  const diagnostic = renderDiagnostic(
    {
      code: codeOfFault(fault, dataset),
      message,
      hint,
      location: {
        ...location,
        ...(location.argument === "filter" ? { span: fault.at } : {}),
      },
    },
    text,
    { found: fault.name, expected: candidates },
  );
  const notes = [
    ...receiverNotes(fault.receiver, dataset),
    ...roleNotes(fault, guidance),
    ...(fault.role === "field" && fault.customFields?.some(hasBareForm)
      ? [
          `Custom fields with a bare form: ${fault.customFields.filter(hasBareForm).join(", ")}.`,
        ]
      : []),
    ...(nearby.length > 1
      ? [`Similar ${rolePlural(fault.role)}: ${nearby.join(", ")}.`]
      : []),
  ];
  return {
    ...diagnostic,
    report: [...diagnostic.report.slice(0, -1), ...notes, hint],
    suggestions,
  };
}

function projectionCandidates(dataset: QueryDataset<any>): readonly string[] {
  const paths = (path: string, shape: ValueShape): string[] => [
    path,
    ...(shape.kind === "object"
      ? Object.entries(shape.keys).flatMap(([key, child]) =>
          paths(`${path}.${key}`, child),
        )
      : shape.kind === "list"
        ? paths(`${path}[0]`, shape.element)
        : []),
  ];
  return unique(
    dataset.names.flatMap((name) => {
      const definition = dataset.definition(name);
      return definition ? paths(name, definition.shape) : [];
    }),
  );
}

function diagnoseRequestName(
  fault: Extract<Fault, { kind: "unknown" }>,
  text: string,
  { dataset, ...location }: DiagnosisContext,
): Diagnostic<ItemQueryErrorCode> {
  const sort = fault.role === "sortable-field";
  const custom = fault.role === "custom-field";
  const candidates = sort
    ? dataset.sortableFields
    : custom
      ? (fault.customFields ?? [])
      : projectionCandidates(dataset);
  const root = dataset.rootName(fault.name);
  const exact = candidates.filter(
    (name) => name.toLowerCase() === fault.name.toLowerCase(),
  );
  const nearby =
    sort && root !== fault.name && candidates.includes(root)
      ? [root]
      : exact.length
        ? exact
        : nearMatches(fault.name, candidates);
  const keys =
    location.index === undefined
      ? []
      : sort
        ? [location.index, "field"]
        : [location.index];
  const argument = sort ? "sort" : "fields";
  const corrected =
    nearby.length === 1
      ? replaceJsonValue(
          text,
          keys,
          custom
            ? `${dataset.customPrefix}custom[${JSON.stringify(nearby[0])}]`
            : nearby[0]!,
        )
      : undefined;
  const entry = custom
    ? (projectionEntry(text, location.index) ?? fault.name)
    : fault.name;
  const suggestions =
    corrected === undefined ? nearby : [shellArgument(argument, corrected)];
  const hint =
    corrected !== undefined
      ? `Try: ${suggestions[0]}`
      : nearby.length
        ? `Similar ${sort ? "Sortable Fields" : "Projection Paths"}: ${nearby.join(", ")}.`
        : recoveryAction(fault.role, candidates, { dataset });
  const diagnostic = renderDiagnostic(
    {
      code: codeOfFault(fault, dataset),
      message: unknownMessage(fault, dataset),
      hint,
      location: {
        ...location,
        path:
          location.path ??
          `${argument}[${location.index ?? 0}]${sort ? ".field" : ""}`,
        span: { from: 0, to: entry.length },
      },
    },
    entry,
    { found: fault.name, expected: candidates },
  );
  const notes = sort
    ? [
        "A Sortable Field is a top-level field with one value.",
        `Sortable Fields include ${dataset.defaultFields.filter((name) => candidates.includes(name)).join(", ")}.`,
      ]
    : [];
  const definition = dataset.definition(root);
  if (!sort && definition) {
    const shape =
      definition.shape.kind === "list"
        ? definition.shape.element
        : definition.shape;
    if (shape.kind === "object")
      notes.push(
        `${root}${definition.shape.kind === "list" ? " entries have" : " has"} these Projection Paths: ${Object.keys(shape.keys).join(", ")}.`,
      );
  }
  return {
    ...diagnostic,
    location: {
      argument,
      index: location.index,
      path: diagnostic.location!.path,
    },
    suggestions,
    report: [...diagnostic.report.slice(0, -1), ...notes, hint],
  };
}

function projectionEntry(text: string, index?: number): string | undefined {
  try {
    const fields: unknown = JSON.parse(text);
    return Array.isArray(fields) && typeof fields[index ?? 0] === "string"
      ? fields[index ?? 0]
      : undefined;
  } catch {
    return undefined;
  }
}

function receiverSwapCorrection(
  fault: Extract<Fault, { readonly kind: "unknown" }>,
  text: string,
  dataset: QueryDataset<any>,
): string | undefined {
  if (fault.role !== "method" || !fault.receiver) return undefined;
  const receiver = fault.receiver;
  const receiverType = receiver.type;
  if (receiverType === "unknown") return undefined;
  const root = parseExpressionAst(text).ast;
  if (!root) return undefined;
  const call = findMethodCall(root, fault);
  if (!call || call.args.length !== 1) return undefined;
  const argument = call.args[0]!;
  const argumentText = text.slice(argument.from, argument.to);
  const argumentPlan = dataset.planFilter(argumentText);
  if ("kind" in argumentPlan || argumentPlan.root.valueType === "unknown")
    return undefined;
  const methods = methodsNamed(fault.name).filter(([owner, definition]) => {
    const parameter = definition.parameters[0];
    return (
      owner === argumentPlan.root.valueType &&
      definition.parameters.length === 1 &&
      !definition.optional?.length &&
      !definition.rest &&
      parameter !== undefined &&
      takesType(parameter, receiverType)
    );
  });
  if (methods.length !== 1) return undefined;
  const receiverText = text.slice(receiver.at.from, receiver.at.to);
  const replacement = `${argumentText}.${fault.name}(${receiverText})`;
  const corrected =
    text.slice(0, call.from) + replacement + text.slice(call.to);
  return "kind" in dataset.planFilter(corrected) ? undefined : corrected;
}

function findMethodCall(
  node: ExpressionNode,
  fault: Extract<Fault, { readonly kind: "unknown" }>,
): Extract<ExpressionNode, { readonly type: "call" }> | undefined {
  if (
    node.type === "call" &&
    node.callee.type === "object-access" &&
    node.callee.property === fault.name &&
    node.callee.to - fault.name.length === fault.at.from &&
    node.callee.to === fault.at.to
  )
    return node;
  const children: readonly ExpressionNode[] = (() => {
    switch (node.type) {
      case "binary":
        return [node.left, node.right];
      case "unary":
        return [node.operand];
      case "call":
        return [node.callee, ...node.args];
      case "array-access":
        return [node.object, node.index];
      case "object-access":
        return [node.object];
      case "array":
        return node.elements;
      case "group":
        return [node.expression];
      default:
        return [];
    }
  })();
  for (const child of children) {
    const found = findMethodCall(child, fault);
    if (found) return found;
  }
  return undefined;
}

function candidatesFor(
  role: Role,
  receiverType: StaticType | undefined,
  dataset: QueryDataset<any>,
): readonly string[] {
  switch (role) {
    case "field":
      return fieldCandidates(dataset);
    case "global":
      return GLOBAL_FUNCTION_NAMES;
    case "method":
      return receiverType !== undefined && receiverType !== "unknown"
        ? unique(
            METHOD_ENTRIES.filter(
              ([type]) => type === "any" || type === receiverType,
            ).map(([, name]) => name),
          )
        : METHOD_NAMES;
    case "property":
      return receiverType !== undefined && receiverType !== "unknown"
        ? unique(
            PROPERTY_ENTRIES.filter(([type]) => type === receiverType).map(
              ([, name]) => name,
            ),
          )
        : PROPERTY_NAMES;
    case "custom-field":
    case "projection-path":
    case "sortable-field":
      return [];
  }
}

function fieldCandidates(dataset: QueryDataset<any>): readonly string[] {
  return dataset.names.flatMap((name) => {
    const filter = dataset.filterField(name);
    if (!filter?.filterable) return [];
    const definition = dataset.definition(name);
    if (!definition) return [name];
    const { shape } = definition;
    if (shape.kind === "list") return [name, `${name}[0]`];
    if (shape.kind !== "object") return [name];
    return [
      name,
      ...Object.keys(shape.keys)
        .filter((key) => propertyOf(filter.value.type, key) !== undefined)
        .map((key) => `${name}.${key}`),
    ];
  });
}

const unique = (names: readonly string[]): readonly string[] => [
  ...new Set(names),
];

function unknownMessage(
  fault: Extract<Fault, { readonly kind: "unknown" }>,
  dataset: QueryDataset<any>,
): string {
  const family = dataset.family;
  const { role, name, receiver } = fault;
  const quoted = JSON.stringify(name);
  switch (role) {
    case "field": {
      if (name === "if" || GLOBAL_FUNCTIONS.has(name))
        return `${quoted} is a function, not a field.`;
      return `${quoted} is not a field of ${family}.`;
    }
    case "global":
      return `${quoted} is not a global function of ${family}.`;
    case "method":
      return receiver && receiver.type !== "unknown"
        ? `A ${receiver.type} has no method ${quoted}.`
        : `${quoted} is not a method of ${family}.`;
    case "property":
      return receiver && receiver.type !== "unknown"
        ? `A ${receiver.type} has no property ${quoted}.`
        : `${quoted} is not a property of a value.`;
    case "custom-field":
      return fault.dotted
        ? `${quoted} is a custom field of the connected Zotero source; read it with bracket access.`
        : `The Zotero source has no custom field named ${quoted}.`;
    case "projection-path":
      return `${quoted} is not a Projection Path of ${family}.`;
    case "sortable-field":
      return `${quoted} is not a Sortable Field of ${family}.`;
  }
}

function recoveryAction(
  role: Role,
  candidates: readonly string[],
  {
    receiverType,
    dataset,
  }: { receiverType?: StaticType; dataset: QueryDataset<any> },
): string {
  const family = dataset.family;
  const joined = candidates.join(", ");
  switch (role) {
    case "field":
      return `Use a field from the ${family} Schema; field names are case-sensitive.`;
    case "global":
      return `Use a global function: ${joined}.`;
    case "method":
      return candidates.length === 0
        ? `${sentenceSubject(receiverType)} has no methods.`
        : `Use a method of ${typeSubject(receiverType)}: ${joined}.`;
    case "property":
      return candidates.length === 0
        ? `${sentenceSubject(receiverType)} has no properties.`
        : `Use a property of ${typeSubject(receiverType)}: ${joined}.`;
    case "custom-field":
      return candidates.length > 0
        ? `Use the exact name of a custom field: ${candidates.map((name) => JSON.stringify(name)).join(", ")}.`
        : "Use the exact name of a custom field from the source.";
    case "projection-path":
      return `Use a Projection Path from the ${family} Schema.`;
    case "sortable-field":
      return `Use a Sortable Field from the ${family} Schema.`;
  }
}

function typeSubject(type?: StaticType): string {
  return type === undefined || type === "unknown" ? "a value" : `a ${type}`;
}

function sentenceSubject(type?: StaticType): string {
  const subject = typeSubject(type);
  return subject[0]!.toUpperCase() + subject.slice(1);
}

function suggestionAction(
  action: {
    readonly role: Role;
    readonly suggestion: string;
    readonly text: string;
    readonly at: Span;
  },
  unique: boolean,
): string {
  const { role, suggestion, text, at } = action;
  if (unique)
    return `Try: ${text.slice(0, at.from)}${suggestion}${text.slice(at.to)}`;
  switch (role) {
    case "global":
      return `Choose a matching function, such as ${globalSignature(suggestion)}.`;
    case "method":
      return `Choose a matching method, such as value.${suggestion}(...).`;
    case "property":
      return `Choose a matching property, such as value.${suggestion}.`;
    case "field":
    case "custom-field":
    case "projection-path":
    case "sortable-field":
      return `Choose a matching field, such as ${suggestion}.`;
  }
}

function receiverNotes(
  receiver: Receiver | undefined,
  dataset: QueryDataset<any>,
): readonly string[] {
  if (!receiver) return [];
  if (receiver.type === "unknown" && !receiver.field)
    return ["The receiver's type depends on the Item."];
  const subject = receiver.field ? `\`${receiver.field}\`` : "The receiver";
  const type =
    receiver.type === "list" && receiver.field
      ? "a list of text"
      : `a ${receiver.type}`;
  const notes = [`${subject} is ${type} in a filter.`];
  if (!receiver.field) return notes;
  const shape = dataset.definition(receiver.field)?.shape;
  if (!shape) return notes;
  const paths = structuredPaths(receiver.field, shape);
  if (paths.length === 0) return notes;
  const listed = paths.map((path) => `\`${path}\``).join(", ");
  return [
    ...notes,
    shape.kind === "list"
      ? `In a Query Row, each \`${receiver.field}\` entry has these Projection Paths: ${listed}.`
      : `In a Query Row, \`${receiver.field}\` has these Projection Paths: ${listed}.`,
  ];
}

function structuredPaths(path: string, shape: ValueShape): readonly string[] {
  switch (shape.kind) {
    case "scalar":
    case "json":
    case "custom-fields":
      return [];
    case "object":
      return Object.keys(shape.keys).map((key) => `${path}.${key}`);
    case "list":
      return shape.element.kind === "object"
        ? Object.keys(shape.element.keys).map((key) => `${path}[0].${key}`)
        : [];
  }
}

interface RoleGuidance {
  readonly note: string;
  readonly action: string;
}

function crossRoleGuidance(
  fault: Extract<Fault, { readonly kind: "unknown" }>,
): RoleGuidance | undefined {
  const { name, role } = fault;
  if (role === "field") {
    const global = name === "if" ? IF_FUNCTION : GLOBAL_FUNCTIONS.get(name);
    if (!global) return undefined;
    const usage = signature(name, global);
    return {
      note: `\`${name}\` is a function; call it as \`${usage}\`.`,
      action: `Call it as \`${usage}\`.`,
    };
  }
  if (role === "global" && methodsNamed(name).length > 0) {
    const usage = `value.${name}(...)`;
    return {
      note: `\`${name}\` is a method; call it on a value as \`${usage}\`.`,
      action: `Call it on a value as \`${usage}\`.`,
    };
  }
  if (role === "method") {
    const global = name === "if" ? IF_FUNCTION : GLOBAL_FUNCTIONS.get(name);
    if (global) {
      const usage = signature(name, global);
      return {
        note: `\`${name}\` is a global function; call it as \`${usage}\`.`,
        action: `Call it as \`${usage}\`.`,
      };
    }
    if (propertiesNamed(name).length > 0)
      return {
        note: `\`${name}\` is a property; read it as \`value.${name}\`.`,
        action: `Read it as \`value.${name}\`.`,
      };
  }
  if (role === "property") {
    if (methodsNamed(name).length > 0)
      return {
        note: `\`${name}\` is a method; call it as \`value.${name}(...)\`.`,
        action: `Call it as \`value.${name}(...)\`.`,
      };
  }
  return undefined;
}

function roleNotes(
  fault: Extract<Fault, { readonly kind: "unknown" }>,
  guidance?: RoleGuidance,
): readonly string[] {
  if (guidance) return [guidance.note];
  const { name, role } = fault;
  if (role === "method") {
    const owners = methodsNamed(name).map(([owner]) => owner);
    if (owners.length > 0)
      return [
        `\`${name}\` is a method of ${owners.map((owner) => `a ${owner}`).join(" or ")}.`,
      ];
  }
  if (role === "property") {
    const owners = propertiesNamed(name).map(([owner]) => owner);
    if (owners.length > 0)
      return [
        `\`${name}\` is a property of ${owners.map((owner) => `a ${owner}`).join(" or ")}.`,
      ];
  }
  return [];
}

function rolePlural(role: Role): string {
  return role === "property" ? "properties" : `${role}s`;
}

function globalSignature(name: string): string {
  const definition = name === "if" ? IF_FUNCTION : GLOBAL_FUNCTIONS.get(name);
  return definition ? signature(name, definition) : `${name}(...)`;
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

/** Shared rendering for engine faults and adapter rejections or operational failures. */
export function renderDiagnostic<Code extends string>(
  base: {
    readonly code: Code;
    readonly message: string;
    readonly hint: string;
    readonly location?: DiagnosticLocation;
  },
  text = "",
  data: {
    readonly found?: string | undefined;
    readonly expected?: readonly string[];
  } = {},
): Diagnostic<Code> {
  const span = base.location?.span;
  const excerpt = span
    ? {
        before: text.slice(Math.max(0, span.from - 40), span.from),
        at: text.slice(span.from, span.to),
        after: text.slice(span.to, span.to + 40),
      }
    : undefined;
  const report = [base.message];
  if (excerpt) {
    const escapedLength = (value: string) => JSON.stringify(value).length - 2;
    report.push(
      excerpt.before + excerpt.at + excerpt.after,
      " ".repeat(escapedLength(excerpt.before)) +
        "^".repeat(Math.max(1, escapedLength(excerpt.at))),
    );
  }
  report.push(base.hint);
  return {
    ...base,
    severity: "error",
    report,
    ...(excerpt ? { excerpt } : {}),
    found: data.found ?? "",
    expected: data.expected ?? [],
    suggestions: [],
  };
}

const SPOKEN_OPERATORS: Readonly<Record<string, string>> = {
  "&&": "AND",
  "||": "OR",
  "!": "NOT",
};

function diagnoseSyntax(
  fault: SyntaxFault,
  text: string,
  location: ItemQueryErrorLocation,
): Diagnostic<"invalid-filter"> {
  const matches = fault.expected.filter(
    (form) =>
      fault.found !== null &&
      text.slice(fault.from, fault.to) === fault.found &&
      SPOKEN_OPERATORS[form] === fault.found.toUpperCase(),
  );
  const suggestions =
    matches.length === 1
      ? [text.slice(0, fault.from) + matches[0] + text.slice(fault.to)]
      : [];
  const expected = fault.expected.join(", ");
  const diagnostic = renderDiagnostic(
    {
      code: "invalid-filter",
      message: `Found ${fault.found === null ? "end of filter" : JSON.stringify(fault.found)} where the filter takes ${expected}.`,
      hint: suggestions.length ? `Try: ${suggestions[0]}` : `Use ${expected}.`,
      location: { ...location, span: { from: fault.from, to: fault.to } },
    },
    text,
    { found: fault.found ?? "end of filter", expected: fault.expected },
  );
  const report = [...diagnostic.report];
  if (fault.opened) {
    const start = Math.max(0, fault.from - 40);
    const opener = fault.opened;
    // A distant opener gets its own bounded excerpt. Nearby openers share the
    // fault excerpt, with a second marker under the opening delimiter.
    const markerStart =
      opener.from < start ? Math.max(0, opener.from - 40) : start;
    const notes: string[] = [];
    if (opener.from < start)
      notes.push(text.slice(markerStart, opener.to + 40));
    notes.push(
      `${" ".repeat(
        JSON.stringify(text.slice(markerStart, opener.from)).length - 2,
      )}^ Opened here; close with ${JSON.stringify(opener.closer)}.`,
    );
    report.splice(report.length - 1, 0, ...notes);
  }
  return { ...diagnostic, suggestions, report };
}

/** Warnings describe the marked comparison; they never replace its evaluation. */
export function diagnoseWarning(
  fault: Extract<Fault, { kind: "constant" }>,
  text: string,
  { clock, dataset }: WarningContext,
): Diagnostic<"never-true" | "always-true"> {
  const left = text.slice(fault.left.at.from, fault.left.at.to);
  const right = text.slice(fault.right.at.from, fault.right.at.to);
  const suggestion = constantCorrection(fault, text, { clock, dataset });
  const whole = parseExpressionAst(text).ast;
  const ungroup = (node: ExpressionNode): ExpressionNode =>
    node.type === "group" ? ungroup(node.expression) : node;
  const root = whole && ungroup(whole);
  const selectsAll =
    fault.value && root?.from === fault.at.from && root.to === fault.at.to;
  const diagnostic = renderDiagnostic(
    {
      code: fault.value ? "always-true" : "never-true",
      message: `${left} is a ${fault.left.type} and ${right} is a ${fault.right.type}: ${fault.operator} between them is ${fault.value ? "always" : "never"} true.${selectsAll ? ` The filter selects every ${dataset.noun}.` : ""}`,
      hint: suggestion
        ? `Try: ${suggestion}`
        : "Compare values of the same type.",
      location: { argument: "filter", span: fault.at },
    },
    text,
    {
      found: `${fault.left.type} ${fault.operator} ${fault.right.type}`,
      expected: ["operands of the same type"],
    },
  );
  const start = Math.max(0, fault.at.from - 40);
  const length = (from: number, to: number) =>
    JSON.stringify(text.slice(from, to)).length - 2;
  const report = [...diagnostic.report];
  report[2] =
    " ".repeat(length(start, fault.left.at.from)) +
    "-".repeat(length(fault.left.at.from, fault.left.at.to)) +
    " ".repeat(length(fault.left.at.to, fault.right.at.from)) +
    "^".repeat(length(fault.right.at.from, fault.right.at.to));
  return {
    ...diagnostic,
    severity: "warning",
    report,
    suggestions: suggestion ? [suggestion] : [],
  };
}

function constantCorrection(
  fault: Extract<Fault, { kind: "constant" }>,
  text: string,
  { clock, dataset }: WarningContext,
): string | undefined {
  const left = text.slice(fault.left.at.from, fault.left.at.to);
  const right = text.slice(fault.right.at.from, fault.right.at.to);
  const rightAst = parseExpressionAst(right).ast;
  const eligible = (definition: FunctionDefinition) => {
    const parameter = definition.parameters[0];
    return (
      definition.parameters.length === 1 &&
      !definition.scope &&
      !definition.rest &&
      parameter &&
      fault.right.type !== "unknown" &&
      takesType(parameter, fault.right.type) &&
      (!parameter.values ||
        (rightAst?.type === "string" &&
          parameter.values.includes(rightAst.value)))
    );
  };
  let replacement: string | undefined;
  if (fault.operator === "==" || fault.operator === "!=") {
    const members = METHOD_ENTRIES.filter(
      ([owner, , definition]) =>
        owner === fault.left.type &&
        definition.diagnosticCorrection === "membership" &&
        definition.returns === "boolean" &&
        eligible(definition),
    );
    if (members.length === 1) {
      const leftAst = parseExpressionAst(left).ast;
      const receiver =
        leftAst?.type === "binary" || leftAst?.type === "unary"
          ? `(${left})`
          : left;
      replacement = `${fault.operator === "!=" ? "!" : ""}${receiver}.${members[0]![1]}(${right})`;
    }
  }
  if (!replacement && rightAst?.type === "string") {
    const literal = parseExpressionAst(rightAst.value).ast;
    if (
      literal &&
      (literal.type === "number" ||
        literal.type === "boolean" ||
        literal.type === "string" ||
        (literal.type === "unary" &&
          literal.operator === "-" &&
          literal.operand.type === "number"))
    ) {
      const type = literal.type === "unary" ? "number" : literal.type;
      if (type === fault.left.type)
        replacement = `${left} ${fault.operator} ${rightAst.value.trim()}`;
    }
    if (!replacement) {
      const conversions = [...GLOBAL_FUNCTIONS].filter(
        ([, definition]) =>
          definition.diagnosticCorrection === "conversion" &&
          definition.returns === fault.left.type &&
          eligible(definition) &&
          definition.call(null, [rightAst.value], clock) !== null,
      );
      if (conversions.length === 1)
        replacement = `${left} ${fault.operator} ${conversions[0]![0]}(${right})`;
    }
  }
  if (!replacement) return undefined;
  const corrected =
    text.slice(0, fault.at.from) + replacement + text.slice(fault.at.to);
  return "kind" in dataset.planFilter(corrected) ? undefined : corrected;
}

/** Decoder facts are independent of the Obsidian adapter and validation library. */
export interface DecodeFault {
  readonly parameter: string;
  readonly message: string;
  readonly hint?: string;
  readonly issue?: {
    readonly path: string;
    readonly span?: { readonly from: number; readonly to: number };
    readonly expected: string;
    readonly received: string;
    readonly keys?: readonly (string | number)[];
    readonly input?: unknown;
    readonly allowed?: readonly string[];
  };
  readonly received?: readonly (readonly [string, string])[];
  readonly shellSplit?: boolean;
  readonly accepted?: readonly string[];
}

/** Render an argument decoder's structured rejection through the same report. */
export function diagnoseDecode(
  fault: DecodeFault,
  action: string,
): Diagnostic<"invalid-argument"> {
  const issue = fault.issue;
  const expected = issue?.allowed ?? (issue ? [issue.expected] : []);
  const raw =
    fault.received?.find(([key]) => key === fault.parameter)?.[1] ?? "";
  const suggestions: string[] = [];
  if (issue?.allowed && typeof issue.input === "string") {
    const input = issue.input;
    const prefixes = issue.allowed.filter((value) => input.startsWith(value));
    const matches = prefixes.length
      ? prefixes
      : nearMatches(input, issue.allowed);
    if (matches.length === 1) {
      const corrected = replaceJsonValue(raw, issue.keys ?? [], matches[0]!);
      if (corrected !== undefined)
        suggestions.push(shellArgument(fault.parameter, corrected));
    }
  }
  if (fault.shellSplit && fault.received) {
    const index = fault.received.findIndex(([key]) => key === fault.parameter);
    const previous = fault.received[index - 1];
    if (previous) {
      const rest = fault.received.slice(index);
      const next = rest.findIndex(([key]) => fault.accepted?.includes(key));
      const tokens = rest
        .slice(0, next === -1 ? undefined : next)
        .map(([key, value]) => (value === "true" ? key : `${key}=${value}`));
      suggestions.push(
        shellArgument(previous[0], [previous[1], ...tokens].join(" ")),
      );
    }
  }
  const jsonIssue =
    issue && (fault.parameter === "fields" || fault.parameter === "sort");
  const found =
    issue?.input !== null && typeof issue?.input === "object"
      ? JSON.stringify(issue.input)
      : issue?.received;
  const message =
    jsonIssue && !issue.span
      ? `${issue.path} received ${found}; expected ${expected.map((value) => (issue.allowed ? JSON.stringify(value) : value)).join(" or ")}.`
      : fault.message;
  const hint = suggestions.length
    ? `Try: ${suggestions[0]}`
    : (fault.hint ?? action);
  const entry = issue?.span
    ? raw
    : typeof issue?.input === "string"
      ? issue.input
      : (found ?? "");
  const diagnostic = renderDiagnostic(
    {
      code: "invalid-argument",
      message,
      hint,
      location: {
        argument: fault.parameter,
        ...(issue?.span
          ? { span: issue.span }
          : jsonIssue
            ? { span: { from: 0, to: entry.length } }
            : {}),
        ...(issue
          ? {
              path: issue.path,
              ...(typeof issue.keys?.[0] === "number"
                ? { index: issue.keys[0] }
                : {}),
            }
          : {}),
      },
    },
    entry,
    { found, expected },
  );
  const result = {
    ...diagnostic,
    location: {
      argument: fault.parameter,
      ...(issue?.span ? { span: issue.span } : {}),
      ...(issue
        ? {
            path: issue.path,
            ...(typeof issue.keys?.[0] === "number"
              ? { index: issue.keys[0] }
              : {}),
          }
        : {}),
    },
    suggestions,
    ...(fault.shellSplit && fault.received
      ? {
          report: [
            ...diagnostic.report.slice(0, -1),
            `Received arguments: ${JSON.stringify(fault.received)}.`,
            hint,
          ],
        }
      : {}),
  };
  return fault.parameter === "limit" ? withCountNote(result) : result;
}

function withCountNote<Code extends string>(
  diagnostic: Diagnostic<Code>,
): Diagnostic<Code> {
  const note = `To count every match, use ${shellArgument("fields", JSON.stringify(COUNT_FIELDS))} limit=${UNLIMITED_LIMIT}.`;
  return {
    ...diagnostic,
    report: [...diagnostic.report.slice(0, -1), note, diagnostic.hint],
  };
}

function shellArgument(name: string, value: string): string {
  return `${name}='${value.replaceAll("'", "'\"'\"'")}'`;
}

function replaceJsonValue(
  text: string,
  keys: readonly (string | number)[],
  value: string,
): string | undefined {
  try {
    const root: unknown = JSON.parse(text);
    if (!keys.length) return JSON.stringify(value);
    let parent: unknown = root;
    for (const key of keys.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
        return undefined;
      parent = (parent as Record<string | number, unknown>)[key];
    }
    const key = keys.at(-1)!;
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
      return undefined;
    (parent as Record<string | number, unknown>)[key] = value;
    return JSON.stringify(root);
  } catch {
    return undefined;
  }
}
