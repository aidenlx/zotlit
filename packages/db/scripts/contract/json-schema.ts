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
      Object.entries(ir.types).map(([name, type]) => [name, schemaFor(type)]),
    ),
  };
}

function defRef(name: string): string {
  return `#/$defs/${name}`;
}

function schemaFor(type: ContractType): JsonSchema {
  switch (type.kind) {
    case "primitive":
      return { type: type.type };
    case "literal":
      return { const: type.value };
    case "unknown":
      return {};
    case "array":
      return { type: "array", items: schemaFor(type.items) };
    case "record":
      return { type: "object", additionalProperties: schemaFor(type.values) };
    case "ref":
      return { $ref: defRef(type.name) };
    case "stringified":
      return {
        type: "string",
        description: `${type.type}, as its string form.`,
      };
    case "helper":
      return {
        type: "object",
        properties: {
          $helper: { const: type.name },
          signature: { const: type.signature },
          value: schemaFor(type.value),
        },
        required: ["$helper", "signature", "value"],
        additionalProperties: false,
      };
    case "object":
      return objectSchema(type);
    case "union":
      return unionSchema(type);
  }
}

function objectSchema(object: ContractObject): JsonSchema {
  const required = object.members
    .filter((member) => !member.optional)
    .map((member) => member.name);
  return {
    type: "object",
    description: normalizeDoc(object.description),
    properties: Object.fromEntries(
      object.members.map((member) => [member.name, memberSchema(member)]),
    ),
    required: required.length > 0 ? required : undefined,
    additionalProperties: object.additional
      ? withDescription(
          schemaFor(object.additional.type),
          object.additional.description,
        )
      : false,
  };
}

function memberSchema(member: ContractMember): JsonSchema {
  return withDescription(schemaFor(member.type), member.description);
}

/** A member's own doc wins over any note the emitted type carries. */
function withDescription(schema: JsonSchema, description?: string): JsonSchema {
  if (!description) return schema;
  return { ...schema, description: normalizeDoc(description) };
}

function unionSchema(union: ContractUnion): JsonSchema {
  const description = normalizeDoc(union.description);
  const options = union.options.map(schemaFor);
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

function formatList(items: readonly string[]): string {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(
    items.map((item) => `\`${item}\``),
  );
}
