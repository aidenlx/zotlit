import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { propertyValues, vaultTags } from "./property-values";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({
  getLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn }),
}));

beforeEach(() => warn.mockClear());

describe("propertyValues", () => {
  it("reads the values the vault holds for a property", () => {
    const getFrontmatterPropertyValuesForKey = vi.fn(() => ["read", "reading"]);
    const app = {
      metadataCache: { getFrontmatterPropertyValuesForKey },
    } as unknown as App;

    expect(propertyValues(app, "status")).toEqual(["read", "reading"]);
    expect(getFrontmatterPropertyValuesForKey).toHaveBeenCalledWith("status");
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads no values, and warns once, when the cache has no read of them", () => {
    const app = { metadataCache: {} } as unknown as App;

    expect(propertyValues(app, "status")).toEqual([]);
    expect(propertyValues(app, "rating")).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("keeps only the text values a broken read returns", () => {
    const app = {
      metadataCache: {
        getFrontmatterPropertyValuesForKey: () => ["read", 3, null],
      },
    } as unknown as App;

    expect(propertyValues(app, "status")).toEqual(["read"]);
  });
});

describe("vaultTags", () => {
  it("reads the vault's tags without their #", () => {
    const app = {
      metadataCache: { getTags: () => ({ "#hci": 2, "#reading/done": 1 }) },
    } as unknown as App;

    expect(vaultTags(app)).toEqual(["hci", "reading/done"]);
  });

  it("reads no tags when the cache has no read of them", () => {
    const app = { metadataCache: {} } as unknown as App;

    expect(vaultTags(app)).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
