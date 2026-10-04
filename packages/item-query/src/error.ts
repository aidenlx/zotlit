import { Data } from "effect";

/** Stable codes of an invalid Item Query request. */
export type ItemQueryErrorCode =
  | "invalid-path"
  | "unknown-field"
  | "unknown-path"
  | "invalid-limit";

/** The part of the request an {@link ItemQueryError} points at. */
export interface ItemQueryErrorLocation {
  readonly argument: "fields" | "limit";
  /** The position of the entry in a list argument. */
  readonly index?: number;
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
