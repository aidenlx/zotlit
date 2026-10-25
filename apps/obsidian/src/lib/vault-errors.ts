// Predicates for Obsidian vault errors that carry no error code, only a message,
// and the typed VaultError that Effect code fails with.
import { Schema } from "@/lib/effect";

/**
 * Whether `error` is Obsidian's `vault.create` rejection for an already-taken
 * path. The message is the only signal — the rejection carries no error code,
 * and the vault path cache can lag the colliding file, so it is unreliable.
 */
export function isFileExistsError(error: unknown): boolean {
  return Error.isError(error) && error.message === "File already exists.";
}

/**
 * A vault or file manager call rejected. `message` is Obsidian's own, so a
 * caller shows and matches the same text as before; `cause` holds what
 * Obsidian threw.
 */
export class VaultError extends Schema.TaggedError<VaultError>()("VaultError", {
  /** The Obsidian method that rejected, such as `renameFile`. */
  operation: Schema.String,
  /** The vault path the call acted on. */
  path: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** A `VaultError` for `operation` on `path`, from what Obsidian threw. */
export const vaultError =
  (operation: string, path: string) =>
  (cause: unknown): VaultError =>
    new VaultError({
      operation,
      path,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
