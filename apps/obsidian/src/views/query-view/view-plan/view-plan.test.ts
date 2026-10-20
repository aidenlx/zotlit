import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { QueryViewRow } from "@/services/item-query/query-view";
import {
  newQueryFileText,
  parseQueryFile,
} from "@/views/query-view/query-file";
import type { QueryFile } from "@/views/query-view/query-file";
import type { VaultHost, VaultValue } from "@/views/query-view/table-notes";
import { VAULT_SORT_CAP } from "@/views/query-view/vault-sort";

import { ViewPlanner } from "./view-plan";
import type { ViewPlanSources } from "./view-plan";

/** The Literature Notes by Indexed Key, each with its frontmatter, counting their scans. */
function notes(byKey: Record<string, Record<string, unknown>>) {
  const reader = {
    scans: 0,
    itemKeys: () => {
      reader.scans++;
      return Object.keys(byKey);
    },
    read: (itemKey: string, name: string, host: VaultHost | null): VaultValue =>
      host?.itemKey === itemKey
        ? { note: true, value: `host ${host.path}` }
        : Object.hasOwn(byKey, itemKey)
          ? { note: true, value: byKey[itemKey]![name] ?? null }
          : { note: false },
  };
  return reader;
}

const LIBRARY = notes({
  ITEMAAAA: { status: "read", rating: 5, tags: ["x"] },
  ITEMBBBB: { status: "reading", rating: 2 },
  ITEMCCCC: { status: null },
  ITEMDDDD: {},
});

function planner(sources: Partial<ViewPlanSources> = {}) {
  return new ViewPlanner({
    context: () => undefined,
    host: () => null,
    notes: LIBRARY,
    ...sources,
  });
}

/** The plan of the view at `index` of the Query File `text`. */
function plan(text: string | QueryFile, index = 0, sources = {}) {
  const file = typeof text === "string" ? parseQueryFile(text) : text;
  return planner(sources).plan(file, file.views[index]!);
}

/** An Items Table whose own filters are `filters`, as YAML. */
const items = (filters: string) => `views:
  - type: table
    name: Items
    from: items
    filters: ${filters}
`;

/** Where `needle` sits in `text`, as a fault's span. */
const span = (text: string, needle: string) => {
  const from = text.indexOf(needle);
  return { from, to: from + needle.length };
};

const TWO_VIEWS = `filters: item.itemType == "journalArticle"
views:
  - type: annotations
    name: All annotations
    from: annotations
    filters:
      and:
        - colorName == "yellow"
        - or:
            - tags.contains("figure")
            - comment != null
  - type: annotations
    name: Second
    from: annotations
`;

describe("the filter of a view's request", () => {
  it("joins the filters for all views and the view's own filters with and", () => {
    const file = parseQueryFile(TWO_VIEWS);
    expect(plan(file, 0).request.filter).toBe(
      '(item.itemType == "journalArticle") && ((colorName == "yellow") && ((tags.contains("figure")) || (comment != null)))',
    );
    expect(plan(file, 1).request.filter).toBe(
      'item.itemType == "journalArticle"',
    );
  });

  it("applies the filters for all views only to views of the first view's dataset", () => {
    const file = parseQueryFile(`filters: item.title.contains("Rules")
views:
  - type: annotations
    name: Annotations
    from: annotations
  - type: table
    name: Items
    from: items
    filters: title != null
`);
    expect(plan(file, 0).request.filter).toBe('item.title.contains("Rules")');
    expect(plan(file, 1).request.filter).toBe("title != null");
  });

  it("gives no filter when the file and the view have none", () => {
    expect(
      plan(newQueryFileText({ items: "Items", annotations: "Annotations" }))
        .request,
    ).not.toHaveProperty("filter");
  });
});

describe("the condition a fault in the request's filter marks", () => {
  const planned = plan(TWO_VIEWS);
  const text = planned.request.filter!;

  it("finds the condition of the filters for all views", () => {
    const condition = 'item.itemType == "journalArticle"';
    expect(planned.locate(span(text, "journalArticle"))).toEqual({
      section: "all",
      path: [0],
      fault: { text: condition, span: span(condition, "journalArticle") },
    });
  });

  it("finds a nested condition of the view's own filters", () => {
    expect(planned.locate(span(text, "comment"))).toEqual({
      section: "view",
      path: [1, 1],
      fault: {
        text: "comment != null",
        span: span("comment != null", "comment"),
      },
    });
    expect(planned.locate(span(text, "colorName"))).toMatchObject({
      section: "view",
      path: [0],
    });
  });

  it("finds no condition for a fault between conditions", () => {
    expect(planned.locate(span(text, ") && ("))).toBeNull();
  });
});

