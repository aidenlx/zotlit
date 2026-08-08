import { posix } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  pandocCliFilter,
  pandocDefaults,
  PANDOC_DEFAULTS_FILENAME,
  PANDOC_FILTER_FILENAME,
} from "./filter";
import { pandocIntegrationFiles } from "./integration";
import { savePandocIntegrationFiles } from "./integration-save";
import type { IntegrationFileSystem } from "./integration-save";

const FOLDER = "/project/pandoc";
const FILTER_PATH = posix.join(FOLDER, PANDOC_FILTER_FILENAME);
const DEFAULTS_PATH = posix.join(FOLDER, PANDOC_DEFAULTS_FILENAME);

class MemoryFileSystem implements IntegrationFileSystem {
  readonly files = new Map<string, string>();
  failRenameTo: string | null = null;
  readonly rename = vi.fn(async (from: string, to: string) => {
    if (to === this.failRenameTo) {
      this.failRenameTo = null;
      throw new Error(`Cannot replace ${to}`);
    }
    const value = this.files.get(from);
    if (value === undefined) throw errno("ENOENT", from);
    this.files.delete(from);
    this.files.set(to, value);
  });
  readonly writeFile = vi.fn(async (path: string, value: string) => {
    if (this.files.has(path)) throw errno("EEXIST", path);
    this.files.set(path, value);
  });
  readonly unlink = vi.fn(async (path: string) => {
    if (!this.files.delete(path)) throw errno("ENOENT", path);
  });

  async readFile(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw errno("ENOENT", path);
    return value;
  }

  async mkdtemp(): Promise<string> {
    return posix.join(FOLDER, ".zotlit-pandoc-test");
  }

  async rm(path: string): Promise<void> {
    for (const file of this.files.keys()) {
      if (file.startsWith(`${path}/`)) this.files.delete(file);
    }
  }
}

function errno(code: string, path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

function save(
  fileSystem: MemoryFileSystem,
  confirmReplacement = vi.fn(async () => true),
) {
  return savePandocIntegrationFiles({
    folder: FOLDER,
    files: pandocIntegrationFiles(),
    confirmReplacement,
    fileSystem,
  });
}

describe("savePandocIntegrationFiles", () => {
  it("cancels before writing when replacement is declined", async () => {
    const fileSystem = new MemoryFileSystem();
    fileSystem.files.set(FILTER_PATH, "old filter");
    const confirmReplacement = vi.fn(async () => false);

    await expect(save(fileSystem, confirmReplacement)).resolves.toEqual({
      kind: "cancelled",
    });
    expect(confirmReplacement).toHaveBeenCalledWith([PANDOC_FILTER_FILENAME]);
    expect(fileSystem.files.get(FILTER_PATH)).toBe("old filter");
    expect(fileSystem.writeFile).not.toHaveBeenCalled();
  });

  it("saves the exact pair without confirmation when both targets are clear", async () => {
    const fileSystem = new MemoryFileSystem();
    const confirmReplacement = vi.fn(async () => true);

    await expect(save(fileSystem, confirmReplacement)).resolves.toEqual({
      kind: "saved",
      folder: FOLDER,
    });
    expect(confirmReplacement).not.toHaveBeenCalled();
    expect(fileSystem.files.get(FILTER_PATH)).toBe(pandocCliFilter);
    expect(fileSystem.files.get(DEFAULTS_PATH)).toBe(pandocDefaults);
  });

  it("confirms once and replaces both files when either target exists", async () => {
    const fileSystem = new MemoryFileSystem();
    fileSystem.files.set(DEFAULTS_PATH, "old defaults");
    const confirmReplacement = vi.fn(async () => true);

    await expect(save(fileSystem, confirmReplacement)).resolves.toMatchObject({
      kind: "saved",
    });
    expect(confirmReplacement).toHaveBeenCalledExactlyOnceWith([
      PANDOC_DEFAULTS_FILENAME,
    ]);
    expect(fileSystem.files.get(FILTER_PATH)).toBe(pandocCliFilter);
    expect(fileSystem.files.get(DEFAULTS_PATH)).toBe(pandocDefaults);
  });

  it("returns one failure result when replacement fails", async () => {
    const fileSystem = new MemoryFileSystem();
    fileSystem.files.set(FILTER_PATH, "old filter");
    fileSystem.files.set(DEFAULTS_PATH, "old defaults");
    fileSystem.failRenameTo = DEFAULTS_PATH;

    const result = await save(fileSystem);

    expect(result).toMatchObject({
      kind: "failed",
      restored: true,
      error: new Error(`Cannot replace ${DEFAULTS_PATH}`),
    });
  });

  it("restores the complete prior pair after a failed replacement", async () => {
    const fileSystem = new MemoryFileSystem();
    fileSystem.files.set(FILTER_PATH, "old filter");
    fileSystem.files.set(DEFAULTS_PATH, "old defaults");
    fileSystem.failRenameTo = DEFAULTS_PATH;

    await save(fileSystem);

    expect(fileSystem.files.get(FILTER_PATH)).toBe("old filter");
    expect(fileSystem.files.get(DEFAULTS_PATH)).toBe("old defaults");
  });
});
