// The file manager as a capability tag: the link, rename and Properties calls
// ZotLit makes, without the Obsidian `App`. It copies the MetadataCache tag's
// shape (policies/events.md, Capability tags); the file manager has no events.
import { Context, Effect, Layer } from "effect";
import { normalizePath } from "obsidian";
import type { FileManager as ObsidianFileManager, TFile } from "obsidian";

import { ObsidianApp } from "@/lib/obsidian-app";
import { Vault } from "@/lib/obsidian-vault";
import { FileExists, vaultError } from "@/lib/vault-errors";
import type { VaultError } from "@/lib/vault-errors";

/** The Obsidian object the tag calls: what `app.fileManager` gives. */
export type FileManagerSource = Pick<
  ObsidianFileManager,
  "processFrontMatter" | "renameFile" | "generateMarkdownLink"
>;

export interface FileManagerShape {
  /**
   * Change the Properties of `file`: `fn` mutates the parsed frontmatter and
   * Obsidian writes it back. Fails when Obsidian rejects, `fn` throwing too.
   * Obsidian writes from the file on disk, so for a note the user may be
   * editing use `processLiveFrontMatter` (`lib/live-text.ts`), which goes
   * through the note's Live Text.
   */
  processFrontMatter(
    file: TFile,
    fn: (frontmatter: Record<string, unknown>) => void,
  ): Effect.Effect<void, VaultError>;
  /**
   * Move `file` to `newPath`; Obsidian updates the links to it. Fails with
   * `FileExists` when the vault cache holds another file or folder at
   * `newPath` (case-sensitive), without calling Obsidian. A move to the
   * file's own path, or one that changes only its case, is no collision.
   */
  renameFile(
    file: TFile,
    newPath: string,
  ): Effect.Effect<void, FileExists | VaultError>;
  /** The link to `file` from the note at `sourcePath`, in the user's link format. */
  generateMarkdownLink(
    file: TFile,
    sourcePath: string,
    options?: { readonly subpath?: string; readonly alias?: string },
  ): Effect.Effect<string>;
}

/** The vault's file manager. */
export class FileManager extends Context.Service<
  FileManager,
  FileManagerShape
>()("zotlit/obsidian/FileManager") {}

/**
 * The file manager service over `source`, deciding its outcomes from the
 * `Vault` tag's cache. It reads a member of `source` only when a call runs, so
 * a test host without a file manager still builds it.
 */
export const makeFileManager = Effect.fnUntraced(function* (
  source: FileManagerSource,
) {
  const vault = yield* Vault;
  return FileManager.of({
    processFrontMatter: (file, fn) =>
      Effect.tryPromise({
        try: () => source.processFrontMatter(file, fn),
        catch: vaultError("processFrontMatter", file.path),
      }),
    renameFile: Effect.fn("FileManager.renameFile")(function* (file, newPath) {
      // As Obsidian's `Vault.rename`: the normalized path, and no move when
      // it is the file's own.
      const path = normalizePath(newPath);
      const held = yield* vault.getAbstractFileByPath(path);
      if (held !== null && held !== file)
        return yield* new FileExists({ path });
      yield* Effect.tryPromise({
        // Obsidian moves `file.path` on success; name the path it had.
        try: () => source.renameFile(file, newPath),
        catch: vaultError("renameFile", file.path),
      });
    }),
    generateMarkdownLink: (file, sourcePath, options = {}) =>
      Effect.sync(() =>
        source.generateMarkdownLink(
          file,
          sourcePath,
          options.subpath,
          options.alias,
        ),
      ),
  });
});

/** The tag over any object of the file manager's shape, such as a test host's. */
export const layerFileManagerFrom = (
  source: FileManagerSource,
): Layer.Layer<FileManager, never, Vault> =>
  Layer.effect(FileManager, makeFileManager(source));

/** The tag over the vault's file manager. */
export const layerFileManager: Layer.Layer<
  FileManager,
  never,
  ObsidianApp | Vault
> = Layer.effect(
  FileManager,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    return yield* makeFileManager(app.fileManager);
  }),
);
