// An in-memory file manager for tests. The test drives it; the tag's own layer
// runs over it (`layerFileManagerFrom`, or `layerHostApp` from
// ./obsidian-host-app). It copies the shape of ./obsidian-metadata-cache.
import type { TAbstractFile, TFile } from "obsidian";

import type { FileManagerSource } from "@/lib/obsidian-file-manager";

/**
 * The Properties of a test vault's notes, by path, and the renames the code
 * under test made. A module under test that still reads `app.fileManager`
 * takes this object, so it sees the same state as the tag.
 */
export class MemoryFileManager implements FileManagerSource {
  /** Each note's frontmatter, by path. */
  readonly frontmatter = new Map<string, Record<string, unknown>>();
  /** Every rename, in call order. */
  readonly renames: { from: string; to: string }[] = [];
  /** The next `processFrontMatter`, `renameFile` or `trashFile` rejects with this. */
  failNext: unknown = undefined;

  #reject(): Promise<never> | undefined {
    if (this.failNext === undefined) return;
    const cause = this.failNext;
    this.failNext = undefined;
    return Promise.reject(cause);
  }

  async processFrontMatter(
    file: TFile,
    fn: (frontmatter: Record<string, unknown>) => void,
  ): Promise<void> {
    await this.#reject();
    const frontmatter = structuredClone(this.frontmatter.get(file.path) ?? {});
    fn(frontmatter);
    this.frontmatter.set(file.path, frontmatter);
  }

  /** As Obsidian: moves the entry and `file.path` to `newPath`. */
  async renameFile(file: TFile, newPath: string): Promise<void> {
    await this.#reject();
    const from = file.path;
    const frontmatter = this.frontmatter.get(from);
    if (frontmatter) {
      this.frontmatter.delete(from);
      this.frontmatter.set(newPath, frontmatter);
    }
    file.path = newPath;
    this.renames.push({ from, to: newPath });
  }

  /**
   * A wikilink to the full path, with `subpath` and `alias` when given. The
   * arguments keep Obsidian's own shape; the source path is unused.
   */
  generateMarkdownLink(
    ...[file, , subpath = "", alias]: [TFile, string, string?, string?]
  ): string {
    return `[[${file.path}${subpath}${alias ? `|${alias}` : ""}]]`;
  }

  /** The attachment's name at the vault root, as Obsidian's default setting. */
  async getAvailablePathForAttachment(filename: string): Promise<string> {
    return filename;
  }

  /** Every file moved to the trash, in call order. */
  readonly trashed: TAbstractFile[] = [];

  async trashFile(file: TAbstractFile): Promise<void> {
    await this.#reject();
    this.trashed.push(file);
  }
}
