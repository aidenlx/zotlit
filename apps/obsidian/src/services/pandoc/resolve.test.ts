import type { LinkCache } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { resolveCitations } from "./resolve";
import type { ResolvePorts, ResolveResponse, ResolvedItem } from "./resolve";

const FILE = "/vault/Notes/Paper.md";
const SOURCE = "Notes/Paper.md";

function link(target: string, line = 0): LinkCache {
  return {
    link: target,
    original: `[[${target}]]`,
    position: {
      start: { line, col: 0, offset: 0 },
      end: { line, col: target.length + 4, offset: 0 },
    },
  };
}

interface Fixture {
  links?: readonly LinkCache[];
  /** Linkpath → Indexed Key of the Literature Note it names. */
  notes?: Record<string, string>;
  /** Indexed Key → what the database holds for that Item. */
  items?: Record<string, ResolvedItem>;
  /** Deny the read lease, as a degraded database does. */
  databaseUnavailable?: boolean;
  missingFile?: boolean;
}

function cited(citationKey: string, title = "A paper"): ResolvedItem {
  return { citationKey, title };
}

function ports(
  fixture: Fixture,
): ResolvePorts & { read: ReturnType<typeof vi.fn> } {
  const read = vi.fn(async (indexedKeys: readonly string[]) => {
    if (fixture.databaseUnavailable) return null;
    const items = new Map<string, ResolvedItem>();
    for (const indexedKey of indexedKeys) {
      const item = fixture.items?.[indexedKey];
      if (item) items.set(indexedKey, item);
    }
    return items;
  });
  return {
    read,
    readDocument: (absolutePath) =>
      fixture.missingFile || absolutePath !== FILE
        ? null
        : { sourcePath: SOURCE, links: fixture.links ?? [] },
    resolveIndexedKey: (linkpath) => fixture.notes?.[linkpath] ?? null,
    database: {
      describe: () => ({ dataDir: "/Zotero", readMode: "immutable" }),
      read,
    },
  };
}

function errorCodes(response: ResolveResponse): string[] {
  return "errors" in response ? response.errors.map((e) => e.code) : [];
}

