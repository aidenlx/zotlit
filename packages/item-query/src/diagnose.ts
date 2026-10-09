import type { ItemQueryErrorLocation } from "./error";
import type {
  Fault,
  ItemQueryFault,
  PlainFault,
  Receiver,
  Role,
  Span,
} from "./fault";
import { BUILT_IN_NAMES, fieldDefinition, filterField } from "./fields";
import type { ValueShape } from "./fields";
import {
  GLOBAL_FUNCTION_NAMES,
  GLOBAL_FUNCTIONS,
  IF_FUNCTION,
  METHOD_ENTRIES,
  METHOD_NAMES,
  methodsNamed,
  propertiesNamed,
  PROPERTY_ENTRIES,
  PROPERTY_NAMES,
  propertyOf,
} from "./filter-functions";
import type { FunctionDefinition } from "./filter-functions";
import type { StaticType } from "./filter-plan";
import { nearMatches } from "./near-match";

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

/** Render a fault produced by the engine. */
export function diagnose(
  fault: ItemQueryFault,
  text: string,
  location: ItemQueryErrorLocation,
): Diagnostic<ItemQueryErrorCodeOf<ItemQueryFault>> {
  if (fault.kind === "unknown") return diagnoseUnknown(fault, text, location);
  return renderDiagnostic(
    {
      code: fault.code,
      message: fault.message,
      hint: fault.action,
      location: { ...location, ...(fault.at ? { span: fault.at } : {}) },
    },
    text,
  );
}

type ItemQueryErrorCodeOf<FaultValue extends ItemQueryFault> =
  FaultValue extends PlainFault ? FaultValue["code"] : string;

export function codeOfFault(fault: ItemQueryFault): PlainFault["code"] {
  if (fault.kind === "plain") return fault.code;
  switch (fault.role) {
    case "global":
    case "method":
      return "unknown-function";
    case "property":
      return "unknown-property";
    case "projection-path":
      return "unknown-path";
    case "field":
    case "custom-field":
    case "sortable-field":
      return "unknown-field";
  }
}

function diagnoseUnknown(
  fault: Extract<Fault, { readonly kind: "unknown" }>,
  text: string,
  location: ItemQueryErrorLocation,
): Diagnostic<PlainFault["code"]> {
  const candidates = candidatesFor(fault.role, fault.receiver?.type);
  const suggestions = nearMatches(fault.name, candidates);
  const hint =
    suggestions.length > 0
      ? suggestionAction(
          {
            role: fault.role,
            suggestion: suggestions[0]!,
            text,
            at: fault.at,
          },
          suggestions.length === 1,
        )
      : recoveryAction(fault.role, candidates, fault.receiver?.type);
  const message = unknownMessage(fault);
  const diagnostic = renderDiagnostic(
    {
      code: codeOfFault(fault),
      message,
      hint,
      location: { ...location, span: fault.at },
    },
    text,
    { found: fault.name, expected: candidates },
  );
  const notes = [
    ...receiverNotes(fault.receiver),
    ...roleNotes(fault),
    ...(suggestions.length > 1
      ? [`Similar ${rolePlural(fault.role)}: ${suggestions.join(", ")}.`]
      : []),
  ];
  return {
    ...diagnostic,
    report: [...diagnostic.report.slice(0, -1), ...notes, hint],
    suggestions,
  };
}

function candidatesFor(
  role: Role,
  receiverType?: StaticType,
): readonly string[] {
  switch (role) {
    case "field":
      return fieldCandidates();
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

function fieldCandidates(): readonly string[] {
  return BUILT_IN_NAMES.flatMap((name) => {
    const filter = filterField(name);
    if (!filter?.filterable) return [];
    const definition = fieldDefinition(name);
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
): string {
  const { role, name, receiver } = fault;
  const quoted = JSON.stringify(name);
  switch (role) {
    case "field": {
      if (name === "if" || GLOBAL_FUNCTIONS.has(name))
        return `${quoted} is a function, not a field.`;
      return `${quoted} is not a field of Item Query.`;
    }
    case "global":
      return `${quoted} is not a global function of Item Query.`;
    case "method":
      return receiver && receiver.type !== "unknown"
        ? `A ${receiver.type} has no method ${quoted}.`
        : `${quoted} is not a method of Item Query.`;
    case "property":
      return receiver && receiver.type !== "unknown"
        ? `A ${receiver.type} has no property ${quoted}.`
        : `${quoted} is not a property of a value.`;
    case "custom-field":
      return `The Zotero source has no custom field named ${quoted}.`;
    case "projection-path":
      return `${quoted} is not a Projection Path of Item Query.`;
    case "sortable-field":
      return `${quoted} is not a Sortable Field of Item Query.`;
  }
}

function recoveryAction(
  role: Role,
  candidates: readonly string[],
  receiverType?: StaticType,
): string {
  const joined = candidates.join(", ");
  switch (role) {
    case "field":
      return "Use a field from the Item Query Schema; field names are case-sensitive.";
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
      return "Use the exact name of a custom field from the source.";
    case "projection-path":
      return "Use a Projection Path from the Item Query Schema.";
    case "sortable-field":
      return "Use a Sortable Field from the Item Query Schema.";
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
    return `Try: ${text.slice(0, at.from)}${suggestion}${text.slice(at.to)}.`;
  switch (role) {
    case "global":
      return `Try: ${globalSignature(suggestion)}.`;
    case "method":
      return `Try: value.${suggestion}(...).`;
    case "property":
      return `Try: value.${suggestion}.`;
    case "field":
    case "custom-field":
    case "projection-path":
    case "sortable-field":
      return `Try: ${suggestion}.`;
  }
}

function receiverNotes(receiver?: Receiver): readonly string[] {
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
  const shape = fieldDefinition(receiver.field)?.shape;
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

function roleNotes(
  fault: Extract<Fault, { readonly kind: "unknown" }>,
): readonly string[] {
  const { name, role } = fault;
  if (role === "field") {
    const global = name === "if" ? IF_FUNCTION : GLOBAL_FUNCTIONS.get(name);
    return global
      ? [
          `\`${name}\` is a function; call it as \`${signature(name, global)}\`.`,
        ]
      : [];
  }
  if (role === "global" && methodsNamed(name).length > 0) {
    return [
      `\`${name}\` is a method; call it on a value as \`value.${name}(...)\`.`,
    ];
  }
  if (role === "method") {
    const global = name === "if" ? IF_FUNCTION : GLOBAL_FUNCTIONS.get(name);
    if (global)
      return [
        `\`${name}\` is a global function; call it as \`${signature(name, global)}\`.`,
      ];
    if (propertiesNamed(name).length > 0)
      return [`\`${name}\` is a property; read it as \`value.${name}\`.`];
    const owners = methodsNamed(name).map(([owner]) => owner);
    if (owners.length > 0)
      return [
        `\`${name}\` is a method of ${owners.map((owner) => `a ${owner}`).join(" or ")}.`,
      ];
  }
  if (role === "property") {
    if (methodsNamed(name).length > 0)
      return [`\`${name}\` is a method; call it as \`value.${name}(...)\`.`];
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
  data: { readonly found?: string; readonly expected?: readonly string[] } = {},
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
