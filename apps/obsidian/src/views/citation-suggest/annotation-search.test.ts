// The Annotation Suggester's search through ZotLit Query over the Zotero
// database alone, as it runs with Zotero closed.
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { openScenarioDatabase } from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { buildQueryService } from "@/services/item-query/__fixtures__";
import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import { searchAnnotations } from "./annotation-search";

/**
 * A second annotated paper beside the scenario's `ART2FULL`, older on every
 * date the scenario gives: "Ten Simple Rules" (`RULES222`), its PDF
 * `RULESPDF`, and one highlight `RULESANN`.
 */
function addOlderPaper(sqlite: ScenarioDatabase["sqlite"]): void {
  sqlite.exec(`
    insert into itemDataValues (value) values ('Ten Simple Rules');
    insert into items (itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key) values
      ((select itemTypeID from itemTypesCombined where typeName = 'journalArticle'), '2010-01-01 00:00:00', '2010-01-01 00:00:00', '2010-01-01 00:00:00', 1, 'RULES222'),
      ((select itemTypeID from itemTypesCombined where typeName = 'attachment'), '2010-01-01 00:00:00', '2010-01-01 00:00:00', '2010-01-01 00:00:00', 1, 'RULESPDF'),
      ((select itemTypeID from itemTypesCombined where typeName = 'annotation'), '2010-01-01 00:00:00', '2010-01-01 00:00:00', '2010-01-01 00:00:00', 1, 'RULESANN');
    insert into itemData (itemID, fieldID, valueID) values
      ((select itemID from items where key = 'RULES222'),
       (select fieldID from fieldsCombined where fieldName = 'title' and custom = 0),
       (select valueID from itemDataValues where value = 'Ten Simple Rules'));
    insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path) values
      ((select itemID from items where key = 'RULESPDF'), (select itemID from items where key = 'RULES222'), 0, 'application/pdf', 'storage:rules.pdf');
    insert into itemAnnotations (itemID, parentItemID, type, text, color, sortIndex, position, comment, pageLabel, isExternal) values
      ((select itemID from items where key = 'RULESANN'), (select itemID from items where key = 'RULESPDF'), 1, 'Rule one: an exact rule', '#5fb236', '00000|000000|00000', '{"pageIndex":0,"rects":[[0,0,1,1]]}', 'Use it', '7', 0);
  `);
}

