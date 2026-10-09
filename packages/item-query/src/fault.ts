import type {
  BinaryOperator,
  ExpressionSyntaxError,
} from "@zotlit/filter-expression";

import type { ItemQueryErrorCode } from "./error";
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
export type Fault =
  | { readonly kind: "syntax"; readonly fault: SyntaxFault }
  | {
      readonly kind: "unknown";
      readonly role: Role;
      readonly name: string;
      readonly at: Span;
      readonly receiver?: Receiver;
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
