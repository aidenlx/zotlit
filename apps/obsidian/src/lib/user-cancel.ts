// The typed reason for a stop the user chose, apart from the unload interrupt.
import { Schema } from "effect";

/**
 * The user stopped the work: they closed the dialog it ran for. It is no
 * failure, so the progress helpers report nothing for it. A plugin unload is
 * an interrupt instead.
 */
export class UserCancelled extends Schema.TaggedError<
  UserCancelled,
  { readonly brand: unique symbol }
>()("UserCancelled", {}) {}
