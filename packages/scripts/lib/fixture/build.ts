// Materializes the Fixture described by `spec.ts`.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { formatIndexedKey, USER_LIBRARY_ID } from "@zotlit/db";

import { FIXTURE_PLUGIN_ID } from "./layout.ts";
import type { FixtureLayout } from "./layout.ts";
import { BETTER_BIBTEX_PREFS, QUIET_FIRST_RUN_PREFS } from "./paired-zotero.ts";
import {
  assertSchemaVersions,
  writePristineDatabase,
  writePristineStyles,
} from "./pristine.ts";
import {
  ANNOTATIONS,
  ATTACHMENTS,
  BUILD_TIMESTAMP,
  COLLECTIONS,
  createStressItems,
  DEFAULT_SCOPE_CASE,
  findScopeCase,
  INSTALLED_STYLES,
  ITEMS,
  LITERATURE_NOTE_DOCUMENTS,
  LITERATURE_NOTE_PROFILES,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
  NOTES,
} from "./spec.ts";
import type {
  FixtureAttachment,
  FixtureCreator,
  FixtureItem,
  FixtureNote,
  PersistedLibraryScope,
} from "./spec.ts";

// The spec is part of this module's public surface: one import specifier
// covers building the Fixture and reading what it is supposed to contain.
export {
  ANNOTATIONS,
  ATTACHMENTS,
  BUILD_TIMESTAMP,
  COLLECTIONS,
  createStressItems,
  DEFAULT_SCOPE_CASE,
  findScopeCase,
  INSTALLED_STYLES,
  ITEMS,
  LITERATURE_NOTE_DOCUMENTS,
  LITERATURE_NOTE_PROFILES,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
  NOTES,
  PERSONAL_SELECTOR,
  SCOPE_CASES,
  UNAVAILABLE_GROUP_IDS,
} from "./spec.ts";
export {
  DEFAULT_STRESS_ITEM_COUNT,
  STRESS_ITEM_COUNT_CONSTRAINT,
} from "./spec.ts";
export type {
  FixtureAnnotation,
  FixtureAnnotationAsset,
  FixtureAsset,
  FixtureAttachment,
  FixtureCollection,
  FixtureCreator,
  FixtureItem,
  FixtureLibrary,
  FixtureNote,
  FixtureScopeCase,
  FixtureStyle,
  LibrarySelector,
  PersistedLibraryScope,
} from "./spec.ts";
export { getFixtureLayout, getFixtureRoot } from "./layout.ts";
export type { FixtureLayout } from "./layout.ts";

export interface BuildOptions {
  /** Scope case the fresh vault starts on. */
  scopeCase?: string;
  /** Number of additive synthetic Items in an on-demand Stress Build. */
  stressItemCount?: number;
  /**
   * Built plugin bundle to copy into the vault (`apps/obsidian/dist-dev`).
   * Absent, the vault carries the Fixture's data with ZotLit neither installed
   * nor enabled, so it opens but verifies no tracer.
   */
  pluginBundleDir?: string;
  /**
   * TCP port for this build's Live Updates channel, on
   * {@link LIVE_UPDATE_HOSTNAME}. The vault binds it and the profile points the
   * Companion at it, so the two sides always agree. Absent, both keep their
   * shipped defaults, which the first ZotLit vault on the machine holds.
   */
  liveUpdatePort?: number;
  /** TCP port written to the generated Zotero profile's HTTP server pref. */
  zoteroHttpPort?: number;
  /** Development Vault root used by vault-backed linked Attachment rows. */
  linkedAttachmentVaultDir?: string;
}

/** Loopback host the vault's `server.hostname` default binds. */
export const LIVE_UPDATE_HOSTNAME = "127.0.0.1";

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
  const items =
    options.stressItemCount === undefined
      ? ITEMS
      : [...ITEMS, ...createStressItems(options.stressItemCount)];

  await rm(layout.root, { recursive: true, force: true });
  await mkdir(layout.dataDir, { recursive: true });
  await mkdir(layout.profileDir, { recursive: true });
  await writeDatabase(layout, items, options.linkedAttachmentVaultDir);
  // A Paired Zotero unpacks its bundled styles seconds after it starts, so the
  // build lays them down itself: every Fixture offers the same Citation and
  // References Style choices from the moment it exists, Zotero running or not.
  await writePristineStyles(layout.dataDir);
  await writeInstalledStyles(layout);
  await writeAttachmentFiles(layout);
  await writeAnnotationCacheFiles(layout);
  await writePrefs(layout, options);
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

