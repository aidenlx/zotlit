// Shape of the Template Contract IR this app reads.
//
// Mirrors `packages/db/scripts/contract/ir.ts`. The db package is excluded from
// docs deploys, so the emitter commits an IR copy here and the page model types
// it against this declaration rather than importing across the workspace.
//
// @see docs/adr/0015-template-contract-artifacts-generate-from-ts-types.md

/** A `zt` data root a Template renders against. */
export type ContractRoot = "note" | "annotation" | "filename";

export interface ContractIR {
  /** Generated-file banner; JSON carries no comment syntax. */
  $comment: string;
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
  templates: readonly string[];
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

export type ContractNamedType = ContractObject | ContractUnion;

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
  /** Doc comment written above this option in a declared literal union. */
  description?: string;
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
  type: string;
}

/** A function-valued member: a link helper the engines invoke differently. */
export interface ContractHelper {
  kind: "helper";
  name: string;
  /** Rendered TS signature, e.g. `(alias?: string, subpath?: string) => string | null`. */
  signature: string;
  /** Liquid filter passing the helper its arguments, e.g. `note_link`. */
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
  /** The member's `@example` blocks, in source order. */
  examples?: readonly ContractExample[];
}

/** One `@example` block: a single fenced code sample an emitter renders as code. */
export interface ContractExample {
  /** Fence language, e.g. `liquid`; absent for an unlabelled fence. */
  lang?: string;
  code: string;
}
