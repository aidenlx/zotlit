import { Effect, PlatformError } from "effect";

/** Returns whether {@link error} carries the given Node.js errno {@link code}. */
export function isErrno(error: unknown, code: string): boolean {
  return (
    Error.isError(error) &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

/** Whether `error` is the `PlatformError` of a missing file. */
export function isNotFound(error: unknown): boolean {
  return (
    PlatformError.isPlatformError(error) && error.reason._tag === "NotFound"
  );
}

/**
 * Whether `error` is a `PlatformError` over the Node.js errno `code`. The
 * errnos read here have no reason of their own, so the code is in the cause.
 */
export function isPlatformErrno(error: unknown, code: string): boolean {
  return PlatformError.isPlatformError(error) && isErrno(error.cause, code);
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
