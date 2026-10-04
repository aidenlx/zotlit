import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";

import { parseItemDate } from "@/lib/zt-date";
import { getAnnotationsByParent } from "@/queries/annotations";
import { getAttachmentsByParents } from "@/queries/attachments";
import {
  getCollectionIDsByItem,
  getCollectionNodesByLibrary,
} from "@/queries/collections";
import type { Item } from "@/queries/items";
import { getItemsByKey, getItemsByLibrary } from "@/queries/items";
import { getChildNotes } from "@/queries/notes";
import { getSchemaVersions } from "@/queries/schema-version";
import { getTagsByItemIDs } from "@/queries/tags";

import { openScenarioDatabase, SCENARIO_ITEMS, SCENARIO_LIBRARIES } from ".";
import type { ScenarioDatabase, ScenarioItemName } from ".";

describe("openScenarioDatabase", () => {
  it("opens an in-memory copy of the pristine Zotero 10 database", () => {
    using scenario = openScenarioDatabase();

    expect(scenario.path).toBe(":memory:");
    expect(getSchemaVersions(scenario.db)).toEqual({
      userdata: 129,
      compatibility: 9,
      supported: true,
    });
  });

  it("keeps Zotero's own lookup tables for fields, item types, and base-field mappings", () => {
    using scenario = openScenarioDatabase();
    const { sqlite } = scenario;

    const bookSectionContainer = sqlite
      .prepare(
        `select base.fieldName as baseField
           from baseFieldMappingsCombined m
           join itemTypesCombined t on t.itemTypeID = m.itemTypeID
           join fieldsCombined f on f.fieldID = m.fieldID
           join fieldsCombined base on base.fieldID = m.baseFieldID
          where t.typeName = 'bookSection' and f.fieldName = 'bookTitle'`,
      )
      .get();
    expect(bookSectionContainer).toEqual({ baseField: "publicationTitle" });

    const builtInTypes = sqlite
      .prepare(
        "select count(*) as n from itemTypesCombined where custom = 0 and typeName in ('journalArticle', 'book', 'bookSection', 'conferencePaper', 'report', 'attachment', 'note', 'annotation')",
      )
      .get();
    expect(builtInTypes).toEqual({ n: 8 });
  });

  it("holds only the live top-level Items in the personal Library universe", () => {
    using scenario = openScenarioDatabase();

    const items = getItemsByLibrary(
      scenario.db,
      SCENARIO_LIBRARIES.personal.libraryID,
    );

    expect(items.map((item) => item.indexedKey).toSorted()).toEqual([
      "ALS2CNFL",
      "ART2FULL",
      "BK2MNTH2",
      "CHP2YEAR",
      "CNF2TEXT",
      "RPT2NDTE",
      "TIE2AAAA",
      "TIE2BBBB",
      "TIE2CCCC",
      "UNI2CDE2",
    ]);
  });

  it("holds the group Library's live top-level Items under group Indexed Keys", () => {
    using scenario = openScenarioDatabase();

    const items = getItemsByLibrary(
      scenario.db,
      SCENARIO_LIBRARIES.group.libraryID,
    );

    expect(items.map((item) => item.indexedKey).toSorted()).toEqual([
      "ART2FULLg4815",
      "GRP2BK22g4815",
    ]);
    expect(SCENARIO_ITEMS.groupArticle.indexedKey).toBe("ART2FULLg4815");
    expect(SCENARIO_ITEMS.fullDateArticle.indexedKey).toBe("ART2FULL");
  });
});

