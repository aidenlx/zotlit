import type {
  BinaryOperator,
  ExpressionSyntaxError,
} from "@zotlit/filter-expression";

import type { ItemQueryErrorCode } from "./error";
import type { ValueShape } from "./fields";
import type { StaticType } from "./filter-plan";
import type { FormulaError } from "./formulas";

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
  | "sortable-field"
  | "formula";
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
 * A fact about one invalid Item Query. `plain` is reserved for the facts
 * that have no generic source: a duplicate Target Library, an invalid limit,
 * invalid Projection Path grammar, the regular-expression engine's reason, a
 * callee that is not a name, and a Query Context that the request does not
 * bind or binds to a value that is not an Indexed Key.
 */
export type Fault =
  | {
      readonly kind: "group";
      /**
       * `scalar`: the value is not scalar. `list`: a list path without `[]`.
       * `each`: the path has more than one `[]`.
       */
      readonly problem: "scalar" | "list" | "each";
      readonly name: string;
      readonly at: Span;
    }
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
      /** Role `formula`: the names of the Formulas that the request defines. */
      readonly formulas?: readonly string[];
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
      /** Arithmetic or unary minus on operands of types it never takes. */
      readonly kind: "operand-type";
      readonly operator: string;
      /** The operands in order: one for unary minus, two for a binary operator. */
      readonly operands: readonly Receiver[];
      readonly at: Span;
    }
  /**
   * Formulas that read each other: `chain` starts and ends with the same name,
   * and `at` is the reference that closes the cycle.
   */
  | {
      readonly kind: "formula-cycle";
      readonly chain: readonly string[];
      readonly at: Span;
    }
  | FaultedFormulaRead
  /** A Formula name that is not an identifier. */
  | { readonly kind: "formula-name"; readonly name: string }
  | {
      /** A Formula whose value is of a type that a Query Row cannot hold. */
      readonly kind: "formula-result";
      readonly name: string;
      readonly found: StaticType;
      readonly at: Span;
    }
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
/**
 * A `formula.<name>` at `at` that reads a Formula with a mistake. The Fault is
 * in that Formula, so the reader gives this Fault in place of a Fault of its
 * own text. `root` is the Fault in the definition of the first Formula, along
 * the reads, that has one of its own.
 */
export interface FaultedFormulaRead {
  readonly kind: "reads-faulted-formula";
  /** The Formula with the mistake. */
  readonly name: string;
  readonly at: Span;
  readonly root: FormulaError;
}
export type PlainFault = Extract<Fault, { kind: "plain" }>;
export type ItemQueryFault = Exclude<Fault, { kind: "constant" }>;
