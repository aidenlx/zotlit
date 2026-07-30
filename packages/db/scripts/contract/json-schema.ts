// Emits one contract root's JSON Schema (draft 2020-12) from the contract IR.

import { type ContractRoot } from "../../src/contract/roots.ts";

import {
  type ContractIR,
  type ContractMember,
  type ContractObject,
  type ContractReference,
  type ContractType,
  type ContractUnion,
} from "#contract/ir";

export interface JsonSchema {
  [keyword: string]: unknown;
}

interface SchemaContext {
  itemTypes: ContractIR["itemTypes"];
  references: readonly ContractReference[];
  owner: string;
  matchedReferences: Set<ContractReference>;
  /** True only for the members directly on a `$defs` entry's own object — never for a nested inline object it contains. */
  atOwnerRoot: boolean;
}

export function toJsonSchema(ir: ContractIR, root: ContractRoot): JsonSchema {
  const rootIR = ir.roots[root];
  if (!rootIR) throw new Error(`Contract IR carries no ${root} root`);
  const matchedReferences = new Set<ContractReference>();
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `urn:zotlit:template-contract:v${ir.contractVersion}:${root}`,
    $comment: ir.$comment,
    title: `zt (${root} root)`,
    description: `The serialized \`zt\` data the ${formatList(rootIR.templates)} ${
      rootIR.templates.length > 1 ? "templates receive" : "template receives"
    }.`,
    $ref: defRef(rootIR.type),
    $defs: Object.fromEntries(
      reachableTypes(ir, rootIR.type, rootIR.references).map(([name, type]) => [
        name,
        schemaFor(type, {
          itemTypes: ir.itemTypes,
          references: rootIR.references,
          owner: name,
          matchedReferences,
          atOwnerRoot: true,
        }),
      ]),
    ),
  };
  const unmatched = rootIR.references.filter(
    (reference) => !matchedReferences.has(reference),
  );
  if (unmatched.length > 0) {
    throw new Error(
      `Contract reference never matched a member: ${unmatched
        .map(({ owner, member }) => `${owner}.${member}`)
        .join(", ")}`,
    );
  }
  return schema;
}

function defRef(name: string): string {
  return `#/$defs/${name}`;
}

/** Whether a declared reference substitutes `owner`'s `member` at its own root. */
function referenceFor(
  references: readonly ContractReference[],
  owner: string | undefined,
  member: string,
): ContractReference | undefined {
  return references.find(
    (reference) => reference.owner === owner && reference.member === member,
  );
}

/**
 * Every named type a root reaches, skipping a member a declared reference
 * substitutes — the same scoping {@link memberSchema} applies via
 * `atOwnerRoot`, so a reference-only owner never drags its ref-arm type in.
 */
export function reachableTypes(
  ir: ContractIR,
  root: string,
  references: readonly ContractReference[],
): Array<readonly [string, ContractIR["types"][string]]> {
  const names = new Set<string>();
  const visit = (
    type: ContractType,
    owner: string | undefined,
    atOwnerRoot: boolean,
  ): void => {
    switch (type.kind) {
      case "ref": {
        if (names.has(type.name)) return;
        names.add(type.name);
        visit(ir.types[type.name]!, type.name, true);
        return;
      }
      case "array":
        visit(type.items, owner, false);
        return;
      case "record":
        visit(type.values, owner, false);
        return;
      case "helper":
        visit(type.value, owner, false);
        return;
      case "object":
        for (const member of type.members) {
          if (
            atOwnerRoot &&
            referenceFor(references, owner, member.name) !== undefined
          ) {
            continue;
          }
          visit(member.type, owner, false);
        }
        if (type.additional) visit(type.additional.type, owner, false);
        return;
      case "union":
        for (const option of type.options) visit(option, owner, atOwnerRoot);
        return;
      default:
        return;
    }
  };
  visit({ kind: "ref", name: root }, undefined, false);
  return [...names].map((name) => [name, ir.types[name]!] as const);
}

function schemaFor(type: ContractType, context: SchemaContext): JsonSchema {
  switch (type.kind) {
    case "primitive":
      return { type: type.type };
    case "literal":
      return withDescription({ const: type.value }, type.description);
    case "unknown":
      return {};
    case "array":
      return { type: "array", items: schemaFor(type.items, context) };
    case "record":
      return {
        type: "object",
        additionalProperties: schemaFor(type.values, context),
      };
    case "ref":
      return { $ref: defRef(type.name) };
    case "stringified":
      return {
        type: "string",
        description: `${type.type}, as its string form.`,
      };
    case "helper":
      return {
        oneOf: [
          {
            type: "object",
            properties: {
              $helper: { const: type.name },
              signature: { const: type.signature },
              value: schemaFor(type.value, context),
            },
            required: ["$helper", "signature", "value"],
            additionalProperties: false,
          },
          ...(type.inert ? [inertMarkerSchema()] : []),
        ],
      };
    case "object":
      return objectSchema(type, context);
    case "union":
      return unionSchema(type, context);
  }
}