async function setup(uses: Record<string, number> = {}) {
  await using stack = new AsyncDisposableStack();
  const scenario = stack.use(
    openScenarioDatabase({
      storage: "temp-directory",
      annotations: true,
    }),
  );
  addOlderPaper(scenario.sqlite);
  const reads = stack.use(
    inProcessReadsService(sharedClientOpener(scenario.db)),
  );
  const { handle: service } = await buildQueryService(
    {
      reads: reads.reads,
      pluginVersion: "2.2.0-beta.2",
      uses,
      source: {
        sourceId: "captured-source",
        databasePath: scenario.path,
        dataDir: dirname(scenario.path),
        baseAttachmentPath: join(dirname(scenario.path), "linked"),
      },
      effective: () => MY_LIBRARY_SCOPE,
      vaultName: "Annotation search",
      basePath: dirname(scenario.path),
    },
    stack,
  );
  const owned = stack.move();
  const search = async (text: string) =>
    (await searchAnnotations(service, text, {
      signal: new AbortController().signal,
      limit: 50,
    }))!.map((hit) => hit.key);
  return {
    service,
    search,
    sqlite: scenario.sqlite,
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}

/** The scenario's live annotations of `ART2FULL` carrying the comment "<b>Comment</b>". */
const COMMENTED = [
  "ANN2UNDR",
  "ANN2NOTE",
  "ANN2IMAG",
  "ANN2INK2",
  "ANN2TEXT",
  "ANN2LINK",
  "ANN2BAD2",
];

describe("searchAnnotations", () => {
  it("matches annotation text in any case", async () => {
    await using h = await setup();
    expect((await h.search("EXACT")).toSorted()).toEqual([
      "ANN2HGHT",
      "RULESANN",
    ]);
  });

  it("matches the comment", async () => {
    await using h = await setup();
    expect((await h.search("comment")).toSorted()).toEqual(
      COMMENTED.toSorted(),
    );
    expect(await h.search("use it")).toEqual(["RULESANN"]);
  });

  // Zotero stores rich text with its reader's inline tags. A search reads
  // what the researcher sees: H<sub>2</sub>O reads "H2O", and the tag names
  // are no words of it.
  it("matches the visible text of rich text, not its markup", async () => {
    await using h = await setup();
    h.sqlite.exec(`
      update itemAnnotations set text = 'Water is H<sub>2</sub>O', comment = 'A <b>key</b>stone'
      where itemID = (select itemID from items where key = 'RULESANN');
    `);
    expect(await h.search("h2o")).toEqual(["RULESANN"]);
    expect(await h.search("keystone")).toEqual(["RULESANN"]);
    expect(await h.search("sub")).toEqual([]);
  });

  // Only the four tags the reader renders are markup; any other angle bracket
  // is text the researcher reads, as the card and the copied comment keep it.
  it("keeps the literal angle brackets of a comparison", async () => {
    await using h = await setup();
    h.sqlite.exec(`
      update itemAnnotations set text = 'Significant at p < 0.05 and q > 0.1', comment = 'Holds for n<30 and m>2'
      where itemID = (select itemID from items where key = 'RULESANN');
    `);
    expect(await h.search("0.05")).toEqual(["RULESANN"]);
    expect(await h.search("n<30")).toEqual(["RULESANN"]);
  });

  it("needs every word, each in the text or the comment", async () => {
    await using h = await setup();
    expect(await h.search("rule use")).toEqual(["RULESANN"]);
    expect(await h.search("exact comment")).toEqual([]);
  });

  it("narrows by tag:", async () => {
    await using h = await setup();
    expect((await h.search("tag:method")).toSorted()).toEqual(
      COMMENTED.toSorted(),
    );
  });

  it("narrows by color: name or hex", async () => {
    await using h = await setup();
    expect(await h.search("color:green")).toEqual(["RULESANN"]);
    expect(await h.search("color:#5FB236")).toEqual(["RULESANN"]);
    expect(
      (await h.search("exact color:yellow color:green")).toSorted(),
    ).toEqual(["ANN2HGHT", "RULESANN"]);
  });

  it("narrows by paper: title words", async () => {
    await using h = await setup();
    expect(await h.search('exact paper:"simple rules"')).toEqual(["RULESANN"]);
    expect(await h.search("exact paper:matching")).toEqual(["ANN2HGHT"]);
  });

  it("puts the annotations of the paper with the latest activity first", async () => {
    {
      await using h = await setup();
      expect(await h.search("exact")).toEqual(["ANN2HGHT", "RULESANN"]);
    }
    {
      // A Use of the older paper on this device makes it the most recent.
      await using h = await setup({
        RULES222: Temporal.Instant.from("2026-10-01T00:00:00Z")
          .epochMilliseconds,
      });
      expect(await h.search("exact")).toEqual(["RULESANN", "ANN2HGHT"]);
    }
  });

  it("lists every annotation for an empty query, the latest paper first", async () => {
    await using h = await setup({
      RULES222: Temporal.Instant.from("2026-10-01T00:00:00Z").epochMilliseconds,
    });
    const keys = await h.search("");
    expect(keys[0]).toBe("RULESANN");
    expect(keys.toSorted()).toEqual(
      [
        "RULESANN",
        "ANN2HGHT",
        ...COMMENTED,
        "ANL2IMAG",
        "ANL2INK2",
        "ANL2UNDR",
        "ANL2TEXT",
      ].toSorted(),
    );
  });

  it("returns what a hit shows and inserts", async () => {
    await using h = await setup();
    const [hit] = (await searchAnnotations(h.service, "use it", {
      signal: new AbortController().signal,
      limit: 50,
    }))!;
    expect(hit).toEqual({
      key: "RULESANN",
      attachmentKey: "RULESPDF",
      itemKey: "RULES222",
      type: "highlight",
      text: "Rule one: an exact rule",
      comment: "Use it",
      color: "#5fb236",
      pageLabel: "7",
      title: "Ten Simple Rules",
      citationKey: null,
    });
  });

  it("answers null once the signal aborts", async () => {
    await using h = await setup();
    const controller = new AbortController();
    controller.abort();
    expect(
      await searchAnnotations(h.service, "exact", {
        signal: controller.signal,
        limit: 50,
      }),
    ).toBeNull();
  });
});
