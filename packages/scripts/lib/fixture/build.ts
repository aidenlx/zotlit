// Materializes the Fixture described by `spec.ts`.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import { USER_LIBRARY_ID } from "@zotlit/db";

import { assertSchemaVersions, writePristineDatabase } from "./pristine.ts";
import {
  BUILD_TIMESTAMP,
  COLLECTIONS,
  DEFAULT_SCOPE_CASE,
  findScopeCase,
  ITEMS,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
  NOTES,
} from "./spec.ts";
import type { FixtureItem, PersistedLibraryScope } from "./spec.ts";

// The spec is part of this module's public surface: one import specifier
// covers building the Fixture and reading what it is supposed to contain.
export {
  BUILD_TIMESTAMP,
  COLLECTIONS,
  DEFAULT_SCOPE_CASE,
  findScopeCase,
  ITEMS,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
  NOTES,
  PERSONAL_SELECTOR,
  SCOPE_CASES,
  UNAVAILABLE_GROUP_IDS,
} from "./spec.ts";
export type {
  FixtureCollection,
  FixtureItem,
  FixtureLibrary,
  FixtureNote,
  FixtureScopeCase,
  LibrarySelector,
  PersistedLibraryScope,
} from "./spec.ts";

/** Every path a maintainer or a test needs from a built Fixture. */
export interface FixtureLayout {
  /** The whole disposable tree — `discardFixture` removes exactly this. */
  root: string;
  /** Stands in for a Zotero data directory; holds `zotero.sqlite`. */
  dataDir: string;
  databasePath: string;
  /** Stands in for a Zotero profile directory; its `prefs.js` names `dataDir`. */
  profileDir: string;
  vaultDir: string;
  pluginDir: string;
  pluginDataPath: string;
}

const PLUGIN_ID = "zotlit";

/** Where the Fixture lives, under the workspace scratch area (git-ignored). */
export function getFixtureRoot(workspaceRoot: string): string {
  return join(workspaceRoot, "tmp", "acceptance-fixture");
}

export function getFixtureLayout(root: string): FixtureLayout {
  const dataDir = join(root, "zotero-data");
  const vaultDir = join(root, "zt-fixture-vault");
  const pluginDir = join(vaultDir, ".obsidian", "plugins", PLUGIN_ID);
  return {
    root,
    dataDir,
    databasePath: join(dataDir, "zotero.sqlite"),
    profileDir: join(root, "zotero-profile"),
    vaultDir,
    pluginDir,
    pluginDataPath: join(pluginDir, "data.json"),
  };
}

export interface BuildOptions {
  /** Scope case the fresh vault starts on. */
  scopeCase?: string;
  /**
   * Built plugin bundle to copy into the vault (`apps/obsidian/dist-dev`).
   * Absent, the vault carries the Fixture's data with ZotLit neither installed
   * nor enabled, so it opens but verifies no tracer.
   */
  pluginBundleDir?: string;
}

/**
 * Write the throwaway Zotero data directory, the profile that points at it,
 * and the throwaway Obsidian vault. Removes whatever sits at `layout.root`
 * first, so a rebuild reproduces the spec rather than merging into an older
 * shape.
 */
export async function buildFixture(
  layout: FixtureLayout,
  options: BuildOptions = {},
): Promise<void> {
  await rm(layout.root, { recursive: true, force: true });
  await mkdir(layout.dataDir, { recursive: true });
  await mkdir(layout.profileDir, { recursive: true });

  await writeDatabase(layout.databasePath);
  await writePrefs(layout);
  await writeVault(layout, options);
}

/** Rewrite only the saved Library Scope of an already-built vault. */
export async function selectScopeCase(
  layout: FixtureLayout,
  id: string,
): Promise<void> {
  const raw = await readFile(layout.pluginDataPath, "utf-8").catch(() => {
    throw new Error(`no Fixture Vault at ${layout.vaultDir}. Build it first.`);
  });
  const data = JSON.parse(raw) as Record<string, unknown>;
  data[LIBRARY_SCOPE_SETTING_KEY] = findScopeCase(id).scope;
  await writeJson(layout.pluginDataPath, data);
}

export async function discardFixture(layout: FixtureLayout): Promise<void> {
  await rm(layout.root, { recursive: true, force: true });
}

type Row = readonly SQLInputValue[];

/**
 * Lay the pristine template down and insert the Spec's rows into the copy.
 * The template carries Zotero's own schema — tables, triggers, foreign keys,
 * and the global schema's item types and fields — so the ids below are read
 * back by name rather than declared here.
 */
async function writeDatabase(databasePath: string): Promise<void> {
  await writePristineDatabase(databasePath);
  using db = new DatabaseSync(databasePath);
  // A user-defined function shadows the `CURRENT_TIMESTAMP` keyword on this
  // connection, column defaults included, so a stamp the Spec forgets lands on
  // a fixed value rather than the time of the build. The connection closes with
  // this scope, so a Paired Zotero that opens the file later keeps a real clock.
  db.function(
    "current_timestamp",
    { deterministic: true },
    () => BUILD_TIMESTAMP,
  );
  assertSchemaVersions(db);
  seedDatabase(db, readSchemaIDs(db));
}

