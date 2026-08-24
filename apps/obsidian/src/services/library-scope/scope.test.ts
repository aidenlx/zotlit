import * as v from "valibot";
import { describe, expect, it } from "vitest";

import type { Library } from "@zotlit/db";

import {
  DEFAULT_LIBRARY_SCOPE,
  libraryScopeSchema,
  resolveLibraryScope,
  sameResolution,
} from "./scope";
import type { LibraryScope, ResolvedLibraryScope } from "./scope";

/**
 * Local library ids deliberately run against group-id order: group 200 sits at
 * libraryID 3 and group 100 at libraryID 7, so a canonical-order assertion
 * cannot pass by accident on database row order.
 */
const MY_LIBRARY: Library = {
  libraryID: 1,
  type: "user",
  groupID: null,
  name: null,
};
const GROUP_200: Library = {
  libraryID: 3,
  type: "group",
  groupID: 200,
  name: "Shared B",
};
const GROUP_100: Library = {
  libraryID: 7,
  type: "group",
  groupID: 100,
  name: "Shared A",
};
const ALL_LIBRARIES = [GROUP_200, MY_LIBRARY, GROUP_100];

function parse(value: unknown): LibraryScope | null {
  const result = v.safeParse(libraryScopeSchema, value);
  return result.success ? result.output : null;
}

describe("library scope validity", () => {
  it("defaults a fresh installation to every library", () => {
    expect(parse(DEFAULT_LIBRARY_SCOPE)).toEqual({ mode: "all" });
  });

  it("accepts a canonically ordered selection", () => {
    expect(
      parse({
        mode: "selected",
        libraries: [
          { type: "personal" },
          { type: "group", groupID: 100 },
          { type: "group", groupID: 200 },
        ],
      }),
    ).not.toBeNull();
  });

  it.each([
    ["an empty selection", { mode: "selected", libraries: [] }],
    [
      "a duplicate selector",
      {
        mode: "selected",
        libraries: [
          { type: "group", groupID: 100 },
          { type: "group", groupID: 100 },
        ],
      },
    ],
    [
      "groups before my library",
      {
        mode: "selected",
        libraries: [{ type: "group", groupID: 100 }, { type: "personal" }],
      },
    ],
    [
      "descending group ids",
      {
        mode: "selected",
        libraries: [
          { type: "group", groupID: 200 },
          { type: "group", groupID: 100 },
        ],
      },
    ],
    [
      "a non-positive group id",
      { mode: "selected", libraries: [{ type: "group", groupID: 0 }] },
    ],
    [
      "a fractional group id",
      { mode: "selected", libraries: [{ type: "group", groupID: 1.5 }] },
    ],
    ["an unknown mode", { mode: "some", libraries: [] }],
    ["a bare string", "all"],
  ])("rejects %s", (_label, value) => {
    expect(parse(value)).toBeNull();
  });
});

describe("resolveLibraryScope", () => {
  it("puts every library of the database in canonical order under all", () => {
    const resolved = resolveLibraryScope(ALL_LIBRARIES, { mode: "all" });

    expect(resolved).toEqual({
      mode: "all",
      invalid: false,
      unavailable: [],
      available: [
        { selector: { type: "personal" }, libraryID: 1, name: null },
        {
          selector: { type: "group", groupID: 100 },
          libraryID: 7,
          name: "Shared A",
        },
        {
          selector: { type: "group", groupID: 200 },
          libraryID: 3,
          name: "Shared B",
        },
      ],
    });
  });

  it("adds a new group to all libraries but not to a selection", () => {
    const before = [MY_LIBRARY, GROUP_100];
    const selected: LibraryScope = {
      mode: "selected",
      libraries: [{ type: "personal" }, { type: "group", groupID: 100 }],
    };

    expect(resolveLibraryScope(before, { mode: "all" }).available).toHaveLength(
      2,
    );
    expect(
      resolveLibraryScope([...before, GROUP_200], { mode: "all" }).available,
    ).toHaveLength(3);
    expect(
      resolveLibraryScope([...before, GROUP_200], selected).available.map(
        (library) => library.libraryID,
      ),
    ).toEqual([1, 7]);
  });

  it("keeps a missing group selected and identified by its group id", () => {
    const resolved = resolveLibraryScope([MY_LIBRARY], {
      mode: "selected",
      libraries: [{ type: "personal" }, { type: "group", groupID: 100 }],
    });

    expect(resolved.available).toEqual([
      { selector: { type: "personal" }, libraryID: 1, name: null },
    ]);
    expect(resolved.unavailable).toEqual([{ type: "group", groupID: 100 }]);
  });

  it("gives a returning group its current name and local library id", () => {
    const scope: LibraryScope = {
      mode: "selected",
      libraries: [{ type: "group", groupID: 100 }],
    };
    const moved: Library = { ...GROUP_100, libraryID: 9, name: "Renamed" };

    expect(resolveLibraryScope([MY_LIBRARY, moved], scope).available).toEqual([
      {
        selector: { type: "group", groupID: 100 },
        libraryID: 9,
        name: "Renamed",
      },
    ]);
  });

  it("falls back to my library and reports a broken saved value", () => {
    const resolved = resolveLibraryScope(ALL_LIBRARIES, null);

    expect(resolved).toEqual({
      mode: "selected",
      invalid: true,
      unavailable: [],
      available: [{ selector: { type: "personal" }, libraryID: 1, name: null }],
    });
  });

  it("reports no available library when the database holds none", () => {
    expect(resolveLibraryScope([], { mode: "all" })).toEqual({
      mode: "all",
      invalid: false,
      available: [],
      unavailable: [],
    });
  });
});

describe("sameResolution", () => {
  const base = (): ResolvedLibraryScope =>
    resolveLibraryScope(ALL_LIBRARIES, { mode: "all" });

  it("treats an equivalent database refresh as no change", () => {
    expect(sameResolution(base(), base())).toBe(true);
  });

  it("treats a group rename as a change", () => {
    const renamed = resolveLibraryScope(
      [MY_LIBRARY, GROUP_200, { ...GROUP_100, name: "Shared A (2026)" }],
      { mode: "all" },
    );

    expect(sameResolution(base(), renamed)).toBe(false);
  });

  it("treats a moved local library id as a change", () => {
    const moved = resolveLibraryScope(
      [MY_LIBRARY, GROUP_200, { ...GROUP_100, libraryID: 11 }],
      { mode: "all" },
    );

    expect(sameResolution(base(), moved)).toBe(false);
  });

  it("treats invalid state as a change", () => {
    expect(
      sameResolution(
        resolveLibraryScope([MY_LIBRARY], {
          mode: "selected",
          libraries: [{ type: "personal" }],
        }),
        resolveLibraryScope([MY_LIBRARY], null),
      ),
    ).toBe(false);
  });

  it("treats an unavailable selector as a change", () => {
    const scope: LibraryScope = {
      mode: "selected",
      libraries: [{ type: "personal" }, { type: "group", groupID: 100 }],
    };

    expect(
      sameResolution(
        resolveLibraryScope([MY_LIBRARY, GROUP_100], scope),
        resolveLibraryScope([MY_LIBRARY], scope),
      ),
    ).toBe(false);
  });
});
