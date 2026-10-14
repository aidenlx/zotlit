import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      { embedRegistry: embeds } as unknown as App,
      "zotquery",
      creator,
    );
    expect(embeds.byExtension.zotquery).toBe(creator);
    unregister?.();
    expect(embeds.byExtension).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it("registers nothing and warns once when the app has no embed registry", () => {
    expect(registerEmbed({} as App, "zotquery", creator)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("registers nothing and warns once when the registry lost a method", () => {
    const { registerExtension, isExtensionRegistered } = registry();
    const app = {
      embedRegistry: { registerExtension, isExtensionRegistered },
    } as unknown as App;
    expect(registerEmbed(app, "zotquery", creator)).toBeNull();
    expect(registerExtension).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("replaces a creator a previous load left behind, without a throw", () => {
    const embeds = registry();
    const app = { embedRegistry: embeds } as unknown as App;
    registerEmbed(app, "zotquery", () => null);
    const unregister = registerEmbed(app, "zotquery", creator);
    expect(embeds.byExtension.zotquery).toBe(creator);
    unregister?.();
    expect(embeds.byExtension).toEqual({});
  });
});
