// Keeps an Item Snapshot to the fields the generated contract declares.

import type { ContractRoot } from "@zotlit/db";
import type {
  ContractIR,
  ContractObject,
  ContractType,
} from "@zotlit/db/contract/ir";
import contractIRJson from "@zotlit/db/contract/ir.json" with { type: "json" };

const contractIR = contractIRJson as ContractIR;
const UNKNOWN_CONTRACT_TYPE: ContractType = { kind: "unknown" };

/**
 * Serialized markers the walk carries through untouched: a cycle reference, an
 * inert placeholder, and a resolved helper. Each is a contract shape of its
 * own, never an Item record with fields to weigh.
 */
export const MARKER_KEYS = ["$ref", "$inert", "$helper"] as const;

/**
 * Drops every key an Item-shaped record carries that neither the contract type
 * nor the generated Zotero field schema for that Item's type declares. A key
 * the user declared as a custom field in their own Zotero database is kept.
 *
 * Item-shaped records are the ones the contract marks with an `item-fields`
 * index signature — the note, filename, related-Item, and parent-Item shapes —
 * and they are the only place an undeclared Zotero field can enter a snapshot.
 *
 * @param root a serialized Template root
 * @param contractRoot the Template root the value was serialized against
 * @param customFields custom field names declared by the Items in the snapshot
 * @returns a pruned copy; the input is left as it is
 */
export function applyFieldAllowList(
  root: Record<string, unknown>,
  contractRoot: ContractRoot,
  customFields: ReadonlySet<string>,
): Record<string, unknown> {
  const rootType = contractIR.roots[contractRoot]?.type;
  if (!rootType) {
    // The allow-list is a redaction gate: an unknown root fails the export
    // rather than passing the snapshot through unpruned.
    throw new Error(
      `The Template contract declares no root '${contractRoot}'.`,
    );
  }
  return prune(root, { kind: "ref", name: rootType }, customFields) as Record<
    string,
    unknown
  >;
}

function prune(
  value: unknown,
  type: ContractType,
  customFields: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => prune(entry, arrayItems(type), customFields));
  }
  if (!isRecord(value)) return value;
  if (MARKER_KEYS.some((key) => key in value)) return value;

  const shapes = objectShapes(type);
  if (shapes.length === 0) return value;

  const declared = new Map<string, ContractType>();
  for (const shape of shapes) {
    for (const member of shape.members) {
      if (!declared.has(member.name)) declared.set(member.name, member.type);
    }
  }
  const fields = shapes.some(
    (shape) => shape.additional?.schema === "item-fields",
  )
    ? allowedItemFields(value, customFields)
    : undefined;

  const pruned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const memberType = declared.get(key);
    if (memberType) {
      pruned[key] = prune(entry, memberType, customFields);
    } else if (fields?.has(key)) {
      pruned[key] = entry;
    }
  }
  return pruned;
}

/** The Zotero field names an Item of this record's type may carry. */
function allowedItemFields(
  record: Record<string, unknown>,
  customFields: ReadonlySet<string>,
): ReadonlySet<string> {
  const itemType = record.itemType;
  const declared =
    typeof itemType === "string" &&
    Object.hasOwn(contractIR.itemTypes, itemType)
      ? contractIR.itemTypes[itemType]
      : undefined;
  return new Set([...(declared ?? []), ...customFields]);
}

/**
 * Every object shape a value of this type may take. A nullable member reads as
 * a union of one shape and `null`; a union of several shapes contributes all of
 * them, so a key is kept when any of the shapes declares it and the record is
 * pruned rather than passed through.
 */
function objectShapes(
  type: ContractType,
  seen: ReadonlySet<string> = new Set(),
): ContractObject[] {
  if (type.kind === "ref") {
    if (seen.has(type.name)) return [];
    return objectShapes(
      contractIR.types[type.name] ?? UNKNOWN_CONTRACT_TYPE,
      new Set([...seen, type.name]),
    );
  }
  if (type.kind === "object") return [type];
  if (type.kind === "union") {
    return type.options.flatMap((option) => objectShapes(option, seen));
  }
  return [];
}

/** The element type behind an array member, through refs and nullable unions. */
function arrayItems(type: ContractType): ContractType {
  const resolved = resolveRef(type);
  if (resolved.kind === "array") return resolved.items;
  if (resolved.kind === "union") {
    for (const option of resolved.options) {
      const items = arrayItems(option);
      if (items.kind !== "unknown") return items;
    }
  }
  return UNKNOWN_CONTRACT_TYPE;
}

function resolveRef(type: ContractType): ContractType {
  let resolved = type;
  const seen = new Set<string>();
  while (resolved.kind === "ref") {
    if (seen.has(resolved.name)) return UNKNOWN_CONTRACT_TYPE;
    seen.add(resolved.name);
    resolved = contractIR.types[resolved.name] ?? UNKNOWN_CONTRACT_TYPE;
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
