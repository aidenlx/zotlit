// Emits one contract root's JSON Schema (draft 2020-12) from the contract IR.

import { type ContractRoot } from "../../src/contract/roots.ts";
import {
  type ContractIR,
  type ContractMember,
  type ContractObject,
  type ContractType,
  type ContractUnion,
} from "./ir.ts";

export interface JsonSchema {
  [keyword: string]: unknown;
}

export function toJsonSchema(ir: ContractIR, root: ContractRoot): JsonSchema {
  const rootIR = ir.roots[root];
  if (!rootIR) throw new Error(`Contract IR carries no ${root} root`);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `urn:zotlit:template-contract:v${ir.contractVersion}:${root}`,
    $comment: ir.$comment,
    title: `zt (${root} root)`,
    description: `The serialized \`zt\` data the ${formatList(rootIR.templates)} ${
      rootIR.templates.length > 1 ? "templates receive" : "template receives"
    }.`,
    $ref: defRef(rootIR.type),
    $defs: Object.fromEntries(
      Object.entries(ir.types).map(([name, type]) => [
        name,
        schemaFor(type, ir.itemTypes),
      ]),
    ),
  };
}

function defRef(name: string): string {
  return `#/$defs/${name}`;
}

function schemaFor(
  type: ContractType,
  itemTypes: ContractIR["itemTypes"],
): JsonSchema {
  switch (type.kind) {
    case "primitive":
      return { type: type.type };
    case "literal":
      return { const: type.value };
    case "unknown":
      return {};
    case "array":
      return { type: "array", items: schemaFor(type.items, itemTypes) };
    case "record":
      return {
        type: "object",
        additionalProperties: schemaFor(type.values, itemTypes),
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
              value: schemaFor(type.value, itemTypes),
            },
            required: ["$helper", "signature", "value"],
            additionalProperties: false,
          },
          inertMarkerSchema(),
        ],
      };
    case "object":
      return objectSchema(type, itemTypes);
    case "union":
      return unionSchema(type, itemTypes);
  }
}

function objectSchema(
  object: ContractObject,
  itemTypes: ContractIR["itemTypes"],
): JsonSchema {
  const required = object.members
    .filter((member) => !member.optional)
    .map((member) => member.name);
  const properties = Object.fromEntries(
    object.members.map((member) => [
      member.name,
      memberSchema(member, itemTypes),
    ]),
  );
  const base = {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: object.additional
      ? withDescription(
          schemaFor(object.additional.type, itemTypes),
          object.additional.description,
        )
      : false,
  };
  return {
    description: normalizeDoc(object.description),
    ...(object.additional?.itemFields ? itemTypeSchema(base, itemTypes) : base),
  };
}

function memberSchema(
  member: ContractMember,
  itemTypes: ContractIR["itemTypes"],
): JsonSchema {
  const schema = withDescription(
    schemaFor(member.type, itemTypes),
    member.description,
  );
  if (member.name !== "parentItem") return schema;
  return { anyOf: [schema, referenceMarkerSchema()] };
}

/** A member's own doc wins over any note the emitted type carries. */
function withDescription(schema: JsonSchema, description?: string): JsonSchema {
  if (!description) return schema;
  return { ...schema, description: normalizeDoc(description) };
}

function unionSchema(
  union: ContractUnion,
  itemTypes: ContractIR["itemTypes"],
): JsonSchema {
  const description = normalizeDoc(union.description);
  const options = union.options.map((option) => schemaFor(option, itemTypes));
  const enumValues = union.options.map((option) =>
    option.kind === "literal" ? option.value : undefined,
  );
  if (enumValues.every((value) => value !== undefined)) {
    return { enum: enumValues, description };
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

function referenceMarkerSchema(): JsonSchema {
  return {
    type: "object",
    properties: {
      $ref: {
        type: "string",
        description:
          "Path to the first serialized occurrence, starting at `zt`.",
      },
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
