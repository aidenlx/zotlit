/** Returns whether {@link error} carries the given Node.js errno {@link code}. */
export function isErrno(error: unknown, code: string): boolean {
  return (
    Error.isError(error) &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
