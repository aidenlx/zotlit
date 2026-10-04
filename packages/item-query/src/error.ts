import { Data } from "effect";

/** Stable codes of an invalid Item Query request. */
export type ItemQueryErrorCode =
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
  readonly argument: "filter" | "fields" | "sort" | "limit";
  /** The position of the entry in a list argument. */
  readonly index?: number;
  /** The part of the filter text, in UTF-16 offsets; `to` is exclusive. */
  readonly span?: { readonly from: number; readonly to: number };
}

/**
 * The request is not a valid Item Query. The query fails as a whole, before it
 * reads the database.
 */
export class ItemQueryError extends Data.TaggedError("ItemQueryError")<{
  readonly code: ItemQueryErrorCode;
  readonly location: ItemQueryErrorLocation;
  readonly message: string;
  /** How the caller can repair the request. */
  readonly hint: string;
}> {}
