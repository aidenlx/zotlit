import type {
  BinaryOperator,
  ExpressionSyntaxError,
} from "@zotlit/filter-expression";

import type { ItemQueryErrorCode } from "./error";
import type { ValueShape } from "./fields";
import type { StaticType } from "./filter-plan";

/** UTF-16 offsets into the caller's argument; `to` is exclusive. */
export interface Span {
  readonly from: number;
  readonly to: number;
}
export type SyntaxFault = ExpressionSyntaxError;
export type Role =
  | "field"
  | "custom-field"
  | "global"
  | "method"
  | "property"
  | "projection-path"
  | "sortable-field";
export interface Receiver {
  readonly type: StaticType;
  readonly at: Span;
  readonly field?: string;
}
export interface Callee {
  readonly name: string;
  readonly receiver?: Receiver;
}
/**
 * A fact about one invalid Item Query. `plain` is reserved for the five facts
 * that have no generic source: a duplicate Target Library, an invalid limit,
 * invalid Projection Path grammar, the regular-expression engine's reason, and a
 * callee that is not a name.
 */
export type Fault =
  | { readonly kind: "syntax"; readonly fault: SyntaxFault }
  | { readonly kind: "custom-key"; readonly at: Span }
  | {
      readonly kind: "unknown";
      readonly role: Role;
      readonly name: string;
      readonly at: Span;
      readonly receiver?: Receiver;
      readonly customFields?: readonly string[];
      readonly dotted?: boolean;
      readonly pathResolution?: {
        readonly found: ValueShape["kind"];
        readonly expected: "list" | "list-element";
        /** Offset of the accessor that cannot read the preceding value. */
        readonly offset: number;
      };
    }
  | {
      readonly kind: "arity";
      readonly callee: Callee;
      readonly at: Span;
      readonly given: number;
    }
  | {
      readonly kind: "argument-type";
      readonly callee: Callee;
      readonly at: Span;
      readonly index: number;
      readonly found: string;
      readonly expected: string;
    }
  | { readonly kind: "unreadable"; readonly name: string; readonly at: Span }
  | {
      readonly kind: "plain";
      readonly code: ItemQueryErrorCode;
      readonly at?: Span;
      readonly message: string;
      readonly action: string;
    }
  | {
      readonly kind: "constant";
      readonly value: boolean;
      readonly operator: BinaryOperator;
      readonly left: Receiver;
      readonly right: Receiver;
      readonly at: Span;
    };
export type PlainFault = Extract<Fault, { kind: "plain" }>;
export type ItemQueryFault = Exclude<Fault, { kind: "constant" }>;
