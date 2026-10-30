import { TFile } from "obsidian";
import type { App, Command, MetadataCache, Vault, Workspace } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";

import { addIndexedKeyActions, indexedKeyForClipboard } from "./actions";

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

describe("indexedKeyForClipboard", () => {
  it("formats the selected object's own identity", () => {
    expect(indexedKeyForClipboard({ key: "ABCD2345", groupID: null })).toBe(
      "ABCD2345",
    );
    expect(indexedKeyForClipboard({ key: "ABCD2345", groupID: 42 })).toBe(
      "ABCD2345g42",
    );
  });
});

describe("copy item key command", () => {
  it("copies the active Literature Note's key", () => {
    const file = new TFile();
    let command: Command | undefined;
    const app = stubService<App>("App", {
      workspace: stubService<Workspace>("Workspace", {
        getActiveFile: () => file,
      }),
      metadataCache: stubService<MetadataCache>("MetadataCache", {
        getFileCache: () => ({
          frontmatter: { "zotero-key": "ABCD2345g42" },
        }),
      }),
    });
    addIndexedKeyActions({
      app,
      addCommand(value) {
        command = value;
        return value;
      },
    });

    const registered = command;
    if (!registered) throw new Error("Command was not registered");
    expect(registered.checkCallback?.(true)).toBe(true);
    expect(registered.checkCallback?.(false)).toBe(true);
    expect(writeText).toHaveBeenCalledWith("ABCD2345g42");
  });

  it("is unavailable without an active file", () => {
    let command: Command | undefined;
    addIndexedKeyActions({
      app: stubService<App>("App", {
        workspace: stubService<Workspace>("Workspace", {
          getActiveFile: () => null,
        }),
        vault: stubService<Vault>("Vault", {}),
      }),
      addCommand(value) {
        command = value;
        return value;
      },
    });

    const registered = command;
    if (!registered) throw new Error("Command was not registered");
    expect(registered.checkCallback?.(true)).toBe(false);
  });

  it("is unavailable when the active file carries no item key", () => {
    const file = new TFile();
    let command: Command | undefined;
    addIndexedKeyActions({
      app: stubService<App>("App", {
        workspace: stubService<Workspace>("Workspace", {
          getActiveFile: () => file,
        }),
        metadataCache: stubService<MetadataCache>("MetadataCache", {
          getFileCache: () => ({ frontmatter: {} }),
        }),
        vault: stubService<Vault>("Vault", {}),
      }),
      addCommand(value) {
        command = value;
        return value;
      },
    });

    const registered = command;
    if (!registered) throw new Error("Command was not registered");
    expect(registered.checkCallback?.(true)).toBe(false);
  });
});
