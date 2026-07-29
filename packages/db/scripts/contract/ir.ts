// Shape of the committed contract IR the extractor emits and the contract emitters consume.

import {
  type ContractRoot,
  type TemplateSlot,
} from "../../src/contract/roots.ts";

/**
 * The extracted `zt` contract: one entry per emitted root plus every named type
 * those roots reach, flattened into {@link ContractIR.types}.
 *
 * @see docs/adr/0015-template-contract-artifacts-generate-from-ts-types.md
 */
export interface ContractIR {
  /** Generated-file banner; JSON carries no comment syntax. */
  $comment: string;
  /** The `CONTRACT_VERSION` of `src/contract/roots.ts` at extraction time. */
  contractVersion: number;
  roots: Readonly<Partial<Record<ContractRoot, ContractRootIR>>>;
  /** Regular Zotero item types and the `zt` field names each type exposes. */
  itemTypes: Readonly<Record<string, readonly string[]>>;
  /** Every named type reachable from {@link ContractIR.roots}, keyed by TS name. */
  types: Readonly<Record<string, ContractNamedType>>;
}

export interface ContractRootIR {
  /** Key into {@link ContractIR.types} holding this root's `zt` shape. */
  type: string;
  /** Template names rendering against this root. */
  templates: readonly TemplateSlot[];
  /** Members serialized as paths back to an object already emitted in this root. */
  references: readonly ContractReference[];
}

export interface ContractReference {
  /** Named type that owns the member. */
  owner: string;
  member: string;
  /** Serialized path to the first occurrence. */
  path: string;
}

/** A type that earns its own {@link ContractIR.types} entry: declared in this package and referenced by name. */
export type ContractNamedType = ContractObject | ContractUnion;

/**
 * The serialized form of one contract value — what `format=json` emits, not the
 * TS type itself. Getters are evaluated, `toString` is dropped (it is
 * non-enumerable), Temporal values become their string form, and helpers become
 * {@link ContractHelper} markers.
 */
export type ContractType =
  | ContractPrimitive
  | ContractLiteral
  | ContractUnknown
  | ContractArray
  | ContractRecord
  | ContractRef
  | ContractStringified
  | ContractHelper
  | ContractNamedType;

export interface ContractPrimitive {
  kind: "primitive";
  type: "string" | "number" | "boolean" | "null";
}

export interface ContractLiteral {
  kind: "literal";
  value: string | number | boolean;
}

/** An open value the contract does not narrow, e.g. an index signature's `unknown`. */
export interface ContractUnknown {
  kind: "unknown";
}

export interface ContractArray {
  kind: "array";
  items: ContractType;
}

/** An object keyed by arbitrary strings, e.g. `Readonly<Record<string, string>>`. */
export interface ContractRecord {
  kind: "record";
  values: ContractType;
}

export interface ContractRef {
  kind: "ref";
  /** Key into {@link ContractIR.types}. */
  name: string;
}

/** A value serialized as its string form, e.g. `Temporal.Instant`. */
export interface ContractStringified {
  kind: "stringified";
  /** Source type name, for prose the emitters generate. */
  type: string;
}

/**
 * A function-valued member. It serializes as
 * `{"$helper": name, "signature": signature, "value": <call result>}`.
 */
export interface ContractHelper {
  kind: "helper";
  /** Member name, echoed in the marker's `$helper` field. */
  name: string;
  /** Rendered TS signature, e.g. `(alias?: string, subpath?: string) => string | null`. */
  signature: string;
  /** Liquid filter passing the helper its arguments, e.g. `note_link`; from the member's `@ztFilter` tag. */
  filter?: string;
  /** Serialized form of the zero-arg call result. */
  value: ContractType;
}

export interface ContractObject {
  kind: "object";
  description?: string;
  members: readonly ContractMember[];
  /** The index signature keeping the shape open, when it has one. */
  additional?: ContractAdditionalMembers;
}

export interface ContractAdditionalMembers {
  description?: string;
  type: ContractType;
  /** How the JSON Schema represents this TypeScript index signature. */
  schema: "open" | "item-fields";
}

export interface ContractUnion {
  kind: "union";
  description?: string;
  options: readonly ContractType[];
}

export interface ContractMember {
  name: string;
  description?: string;
  optional: boolean;
  type: ContractType;
  /** The member's `@example` blocks, in source order; absent when it declares none. */
  examples?: readonly ContractExample[];
}

/** One `@example` block: a single fenced code sample an emitter renders as code. */
export interface ContractExample {
  /** Fence language, e.g. `liquid`; absent for an unlabelled fence. */
  lang?: string;
  code: string;
}