const ASSET_DIR = join(import.meta.dirname, "assets");
const VAULT_PAGES_DIR = join(import.meta.dirname, "vault-pages");
const VAULT_PLUGINS_DIR = join(import.meta.dirname, "vault-plugins");

function attachmentDatabasePath(
  attachment: FixtureAttachment,
  layout: FixtureLayout,
  linkedAttachmentVaultDir = layout.vaultDir,
): string | null {
  switch (attachment.linkMode) {
    case "imported_file":
    case "imported_url":
      return `storage:${attachment.path}`;
    case "linked_file":
      return join(
        attachment.fileRoot === "vault"
          ? linkedAttachmentVaultDir
          : layout.linkedFilesDir,
        attachment.path,
      );
    case "linked_url":
      return null;
  }
}

function attachmentFilePath(
  attachment: FixtureAttachment,
  layout: FixtureLayout,
  linkedAttachmentVaultDir = layout.vaultDir,
): string | null {
  switch (attachment.linkMode) {
    case "imported_file":
    case "imported_url":
      return join(layout.dataDir, "storage", attachment.key, attachment.path);
    case "linked_file":
      return join(
        attachment.fileRoot === "vault"
          ? linkedAttachmentVaultDir
          : layout.linkedFilesDir,
        attachment.path,
      );
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

async function writeAnnotationCacheFiles(layout: FixtureLayout): Promise<void> {
  for (const annotation of ANNOTATIONS) {
    if (annotation.cacheImageAsset === null) continue;
    const groupID = LIBRARIES.find(
      (library) => library.libraryID === annotation.libraryID,
    )!.groupID;
    const libraryPath =
      groupID === null ? "library" : join("groups", String(groupID));
    const destination = join(
      layout.dataDir,
      "cache",
      libraryPath,
      `${annotation.key}.png`,
    );
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(ASSET_DIR, annotation.cacheImageAsset), destination);
  }
}

/**
 * Lay the Spec's user-installed styles down beside Zotero's bundled set, the
 * way Zotero keeps an installed style: one flat `.csl` file under `styles/`.
 */
async function writeInstalledStyles(layout: FixtureLayout): Promise<void> {
  const stylesDir = join(layout.dataDir, "styles");
  await mkdir(stylesDir, { recursive: true });
  for (const style of INSTALLED_STYLES) {
    await cp(
      join(ASSET_DIR, "styles", style.file),
      join(stylesDir, style.file),
    );
  }
}

/**
 * Lay the pristine template down and insert the Spec's rows into the copy.
 * The template carries Zotero's own schema — tables, triggers, foreign keys,
 * and the global schema's item types and fields — so the ids below are read
 * back by name rather than declared here.
 */
async function writeDatabase(
  layout: FixtureLayout,
  items: readonly FixtureItem[],
  linkedAttachmentVaultDir?: string,
): Promise<void> {
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
  db.exec("begin");
  try {
    seedDatabase(db, readSchemaIDs(db), {
      layout,
      items,
      linkedAttachmentVaultDir,
    });
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

/** The global-schema ids the Spec's rows reference, resolved by name. */
interface SchemaIDs {
  itemTypes: Record<
    FixtureItem["itemType"] | "annotation" | "attachment" | "note",
    number
  >;
  fields: Record<
    | "title"
    | "citationKey"
    | "date"
    | "publicationTitle"
    | "bookTitle"
    | "url"
    | "accessDate",
    number
  >;
  charsets: Record<"utf-8", number>;
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
      [
        "title",
        "citationKey",
        "date",
        "publicationTitle",
        "bookTitle",
        "url",
        "accessDate",
      ],
    ),
    charsets: lookup(
      "select charsetID from charsets where charset = ?",
      "charsetID",
      ["utf-8"],
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
  {
    layout,
    items,
    linkedAttachmentVaultDir,
  }: {
    layout: FixtureLayout;
    items: readonly FixtureItem[];
    linkedAttachmentVaultDir?: string;
  },
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
      dateAdded?: string;
      dateModified: string;
    },
    itemTypeID: number,
  ): Row => [
    item.itemID,
    itemTypeID,
    item.dateAdded ?? item.dateModified,
    item.dateModified,
    item.dateModified,
    item.libraryID,
    item.key,
  ];
  insert(
    "insert into items (itemID, itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key)" +
      " values (?, ?, ?, ?, ?, ?, ?)",
    [
      ...items.map((item) => itemRow(item, ids.itemTypes[item.itemType])),
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
    "insert into itemAttachments (itemID, parentItemID, linkMode, contentType, charsetID, path) values (?, ?, ?, ?, ?, ?)",
    ATTACHMENTS.map((attachment) => [
      attachment.itemID,
      attachment.parentItemID,
      ATTACHMENT_LINK_MODES[attachment.linkMode],
      attachment.contentType,
      attachment.linkMode === "imported_url" &&
      attachment.contentType === "text/html"
        ? ids.charsets["utf-8"]
        : null,
      attachmentDatabasePath(attachment, layout, linkedAttachmentVaultDir),
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

  seedItemData(insert, ids, { items, attachments: ATTACHMENTS });

  // `creators` is keyed by name across the whole database, so two items by the
  // same person would share one row. Ids follow first use, which the Spec's own
  // order fixes, so a rebuild reproduces them.
  const creators = new Map<string, FixtureCreator & { creatorID: number }>();
  for (const creator of items.flatMap((item) => item.creators)) {
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
    items.flatMap((item) =>
      item.creators.map((creator, orderIndex) => [
        item.itemID,
        creators.get(creatorKey(creator))!.creatorID,
        ids.creatorTypes[creator.creatorType],
        orderIndex,
      ]),
    ),
  );

  const tags = new Map<string, number>();
  for (const tag of items.flatMap((item) => item.tags ?? [])) {
    if (!tags.has(tag.name)) tags.set(tag.name, tags.size + 1);
  }
  insert(
    "insert into tags (tagID, name) values (?, ?)",
    [...tags].map(([name, tagID]) => [tagID, name]),
  );
  insert(
    "insert into itemTags (itemID, tagID, type) values (?, ?, ?)",
    items.flatMap((item) =>
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
    items.flatMap((item) =>
      (item.relatedKeys ?? []).map((relatedKey) => [
        item.itemID,
        relationPredicateID,
        relatedItemUri(item, relatedKey, items),
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
    [...items, ...NOTES].flatMap((item) =>
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

function relatedItemUri(
  item: FixtureItem,
  relatedKey: string,
  items: readonly FixtureItem[],
): string {
  const target = items.find(
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
  {
    items,
    attachments,
  }: {
    items: readonly FixtureItem[];
    attachments: readonly FixtureAttachment[];
  },
): void {
  const fieldValues = [
    ...items.flatMap((item) => [
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
    ]),
    ...attachments.flatMap((attachment) => [
      {
        itemID: attachment.itemID,
        fieldID: ids.fields.title,
        value: attachment.title,
      },
      ...(attachment.url === null
        ? []
        : [
            {
              itemID: attachment.itemID,
              fieldID: ids.fields.url,
              value: attachment.url,
            },
            {
              itemID: attachment.itemID,
              fieldID: ids.fields.accessDate,
              value: attachment.dateModified,
            },
          ]),
    ]),
  ];

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
 * launches on it. Port overrides also configure the Companion's notify URL and
 * Zotero's HTTP server for a Paired Run.
 */
function writePrefs(
  layout: FixtureLayout,
  options: BuildOptions,
): Promise<void> {
  const lines = [
    'user_pref("extensions.zotero.useDataDir", true);',
    `user_pref("extensions.zotero.dataDir", ${JSON.stringify(layout.dataDir)});`,
    ...QUIET_FIRST_RUN_PREFS,
    ...BETTER_BIBTEX_PREFS,
    ...(options.zoteroHttpPort === undefined
      ? []
      : [
          `user_pref("extensions.zotero.httpServer.port", ${options.zoteroHttpPort});`,
        ]),
    ...(options.liveUpdatePort === undefined
      ? []
      : [
          // The master switch is the Companion's counterpart to the vault's
          // `server.enabled`: it gates every outbound notification at emit
          // time, so a Paired Run needs it on to exercise Live Updates.
          'user_pref("extensions.zotlit.notify", true);',
          `user_pref("extensions.zotlit.notify-url", "http://${LIVE_UPDATE_HOSTNAME}:${options.liveUpdatePort}");`,
        ]),
    "",
  ];
  return writeFile(join(layout.profileDir, "prefs.js"), lines.join("\n"));
}

/** ZotLit's settings version, so the vault loads without a migration pass. */
const SETTINGS_VERSION = 10;

async function writeVault(
  layout: FixtureLayout,
  options: BuildOptions,
): Promise<void> {
  const configDir = join(layout.vaultDir, ".obsidian");
  await mkdir(layout.pluginDir, { recursive: true });
  await mkdir(join(layout.vaultDir, "literatures"), { recursive: true });
  await mkdir(join(layout.vaultDir, "templates"), { recursive: true });
  await mkdir(join(layout.vaultDir, "zotero_notes"), { recursive: true });

  await writeJson(join(configDir, "app.json"), {});
  // Native menus interfere with automated Paired Run / E2E flows on
  // Windows, so the seed disables them.
  await writeJson(join(configDir, "appearance.json"), { nativeMenus: false });
  // Obsidian errors on an enabled plugin whose folder holds no bundle, so the
  // enabled list names ZotLit only when the copy below installs it.
  await writeJson(join(configDir, "community-plugins.json"), [
    "hot-reload",
    ...(options.pluginBundleDir ? [FIXTURE_PLUGIN_ID] : []),
  ]);
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
  await cp(VAULT_PAGES_DIR, layout.vaultDir, { recursive: true });
  await cp(
    join(VAULT_PLUGINS_DIR, "hot-reload"),
    join(configDir, "plugins", "hot-reload"),
    { recursive: true },
  );
  for (const document of LITERATURE_NOTE_DOCUMENTS) {
    await writeFile(
      join(layout.vaultDir, "templates", document.filename),
      document.source,
    );
  }

  const scope: PersistedLibraryScope = findScopeCase(
    options.scopeCase ?? DEFAULT_SCOPE_CASE,
  ).scope;

  // Literature Notes for the My Library items give an update batch existing
  // notes to act on and leave every other Fixture item as create work.
  for (const item of ITEMS.filter(
    (candidate) => candidate.libraryID === USER_LIBRARY_ID,
  )) {
    await writeFile(
      join(
        layout.vaultDir,
        "literatures",
        `${item.literatureNoteName ?? item.key}.md`,
      ),
      literatureNote(item, layout, options.linkedAttachmentVaultDir),
    );
  }

  for (const note of NOTES.filter(
    (candidate) => candidate.parentItemID !== null && !candidate.trashed,
  )) {
    if (note.importedNoteBody === null) {
      throw new Error(`Child Note ${note.key} needs an Imported Note body`);
    }
    const indexedKey = fixtureIndexedKey(note);
    await writeFile(
      join(layout.vaultDir, "zotero_notes", `${indexedKey}.md`),
      importedNote(note, indexedKey, note.importedNoteBody),
    );
  }

  if (options.pluginBundleDir) {
    await cp(options.pluginBundleDir, layout.pluginDir, { recursive: true });
  }

  // After the bundle copy: a Paired Run passes a Development Vault's plugin
  // folder as the bundle, and that folder carries the settings ZotLit last
  // saved there. The generated settings are the ones this build promises.
  await writeJson(layout.pluginDataPath, {
    __VERSION__: SETTINGS_VERSION,
    "note.default-profile": {
      bindings: {
        "note.literature-folder": "literatures",
        "citation.references-style": null,
        "note.import-folder": "zotero_notes",
        "note.import-colored-highlights": false,
        "note.import-annotations-as-template": false,
      },
    },
    "note.profiles": LITERATURE_NOTE_PROFILES,
    "server.enabled": true,
    ...(options.liveUpdatePort === undefined
      ? {}
      : { "server.port": options.liveUpdatePort }),
    [LIBRARY_SCOPE_SETTING_KEY]: scope,
  });
}

function literatureNote(
  item: FixtureItem,
  layout: FixtureLayout,
  linkedAttachmentVaultDir?: string,
): string {
  const attachments = ATTACHMENTS.filter(
    (attachment) =>
      attachment.parentItemID === item.itemID &&
      attachment.sourceAsset !== null,
  ).map((attachment) => {
    const path = attachmentFilePath(
      attachment,
      layout,
      linkedAttachmentVaultDir,
    )!;
    return `[${attachment.path}](${pathToFileURL(path).href})`;
  });
  return [
    "---",
    `title: ${JSON.stringify(item.title)}`,
    `zotero-key: ${item.key}`,
    // `citekey` is the compatibility frontmatter key ZotLit still reads.
    ...(item.citationKey === null ? [] : [`citekey: ${item.citationKey}`]),
    "---",
    `# ${item.title}`,
    "",
    ...attachments,
    ...(attachments.length === 0 ? [] : [""]),
  ].join("\n");
}

function fixtureIndexedKey(note: FixtureNote): string {
  const groupID = LIBRARIES.find(
    (library) => library.libraryID === note.libraryID,
  )!.groupID;
  return formatIndexedKey(note.key, groupID);
}

function importedNote(
  note: FixtureNote,
  indexedKey: string,
  body: string,
): string {
  const instant = `${note.dateModified.replace(" ", "T")}Z`;
  return [
    "---",
    `date: ${instant}`,
    `zotero-note-key: ${indexedKey}`,
    `zotero-lastmod: ${instant}`,
    "---",
    body,
    "",
  ].join("\n");
}

function writeJson(path: string, value: unknown): Promise<void> {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
