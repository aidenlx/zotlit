import { describe, expect, it } from "vitest";

import {
  loadZoteroPathOverrides,
  saveZoteroPathOverrides,
} from "./device-paths";
import type { ZoteroPathOverrides } from "./device-paths";

const KEY = "zotlit-zotero-paths";

/** Map-backed stand-in for Obsidian's vault-scoped localStorage. */
class AppStub {
  readonly store = new Map<string, unknown>();

  loadLocalStorage(key: string): unknown {
    return this.store.get(key) ?? null;
  }

  saveLocalStorage(key: string, data: unknown): void {
    if (data === null) this.store.delete(key);
    else this.store.set(key, data);
  }
}

describe("device-paths", () => {
  it("returns nulls when nothing is stored", () => {
    expect(loadZoteroPathOverrides(new AppStub())).toEqual({
      profileDir: null,
      dataDir: null,
    });
  });

  it("round-trips a sparse record", () => {
    const app = new AppStub();
    saveZoteroPathOverrides(app, { profileDir: "/p", dataDir: null });
    expect(app.store.get(KEY)).toEqual({ profileDir: "/p" });
    expect(loadZoteroPathOverrides(app)).toEqual({
      profileDir: "/p",
      dataDir: null,
    });
  });

  it("stores both paths when both are set", () => {
    const app = new AppStub();
    saveZoteroPathOverrides(app, { profileDir: "/p", dataDir: "/d" });
    expect(app.store.get(KEY)).toEqual({ profileDir: "/p", dataDir: "/d" });
  });

  it("clears the entry when both are unset", () => {
    const app = new AppStub();
    app.store.set(KEY, { profileDir: "/p" });
    saveZoteroPathOverrides(app, { profileDir: null, dataDir: null });
    expect(app.store.has(KEY)).toBe(false);
  });

  it("ignores non-string and empty values", () => {
    const app = new AppStub();
    app.store.set(KEY, { profileDir: 42, dataDir: "" });
    expect(loadZoteroPathOverrides(app)).toEqual({
      profileDir: null,
      dataDir: null,
    });
  });

  it("ignores a non-object stored value", () => {
    const app = new AppStub();
    app.store.set(KEY, "garbage");
    const result: ZoteroPathOverrides = loadZoteroPathOverrides(app);
    expect(result).toEqual({ profileDir: null, dataDir: null });
  });
});
