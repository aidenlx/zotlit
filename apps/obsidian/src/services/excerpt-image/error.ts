import { Data, Schema } from "effect";

/** A PDF crop or fallback image cannot be used. */
export class ExcerptImageError extends Data.TaggedError("ExcerptImageError")<{
  readonly message: string;
}> {}

/** Writing the device-local Excerpt cache failed. */
export class ExcerptCacheWriteError extends Schema.TaggedError<
  ExcerptCacheWriteError,
  { readonly brand: unique symbol }
>()("ExcerptCacheWriteError", { cause: Schema.Defect() }) {}
