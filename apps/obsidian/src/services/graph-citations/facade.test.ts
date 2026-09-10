import type { App, MetadataCache } from "obsidian";
import { describe, expect, it } from "vitest";

import type { GraphCitationAdditions } from "./adapter";
import { facadeApp, mergeLinkMaps, renderWithFacade } from "./facade";
import type { FacadeEngine } from "./facade";

function additionsOf(
  overrides: Partial<GraphCitationAdditions>,
): GraphCitationAdditions {
  return {
    resolvedLinks: {},
    unresolvedLinks: {},
    citedWorkNodes: new Map(),
    ...overrides,
  };
}

/** A metadata cache whose one method reads its own state through `this`. */
function cacheWith(links: {
  resolved: MetadataCache["resolvedLinks"];
  unresolved: MetadataCache["unresolvedLinks"];
}): MetadataCache {
  return {
    resolvedLinks: links.resolved,
    unresolvedLinks: links.unresolved,
    files: ["Draft.md", "Other.md"],
    getCachedFiles(this: { files: string[] }) {
      return this.files;
    },
  } as unknown as MetadataCache;
}

describe("facadeApp", () => {
  it("augments both link maps and forwards every other read to the real cache", () => {
    const cache = cacheWith({
      resolved: { "Draft.md": { "Other.md": 1 } },
      unresolved: { "Draft.md": { missing: 1 } },
    });
    const app = {
      metadataCache: cache,
      vault: { name: "v" },
    } as unknown as App;

    const facade = facadeApp(
      app,
      additionsOf({
        resolvedLinks: { "Draft.md": { "Literature/Doe 2024.md": 1 } },
        unresolvedLinks: { "Other.md": { "@typo2024": 1 } },
      }),
    );

    expect(facade.metadataCache.resolvedLinks).toEqual({
      "Draft.md": { "Other.md": 1, "Literature/Doe 2024.md": 1 },
    });
    expect(facade.metadataCache.unresolvedLinks).toEqual({
      "Draft.md": { missing: 1 },
      "Other.md": { "@typo2024": 1 },
    });
    expect(
      (
        facade.metadataCache as unknown as { getCachedFiles(): string[] }
      ).getCachedFiles(),
    ).toEqual(["Draft.md", "Other.md"]);
    expect(facade.vault).toBe(app.vault);
    expect(cache.resolvedLinks).toEqual({ "Draft.md": { "Other.md": 1 } });
  });
});

describe("renderWithFacade", () => {
  it("shows the facade to render alone and restores the real app after", () => {
    const app = {
      metadataCache: cacheWith({ resolved: {}, unresolved: {} }),
    } as unknown as App;
    const seen: MetadataCache["unresolvedLinks"][] = [];
    const render = function (this: FacadeEngine) {
      seen.push(this.app.metadataCache.unresolvedLinks);
      return 7;
    };
    const engine = { app, render };

    const result = renderWithFacade(
      engine,
      render,
      additionsOf({ unresolvedLinks: { "Draft.md": { "@typo2024": 1 } } }),
    );

    expect(result).toBe(7);
    expect(seen).toEqual([{ "Draft.md": { "@typo2024": 1 } }]);
    expect(engine.app).toBe(app);
  });

  it("restores the real app when render throws", () => {
    const app = {
      metadataCache: cacheWith({ resolved: {}, unresolved: {} }),
    } as unknown as App;
    const render = () => {
      throw new Error("boom");
    };
    const engine = { app, render };

    expect(() => renderWithFacade(engine, render, additionsOf({}))).toThrow(
      "boom",
    );
    expect(engine.app).toBe(app);
  });
});

describe("mergeLinkMaps", () => {
  it("returns the base itself when there is nothing to add", () => {
    const base = { "Draft.md": { "Other.md": 1 } };
    expect(mergeLinkMaps(base, {})).toBe(base);
  });

  it("merges per source without touching either input", () => {
    const base = { "Draft.md": { "Other.md": 1 } };
    const additions = {
      "Draft.md": { "Doe.md": 1 },
      "New.md": { "Doe.md": 1 },
    };

    expect(mergeLinkMaps(base, additions)).toEqual({
      "Draft.md": { "Other.md": 1, "Doe.md": 1 },
      "New.md": { "Doe.md": 1 },
    });
    expect(base).toEqual({ "Draft.md": { "Other.md": 1 } });
    expect(additions).toEqual({
      "Draft.md": { "Doe.md": 1 },
      "New.md": { "Doe.md": 1 },
    });
  });
});
