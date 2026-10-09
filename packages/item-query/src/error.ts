import { Data } from "effect";

import { diagnose } from "./diagnose";
import type { Fault, PlainFault, Span } from "./fault";

/** Stable codes of an invalid Item Query request. */
export type ItemQueryErrorCode =
  | "duplicate-library"
  | "invalid-path"
  | "unknown-field"
  | "unknown-path"
  | "unsortable-field"
  | "invalid-limit"
  | "invalid-filter"
  | "unfilterable-field"
  | "unknown-function"
  | "unknown-property"
  | "wrong-argument-count"
  | "wrong-argument-type";

/** The part of the request an {@link ItemQueryError} points at. */
export interface ItemQueryErrorLocation {
  readonly argument: "libraries" | "filter" | "fields" | "sort" | "limit";
  /** The position of the entry in a list argument. */
  readonly index?: number;
  /** The part of the filter text, in UTF-16 offsets; `to` is exclusive. */
  readonly span?: Span;
}

/**
 * The request is not a valid Item Query. The query fails as a whole, before it
 * reads the database.
 */
export class ItemQueryError extends Data.TaggedError("ItemQueryError")<{
  readonly fault: PlainFault | Extract<Fault, { kind: "syntax" }>;
  readonly location: ItemQueryErrorLocation;
}> {
  get code(): ItemQueryErrorCode {
    return diagnose(this.fault, "", this.location).code;
  }
  override get message(): string {
    return diagnose(this.fault, "", this.location).message;
  }
  get hint(): string {
    return diagnose(this.fault, "", this.location).hint;
  }
}
