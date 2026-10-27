import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";

import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";
import { LIBRARIES } from "@zotlit/scripts/fixture";
import type { LibrarySelector } from "@zotlit/scripts/fixture";

import type { CreateOperationReply } from "./e2e-run-note-types.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import type { FrameRecord } from "./page-notes-types.ts";

async function createFixtureNote(
  vaultId: string,
  itemID: number,
  profile?: import("../../../apps/obsidian/src/lib/profile-stamp.ts").ProfileSelector,
): Promise<CreateOperationReply> {
  return obRun(
    vaultId,
    async ({ zotlit }, { itemID, profile }) => {
      const hits = await zotlit.services.itemLookup.search("", { limit: 100 });
      const hit = hits.find((candidate) => candidate.item.itemID === itemID);
      if (!hit) throw new Error("Fixture Item not found");
      const result = await zotlit.services.noteFeature.createNote(hit.item, {
        profile,
      });
      return result.outcome === "created"
        ? {
            outcome: "created" as const,
            path: result.file.path,
            indexedKey: hit.item.indexedKey,
          }
        : { outcome: "refused" as const, diagnostic: result.diagnostic };
    },
    { itemID, profile },
  );
}

/**
 * Watch the window's frames from now on: the longest gap between two
 * animation frames, and the long tasks the renderer reported.
 */
async function recordFrames(vaultId: string): Promise<
  AsyncDisposable & {
    read(): Promise<{
      frames: number;
      maxFrameGapMs: number;
      longTasks: number;
      longestTaskMs: number;
    }>;
  }