describe("resolveCitations", () => {
  it("maps every Literature Note link to its current citation key", async () => {
    const response = await resolveCitations(
      FILE,
      ports({
        links: [link("Doe 2020"), link("Papers/Lee 2023")],
        notes: { "Doe 2020": "AAAA1111", "Papers/Lee 2023": "BBBB2222" },
        items: { AAAA1111: cited("doe2020"), BBBB2222: cited("lee2023") },
      }),
    );

    expect(response).toEqual({
      citations: { "Doe 2020": "doe2020", "Papers/Lee 2023": "lee2023" },
    });
  });

  it("leaves links to ordinary notes out without an error", async () => {
    const response = await resolveCitations(
      FILE,
      ports({
        links: [link("Doe 2020"), link("Reading list")],
        notes: { "Doe 2020": "AAAA1111" },
        items: { AAAA1111: cited("doe2020") },
      }),
    );

    expect(response).toEqual({ citations: { "Doe 2020": "doe2020" } });
  });

  it("returns an empty map for a document with no Literature Note links", async () => {
    const response = await resolveCitations(
      FILE,
      ports({ links: [link("Reading list")] }),
    );

    expect(response).toEqual({ citations: {} });
  });

  it("strips fragments and percent-decodes the map keys", async () => {
    const response = await resolveCitations(
      FILE,
      ports({
        links: [
          link("Doe%202020#cite:locator=33"),
          link("M%C3%BCller 2019.md"),
          link("50% Solution"),
        ],
        notes: {
          "Doe 2020": "AAAA1111",
          "Müller 2019.md": "BBBB2222",
          "50% Solution": "CCCC3333",
        },
        items: {
          AAAA1111: cited("doe2020"),
          BBBB2222: cited("muller2019"),
          CCCC3333: cited("solution"),
        },
      }),
    );

    expect(response).toEqual({
      citations: {
        "Doe 2020": "doe2020",
        "Müller 2019.md": "muller2019",
        "50% Solution": "solution",
      },
    });
  });

  it("looks each unique linkpath up once", async () => {
    const deps = ports({
      links: [link("Doe 2020"), link("Doe%202020"), link("Doe 2020#cite:")],
      notes: { "Doe 2020": "AAAA1111" },
      items: { AAAA1111: cited("doe2020") },
    });

    await resolveCitations(FILE, deps);

    expect(deps.read).toHaveBeenCalledExactlyOnceWith(["AAAA1111"]);
  });

  it("reports a path that names no vault file", async () => {
    const response = await resolveCitations(
      "/elsewhere/Paper.md",
      ports({ missingFile: true }),
    );

    expect(response).toEqual({
      errors: [
        {
          code: "file-not-found",
          message: 'No vault file at "/elsewhere/Paper.md".',
        },
      ],
    });
  });

  it("reports an unreadable database once, naming it", async () => {
    const response = await resolveCitations(
      FILE,
      ports({
        links: [link("Doe 2020"), link("Roe 2021")],
        notes: { "Doe 2020": "AAAA1111", "Roe 2021": "BBBB2222" },
        databaseUnavailable: true,
      }),
    );

    expect(errorCodes(response)).toEqual(["database-unavailable"]);
    expect("errors" in response && response.errors[0]!.message).toContain(
      "/Zotero",
    );
    expect("errors" in response && response.errors[0]!.message).toContain(
      "immutable",
    );
  });

  it("reports an Indexed Key the database has no live Item for", async () => {
    const response = await resolveCitations(
      FILE,
      ports({
        links: [link("Doe 2020")],
        notes: { "Doe 2020": "AAAA1111" },
      }),
    );

    expect(response).toMatchObject({
      errors: [
        {
          code: "item-not-found",
          linkpath: "Doe 2020",
          indexedKey: "AAAA1111",
        },
      ],
    });
  });

  it("reports an Item without a citation key, naming its title", async () => {
    const response = await resolveCitations(
      FILE,
      ports({
        links: [link("Doe 2020")],
        notes: { "Doe 2020": "AAAA1111" },
        items: { AAAA1111: { citationKey: null, title: "Deep sea drift" } },
      }),
    );

    expect(errorCodes(response)).toEqual(["citation-key-missing"]);
    expect("errors" in response && response.errors[0]!.message).toContain(
      "Deep sea drift",
    );
  });

  it("reports two Items that share one citation key", async () => {
    const response = await resolveCitations(
      FILE,
      ports({
        links: [link("Doe 2020"), link("Doe 2020 duplicate")],
        notes: { "Doe 2020": "AAAA1111", "Doe 2020 duplicate": "BBBB2222" },
        items: { AAAA1111: cited("doe2020"), BBBB2222: cited("doe2020") },
      }),
    );

    expect(errorCodes(response)).toEqual(["duplicate-citation-key"]);
    expect("errors" in response && response.errors[0]!.message).toContain(
      "BBBB2222",
    );
  });

  it("accepts two linkpaths that name the same Item", async () => {
    const response = await resolveCitations(
      FILE,
      ports({
        links: [link("Doe 2020"), link("Papers/Doe 2020")],
        notes: { "Doe 2020": "AAAA1111", "Papers/Doe 2020": "AAAA1111" },
        items: { AAAA1111: cited("doe2020") },
      }),
    );

    expect(response).toEqual({
      citations: { "Doe 2020": "doe2020", "Papers/Doe 2020": "doe2020" },
    });
  });

  it("reports citation intent on a target that is not a Literature Note", async () => {
    const response = await resolveCitations(
      FILE,
      ports({ links: [link("Reading list#cite:locator=33")] }),
    );

    expect(response).toMatchObject({
      errors: [
        { code: "unresolved-citation-intent", linkpath: "Reading list" },
      ],
    });
  });

  it("leaves an ordinary fragment on a non-citation link alone", async () => {
    const response = await resolveCitations(
      FILE,
      ports({ links: [link("Reading list#Section"), link("Notes#^block")] }),
    );

    expect(response).toEqual({ citations: {} });
  });

  it("suppresses every citation once anything fails", async () => {
    const response = await resolveCitations(
      FILE,
      ports({
        links: [link("Doe 2020"), link("Roe 2021"), link("Reading list#cite:")],
        notes: { "Doe 2020": "AAAA1111", "Roe 2021": "BBBB2222" },
        items: { AAAA1111: cited("doe2020") },
      }),
    );

    expect(response).not.toHaveProperty("citations");
    expect(errorCodes(response)).toEqual([
      "unresolved-citation-intent",
      "item-not-found",
    ]);
  });
});
