// Fails codegen on a declared `ContractReference` the emitted schemas would
// otherwise substitute without proof: an unresolvable path, a resolved type
// that doesn't structurally cover the member it replaces, or an owner
// reachable from more than its own declaring root.

import { type ContractRoot } from "../../src/contract/roots.ts";
import { reachableTypes } from "./json-schema.ts";

import {
  type ContractIR,
  type ContractReference,
  type ContractRootIR,
} from "#contract/ir";

/**
 * Fail codegen on a declared {@link ContractReference} that would substitute a
 * lie: a path that doesn't resolve, a resolved type that doesn't structurally
 * cover the member it replaces, or an owner reachable from more than its own
 * declaring root.
 */
export function validateReferences(ir: ContractIR): void {
  const entries = Object.entries(ir.roots) as [ContractRoot, ContractRootIR][];
  const reachableByRoot = new Map(
    entries.map(([root, rootIR]) => [
      root,
      new Set(
        reachableTypes(ir, rootIR.type, rootIR.references).map(
          ([name]) => name,
        ),
      ),
    ]),
  );
  for (const [root, rootIR] of entries) {
    for (const reference of rootIR.references) {
      const resolved = resolvePath(ir, rootIR.type, reference.path);
      const refArm = refArmOf(ir, reference);
      assertCovers({
        ir,
        resolvedName: resolved,
        refArmName: refArm,
        reference,
      });

      const reachable = reachableByRoot.get(root)!;
      if (!reachable.has(reference.owner)) {
        throw new Error(
          `Contract reference owner ${reference.owner}.${reference.member} is not reachable from its declaring root ${root}`,
        );
      }
      for (const [otherRoot, otherReachable] of reachableByRoot) {
        if (otherRoot === root) continue;
        if (otherReachable.has(reference.owner)) {
          throw new Error(
            `Contract reference owner ${reference.owner} is declared on root ${root} but is also reachable from root ${otherRoot}`,
          );
        }
      }
    }
  }
}

/** Resolve a reference's `path` (`"zt"` or `"zt.a.b"`) to a {@link ContractIR.types} key. */
function resolvePath(ir: ContractIR, rootType: string, path: string): string {
  const [head, ...segments] = path.split(".");
  if (head !== "zt") {
    throw new Error(`Contract reference path must start with "zt": ${path}`);
  }
  let current = rootType;
  for (const segment of segments) {
    const type = ir.types[current];
    if (!type || type.kind !== "object") {
      throw new Error(
        `Contract reference path ${path} traverses ${current}, which is not an object type`,
      );
    }
    const member = type.members.find((candidate) => candidate.name === segment);
    if (!member) {
      throw new Error(
        `Contract reference path ${path} has no member ${segment} on ${current}`,
      );
    }
    if (member.type.kind !== "ref") {
      throw new Error(
        `Contract reference path ${path} traverses ${current}.${segment}, which is not a plain reference (arrays/records/unions are unsupported)`,
      );
    }
    current = member.type.name;
  }
  return current;
}

/** The `$defs` name of the ref arm a reference's `owner.member` substitutes. */
function refArmOf(ir: ContractIR, reference: ContractReference): string {
  const owner = ir.types[reference.owner];
  if (!owner || owner.kind !== "object") {
    throw new Error(
      `Contract reference owner ${reference.owner} is not a known object type`,
    );
  }
  const member = owner.members.find(
    (candidate) => candidate.name === reference.member,
  );
  if (!member) {
    throw new Error(
      `Contract reference member never matched a member: ${reference.owner}.${reference.member}`,
    );
  }
  const { type } = member;
  if (type.kind === "ref") return type.name;
  if (type.kind === "union") {
    const refs = type.options.filter((option) => option.kind === "ref");
    if (refs.length === 1) return refs[0]!.name;
  }
  throw new Error(
    `Contract reference ${reference.owner}.${reference.member} holds no single ref arm to substitute`,
  );
}

/**
 * Every member of `refArmName` exists on `resolvedName` with a deep-equal
 * type and equal optionality, and both share an equal `additional` clause.
 */
function assertCovers(options: {
  ir: ContractIR;
  resolvedName: string;
  refArmName: string;
  reference: ContractReference;
}): void {
  const { ir, resolvedName, refArmName, reference } = options;
  const resolved = ir.types[resolvedName];
  const refArm = ir.types[refArmName];
  if (
    !resolved ||
    resolved.kind !== "object" ||
    !refArm ||
    refArm.kind !== "object"
  ) {
    throw new Error(
      `Contract reference ${reference.owner}.${reference.member} does not resolve to comparable object types`,
    );
  }
  const missing = refArm.members
    .filter((member) => {
      const match = resolved.members.find(
        (candidate) => candidate.name === member.name,
      );
      return (
        !match ||
        match.optional !== member.optional ||
        !deepEqual(match.type, member.type)
      );
    })
    .map((member) => member.name);
  const additionalMismatch = !deepEqual(resolved.additional, refArm.additional);
  if (missing.length > 0 || additionalMismatch) {
    const missingNote =
      missing.length > 0 ? `: missing ${missing.join(", ")}` : "";
    const additionalNote = additionalMismatch
      ? " (index signature differs)"
      : "";
    throw new Error(
      `Contract reference path ${reference.path} does not cover ${reference.owner}.${reference.member}${missingNote}${additionalNote}`,
    );
  }
}

/**
 * Structural equality for IR fragments. A key holding `undefined` (e.g. a
 * helper's absent `filter`) is treated the same as an omitted key, since
 * `JSON.stringify` already erases that distinction in the committed artifacts.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord).filter(
    (key) => aRecord[key] !== undefined,
  );
  const bKeys = Object.keys(bRecord).filter(
    (key) => bRecord[key] !== undefined,
  );
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) => key in bRecord && deepEqual(aRecord[key], bRecord[key]),
  );
}
