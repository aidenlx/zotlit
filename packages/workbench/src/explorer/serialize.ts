// Converts live Template data into the Workbench's JSON-safe contract form.

import type { ContractRoot } from "@zotlit/db";
import type {
  ContractHelper,
  ContractType,
  RuntimeContractIR,
} from "@zotlit/db/contract/ir";
import contractIRJson from "@zotlit/db/contract/ir.runtime.json" with { type: "json" };

import { formatAccessorPath } from "./accessor-path";
import type { TemplatePathSegment } from "./accessor-path";
import { inertPlaceholderReason } from "./inert-placeholder";
import { coerceToString } from "./string-coercion";
const UNKNOWN_CONTRACT_TYPE: ContractType = { kind: "unknown" };
const contractIR = contractIRJson as RuntimeContractIR;

/**
 * The committed contract IR lacks an entry this build's data shapes need — a
 * stale generated artifact rather than anything a caller selected. Distinct
 * from a fault raised while evaluating the data itself.
 */
export class ContractMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractMetadataError";
  }
}

export function serializeTemplateData(
  root: object,
  contractRoot: ContractRoot,
): unknown {
  const rootIR = contractIR.roots[contractRoot];
  if (!rootIR)
    throw new ContractMetadataError(
      `Missing contract metadata for '${contractRoot}'`,
    );

  return serializeValue(root, {
    path: [],
    active: new WeakMap(),
    contractType: { kind: "ref", name: rootIR.type },
  });
}

interface SerializeContext {
  path: readonly TemplatePathSegment[];
  active: WeakMap<object, readonly TemplatePathSegment[]>;
  contractType: ContractType;
}

function serializeValue(value: unknown, context: SerializeContext): unknown {
  const { path, active } = context;
  if (typeof value === "function") {
    const inertReason = inertPlaceholderReason(value);
    if (inertReason !== undefined) return { $inert: inertReason };

    const contractHelper = findContractHelper(context.contractType);
    if (!contractHelper) {
      throw new ContractMetadataError(
        `Missing helper contract metadata for '${formatAccessorPath(path, "zt")}'`,
      );
    }

    let result: unknown = null;
    let helperError: string | undefined;
    try {
      result = (value as (...args: unknown[]) => unknown)() ?? null;
    } catch (error) {
      helperError = error instanceof Error ? error.message : String(error);
    }
    return {
      $helper: contractHelper.name,
      signature: contractHelper.signature,
      value: serializeValue(result, {
        path,
        active,
        contractType: contractHelper.value,
      }),
      ...(helperError === undefined ? {} : { error: helperError }),
    };
  }

  if (value === null || value === undefined) return value;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value !== "object") return coerceToString(value);

  const cyclePath = active.get(value);
  if (cyclePath !== undefined) {
    return { $ref: formatAccessorPath(cyclePath, "zt") };
  }
  if (!isPlainContainer(value)) return coerceToString(value);

  active.set(value, path);
  try {
    if (Array.isArray(value)) {
      const itemType = arrayItemContractType(context.contractType);
      return value.map(
        (entry, index) =>
          serializeValue(entry, {
            path: [...path, index],
            active,
            contractType: itemType,
          }) ?? null,
      );
    }

    const serialized: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const entry = serializeValue((value as Record<string, unknown>)[key], {
        path: [...path, key],
        active,
        contractType: memberContractType(context.contractType, key),
      });
      if (entry !== undefined) serialized[key] = entry;
    }
    return serialized;
  } finally {
    active.delete(value);
  }
}

function findContractHelper(type: ContractType): ContractHelper | null {
  const resolved = resolveContractType(type);
  if (resolved.kind === "helper") return resolved;
  if (resolved.kind !== "union") return null;
  for (const option of resolved.options) {
    const helper = findContractHelper(option);
    if (helper) return helper;
  }
  return null;
}

function memberContractType(type: ContractType, name: string): ContractType {
  const resolved = resolveContractType(type);
  if (resolved.kind === "object") {
    return (
      resolved.members.find((member) => member.name === name)?.type ??
      resolved.additional?.type ??
      UNKNOWN_CONTRACT_TYPE
    );
  }
  if (resolved.kind === "union") {
    for (const option of resolved.options) {
      const memberType = memberContractType(option, name);
      if (memberType.kind !== "unknown") return memberType;
    }
  }
  return UNKNOWN_CONTRACT_TYPE;
}

function arrayItemContractType(type: ContractType): ContractType {
  const resolved = resolveContractType(type);
  if (resolved.kind === "array") return resolved.items;
  if (resolved.kind === "union") {
    for (const option of resolved.options) {
      const itemType = arrayItemContractType(option);
      if (itemType.kind !== "unknown") return itemType;
    }
  }
  return UNKNOWN_CONTRACT_TYPE;
}

function resolveContractType(type: ContractType): ContractType {
  let resolved = type;
  const seen = new Set<string>();
  while (resolved.kind === "ref") {
    if (seen.has(resolved.name)) return UNKNOWN_CONTRACT_TYPE;
    seen.add(resolved.name);
    resolved = contractIR.types[resolved.name] ?? UNKNOWN_CONTRACT_TYPE;
  }
  return resolved;
}

function isPlainContainer(value: object): boolean {
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