/** The global-schema ids the Spec's rows reference, resolved by name. */
interface SchemaIDs {
  itemTypes: Record<FixtureItem["itemType"] | "note", number>;
  fields: Record<
    "title" | "citationKey" | "date" | "publicationTitle" | "bookTitle",
    number
  >;
  authorCreatorType: number;
}

function readSchemaIDs(db: DatabaseSync): SchemaIDs {
  const lookup = <T extends string>(
    sql: string,
    column: string,
    names: readonly T[],
  ): Record<T, number> => {
    const statement = db.prepare(sql);
    return Object.fromEntries(
      names.map((name) => {
        const row = statement.get(name) as Record<string, number> | undefined;
        const id = row?.[column];
        if (id === undefined) {
          throw new Error(
            `the pristine template carries no "${name}" in its global schema.`,
          );
        }
        return [name, id];
      }),
    ) as Record<T, number>;
  };

  return {
    itemTypes: lookup(
      "select itemTypeID from itemTypesCombined where typeName = ?",
      "itemTypeID",
      ["journalArticle", "bookSection", "note"],
    ),
    fields: lookup(
      "select fieldID from fieldsCombined where fieldName = ?",
      "fieldID",
      ["title", "citationKey", "date", "publicationTitle", "bookTitle"],
    ),
    authorCreatorType: lookup(
      "select creatorTypeID from creatorTypes where creatorType = ?",
      "creatorTypeID",
      ["author"],
    ).author,
  };
}

function containerFieldID(
  ids: SchemaIDs,
  itemType: FixtureItem["itemType"],
): number {
  return itemType === "bookSection"
    ? ids.fields.bookTitle
    : ids.fields.publicationTitle;
}

function seedDatabase(db: DatabaseSync, ids: SchemaIDs): void {
  const insert = (sql: string, rows: readonly Row[]): void => {
    const statement = db.prepare(sql);
    for (const row of rows) statement.run(...row);
  };

  // Zotero's first run already created My Library, so the Spec's row for it
  // updates that row instead of colliding with it.
  insert(
    "insert into libraries (libraryID, type, editable, filesEditable) values (?, ?, ?, ?)" +
      " on conflict (libraryID) do update set type = excluded.type," +
      " editable = excluded.editable, filesEditable = excluded.filesEditable",
    LIBRARIES.map((library) => [
      library.libraryID,
      library.type,
      library.editable,
      library.editable,
    ]),
  );
  insert(
    "insert into groups (groupID, libraryID, name, description, version) values (?, ?, ?, '', 0)",
    LIBRARIES.filter((library) => library.groupID !== null).map((library) => [
      library.groupID,
      library.libraryID,
      library.name,
    ]),
  );

  insert(
    "insert into collections (collectionID, collectionName, libraryID, key) values (?, ?, ?, ?)",
    COLLECTIONS.map((collection) => [
      collection.collectionID,
      collection.name,
      collection.libraryID,
      collection.key,
    ]),
  );

  const itemRow = (
    item: {
      itemID: number;
      libraryID: number;
      key: string;
      dateModified: string;
    },
    itemTypeID: number,
  ): Row => [
    item.itemID,
    itemTypeID,
    item.dateModified,
    item.dateModified,
    item.dateModified,
    item.libraryID,
    item.key,
  ];
  insert(
    "insert into items (itemID, itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key)" +
      " values (?, ?, ?, ?, ?, ?, ?)",
    [
      ...ITEMS.map((item) => itemRow(item, ids.itemTypes[item.itemType])),
      ...NOTES.map((note) => itemRow(note, ids.itemTypes.note)),
    ],
  );
  insert(
    "insert into itemNotes (itemID, parentItemID, note, title) values (?, ?, ?, ?)",
    NOTES.map((note) => [
      note.itemID,
      note.parentItemID,
      note.note,
      note.title,
    ]),
  );

  seedItemData(insert, ids);

  // `creators` is keyed by name across the whole database, so two items by the
  // same person would share one row. Ids follow first use, which the Spec's own
  // order fixes, so a rebuild reproduces them.
  const creators = new Map<string, FixtureCreator & { creatorID: number }>();
  for (const { creator } of ITEMS) {
    const key = creatorKey(creator);
    if (!creators.has(key)) {
      creators.set(key, { creatorID: creators.size + 1, ...creator });
    }
  }
  insert(
    "insert into creators (creatorID, firstName, lastName, fieldMode) values (?, ?, ?, 0)",
    [...creators.values()].map((creator) => [
      creator.creatorID,
      creator.firstName,
      creator.lastName,
    ]),
  );
  insert(
    "insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values (?, ?, ?, 0)",
    ITEMS.map((item) => [
      item.itemID,
      creators.get(creatorKey(item.creator))!.creatorID,
      ids.authorCreatorType,
    ]),
  );

  insert(
    "insert into collectionItems (collectionID, itemID) values (?, ?)",
    [...ITEMS, ...NOTES].flatMap((item) =>
      item.collectionIDs.map((collectionID) => [collectionID, item.itemID]),
    ),
  );
}