describe("scenario seed", () => {
  const item = (scenario: ScenarioDatabase, name: ScenarioItemName): Item => {
    const { db } = scenario!;
    const { key, library } = SCENARIO_ITEMS[name];
    const [found] = getItemsByKey(db, SCENARIO_LIBRARIES[library].libraryID, [
      key,
    ]);
    if (!found) throw new Error(`no live top-level Item ${name}`);
    return found;
  };
  const fieldOf = (found: Item, name: string): string | null =>
    (found.fields as object as Partial<Record<string, string>>)[name] ?? null;
  const isTrashed = (
    scenario: ScenarioDatabase,
    name: ScenarioItemName,
  ): boolean => {
    const { key, library } = SCENARIO_ITEMS[name];
    const row = scenario.sqlite
      .prepare(
        "select exists(select 1 from deletedItems d join items i using (itemID) where i.key = ? and i.libraryID = ?) as trashed",
      )
      .get(key, SCENARIO_LIBRARIES[library].libraryID) as { trashed: number };
    return row.trashed === 1;
  };

  it("has trashed top-level Items in both Libraries", () => {
    using scenario = openScenarioDatabase();

    expect(isTrashed(scenario, "trashedArticle")).toBe(true);
    expect(isTrashed(scenario, "groupTrashed")).toBe(true);
    expect(isTrashed(scenario, "fullDateArticle")).toBe(false);
  });

  it("has a live and a trashed Attachment, an Annotation, and a Child Note", () => {
    using scenario = openScenarioDatabase();
    const { db } = scenario;
    const parent = item(scenario, "fullDateArticle");

    const attachments = getAttachmentsByParents(db, [parent.itemID]);
    expect(attachments.map((a) => a.indexedKey)).toEqual(["PDF2LIVE"]);
    expect(isTrashed(scenario, "trashedAttachment")).toBe(true);

    const annotations = getAnnotationsByParent(db, attachments[0]!.itemID);
    expect(annotations.map((a) => [a.key, a.text])).toEqual([
      ["ANN2HGHT", "an exact match"],
    ]);

    const notes = getChildNotes(db, parent.itemID);
    expect(notes.map((n) => n.key)).toEqual(["NTE2CHLD"]);
  });

  it("has full, partial, text, and missing dates", () => {
    using scenario = openScenarioDatabase();
    const dateKind = (name: ScenarioItemName) =>
      parseItemDate(fieldOf(item(scenario, name), "date"))?.kind ?? null;

    expect(dateKind("fullDateArticle")).toBe("date");
    expect(dateKind("yearMonthBook")).toBe("yearMonth");
    expect(dateKind("yearOnlyChapter")).toBe("year");
    expect(dateKind("textDateConference")).toBe("text");
    expect(dateKind("missingDateReport")).toBeNull();
  });

  it("stores type-specific alias fields under their base fields", () => {
    using scenario = openScenarioDatabase();

    expect(item(scenario, "yearOnlyChapter").baseFields.publicationTitle).toBe(
      "Handbook of Methods",
    );
    expect(
      item(scenario, "textDateConference").baseFields.publicationTitle,
    ).toBe("Proceedings of Testing");
    expect(item(scenario, "missingDateReport").baseFields.publisher).toBe(
      "Lab Institute",
    );
  });

  it("has an alias conflict: base field, type-specific variant, and a same-named custom field", () => {
    using scenario = openScenarioDatabase();
    const { sqlite } = scenario;
    const conflict = item(scenario, "aliasConflictChapter");

    const stored = sqlite
      .prepare(
        `select f.fieldName as field, f.custom as custom, v.value as value
           from itemData d
           join fieldsCombined f using (fieldID)
           join itemDataValues v using (valueID)
          where d.itemID = ? and f.fieldName in ('bookTitle', 'publicationTitle')
          order by f.custom, f.fieldName`,
      )
      .all(conflict.itemID);
    expect(stored).toEqual([
      { field: "bookTitle", custom: 0, value: "Type-Specific Host" },
      { field: "publicationTitle", custom: 0, value: "Base Field Host" },
      { field: "publicationTitle", custom: 1, value: "Custom Host" },
    ]);
  });

  it("has custom fields apart from the built-in field of the same name", () => {
    using scenario = openScenarioDatabase();
    const article = item(scenario, "fullDateArticle");

    expect(fieldOf(article, "title")).toBe(
      "Exact Matching in Literature Review",
    );
    expect(Object.fromEntries(article.customFields)).toEqual({
      "review.status": "done",
      mood: "calm",
      title: "Custom Title Value",
    });
  });

  it("has both creator modes and the same person as author and editor", () => {
    using scenario = openScenarioDatabase();

    expect(item(scenario, "fullDateArticle").creators).toEqual([
      {
        firstName: "Ada",
        lastName: "Lovelace",
        creatorType: "author",
        fieldMode: 0,
      },
      {
        firstName: "",
        lastName: "World Health Organization",
        creatorType: "author",
        fieldMode: 1,
      },
    ]);
    expect(
      item(scenario, "yearMonthBook").creators.map((c) => [
        c.firstName,
        c.lastName,
        c.creatorType,
      ]),
    ).toEqual([
      ["Grace", "Hopper", "author"],
      ["Grace", "Hopper", "editor"],
    ]);
  });

  it("has Tags that differ only in case", () => {
    using scenario = openScenarioDatabase();
    const { db } = scenario;

    const tags = getTagsByItemIDs(db, [
      item(scenario, "fullDateArticle").itemID,
    ]);
    expect(
      tags.map((t) => `${t.tag.name} (type ${t.type})`).toSorted(),
    ).toEqual(["To-Read (type 1)", "methods (type 0)", "to-read (type 0)"]);
  });

  it("has two live Collections with the same leaf name under different parents", () => {
    using scenario = openScenarioDatabase();
    const { db } = scenario;

    const nodes = getCollectionNodesByLibrary(
      db,
      SCENARIO_LIBRARIES.personal.libraryID,
    );
    const nameOf = new Map(nodes.map((n) => [n.collectionID, n]));
    const paths = nodes
      .map((n) => {
        const parent = n.parentCollectionID
          ? nameOf.get(n.parentCollectionID)
          : undefined;
        return parent
          ? `${parent.collectionName}/${n.collectionName}`
          : n.collectionName;
      })
      .toSorted();
    // "Archive" is trashed, so its live child "Old" has no live parent.
    expect(paths).toEqual([
      "Old",
      "Teaching",
      "Teaching/Methods",
      "Thesis",
      "Thesis/Methods",
    ]);

    const memberships = getCollectionIDsByItem(
      db,
      item(scenario, "yearMonthBook").itemID,
    ).map((id) => nameOf.get(id)?.key);
    expect(memberships).toEqual(["CL2TCMTH"]);
  });

  it("has tie-heavy Items that share title, date, and timestamps", () => {
    using scenario = openScenarioDatabase();
    const tie = (name: ScenarioItemName) => {
      const found = item(scenario, name);
      const { dateAdded, dateModified } = found;
      return {
        title: fieldOf(found, "title"),
        date: fieldOf(found, "date"),
        dateAdded: dateAdded.toString(),
        dateModified: dateModified.toString(),
      };
    };

    const shared = {
      date: "2021-00-00 2021",
      dateAdded: "2021-01-01T00:00:00Z",
      dateModified: "2024-03-01T12:00:00Z",
    };
    expect(tie("tieFirst")).toEqual({ title: "Same Title", ...shared });
    expect(tie("tieSecond")).toEqual({ title: "Same Title", ...shared });
    expect(tie("tieUntitled")).toEqual({ title: null, ...shared });
  });

  it("stores one field value as an SQLite integer and an equal one as text", () => {
    using scenario = openScenarioDatabase();
    const { sqlite } = scenario;
    const storage = (name: ScenarioItemName) =>
      sqlite
        .prepare(
          `select typeof(v.value) as type, v.value as value
             from items i
             join itemData d using (itemID)
             join fieldsCombined f using (fieldID)
             join itemDataValues v using (valueID)
            where i.key = ? and f.fieldName = 'volume'`,
        )
        .get(SCENARIO_ITEMS[name].key);

    expect(storage("tieFirst")).toEqual({ type: "integer", value: 12 });
    expect(storage("tieSecond")).toEqual({ type: "text", value: "12" });
  });
});

