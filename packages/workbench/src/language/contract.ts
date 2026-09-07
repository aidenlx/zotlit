// Template Contract traversal shared by completion and local-variable inference.
import type { ContractMember, ContractType } from "@zotlit/db/contract/ir";
import type { ContractIR } from "@zotlit/db/contract/ir";
import contractJson from "@zotlit/db/contract/ir.json";
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
export function sampleValue(sample: unknown, path: readonly string[]): unknown {
  let value = sample;
  for (const key of path) {
    if (Array.isArray(value) && (key === "first" || key === "last"))
      value = key === "first" ? value[0] : value.at(-1);
    else if (value && typeof value === "object")
      value = (value as Record<string, unknown>)[key];
    else return undefined;
  }
  return value;
}
