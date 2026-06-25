// Predicates for Obsidian vault errors that carry no error code, only a message.

/**
 * Whether `error` is Obsidian's `vault.create` rejection for an already-taken
 * path. The message is the only signal — the rejection carries no error code,
 * and the vault path cache can lag the colliding file, so it is unreliable.
 */
export function isFileExistsError(error: unknown): boolean {
  return Error.isError(error) && error.message === "File already exists.";
}