describe("openScenarioDatabase storage", () => {
  it("writes the copy into a temporary directory and removes it on close", () => {
    using scenario = openScenarioDatabase({ storage: "temp-directory" });
    const { path } = scenario;

    expect(path).toMatch(/zotero\.sqlite$/);
    expect(existsSync(path)).toBe(true);
    expect(
      getItemsByLibrary(scenario.db, SCENARIO_LIBRARIES.personal.libraryID),
    ).toHaveLength(10);

    scenario.close();
    expect(existsSync(dirname(path))).toBe(false);
  });
});

describe("openScenarioDatabase lowest layout", () => {
  const columnsOf = (scenario: ScenarioDatabase, table: string) =>
    (
      scenario.sqlite.prepare(`pragma table_info("${table}")`).all() as {
        name: string;
      }[]
    ).map((c) => c.name);

  // Migrations 126 (normalized shadow columns) and 129 (clientVersion).
  const added = [
    ["items", "clientVersion"],
    ["itemDataValues", "valueNormalized"],
    ["itemAnnotations", "textNormalized"],
    ["itemAnnotations", "commentNormalized"],
    ["tags", "nameNormalized"],
    ["creators", "firstNameNormalized"],
    ["creators", "lastNameNormalized"],
    ["collections", "clientVersion"],
    ["savedSearches", "clientVersion"],
    ["libraries", "clientVersion"],
  ] as const;

  it("keeps the columns added after userdata 125 in the highest layout", () => {
    using scenario = openScenarioDatabase();

    for (const [table, column] of added) {
      expect(columnsOf(scenario, table)).toContain(column);
    }
  });

  it("drops the columns added after userdata 125 and reads as userdata 125", () => {
    using scenario = openScenarioDatabase({ layout: "lowest" });

    for (const [table, column] of added) {
      expect(columnsOf(scenario, table)).not.toContain(column);
    }
    expect(columnsOf(scenario, "items")).toContain("clientDateModified");
    expect(getSchemaVersions(scenario.db)).toEqual({
      userdata: 125,
      compatibility: 7,
      supported: true,
    });
  });

  it("keeps the same scenario rows in the lowest layout", () => {
    using scenario = openScenarioDatabase({ layout: "lowest" });
    const { db } = scenario;

    const personal = getItemsByLibrary(
      db,
      SCENARIO_LIBRARIES.personal.libraryID,
    );
    expect(personal).toHaveLength(10);
    const article = personal.find((i) => i.key === "ART2FULL")!;
    const [attachment] = getAttachmentsByParents(db, [article.itemID]);
    expect(
      getAnnotationsByParent(db, attachment!.itemID).map((a) => a.key),
    ).toEqual(["ANN2HGHT"]);
  });
});