> {
  await obRun(
    vaultId,
    async ({ page }) => {
      var record: FrameRecord = {
        frames: 0,
        maxFrameGapMs: 0,
        longTasks: 0,
        longestTaskMs: 0,
        live: true,
        observer: null,
      };
      var previous = performance.now();
      var tick = function (now: number) {
        record.frames++;
        record.maxFrameGapMs = Math.max(record.maxFrameGapMs, now - previous);
        previous = now;
        if (record.live) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      record.observer = new PerformanceObserver(function (list) {
        for (var entry of list.getEntries()) {
          record.longTasks++;
          record.longestTaskMs = Math.max(record.longestTaskMs, entry.duration);
        }
      });
      record.observer.observe({ type: "longtask" });
      page.scratch.frames = record;
      return String(true);
    },
    undefined,
  );
  return {
    async read() {
      return JSON.parse(
        await obRun(
          vaultId,
          async ({ page }) => {
            var r = page.scratch.frames!;
            return JSON.stringify({
              frames: r.frames,
              maxFrameGapMs: Math.round(r.maxFrameGapMs),
              longTasks: r.longTasks,
              longestTaskMs: Math.round(r.longestTaskMs),
            });
          },
          undefined,
        ),
      ) as {
        frames: number;
        maxFrameGapMs: number;
        longTasks: number;
        longestTaskMs: number;
      };
    },
    async [Symbol.asyncDispose]() {
      await obRun(
        vaultId,
        async ({ page }) => {
          var r = page.scratch.frames!;
          r.live = false;
          r.observer!.disconnect();
          delete page.scratch.frames;
          return String(true);
        },
        undefined,
      );
    },
  };
}

function hasOneIndexedNote(
  vaultId: string,
  indexedKey: string,
): Promise<boolean> {
  return hasIndexedNotes(vaultId, indexedKey, 1);
}

function hasIndexedNotes(
  vaultId: string,
  indexedKey: string,
  count: number,
): Promise<boolean> {
  return obRunUntil(
    vaultId,
    async ({ zotlit }, { indexedKey }) => {
      return zotlit.services.noteIndex.getNotesByItemKey(indexedKey).length;
    },
    { indexedKey },
    {
      ready: (value) => value === count,
      what: "notes indexed under the item key to match the expected count",
    },
  ).then(
    () => true,
    () => false,
  );
}

/** A Fixture Item's Indexed Key and its current Literature Note, if any. */
async function indexedNote(
  vaultId: string,
  itemID: number,
): Promise<{ indexedKey: string; path: string | null }> {
  return obRun(
    vaultId,
    async ({ zotlit }, { itemID }) => {
      const hits = await zotlit.services.itemLookup.search("", { limit: 100 });
      const hit = hits.find((candidate) => candidate.item.itemID === itemID);
      if (!hit) throw new Error("Fixture Item not found");
      const notes = zotlit.services.noteIndex.getNotesByItemKey(
        hit.item.indexedKey,
      );
      return { indexedKey: hit.item.indexedKey, path: notes[0]?.path ?? null };
    },
    { itemID },
  );
}

/** Maps the Scope Case's stable selectors to the Fixture's libraryIDs. */
function expectedLibraryIDs(selectors: readonly LibrarySelector[]): number[] {
  return selectors
    .map((selector) => {
      const library =
        selector.type === "personal"
          ? LIBRARIES.find((candidate) => candidate.groupID === null)
          : LIBRARIES.find(
              (candidate) => candidate.groupID === selector.groupID,
            );
      if (!library) {
        throw new Error(
          `no Fixture Library for selector ${JSON.stringify(selector)}`,
        );
      }
      return library.libraryID;
    })
    .toSorted((a, b) => a - b);
}

/** Reads the user-visible Managed Region, including its boundary markers. */
function managedRegion(source: string): string {
  const start = source.indexOf("%%zt-managed%%");
  const end = source.indexOf("%%/zt-managed%%", start);
  if (start < 0 || end < 0) throw new Error("Missing Managed Region");
  return source.slice(start, end + "%%/zt-managed%%".length);
}

function noteBody(source: string): string {
  const end = source.indexOf("\n---", 3);
  if (!source.startsWith("---\n") || end < 0)
    throw new Error("Missing frontmatter");
  return source.slice(end + 4);
}

/**
 * The chooser selects on hover, and the physical cursor can reselect a row after
 * a rerender. Repeat mousemove until the desired row stays selected.
 */
async function hoverSuggestion(
  vaultId: string,
  match: { text: string } | { key: string },
): Promise<string> {
  return obRunUntil<{ text: string } | { key: string }, string | null>(
    vaultId,
    (_context, match: { text: string } | { key: string }) => {
      const prompt = Array.from(activeDocument.querySelectorAll(".prompt")).at(
        -1,
      );
      const row = Array.from(
        prompt?.querySelectorAll<HTMLElement>(".suggestion-item") ?? [],
      ).find((row) =>
        "text" in match
          ? row.textContent.includes(match.text)
          : !row.closest("[aria-busy]") && row.dataset.indexedKey === match.key,
      );
      if (!row) return null;
      row.dispatchEvent(
        new (activeWindow as Window & typeof globalThis).MouseEvent(
          "mousemove",
          { bubbles: true },
        ),
      );
      return row.classList.contains("is-selected") ? row.textContent : null;
    },
    match,
    { what: "selected prompt row", ready: (value) => value !== null },
  ).then((value) => value!);
}

function selectSuggestion(vaultId: string, needle: string): Promise<string> {
  return hoverSuggestion(vaultId, { text: needle });
}

/**
 * Types `query` into the last prompt, an Item search, and selects the row of
 * the Item whose Indexed Key is `key`. The prompt marks its results
 * `aria-busy` until the answer to the typed query shows; the rows before it
 * answer an earlier query. Rows of Items that share a title read the same, so
 * the row is found by its `data-indexed-key`.
 *
 * @param vaultId - The vault whose window holds the prompt.
 * @param query - The text typed into the prompt.
 * @param key - The Indexed Key of the Item to select.
 * @returns The selected row's text.
 */
async function selectItemSuggestion(
  vaultId: string,
  query: string,
  key: string,
): Promise<string> {
  await obRun(
    vaultId,
    async (_context, { query }) => {
      var input = Array.from(activeDocument.querySelectorAll(".prompt"))
        .at(-1)!
        .querySelector("input")!;
      input.value = query;
      input.dispatchEvent(
        new input.ownerDocument.defaultView!.Event("input", { bubbles: true }),
      );
      return String(true);
    },
    { query },
  );
  return hoverSuggestion(vaultId, { key });
}

/**
 * Presses `key` in the last prompt's input.
 *
 * @param vaultId - The vault whose window holds the prompt.
 * @param key - The key pressed.
 * @param modifiers - The modifier keys held with it.
 */
async function pressPromptKey(
  vaultId: string,
  key: "Enter" | "Escape",
  modifiers: { altKey?: boolean } = {},
): Promise<void> {
  const keyCode = key === "Enter" ? 13 : 27;
  await obRun(
    vaultId,
    async (_context, { keyEventInit }) => {
      Array.from(activeDocument.querySelectorAll(".prompt"))
        .at(-1)!
        .querySelector("input")!
        .dispatchEvent(
          new (activeWindow as Window & typeof globalThis).KeyboardEvent(
            "keydown",
            keyEventInit,
          ),
        );
      return String(true);
    },
    {
      keyEventInit: {
        key,
        code: key,
        keyCode,
        which: keyCode,
        bubbles: true,
        ...modifiers,
      },
    },
  );
}

function clickModalButton(
  vaultId: string,
  label: string,
  documentTarget: "activeDocument" | "document" | "settings" = "activeDocument",
): Promise<boolean> {
  return obRunUntil(
    vaultId,
    ({ app, page }, { label, documentTarget }) => {
      const doc =
        documentTarget === "document"
          ? document
          : documentTarget === "settings"
            ? app.setting.containerEl.ownerDocument
            : activeDocument;
      const modal = Array.from(doc.querySelectorAll(".modal")).at(-1);
      const button = Array.from(modal?.querySelectorAll("button") ?? []).find(
        (button) => button.textContent.trim() === label,
      );
      if (!button || button.disabled) return false;
      page.press(button, label);
      return true;
    },
    { label, documentTarget },
    { what: `modal button ${label}` },
  ).then(
    () => true,
    () => false,
  );
}

/** Captures notices across the vault's open documents, including a window
 * whose closure moves the next notice to the main window. */
async function observeNotices(vaultId: string) {
  await obRun(
    vaultId,
    async ({ page }) => {
      using observers = new DisposableStack();
      const values = new Map<Element, string>();
      const documents = new Set([...page.windowDocuments(), activeDocument]);
      for (const doc of documents) {
        const previous = new Set(doc.querySelectorAll(".notice"));
        const observer = observers.adopt(
          new doc.defaultView!.MutationObserver(() => {
            for (const element of doc.querySelectorAll(".notice"))
              if (!previous.has(element))
                values.set(element, element.textContent);
          }),
          (value) => value.disconnect(),
        );
        observer.observe(doc.body, { childList: true, subtree: true });
      }
      page.scratch.notices = { observers: observers.move(), values };
      return String(true);
    },
    undefined,
  );
  return {
    async read(): Promise<string[]> {
      return JSON.parse(
        await obRun(
          vaultId,
          async ({ page }) => {
            return JSON.stringify([...page.scratch.notices!.values.values()]);
          },
          undefined,
        ),
      ) as string[];
    },
    async [Symbol.asyncDispose]() {
      await obRun(
        vaultId,
        async ({ page }) => {
          page.scratch.notices!.observers[Symbol.dispose]();
          delete page.scratch.notices;
          return String(true);
        },
        undefined,
      );
    },
  };
}

/** The Chinese Segmenter's device-wide cache directory under OPFS `zotlit/`. */

const SEGMENTER_CACHE_DIR = "chinese-segmenter";

/** Items a synthetic sync adds: the scale ADR 0069 measured at. */
const SYNTHETIC_CORPUS_SIZE = 10_000;
/** A word only synthetic Items carry. */
const SYNTHETIC_MARKER = "zqsynth";

/**
 * Deterministic synthetic titles, each with {@link SYNTHETIC_MARKER} and a
 * last word no other title has.
 */
function syntheticTitles(count: number): string[] {
  let seed = 42;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const syllables = "ka ri mo ne lu ta si po ve ga ro mi da ze nu fo".split(
    " ",
  );
  const vocabulary = Array.from({ length: 600 }, () =>
    Array.from(
      { length: 2 + (random() % 3) },
      () => syllables[random() % syllables.length],
    ).join(""),
  );
  return Array.from({ length: count }, (_, index) =>
    [
      SYNTHETIC_MARKER,
      ...Array.from(
        { length: 6 + (random() % 8) },
        () => vocabulary[random() % vocabulary.length],
      ),
      `v${index}`,
    ].join(" "),
  );
}

/**
 * Writes journal articles into the Fixture's My Library the way Zotero stores
 * them: a title, a journal, and one to three authors each. Disposing deletes
 * every row it wrote.
 */
function addMyLibraryItems(
  databasePath: string,
  titles: readonly string[],
): Disposable & { firstItemID: number } {
  using database = new DatabaseSync(databasePath);
  const id = (sql: string, ...params: string[]) =>
    Number(Object.values(database.prepare(sql).get(...params)!)[0]);
  const itemTypeID = id(
    "select itemTypeID from itemTypes where typeName = 'journalArticle'",
  );
  const field = (name: string) =>
    id("select fieldID from fieldsCombined where fieldName = ?", name);
  const titleField = field("title");
  const journalField = field("publicationTitle");
  const authorTypeID = id(
    "select creatorTypeID from creatorTypes where creatorType = 'author'",
  );
  const firstItemID = id("select max(itemID) + 1 from items");
  const firstValueID = id("select max(valueID) + 1 from itemDataValues");
  const firstCreatorID = id(
    "select coalesce(max(creatorID), 0) + 1 from creators",
  );
  const libraryID = LIBRARIES.find(
    ({ groupID }) => groupID === null,
  )!.libraryID;

  // One transaction: a failed write leaves no row behind.
  database.exec("begin");
  using rollback = new DisposableStack();
  rollback.defer(() => database.exec("rollback"));
  const value = database.prepare(
    "insert into itemDataValues (valueID, value) values (?, ?)",
  );
  // Names carry the first new itemID, so a second call writes new rows too.
  const journals = Array.from({ length: 40 }, (_, index) => {
    value.run(
      firstValueID + index,
      `${SYNTHETIC_MARKER} journal ${firstItemID + index}`,
    );
    return firstValueID + index;
  });
  const creator = database.prepare(
    "insert into creators (creatorID, firstName, lastName, fieldMode) values (?, ?, ?, 0)",
  );
  const creators = Array.from({ length: 400 }, (_, index) => {
    creator.run(
      firstCreatorID + index,
      "A.",
      `Synthauthor${firstItemID + index}`,
    );
    return firstCreatorID + index;
  });
  const item = database.prepare(
    "insert into items (itemID, itemTypeID, libraryID, key, dateAdded, dateModified, clientDateModified) values (?, ?, ?, ?, '2030-01-01 00:00:00', '2030-01-01 00:00:00', '2030-01-01 00:00:00')",
  );
  const data = database.prepare(
    "insert into itemData (itemID, fieldID, valueID) values (?, ?, ?)",
  );
  const author = database.prepare(
    "insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values (?, ?, ?, ?)",
  );
  const titleValueID = firstValueID + journals.length;
  titles.forEach((title, index) => {
    const itemID = firstItemID + index;
    item.run(itemID, itemTypeID, libraryID, zoteroKey(itemID));
    value.run(titleValueID + index, title);
    data.run(itemID, titleField, titleValueID + index);
    data.run(itemID, journalField, journals[index % journals.length]!);
    for (let order = 0; order <= index % 3; order++) {
      author.run(
        itemID,
        creators[(index * 7 + order) % creators.length]!,
        authorTypeID,
        order,
      );
    }
  });
  database.exec("commit");
  rollback.move();

  const lastItemID = firstItemID + titles.length - 1;
  return {
    firstItemID,
    [Symbol.dispose]() {
      using database = new DatabaseSync(databasePath);
      database.exec("begin");
      for (const table of ["itemCreators", "itemData", "items"])
        database
          .prepare(`delete from ${table} where itemID between ? and ?`)
          .run(firstItemID, lastItemID);
      database
        .prepare("delete from itemDataValues where valueID between ? and ?")
        .run(firstValueID, titleValueID + titles.length - 1);
      database
        .prepare("delete from creators where creatorID between ? and ?")
        .run(firstCreatorID, firstCreatorID + creators.length - 1);
      database.exec("commit");
    },
  };
}

/** A Zotero Item key, `ZQ` and six more of Zotero's key characters, one per `itemID`. */
function zoteroKey(itemID: number): string {
  const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
  let key = "";
  for (let rest = itemID, place = 0; place < 6; place++) {
    key = alphabet[rest % alphabet.length] + key;
    rest = Math.floor(rest / alphabet.length);
  }
  return `ZQ${key}`;
}

/** Tells the plugin the Zotero database changed, as the Companion's Freshness Signal does. */
async function signalDatabaseUpdated(vaultId: string): Promise<void> {
  const server = JSON.parse(
    await obRun(
      vaultId,
      async ({ zotlit }) => {
        var services = zotlit.services;
        var settings = services.bridge.runSync(services.settings.current);
        return JSON.stringify({
          hostname: settings["server.hostname"],
          port: services.bridge.runSync(services.localServer.effectivePort),
          sourceId: services.zoteroPref.sourceId,
        });
      },
      undefined,
    ),
  ) as { hostname: string; port: number; sourceId: string };
  const response = await fetch(
    `http://${server.hostname}:${server.port}/notify`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        [SOURCE_ID_HEADER]: server.sourceId,
      },
      body: JSON.stringify({ event: "db/updated" }),
    },
  );
  expect(response.status).toBe(204);
}

/**
 * The renderer's used JavaScript heap, in bytes, after a full garbage
 * collection. A Web Worker's heap is its own and stays out of this figure.
 */
async function rendererHeap(vaultId: string): Promise<number> {
  return Number(
    await obRun(
      vaultId,
      async (_context) => {
        require("v8").setFlagsFromString("--expose-gc");
        var gc = (require("vm") as typeof import("node:vm")).runInNewContext(
          "gc",
        ) as () => void;
        gc();
        gc();
        return String(process.memoryUsage().heapUsed);
      },
      undefined,
    ),
  );
}

export {
  SEGMENTER_CACHE_DIR,
  SYNTHETIC_CORPUS_SIZE,
  SYNTHETIC_MARKER,
  createFixtureNote,
  recordFrames,
  hasOneIndexedNote,
  hasIndexedNotes,
  indexedNote,
  expectedLibraryIDs,
  managedRegion,
  noteBody,
  pressPromptKey,
  selectSuggestion,
  selectItemSuggestion,
  clickModalButton,
  observeNotices,
  syntheticTitles,
  addMyLibraryItems,
  zoteroKey,
  signalDatabaseUpdated,
  rendererHeap,
};
