// Materializes the Fixture described by `spec.ts`.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import { USER_LIBRARY_ID } from "@zotlit/db";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import {
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

  writeDatabase(layout.databasePath);
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

/**
 * Zotero schema versions the Fixture claims. Inside
 * `SUPPORTED_SCHEMA_VERSIONS`, so ZotLit reads it as a supported database.
 */
const SCHEMA_VERSIONS = { userdata: 125, compatibility: 7 } as const;

const ITEM_TYPE_IDS = { journalArticle: 1, bookSection: 2 } as const;
const NOTE_ITEM_TYPE_ID = 4;
const FIELD_IDS = {
  title: 10,
  citationKey: 11,
  date: 12,
  publicationTitle: 13,
  bookTitle: 20,
} as const;
const AUTHOR_CREATOR_TYPE_ID = 1;

function containerFieldID(itemType: FixtureItem["itemType"]): number {
  return itemType === "bookSection"
    ? FIELD_IDS.bookTitle
    : FIELD_IDS.publicationTitle;
}

type Row = readonly SQLInputValue[];

function writeDatabase(databasePath: string): void {
  using db = new DatabaseSync(databasePath);
  seedDatabase(db);
}

function seedDatabase(db: DatabaseSync): void {
  createFixtureSchema(db);

  const insert = (sql: string, rows: readonly Row[]): void => {
    const statement = db.prepare(sql);
    for (const row of rows) statement.run(...row);
  };

  insert("insert into version (schema, version) values (?, ?)", [
    ["userdata", SCHEMA_VERSIONS.userdata],
    ["compatibility", SCHEMA_VERSIONS.compatibility],
  ]);

  insert(
    "insert into libraries (libraryID, type, editable, filesEditable) values (?, ?, ?, ?)",
    LIBRARIES.map((library) => [
      library.libraryID,
      library.type,
      library.editable,
      library.editable,
    ]),
  );
  insert(
    "insert into groups (groupID, libraryID, name) values (?, ?, ?)",
    LIBRARIES.filter((library) => library.groupID !== null).map((library) => [
      library.groupID,
      library.libraryID,
      library.name,
    ]),
  );

  insert("insert into itemTypes (itemTypeID, typeName) values (?, ?)", [
    [ITEM_TYPE_IDS.journalArticle, "journalArticle"],
    [ITEM_TYPE_IDS.bookSection, "bookSection"],
    [3, "attachment"],
    [NOTE_ITEM_TYPE_ID, "note"],
    [5, "annotation"],
  ]);
  insert(
    "insert into fieldsCombined (fieldID, fieldName, custom) values (?, ?, 0)",
    Object.entries(FIELD_IDS).map(([fieldName, fieldID]) => [
      fieldID,
      fieldName,
    ]),
  );
  // `bookSection.bookTitle` resolves to the `publicationTitle` base field, the
  // alias path the indexed-item reader has to walk.
  insert(
    "insert into baseFieldMappingsCombined (itemTypeID, baseFieldID, fieldID) values (?, ?, ?)",
    [
      [
        ITEM_TYPE_IDS.bookSection,
        FIELD_IDS.publicationTitle,
        FIELD_IDS.bookTitle,
      ],
    ],
  );
  insert(
    "insert into creatorTypes (creatorTypeID, creatorType) values (?, ?)",
    [[AUTHOR_CREATOR_TYPE_ID, "author"]],
  );
  insert(
    "insert into itemTypeCreatorTypes (itemTypeID, creatorTypeID, primaryField) values (?, ?, 1)",
    Object.values(ITEM_TYPE_IDS).map((itemTypeID) => [
      itemTypeID,
      AUTHOR_CREATOR_TYPE_ID,
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

  insert(
    "insert into items (itemID, itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key)" +
      " values (?, ?, ?, ?, ?, ?, ?)",
    ITEMS.map((item) => [
      item.itemID,
      ITEM_TYPE_IDS[item.itemType],
      item.dateModified,
      item.dateModified,
      item.dateModified,
      item.libraryID,
      item.key,
    ]),
  );

  insert(
    "insert into items (itemID, itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key)" +
      " values (?, ?, ?, ?, ?, ?, ?)",
    NOTES.map((note) => [
      note.itemID,
      NOTE_ITEM_TYPE_ID,
      note.dateModified,
      note.dateModified,
      note.dateModified,
      note.libraryID,
      note.key,
    ]),
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

  // One value row per (item, field) pair keeps `valueID` derivable from the
  // spec, so a rebuild reproduces the same ids without a lookup table.
  const fieldValues = ITEMS.flatMap((item) => [
    { itemID: item.itemID, fieldID: FIELD_IDS.title, value: item.title },
    { itemID: item.itemID, fieldID: FIELD_IDS.date, value: item.date },
    {
      itemID: item.itemID,
      fieldID: containerFieldID(item.itemType),
      value: item.containerTitle,
    },
    ...(item.citationKey === null
      ? []
      : [
          {
            itemID: item.itemID,
            fieldID: FIELD_IDS.citationKey,
            value: item.citationKey,
          },
        ]),
  ]);
  insert(
    "insert into itemDataValues (valueID, value) values (?, ?)",
    fieldValues.map((entry, index) => [index + 1, entry.value]),
  );
  insert(
    "insert into itemData (itemID, fieldID, valueID) values (?, ?, ?)",
    fieldValues.map((entry, index) => [entry.itemID, entry.fieldID, index + 1]),
  );

  insert(
    "insert into creators (creatorID, firstName, lastName, fieldMode) values (?, ?, ?, 0)",
    ITEMS.map((item) => [
      item.itemID,
      item.creator.firstName,
      item.creator.lastName,
    ]),
  );
  insert(
    "insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values (?, ?, ?, 0)",
    ITEMS.map((item) => [item.itemID, item.itemID, AUTHOR_CREATOR_TYPE_ID]),
  );

  insert(
    "insert into collectionItems (collectionID, itemID) values (?, ?)",
    [...ITEMS, ...NOTES].flatMap((item) =>
      item.collectionIDs.map((collectionID) => [collectionID, item.itemID]),
    ),
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
