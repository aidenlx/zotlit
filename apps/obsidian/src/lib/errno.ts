import { Effect, PlatformError, Schema } from "effect";

/** Returns whether {@link error} carries the given Node.js errno {@link code}. */
export function isErrno(error: unknown, code: string): boolean {
  return (
    Error.isError(error) &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

/**
 * A Node.js system call (`node:fs`, `process.kill`) threw or rejected.
 * `message` and `code` are the original's, so {@link isErrno} and a caller
 * that reads the message see what they saw on the original; `cause` holds it.
 */
export class SystemCallError extends Schema.TaggedError<
  SystemCallError,
  { readonly brand: unique symbol }
>()("SystemCallError", {
  message: Schema.String,
  /** The errno code, such as `ENOENT`, when the original carries one. */
  code: Schema.optional(Schema.String),
  cause: Schema.Defect(),
}) {}

/** Wraps what a Node.js system call threw, as the `catch` of `Effect.try`. */
export function systemCallError(cause: unknown): SystemCallError {
  const code =
    Error.isError(cause) &&
    "code" in cause &&
    typeof (cause as NodeJS.ErrnoException).code === "string"
      ? (cause as NodeJS.ErrnoException).code
      : undefined;
  return new SystemCallError({
    message: Error.isError(cause) ? cause.message : String(cause),
    ...(code === undefined ? {} : { code }),
    cause,
  });
}

/**
 * The `PlatformError` reason `FileSystem` gives a Node.js errno, as
 * `@effect/platform-node-shared` maps it.
 */
function errnoReason(cause: unknown): PlatformError.SystemErrorTag {
  if (isErrno(cause, "ENOENT")) return "NotFound";
  if (isErrno(cause, "EACCES")) return "PermissionDenied";
  if (isErrno(cause, "EEXIST")) return "AlreadyExists";
  if (
    isErrno(cause, "EISDIR") ||
    isErrno(cause, "ENOTDIR") ||
    isErrno(cause, "ELOOP")
  )
    return "BadResource";
  if (isErrno(cause, "EBUSY")) return "Busy";
  return "Unknown";
}

/**
 * A `node:fs` call that `FileSystem` has no form for, failing with the
 * `PlatformError` `FileSystem` would give: the errno's reason, with the
 * original in `cause`.
 */
export const nodeFileSystemCall = <A>(
  method: string,
  path: string,
  evaluate: () => Promise<A>,
): Effect.Effect<A, PlatformError.PlatformError> =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) =>
      PlatformError.systemError({
        _tag: errnoReason(cause),
        module: "FileSystem",
        method,
        syscall: Error.isError(cause)
          ? (cause as NodeJS.ErrnoException).syscall
          : undefined,
        pathOrDescriptor: path,
        cause,
      }),
  });