describe("the conditions the vault answers", () => {
  it("takes each one that must hold for every row out of the request, and ZotLit Query reads its Items by key in its place", () => {
    const planned = plan(`filters:
  and:
    - itemType == "book"
    - vault["status"] == "read"
views:
  - type: table
    name: Items
    from: items
    filters:
      and:
        - vault.rating > 1
        - dat == 1
`);
    const keys = '["ITEMAAAA"].contains(indexedKey)';
    expect(planned.fault).toBeNull();
    expect(planned.keys).toBe(keys);
    expect(planned.request.filter).toBe(
      `((itemType == "book") && (dat == 1))\n&& (${keys})`,
    );
  });

  it("finds the conditions ZotLit Query runs at their places, past the key list", () => {
    const planned = plan(
      items(`
      and:
        - vault.rating > 1
        - or:
            - dat == 1
            - title != null
        - abstract != null`),
    );
    const text = planned.request.filter!;
    expect(planned.locate(span(text, "dat"))).toEqual({
      section: "view",
      path: [1, 0],
      fault: { text: "dat == 1", span: span("dat == 1", "dat") },
    });
    expect(planned.locate(span(text, "abstract"))).toEqual({
      section: "view",
      path: [2],
      fault: {
        text: "abstract != null",
        span: span("abstract != null", "abstract"),
      },
    });
    expect(planned.locate(span(text, "ITEMAAAA"))).toBeNull();
  });

  it("gives only the key list to ZotLit Query when every condition reads a vault property", () => {
    const planned = plan(items("vault.rating > 3"));
    expect(planned.request.filter).toBe('["ITEMAAAA"].contains(indexedKey)');
  });

  it("takes each top-level conjunct of a string as a condition of its own", () => {
    const planned = plan(
      items(`
      and:
        - 'vault["status"] == "read" && itemType == "book" && (vault.rating > 3)'
        - dat == 1`),
    );
    const text = planned.request.filter!;
    expect(text).toBe(
      '((itemType == "book") && (dat == 1))\n&& (["ITEMAAAA"].contains(indexedKey))',
    );
    // A fault in a kept conjunct falls at its place in the whole condition.
    const condition =
      'vault["status"] == "read" && itemType == "book" && (vault.rating > 3)';
    expect(planned.locate(span(text, "itemType"))).toEqual({
      section: "view",
      path: [0],
      fault: { text: condition, span: span(condition, "itemType") },
    });
    expect(planned.locate(span(text, "dat"))).toEqual({
      section: "view",
      path: [1],
      fault: { text: "dat == 1", span: span("dat == 1", "dat") },
    });
  });

  it("splits a filter that is one string", () => {
    expect(
      plan(items(`'itemType == "book" && vault.status == "read"'`)).request
        .filter,
    ).toBe('(itemType == "book")\n&& (["ITEMAAAA"].contains(indexedKey))');
  });

  it("keeps only the Items whose note passes, where the conditions fail for no value", () => {
    expect(
      plan(
        items(`
      and:
        - vault["status"] == "read"
        - vault.rating > 1`),
      ).keys,
    ).toBe('["ITEMAAAA"].contains(indexedKey)');
  });

  it("keeps no Item where no note passes", () => {
    expect(plan(items(`'vault.status == "unknown"'`)).keys).toBe(
      "[].contains(indexedKey)",
    );
  });

  it("leaves out the Items whose note fails, where the condition holds for no value, so Items without a note stay", () => {
    expect(plan(items(`'vault["status"] != "read"'`)).keys).toBe(
      '!["ITEMAAAA"].contains(indexedKey)',
    );
    expect(plan(items("vault.status == null")).keys).toBe(
      '!["ITEMAAAA", "ITEMBBBB"].contains(indexedKey)',
    );
  });

  it("adds no condition where every note passes a condition that holds for no value", () => {
    const planned = plan(items(`'vault.missing != "x"'`));
    expect(planned.keys).toBeNull();
    expect(planned.request).not.toHaveProperty("filter");
  });

  it("reads lists and methods on the value as ZotLit Query does", () => {
    expect(plan(items(`'vault.tags.contains("x")'`)).keys).toBe(
      '["ITEMAAAA"].contains(indexedKey)',
    );
    expect(plan(items("vault.status.isEmpty()")).keys).toBe(
      '!["ITEMAAAA", "ITEMBBBB"].contains(indexedKey)',
    );
  });

  it("reads the Item of an Annotation or an Attachment by its Item's key", () => {
    expect(
      plan(`views:
  - type: annotations
    name: Annotations
    from: annotations
    filters: 'vault.status == "read"'
`).keys,
    ).toBe('["ITEMAAAA"].contains(item.indexedKey)');
  });

  it("reads the note that holds the view for its own Item", () => {
    expect(
      plan(items(`'vault.status == "host note.md"'`), 0, {
        host: () => ({ path: "note.md", itemKey: "ITEMBBBB" }),
      }).keys,
    ).toBe('["ITEMBBBB"].contains(indexedKey)');
  });
});

