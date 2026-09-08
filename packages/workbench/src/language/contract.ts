import type { TemplatePathSegment } from "#/explorer/accessor-path";

// Template Contract traversal shared by completion and local-variable inference.
import type { ContractMember, ContractType } from "@zotlit/db/contract/ir";
import type { ContractIR } from "@zotlit/db/contract/ir";
import contractJson from "@zotlit/db/contract/ir.json";

import { formatAccessorPath } from "#/explorer/accessor-path";
export const contract = contractJson as ContractIR;

export function resolve(type: ContractType): ContractType {
  return type.kind === "ref" ? resolve(contract.types[type.name]!) : type;
}
export function members(type: ContractType): readonly ContractMember[] {
  const value = resolve(type);
  if (value.kind === "object") return value.members;
  if (value.kind === "union") return value.options.flatMap(members);
  if (value.kind === "helper") return members(value.value);
  return [];
}
export function describe(type: ContractType): string {
  switch (type.kind) {
    case "primitive":
      return type.type;
    case "literal":
      return JSON.stringify(type.value);
    case "ref":
      return type.name;
    case "array":
      return `${describe(type.items)}[]`;
    case "helper":
      return type.signature;
    case "union":
      return type.options.map(describe).join(" | ");
    case "stringified":
      return type.type;
    default:
      return type.kind;
  }
}
export function child(
  type: ContractType,
  key: string,
): ContractType | undefined {
  const value = resolve(type);
  if (
    value.kind === "array" &&
    (key === "first" || key === "last" || /^\d+$/.test(key))
  )
    return value.items;
  return members(value).find((member) => member.name === key)?.type;
}
/**
 * Formats the value at `path` for a `Sample:` hint.
 * @param sample - The data graph a template reads: link helpers are functions
 * and an annotation links back to its parent Item.
 * @param path - Keys from `zt` to the value, read the way `sampleValue` reads
 * them.
 * @returns JSON where a link helper is the text it outputs and a value that
 * refers to one of its ancestors is a `$ref` to that ancestor's `zt` accessor;
 * undefined when the path resolves to nothing.
 */
export function sampleJson(
  sample: unknown,
  path: readonly string[],
): string | undefined {
  const ancestors = new Map<object, readonly TemplatePathSegment[]>();
  let value = sample;
  path.forEach((key, depth) => {
    if (value && typeof value === "object")
      ancestors.set(value, path.slice(0, depth));
    value = sampleStep(value, key);
  });
  if (value === undefined) return undefined;
  const plain = (
    node: unknown,
    at: readonly TemplatePathSegment[],
  ): unknown => {
    if (typeof node === "function") return String(node);
    if (!node || typeof node !== "object") return node;
    const seen = ancestors.get(node);
    if (seen) return { $ref: formatAccessorPath(seen, "zt") };
    ancestors.set(node, at);
    const out = Array.isArray(node)
      ? node.map((entry, index) => plain(entry, [...at, index]))
      : Object.fromEntries(
          Object.entries(node).map(([key, entry]) => [
            key,
            plain(entry, [...at, key]),
          ]),
        );
    ancestors.delete(node);
    return out;
  };
  return JSON.stringify(plain(value, path));
}
export function sampleValue(sample: unknown, path: readonly string[]): unknown {
  let value = sample;
  for (const key of path) value = sampleStep(value, key);
  return value;
}
/** One key read on a Sample: `first` and `last` address an array's ends. */
function sampleStep(value: unknown, key: string): unknown {
  if (Array.isArray(value) && (key === "first" || key === "last"))
    return key === "first" ? value[0] : value.at(-1);
  if (value && typeof value === "object")
    return (value as Record<string, unknown>)[key];
  return undefined;
}