type FixtureCreator = FixtureItem["creator"];

/** `creators` is unique on `(lastName, firstName, fieldMode)`, all fieldMode 0. */
function creatorKey({ firstName, lastName }: FixtureCreator): string {
  return JSON.stringify([lastName, firstName]);
}

/**
 * `itemDataValues.value` is unique across the database, so repeated titles,
 * dates, and container names share one value row. Ids follow first use, which
 * the Spec's own order fixes, so a rebuild reproduces them.
 *
 * `valueNormalized` stays unset: Zotero itself leaves it null whenever the
 * normalized form matches the ASCII-lowercased value, which holds for every
 * ASCII value the Spec carries. Search reads `coalesce(valueNormalized, value)`.
 */
function seedItemData(
  insert: (sql: string, rows: readonly Row[]) => void,
  ids: SchemaIDs,
): void {
  const fieldValues = ITEMS.flatMap((item) => [
    { itemID: item.itemID, fieldID: ids.fields.title, value: item.title },
    { itemID: item.itemID, fieldID: ids.fields.date, value: item.date },
    {
      itemID: item.itemID,
      fieldID: containerFieldID(ids, item.itemType),
      value: item.containerTitle,
    },
    ...(item.citationKey === null
      ? []
      : [
          {
            itemID: item.itemID,
            fieldID: ids.fields.citationKey,
            value: item.citationKey,
          },
        ]),
  ]);

  const valueIDs = new Map<string, number>();
  for (const { value } of fieldValues) {
    if (!valueIDs.has(value)) valueIDs.set(value, valueIDs.size + 1);
  }
  insert(
    "insert into itemDataValues (valueID, value) values (?, ?)",
    [...valueIDs].map(([value, valueID]) => [valueID, value]),
  );
  insert(
    "insert into itemData (itemID, fieldID, valueID) values (?, ?, ?)",
    fieldValues.map((entry) => [
      entry.itemID,
      entry.fieldID,
      valueIDs.get(entry.value)!,
    ]),
  );
}

/**
 * A Zotero profile whose prefs point at the Fixture's data directory, so one
 * profile-directory override in ZotLit switches the whole install over.
 */
function writePrefs(layout: FixtureLayout): Promise<void> {
  const lines = [
    'user_pref("extensions.zotero.useDataDir", true);',
    `user_pref("extensions.zotero.dataDir", ${JSON.stringify(layout.dataDir)});`,
    "",
  ];
  return writeFile(join(layout.profileDir, "prefs.js"), lines.join("\n"));
}

/** ZotLit's settings version, so the vault loads without a migration pass. */
const SETTINGS_VERSION = 9;

async function writeVault(
  layout: FixtureLayout,
  options: BuildOptions,
): Promise<void> {
  const configDir = join(layout.vaultDir, ".obsidian");
  await mkdir(layout.pluginDir, { recursive: true });
  await mkdir(join(layout.vaultDir, "literatures"), { recursive: true });

  await writeJson(join(configDir, "app.json"), {});
  await writeJson(join(configDir, "appearance.json"), {});
  // Obsidian errors on an enabled plugin whose folder holds no bundle, so the
  // enabled list names ZotLit only when the copy below installs it.
  await writeJson(
    join(configDir, "community-plugins.json"),
    options.pluginBundleDir ? [PLUGIN_ID] : [],
  );
  await writeJson(join(configDir, "core-plugins.json"), {
    "file-explorer": true,
    "global-search": true,
    switcher: true,
    backlink: true,
    "outgoing-link": true,
    properties: true,
    "page-preview": true,
    "command-palette": true,
    "editor-status": true,
    outline: true,
  });

  const scope: PersistedLibraryScope = findScopeCase(
    options.scopeCase ?? DEFAULT_SCOPE_CASE,
  ).scope;
  await writeJson(layout.pluginDataPath, {
    __VERSION__: SETTINGS_VERSION,
    "note.literature-folder": "literatures",
    "note.import-folder": "zotero_notes",
    "server.enabled": true,
    [LIBRARY_SCOPE_SETTING_KEY]: scope,
  });

  // Literature Notes for the My Library items give an update batch existing
  // notes to act on and leave every other Fixture item as create work.
  for (const item of ITEMS.filter(
    (candidate) => candidate.libraryID === USER_LIBRARY_ID,
  )) {
    await writeFile(
      join(layout.vaultDir, "literatures", `${item.key}.md`),
      literatureNote(item),
    );
  }

  if (options.pluginBundleDir) {
    await cp(options.pluginBundleDir, layout.pluginDir, { recursive: true });
  }
}

function literatureNote(item: FixtureItem): string {
  return [
    "---",
    `title: ${JSON.stringify(item.title)}`,
    `zotero-key: ${item.key}`,
    // `citekey` is the compatibility frontmatter key ZotLit still reads.
    ...(item.citationKey === null ? [] : [`citekey: ${item.citationKey}`]),
    "---",
    `# ${item.title}`,
    "",
  ].join("\n");
}

function writeJson(path: string, value: unknown): Promise<void> {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
