// Materializes the Fixture described by `spec.ts`.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import { USER_LIBRARY_ID } from "@zotlit/db";

import { QUIET_FIRST_RUN_PREFS } from "./paired-zotero.ts";
import { assertSchemaVersions, writePristineDatabase } from "./pristine.ts";
import {
  ANNOTATIONS,
  ATTACHMENTS,
  BUILD_TIMESTAMP,
  COLLECTIONS,
  DEFAULT_SCOPE_CASE,
  findScopeCase,
  ITEMS,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
  NOTES,
} from "./spec.ts";
import type {
  FixtureAttachment,
  FixtureCreator,
  FixtureItem,
  PersistedLibraryScope,
} from "./spec.ts";

// The spec is part of this module's public surface: one import specifier
// covers building the Fixture and reading what it is supposed to contain.
export {
  ANNOTATIONS,
  ATTACHMENTS,
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
  FixtureAnnotation,
  FixtureAsset,
  FixtureAttachment,
  FixtureCollection,
  FixtureCreator,
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
  /** Host-native files referenced by `linked_file` Attachment rows. */
  linkedFilesDir: string;
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
    linkedFilesDir: join(root, "linked-files"),
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

  await writeDatabase(layout);
  await writeAttachmentFiles(layout);
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

const ATTACHMENT_LINK_MODES = {
  imported_file: 0,
  imported_url: 1,
  linked_file: 2,
  linked_url: 3,
} as const;

const ASSET_DIR = join(import.meta.dirname, "assets", "sakimas-song");

function attachmentDatabasePath(
  attachment: FixtureAttachment,
  layout: FixtureLayout,
): string {
  switch (attachment.linkMode) {
    case "imported_file":
    case "imported_url":
      return `storage:${attachment.path}`;
    case "linked_file":
      return join(layout.linkedFilesDir, attachment.path);
    case "linked_url":
      return attachment.path;
  }
}

function attachmentFilePath(
  attachment: FixtureAttachment,
  layout: FixtureLayout,
): string | null {
  switch (attachment.linkMode) {
    case "imported_file":
    case "imported_url":
      return join(layout.dataDir, "storage", attachment.key, attachment.path);
    case "linked_file":
      return join(layout.linkedFilesDir, attachment.path);
    case "linked_url":
      return null;
  }
}

async function writeAttachmentFiles(layout: FixtureLayout): Promise<void> {
  for (const attachment of ATTACHMENTS) {
    if (attachment.sourceAsset === null) continue;
    const destination = attachmentFilePath(attachment, layout)!;
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(ASSET_DIR, attachment.sourceAsset), destination);
  }
}

/**
 * Lay the pristine template down and insert the Spec's rows into the copy.
 * The template carries Zotero's own schema — tables, triggers, foreign keys,
 * and the global schema's item types and fields — so the ids below are read
 * back by name rather than declared here.
 */
async function writeDatabase(layout: FixtureLayout): Promise<void> {
  await writePristineDatabase(layout.databasePath);
  using db = new DatabaseSync(layout.databasePath);
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
  seedDatabase(db, readSchemaIDs(db), layout);
}

/** The global-schema ids the Spec's rows reference, resolved by name. */
interface SchemaIDs {
  itemTypes: Record<
    FixtureItem["itemType"] | "annotation" | "attachment" | "note",
    number
  >;
  fields: Record<
    "title" | "citationKey" | "date" | "publicationTitle" | "bookTitle",
    number
  >;
  creatorTypes: Record<FixtureCreator["creatorType"], number>;
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
      ["journalArticle", "bookSection", "note", "attachment", "annotation"],
    ),
    fields: lookup(
      "select fieldID from fieldsCombined where fieldName = ?",
      "fieldID",
      ["title", "citationKey", "date", "publicationTitle", "bookTitle"],
    ),
    creatorTypes: lookup(
      "select creatorTypeID from creatorTypes where creatorType = ?",
      "creatorTypeID",
      ["author", "contributor", "editor"],
    ),
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

