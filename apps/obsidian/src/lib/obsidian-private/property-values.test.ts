import type { App, MetadataCache as MetadataCacheApi } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";

import { propertyValues, vaultTags } from "./property-values";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({
  getLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn }),
}));

beforeEach(() => warn.mockClear());

describe("propertyValues", () => {
  it("reads the values the vault holds for a property", () => {
    const getFrontmatterPropertyValuesForKey = vi.fn(() => ["read", "reading"]);
    const app = stubService<App>("App", {
      metadataCache: stubService<MetadataCacheApi>("MetadataCache", {
        getFrontmatterPropertyValuesForKey,
      }),
    });

    expect(propertyValues(app, "status")).toEqual(["read", "reading"]);
    expect(getFrontmatterPropertyValuesForKey).toHaveBeenCalledWith("status");
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads no values, and warns once, when the cache has no read of them", () => {
    const app = stubService<App>("App", {
      metadataCache: stubService<MetadataCacheApi>("MetadataCache", {
        getFrontmatterPropertyValuesForKey: undefined,
      }),
    });

    expect(propertyValues(app, "status")).toEqual([]);
    expect(propertyValues(app, "rating")).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("keeps only the text values a broken read returns", () => {
    const app = stubService<App>("App", {
      metadataCache: stubService<MetadataCacheApi>("MetadataCache", {
        getFrontmatterPropertyValuesForKey: () => ["read", 3, null] as never,
      }),
    });

    expect(propertyValues(app, "status")).toEqual(["read"]);
  });
});

describe("vaultTags", () => {
  it("reads the vault's tags without their #", () => {
    const app = stubService<App>("App", {
      metadataCache: stubService<MetadataCacheApi>("MetadataCache", {
        getTags: () => ({ "#hci": 2, "#reading/done": 1 }),
      }),
    });

    expect(vaultTags(app)).toEqual(["hci", "reading/done"]);
  });

  it("reads no tags when the cache has no read of them", () => {
    const app = stubService<App>("App", {
      metadataCache: stubService<MetadataCacheApi>("MetadataCache", {
        getTags: undefined,
      }),
    });

    expect(vaultTags(app)).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
