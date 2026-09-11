import type { App, MetadataCache } from "obsidian";
import { describe, expect, it } from "vitest";

import type { GraphCitationAdditions } from "./adapter";
import {
  facadeApp,
  mergeLinkMaps,
  onlyLinksTo,
  renderWithFacade,
  withoutLinks,
} from "./facade";
import type { FacadeEngine } from "./facade";

function additionsOf(
  overrides: Partial<GraphCitationAdditions>,
): GraphCitationAdditions {
  return {
    resolvedLinks: {},
    unresolvedLinks: {},
    citationLinks: {},
    citedWorkNodes: new Map(),
    citingSources: new Map(),
    literatureNotes: new Set(),
    hiddenLinks: {},
    survivingPaths: null,
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

describe("facadeApp under the Filters rows", () => {
  it("takes each note's Wikilink Citation edges away and draws the citekey edge in their place", () => {
    const cache = cacheWith({
      resolved: {
        "Draft.md": { "Literature/Doe 2024.md": 1, "Other.md": 1 },
        "Other.md": { "Literature/Doe 2024.md": 1 },
        // An aliased link no citation names, so the edge stays.
        "Alias.md": { "Literature/Doe 2024.md": 1 },
      },
      unresolved: {},
    });
    const app = { metadataCache: cache } as unknown as App;

    const facade = facadeApp(
      app,
      additionsOf({
        resolvedLinks: { "Draft.md": { "Literature/Doe 2024.md": 1 } },
        hiddenLinks: {
          "Draft.md": { "Literature/Doe 2024.md": 1 },
          "Other.md": { "Literature/Doe 2024.md": 1 },
        },
      }),
    );

    expect(facade.metadataCache.resolvedLinks).toEqual({
      "Draft.md": { "Other.md": 1, "Literature/Doe 2024.md": 1 },
      "Other.md": {},
      "Alias.md": { "Literature/Doe 2024.md": 1 },
    });
    expect(cache.resolvedLinks["Other.md"]).toEqual({
      "Literature/Doe 2024.md": 1,
    });
  });

  it("narrows the cached files to the surviving paths, so the render's own narrowing runs on them", () => {
    const cache = cacheWith({ resolved: {}, unresolved: {} });
    const app = { metadataCache: cache } as unknown as App;

    const facade = facadeApp(
      app,
      additionsOf({ survivingPaths: new Set(["Draft.md"]) }),
    );

    expect(
      (
        facade.metadataCache as unknown as { getCachedFiles(): string[] }
      ).getCachedFiles(),
    ).toEqual(["Draft.md"]);
  });

  it("leaves the file list whole while Citation-connected only is off", () => {
    const cache = cacheWith({ resolved: {}, unresolved: {} });
    const app = { metadataCache: cache } as unknown as App;

    const facade = facadeApp(app, additionsOf({}));

    expect(
      (
        facade.metadataCache as unknown as { getCachedFiles(): string[] }
      ).getCachedFiles(),
    ).toEqual(["Draft.md", "Other.md"]);
  });

  it("takes the narrowed-away targets out of both link maps, and leaves the citations", () => {
    const cache = cacheWith({
      resolved: { "Draft.md": { "Other.md": 1 } },
      unresolved: { "Draft.md": { todo: 1 } },
    });
    const app = { metadataCache: cache } as unknown as App;

    const facade = facadeApp(
      app,
      additionsOf({
        resolvedLinks: { "Draft.md": { "Literature/Doe 2024.md": 1 } },
        unresolvedLinks: { "Draft.md": { "@typo2024": 1 } },
        citedWorkNodes: new Map([["@typo2024", "typo2024"]]),
        survivingPaths: new Set(["Draft.md", "Literature/Doe 2024.md"]),
      }),
    );

    // Other and todo both draw a node of their own where the link stands, so
    // the row that took their nodes away takes the links with them.
    expect(facade.metadataCache.resolvedLinks).toEqual({
      "Draft.md": { "Literature/Doe 2024.md": 1 },
    });
    expect(facade.metadataCache.unresolvedLinks).toEqual({
      "Draft.md": { "@typo2024": 1 },
    });
  });

  it("leaves both link maps whole while Citation-connected only is off", () => {
    const cache = cacheWith({
      resolved: { "Draft.md": { "Other.md": 1 } },
      unresolved: { "Draft.md": { todo: 1 } },
    });
    const app = { metadataCache: cache } as unknown as App;

    const facade = facadeApp(app, additionsOf({}));

    expect(facade.metadataCache.resolvedLinks).toEqual({
      "Draft.md": { "Other.md": 1 },
    });
    expect(facade.metadataCache.unresolvedLinks).toEqual({
      "Draft.md": { todo: 1 },
    });
  });
});

describe("onlyLinksTo", () => {
  it("returns the base itself when every target is kept", () => {
    const base = { "Draft.md": { "Other.md": 1 } };
    expect(onlyLinksTo(base, () => true)).toBe(base);
  });

  it("drops the turned-down targets without touching the base", () => {
    const base = {
      "Draft.md": { "Other.md": 1, "Kept.md": 2 },
      "Alias.md": { "Other.md": 1 },
    };

    expect(onlyLinksTo(base, (target) => target === "Kept.md")).toEqual({
      "Draft.md": { "Kept.md": 2 },
      "Alias.md": {},
    });
    expect(base).toEqual({
      "Draft.md": { "Other.md": 1, "Kept.md": 2 },
      "Alias.md": { "Other.md": 1 },
    });
  });
});

describe("withoutLinks", () => {
  it("returns the base itself when there is nothing to take away", () => {
    const base = { "Draft.md": { "Other.md": 1 } };
    expect(withoutLinks(base, {})).toBe(base);
  });

  it("drops the named edges of the named sources without touching the base", () => {
    const base = {
      "Draft.md": { "Doe.md": 1, "Other.md": 1 },
      "Other.md": { "Doe.md": 1 },
      "Alias.md": { "Doe.md": 1 },
    };

    expect(
      withoutLinks(base, {
        "Draft.md": { "Doe.md": 1 },
        "Other.md": { "Doe.md": 1 },
      }),
    ).toEqual({
      "Draft.md": { "Other.md": 1 },
      "Other.md": {},
      "Alias.md": { "Doe.md": 1 },
    });
    expect(base["Draft.md"]).toEqual({ "Doe.md": 1, "Other.md": 1 });
  });

  it("keeps the edge while an ordinary link to the same target remains", () => {
    const base = { "Draft.md": { "Doe.md": 3 } };

    expect(withoutLinks(base, { "Draft.md": { "Doe.md": 2 } })).toEqual({
      "Draft.md": { "Doe.md": 1 },
    });
  });

  it("leaves a source the vault holds no links for", () => {
    const base = { "Draft.md": { "Doe.md": 1 } };

    expect(withoutLinks(base, { "Gone.md": { "Doe.md": 1 } })).toEqual(base);
  });
});
