// The typed failures of the Vault and FileManager capability tags. An expected
// outcome is its own tagged error, which the tag decides from the vault cache
// before it calls Obsidian; `VaultError` is every other rejection.
import { Schema } from "effect";

/**
 * The vault cache holds a file or folder at `path`, so the tag did not call
 * Obsidian. The lookup is case-sensitive: a name that differs only in case is
 * not in the cache, and a disk that folds case then fails the call as a
 * `VaultError`.
 */
export class FileExists extends Schema.TaggedError<FileExists>()("FileExists", {
  /** The vault path that is taken. */
  path: Schema.String,
}) {
  /** Obsidian's own text for this case, which a caller that shows it shows as before. */
  override get message(): string {
    return "File already exists.";
  }
}

/**
 * A vault or file manager call rejected. `message` is Obsidian's own, for logs and
 * notices; `cause` holds what Obsidian threw. Nothing classifies it.
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
