// The typed reason for a stop the user chose, apart from the unload interrupt.
import { Schema } from "effect";

import { AbortError } from "@/lib/abort-error";

/**
 * The user stopped the work: they closed the dialog it ran for. It is no
 * failure, so the progress helpers report nothing for it. A plugin unload is
 * an interrupt instead.
 */
export class UserCancelled extends Schema.TaggedError<
  UserCancelled,
  { readonly brand: unique symbol }
>()("UserCancelled", {}) {}

/** Whether `error` is a stop the user chose: an abort or {@link UserCancelled}. */
export function isUserStop(error: unknown): boolean {
  return AbortError.test(error) || error instanceof UserCancelled;
}