describe("a vault condition the vault cannot answer apart from ZotLit Query", () => {
  it("marks the first one inside an or or a not group, and keeps the view from running", () => {
    const planned = plan(`filters:
  or:
    - vault.rating > 3
    - itemType == "book"
views:
  - type: table
    name: Items
    from: items
    filters:
      and:
        - vault.status == "read"
        - not:
            - vault["reading-status"] == "read"
`);
    expect(planned.fault).toEqual({
      at: { section: "all", path: [0] },
      diagnostic: {
        code: "vault-filter-nested",
        message: m.query_view_vault_filter_nested(),
        hint: m.query_view_vault_filter_nested_hint(),
      },
    });
  });

  it("marks one nested in the view's own filters at its place", () => {
    expect(
      plan(
        items(`
      and:
        - or:
            - vault.rating > 3
            - title != null
        - vault.rating > 3
        - dat == 1`),
      ).fault?.at,
    ).toEqual({ section: "view", path: [0, 0] });
  });

  it.each([
    `'vault.rating > 3 || itemType == "book"'`,
    "vault.status == this.item.title",
    `'vault[name] == "read"'`,
    "vault == null",
  ])("marks %s, which cannot be split from the Zotero part", (filters) => {
    expect(plan(items(filters)).fault).toEqual({
      at: { section: "view", path: [0] },
      diagnostic: {
        code: "vault-filter-mixed",
        message: m.query_view_vault_filter_mixed(),
        hint: m.query_view_vault_filter_mixed_hint(),
      },
    });
  });

  it("marks one ZotLit Query cannot plan with its message", () => {
    const { fault } = plan(items("vault.status.nope()"));
    expect(fault?.at).toEqual({ section: "view", path: [0] });
    expect(fault?.diagnostic.message).toBeTruthy();
  });
});

describe("the request of a view", () => {
  const SORTED = `formulas:
  short: title.slice(0, 10)
views:
  - type: table
    name: Items
    from: items
    sort:
      - property: vault.rating
        direction: DESC
      - property: title
        direction: ASC
    limit: 2
    order:
      - title
      - vault.rating
`;

  it("leaves out a vault sort and asks for every match up to the cap, with the fields it sorts by", () => {
    const { request } = plan(SORTED);
    expect(request.sort).toEqual([{ field: "title", direction: "asc" }]);
    expect(request.limit).toBe(VAULT_SORT_CAP);
    expect(request.fields).toContain("title");
    expect(request.fields).not.toContain("vault.rating");
    expect(request.formulas).toEqual({ short: "title.slice(0, 10)" });
  });

  it("sends the Query Context, and the run key tells two contexts apart", () => {
    const context = { item: "ITEMAAAA" };
    const file = parseQueryFile(SORTED);
    const view = file.views[0]!;
    const planned = planner({ context: () => context }).plan(file, view);
    expect(planned.request.context).toEqual(context);
    expect(planned.key).not.toBe(planner().plan(file, view).key);
    expect(planned.key).toBe(
      planner({ context: () => ({ item: "ITEMAAAA" }) }).plan(file, view).key,
    );
  });

  it("lays the rows out sorted by the vault property, and keeps `limit` of them", () => {
    const row = (indexedKey: string, title: string): QueryViewRow =>
      ({ indexedKey, values: { title } }) as unknown as QueryViewRow;
    const shown = plan(SORTED).layout([
      row("ITEMBBBB", "b"),
      row("ITEMDDDD", "d"),
      row("ITEMAAAA", "a"),
    ]);
    expect(shown.rows.map(({ annotationKey }) => annotationKey)).toEqual([
      "ITEMAAAA",
      "ITEMBBBB",
    ]);
    expect(shown.dropped).toBe(true);
  });
});

describe("a plan again", () => {
  const FILE = parseQueryFile(items(`'vault.status == "read"'`));
  const VIEW = FILE.views[0]!;

  it("reads the Literature Notes again only once they changed", () => {
    const counted = notes({ ITEMAAAA: { status: "read" } });
    let context = { item: "ITEMAAAA" };
    const planning = planner({ notes: counted, context: () => context });
    const first = planning.plan(FILE, VIEW);
    expect(counted.scans).toBe(1);
    context = { item: "ITEMBBBB" };
    expect(planning.plan(FILE, VIEW).key).not.toBe(first.key);
    expect(counted.scans).toBe(1);
    planning.notesChanged();
    planning.plan(FILE, VIEW);
    expect(counted.scans).toBe(2);
  });

  it("reads them again for another note that holds the view", () => {
    const counted = notes({ ITEMAAAA: { status: "read" } });
    let host: VaultHost | null = null;
    const planning = planner({ notes: counted, host: () => host });
    planning.plan(FILE, VIEW);
    host = { path: "note.md", itemKey: "ITEMBBBB" };
    planning.plan(FILE, VIEW);
    expect(counted.scans).toBe(2);
  });
});
