import { Data } from "effect";

/** A PDF crop or fallback image cannot be used. */
export class ExcerptImageError extends Data.TaggedError("ExcerptImageError")<{
  readonly message: string;
}> {}
