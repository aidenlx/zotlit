// Keeps an Item Snapshot to the fields the generated contract declares.

import type { ContractRoot } from "@zotlit/db";
import type { ContractIR, ContractType } from "@zotlit/db/contract/ir";
import contractIRJson from "@zotlit/db/contract/ir.json" with { type: "json" };

const contractIR = contractIRJson as ContractIR;
const UNKNOWN_CONTRACT_TYPE: ContractType = { kind: "unknown" };

/**
 * Serialized markers the walk carries through untouched: a cycle reference, an
 * inert placeholder, and a resolved helper. Each is a contract shape of its
 * own, never an Item record with fields to weigh.
 */
const MARKER_KEYS = ["$ref", "$inert", "$helper"] as const;

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
  if (!rootType) return root;
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
  const resolved = resolveType(type);
  if (Array.isArray(value)) {
    const items =
      resolved.kind === "array" ? resolved.items : UNKNOWN_CONTRACT_TYPE;
    return value.map((entry) => prune(entry, items, customFields));
  }
  if (!isRecord(value)) return value;
  if (MARKER_KEYS.some((key) => key in value)) return value;
  if (resolved.kind !== "object") return value;

  const declared = new Set(resolved.members.map((member) => member.name));
  const fields =
    resolved.additional?.schema === "item-fields"
      ? allowedItemFields(value, customFields)
      : undefined;

  const pruned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (declared.has(key)) {
      const memberType = resolved.members.find(
        (member) => member.name === key,
      )?.type;
      pruned[key] = prune(
        entry,
        memberType ?? UNKNOWN_CONTRACT_TYPE,
        customFields,
      );
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
 * The named shape behind a member type. A nullable member reads as a union of
 * one shape and `null`, so a single non-primitive option resolves through;
 * a union of several shapes stays as it is and the walk stops there.
 */
function resolveType(type: ContractType): ContractType {
  let resolved = type;
  const seen = new Set<string>();
  for (;;) {
    if (resolved.kind === "ref") {
      if (seen.has(resolved.name)) return UNKNOWN_CONTRACT_TYPE;
      seen.add(resolved.name);
      resolved = contractIR.types[resolved.name] ?? UNKNOWN_CONTRACT_TYPE;
      continue;
    }
    if (resolved.kind === "union") {
      const shapes = resolved.options.filter(
        (option) => option.kind === "ref" || option.kind === "object",
      );
      if (shapes.length !== 1 || shapes[0] === undefined) return resolved;
      resolved = shapes[0];
      continue;
    }
    return resolved;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
