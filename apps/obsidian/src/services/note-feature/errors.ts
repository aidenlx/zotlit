// The typed failures of the Note Feature writes, and the errors their plain callers see.
import { Schema } from "effect";

import { plainTemplateError } from "@/services/template/errors";

import { NotePathUnavailable } from "./note-path";

/** The Snapshot holds no Item with this Indexed Key. */
export class ItemNotFound extends Schema.TaggedError<
  ItemNotFound,
  { readonly brand: unique symbol }
>()("ItemNotFound", {
  indexedKey: Schema.String,
  message: Schema.String,
}) {}

/**
 * A note write stopped before it wrote: a render, the caller's own session
 * check, or the Properties parse threw. The note is left as it was; `cause`
 * holds what was thrown.
 */
export class NoteWriteAborted extends Schema.TaggedError<
  NoteWriteAborted,
  { readonly brand: unique symbol }
>()("NoteWriteAborted", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return Error.isError(this.cause) ? this.cause.message : String(this.cause);
  }
}

/**
 * A Profile switch failed, and so did putting the notes back. `cause` holds
 * the failure and each failed rollback.
 */
export class ProfileSwitchRollbackFailed extends Schema.TaggedError<
  ProfileSwitchRollbackFailed,
  { readonly brand: unique symbol }
>()("ProfileSwitchRollbackFailed", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * What a plain caller of a Note Feature write sees for `error`: what the
 * render, the rewrite or the filename threw, as the Promise operations
 * rejected with it, and any other failure as it is.
 */
export function plainNoteError(error: unknown): unknown {
  return error instanceof NoteWriteAborted ||
    error instanceof NotePathUnavailable
    ? error.cause
    : plainTemplateError(error);
}