function objectSchema(
  object: ContractObject,
  context: SchemaContext,
): JsonSchema {
  const required = object.members
    .filter((member) => !member.optional)
    .map((member) => member.name);
  const properties = Object.fromEntries(
    object.members.map((member) => [
      member.name,
      memberSchema(member, context),
    ]),
  );
  const base = {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: object.additional
      ? withDescription(
          schemaFor(object.additional.type, context),
          object.additional.description,
        )
      : false,
  };
  const isItemFields = object.additional?.schema === "item-fields";
  return {
    description: isItemFields
      ? joinDescriptions(object.description, object.additional?.description)
      : normalizeDoc(object.description),
    ...(isItemFields ? itemTypeSchema(base, context.itemTypes) : base),
  };
}

/**
 * An item-fields owner's own description plus its dropped index-signature
 * description, since {@link itemTypeSchema} rebuilds the object without an
 * `additionalProperties` keyword to carry the latter.
 */
function joinDescriptions(
  ...parts: (string | undefined)[]
): string | undefined {
  const normalized = parts
    .map(normalizeDoc)
    .filter((part): part is string => Boolean(part));
  return normalized.length > 0 ? normalized.join("\n\n") : undefined;
}

function memberSchema(
  member: ContractMember,
  context: SchemaContext,
): JsonSchema {
  const reference =
    context.atOwnerRoot &&
    referenceFor(context.references, context.owner, member.name);
  if (reference) {
    context.matchedReferences.add(reference);
    return withDescription(
      substituteReference(member.type, reference.path, {
        ...context,
        atOwnerRoot: false,
      }),
      member.description,
    );
  }
  return withDescription(
    schemaFor(member.type, { ...context, atOwnerRoot: false }),
    member.description,
  );
}

/**
 * Replace only the ref arm of a reference-substituted member with the
 * reference marker, keeping any other union options (e.g. `null`) as
 * themselves.
 */
function substituteReference(
  type: ContractType,
  path: string,
  context: SchemaContext,
): JsonSchema {
  if (type.kind === "ref") return referenceMarkerSchema(path);
  if (type.kind === "union") {
    return {
      oneOf: type.options.map((option) =>
        option.kind === "ref"
          ? referenceMarkerSchema(path)
          : schemaFor(option, context),
      ),
    };
  }
  throw new Error(
    `Contract reference targets a member with no ref arm: ${JSON.stringify(type)}`,
  );
}

/** A member's own doc wins over any note the emitted type carries. */
function withDescription(schema: JsonSchema, description?: string): JsonSchema {
  if (!description) return schema;
  return { ...schema, description: normalizeDoc(description) };
}

function unionSchema(union: ContractUnion, context: SchemaContext): JsonSchema {
  const description = normalizeDoc(union.description);
  const options = union.options.map((option) => schemaFor(option, context));
  const enumValues = union.options.map((option) =>
    option.kind === "literal" ? option.value : undefined,
  );
  if (enumValues.every((value) => value !== undefined)) {
    // A documented option needs a schema of its own to hold its description.
    const documented = union.options.some(
      (option) => option.kind === "literal" && option.description,
    );
    return documented
      ? { oneOf: options, description }
      : { enum: enumValues, description };
  }
  const primitives = options.map((option) =>
    Object.keys(option).length === 1 && typeof option.type === "string"
      ? option.type
      : undefined,
  );
  if (primitives.every((type) => type !== undefined)) {
    return { type: primitives, description };
  }
  return { anyOf: options, description };
}

/** Every contract doc comment writes the plain `{@link Target}` form. */
const LINK_TAG = /\{@link\s+([^}\s]+)\}/g;

/**
 * JSDoc wraps at the source's column limit and links its own symbols. Rejoin
 * each paragraph so the description reads as prose, keep the paragraph breaks,
 * and render a link tag as the code-formatted target a schema reader can search
 * for.
 */
function normalizeDoc(text: string | undefined): string | undefined {
  return text
    ?.trim()
    .replaceAll(LINK_TAG, "`$1`")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replaceAll(/\s+/g, " ").trim())
    .join("\n\n");
}

function itemTypeSchema(
  base: JsonSchema,
  itemTypes: ContractIR["itemTypes"],
): JsonSchema {
  const baseProperties = base.properties as Record<string, JsonSchema>;
  return {
    type: base.type,
    properties: baseProperties,
    required: base.required,
    oneOf: Object.entries(itemTypes).map(([itemType, fields]) => ({
      properties: {
        ...Object.fromEntries(
          fields
            .filter((field) => !(field in baseProperties))
            .map((field) => [field, { type: "string" }]),
        ),
        itemType: { const: itemType },
      },
      required: ["itemType"],
    })),
    unevaluatedProperties: false,
  };
}

function inertMarkerSchema(): JsonSchema {
  return {
    type: "object",
    properties: { $inert: { type: "string" } },
    required: ["$inert"],
    additionalProperties: false,
  };
}

function referenceMarkerSchema(path: string): JsonSchema {
  return {
    type: "object",
    properties: {
      $ref: { const: path },
    },
    required: ["$ref"],
    additionalProperties: false,
  };
}

function formatList(items: readonly string[]): string {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(
    items.map((item) => `\`${item}\``),
  );
}
