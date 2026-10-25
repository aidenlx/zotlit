// The file manager as a capability tag: the link, rename and Properties calls
// ZotLit makes, without the Obsidian `App`. It copies the MetadataCache tag's
// shape (policies/events.md, Capability tags); the file manager has no events.
import type { FileManager as ObsidianFileManager, TFile } from "obsidian";

import { Context, Effect, Layer } from "@/lib/effect";
import { ObsidianApp } from "@/lib/obsidian-app";
import { vaultError } from "@/lib/vault-errors";
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
  /** Move `file` to `newPath`; Obsidian updates the links to it. */
  renameFile(file: TFile, newPath: string): Effect.Effect<void, VaultError>;
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
 * The file manager service over `source`. It reads a member of `source` only
 * when a call runs, so a test host without a file manager still builds it.
 */
export const makeFileManager = (source: FileManagerSource) =>
  FileManager.of({
    processFrontMatter: (file, fn) =>
      Effect.tryPromise({
        try: () => source.processFrontMatter(file, fn),
        catch: vaultError("processFrontMatter", file.path),
      }),
    renameFile: (file, newPath) =>
      Effect.tryPromise({
        // Obsidian moves `file.path` on success; name the path it had.
        try: () => source.renameFile(file, newPath),
        catch: vaultError("renameFile", file.path),
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

/** The tag over any object of the file manager's shape, such as a test host's. */
export const layerFileManagerFrom = (
  source: FileManagerSource,
): Layer.Layer<FileManager> =>
  Layer.sync(FileManager, () => makeFileManager(source));

/** The tag over the vault's file manager. */
export const layerFileManager: Layer.Layer<FileManager, never, ObsidianApp> =
  Layer.effect(
    FileManager,
    Effect.gen(function* () {
      const app = yield* ObsidianApp;
      return makeFileManager(app.fileManager);
    }),
  );