function seedDatabase(
  db: DatabaseSync,
  ids: SchemaIDs,
  layout: FixtureLayout,
): void {
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
      ...ATTACHMENTS.map((attachment) =>
        itemRow(attachment, ids.itemTypes.attachment),
      ),
      ...ANNOTATIONS.map((annotation) =>
        itemRow(annotation, ids.itemTypes.annotation),
      ),
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
  insert(
    "insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path) values (?, ?, ?, ?, ?)",
    ATTACHMENTS.map((attachment) => [
      attachment.itemID,
      attachment.parentItemID,
      ATTACHMENT_LINK_MODES[attachment.linkMode],
      attachment.contentType,
      attachmentDatabasePath(attachment, layout),
    ]),
  );
  insert(
    "insert into itemAnnotations (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex, position, isExternal)" +
      " values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
    ANNOTATIONS.map((annotation) => [
      annotation.itemID,
      annotation.parentItemID,
      annotation.type,
      annotation.text,
      annotation.comment,
      annotation.color,
      annotation.pageLabel,
      annotation.sortIndex,
      JSON.stringify(annotation.position),
    ]),
  );

  seedItemData(insert, ids);

  // `creators` is keyed by name across the whole database, so two items by the
  // same person would share one row. Ids follow first use, which the Spec's own
  // order fixes, so a rebuild reproduces them.
  const creators = new Map<string, FixtureCreator & { creatorID: number }>();
  for (const creator of ITEMS.flatMap((item) => item.creators)) {
    const key = creatorKey(creator);
    if (!creators.has(key)) {
      creators.set(key, { creatorID: creators.size + 1, ...creator });
    }
  }
  insert(
    "insert into creators (creatorID, firstName, lastName, fieldMode) values (?, ?, ?, ?)",
    [...creators.values()].map((creator) => [
      creator.creatorID,
      creator.firstName,
      creator.lastName,
      creator.fieldMode,
    ]),
  );
  insert(
    "insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values (?, ?, ?, ?)",
    ITEMS.flatMap((item) =>
      item.creators.map((creator, orderIndex) => [
        item.itemID,
        creators.get(creatorKey(creator))!.creatorID,
        ids.creatorTypes[creator.creatorType],
        orderIndex,
      ]),
    ),
  );

  const tags = new Map<string, number>();
  for (const tag of ITEMS.flatMap((item) => item.tags ?? [])) {
    if (!tags.has(tag.name)) tags.set(tag.name, tags.size + 1);
  }
  insert(
    "insert into tags (tagID, name) values (?, ?)",
    [...tags].map(([name, tagID]) => [tagID, name]),
  );
  insert(
    "insert into itemTags (itemID, tagID, type) values (?, ?, ?)",
    ITEMS.flatMap((item) =>
      (item.tags ?? []).map((tag) => [
        item.itemID,
        tags.get(tag.name)!,
        tag.type,
      ]),
    ),
  );

  const relationPredicateID = ensureRelationPredicate(db);
  insert(
    "insert into itemRelations (itemID, predicateID, object) values (?, ?, ?)",
    ITEMS.flatMap((item) =>
      (item.relatedKeys ?? []).map((relatedKey) => [
        item.itemID,
        relationPredicateID,
        relatedItemUri(item, relatedKey),
      ]),
    ),
  );

  insert(
    "insert into deletedItems (itemID, dateDeleted) values (?, ?)",
    NOTES.filter((note) => note.trashed).map((note) => [
      note.itemID,
      note.dateModified,
    ]),
  );

  insert(
    "insert into collectionItems (collectionID, itemID) values (?, ?)",
    [...ITEMS, ...NOTES].flatMap((item) =>
      item.collectionIDs.map((collectionID) => [collectionID, item.itemID]),
    ),
  );
}

/** `creators` is unique on `(lastName, firstName, fieldMode)`. */
function creatorKey({
  firstName,
  lastName,
  fieldMode,
}: FixtureCreator): string {
  return JSON.stringify([lastName, firstName, fieldMode]);
}

function ensureRelationPredicate(db: DatabaseSync): number {
  const existing = db
    .prepare(
      "select predicateID from relationPredicates where predicate = 'dc:relation'",
    )
    .get() as { predicateID: number } | undefined;
  if (existing) return existing.predicateID;

  const { predicateID } = db
    .prepare(
      "select coalesce(max(predicateID), 0) + 1 as predicateID from relationPredicates",
    )
    .get() as { predicateID: number };
  db.prepare(
    "insert into relationPredicates (predicateID, predicate) values (?, 'dc:relation')",
  ).run(predicateID);
  return predicateID;
}

function relatedItemUri(item: FixtureItem, relatedKey: string): string {
  const target = ITEMS.find(
    (candidate) =>
      candidate.libraryID === item.libraryID && candidate.key === relatedKey,
  );
  if (!target) {
    throw new Error(
      `Related Item ${relatedKey} is not in library ${item.libraryID}.`,
    );
  }
  const library = LIBRARIES.find(
    (candidate) => candidate.libraryID === item.libraryID,
  )!;
  return library.groupID === null
    ? `http://zotero.org/users/local/fixture/items/${target.key}`
    : `http://zotero.org/groups/${library.groupID}/items/${target.key}`;
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
 * profile-directory override in ZotLit switches the whole install over. The
 * same profile carries {@link QUIET_FIRST_RUN_PREFS}, because a Paired Zotero
 * launches on it.
 */
function writePrefs(layout: FixtureLayout): Promise<void> {
  const lines = [
    'user_pref("extensions.zotero.useDataDir", true);',
    `user_pref("extensions.zotero.dataDir", ${JSON.stringify(layout.dataDir)});`,
    ...QUIET_FIRST_RUN_PREFS,
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
