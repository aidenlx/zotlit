import type { App, EmbedRegistry } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";

import { registerEmbed } from "./embed-registry";
import type { EmbedCreator } from "./embed-registry";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({
  getLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn }),
}));

beforeEach(() => warn.mockClear());

/** A registry as Obsidian 1.14.4 keeps it. */
function registry() {
  const byExtension: Record<string, EmbedCreator> = {};
  return {
    byExtension,
    registerExtension: vi.fn((ext: string, creator: EmbedCreator) => {
      if (ext in byExtension) throw new Error(`already registered: ${ext}`);
      byExtension[ext] = creator;
    }),
    unregisterExtension: vi.fn((ext: string) => {
      delete byExtension[ext];
    }),
    isExtensionRegistered: (ext: string) => ext in byExtension,
  };
}

const creator: EmbedCreator = () => null;

describe("registerEmbed", () => {
  it("registers the creator for the extension, and the returned callback removes it", () => {
    const embeds = registry();
    const unregister = registerEmbed(
      stubService<App>("App", { embedRegistry: embeds }),
      "zotquery",
      creator,
    );
    expect(embeds.byExtension.zotquery).toBe(creator);
    unregister?.();
    expect(embeds.byExtension).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it("registers nothing and warns once when the app has no embed registry", () => {
    expect(
      registerEmbed(
        stubService<App>("App", { embedRegistry: undefined }),
        "zotquery",
        creator,
      ),
    ).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("registers nothing and warns once when the registry lost a method", () => {
    const embeds = registry();
    const app = stubService<App>("App", {
      embedRegistry: {
        registerExtension: (
          ...args: Parameters<EmbedRegistry["registerExtension"]>
        ) => embeds.registerExtension(...args),
        isExtensionRegistered: (extension) =>
          embeds.isExtensionRegistered(extension),
      },
    });
    expect(registerEmbed(app, "zotquery", creator)).toBeNull();
    expect(embeds.registerExtension).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("replaces a creator a previous load left behind, without a throw", () => {
    const embeds = registry();
    const app = stubService<App>("App", { embedRegistry: embeds });
    registerEmbed(app, "zotquery", () => null);
    const unregister = registerEmbed(app, "zotquery", creator);
    expect(embeds.byExtension.zotquery).toBe(creator);
    unregister?.();
    expect(embeds.byExtension).toEqual({});
  });
});
