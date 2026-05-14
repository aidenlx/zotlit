import {
  sqliteTable,
  type AnySQLiteColumn,
  primaryKey,
  index,
  unique,
  integer,
  text,
  customType,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { Temporal } from "@zotlit/shared/temporal";

type SqliteAnyOut =
  | null
  | number
  // | bigint enable this if ever enable readBigInts
  | string
  | Uint8Array;
type SqliteAnyIn =
  | null
  | number
  | bigint
  | string
  | NodeJS.TypedArray
  | DataView;

export const sqliteAny = customType<{
  data: SqliteAnyOut;
  driverData: SqliteAnyIn;
}>({
  dataType() {
    return "";
  },
});

// Zotero stores all date columns as UTC strings ("YYYY-MM-DD HH:MM:SS"),
// produced by SQLite's CURRENT_TIMESTAMP and Zotero.Date.dateToSQL(d, true).
const sqlDateMapping = {
  fromDriver: (s: string) => Temporal.Instant.from(`${s.replace(" ", "T")}Z`),
  toDriver: (i: Temporal.Instant) =>
    i.toString({ smallestUnit: "second" }).slice(0, -1).replace("T", " "),
} as const;

export const timestamp = customType<{
  data: Temporal.Instant;
  driverData: string;
}>({
  dataType: () => "TIMESTAMP",
  ...sqlDateMapping,
});

// Columns declared in Zotero's schema with no type (e.g. `dateDeleted DEFAULT
// CURRENT_TIMESTAMP NOT NULL`, `itemDataValues.value UNIQUE`). The stored
// value is typically a TIMESTAMP/text string; SQLite gives the column NONE
// affinity so it can hold any storage class.
export const noType = customType<{ data: string; driverData: string }>({
  dataType: () => "",
});

// noType columns whose values are TIMESTAMP-format strings (e.g. dateDeleted).
export const noTypeDate = customType<{
  data: Temporal.Instant;
  driverData: string;
}>({
  dataType: () => "",
  ...sqlDateMapping,
});

// Foreign-key columns Zotero declares without a type that always reference an
// INTEGER PRIMARY KEY (e.g. `itemData.valueID` -> `itemDataValues.valueID`).
export const noTypeInt = customType<{ data: number; driverData: number }>({
  dataType: () => "",
});

export const noneType = customType<{ data: number; driverData: number }>({
  dataType: () => "NONE",
});

const currentTimestamp = sql`CURRENT_TIMESTAMP`;

export const fieldFormats = sqliteTable("fieldFormats", {
  fieldFormatID: integer().primaryKey(),
  regex: text(),
  isInteger: integer(),
});

export const charsets = sqliteTable(
  "charsets",
  {
    charsetID: integer().primaryKey(),
    charset: text(),
  },
  (table) => [
    index("charsets_charset").on(table.charset),
    unique("charsets_charset_unique").on(table.charset),
  ],
);

export const fileTypes = sqliteTable(
  "fileTypes",
  {
    fileTypeID: integer().primaryKey(),
    fileType: text(),
  },
  (table) => [
    index("fileTypes_fileType").on(table.fileType),
    unique("fileTypes_fileType_unique").on(table.fileType),
  ],
);

export const fileTypeMimeTypes = sqliteTable(
  "fileTypeMimeTypes",
  {
    fileTypeID: integer().references(() => fileTypes.fileTypeID),
    mimeType: text(),
  },
  (table) => [
    index("fileTypeMimeTypes_mimeType").on(table.mimeType),
    primaryKey({
      columns: [table.fileTypeID, table.mimeType],
      name: "fileTypeMimeTypes_pk",
    }),
  ],
);

export const syncObjectTypes = sqliteTable(
  "syncObjectTypes",
  {
    syncObjectTypeID: integer().primaryKey(),
    name: text(),
  },
  (table) => [index("syncObjectTypes_name").on(table.name)],
);

export const itemTypes = sqliteTable("itemTypes", {
  itemTypeID: integer().primaryKey(),
  typeName: text(),
  templateItemTypeID: integer(),
  display: integer().default(1),
});

export const itemTypesCombined = sqliteTable("itemTypesCombined", {
  itemTypeID: integer().primaryKey(),
  typeName: text().notNull(),
  display: integer().default(1).notNull(),
  custom: integer().notNull(),
});

export const fields = sqliteTable("fields", {
  fieldID: integer().primaryKey(),
  fieldName: text(),
  fieldFormatID: integer().references(() => fieldFormats.fieldFormatID),
});

export const fieldsCombined = sqliteTable("fieldsCombined", {
  fieldID: integer().primaryKey(),
  fieldName: text().notNull(),
  label: text(),
  fieldFormatID: integer(),
  custom: integer().notNull(),
});

export const itemTypeFields = sqliteTable(
  "itemTypeFields",
  {
    itemTypeID: integer().references(() => itemTypes.itemTypeID),
    fieldID: integer().references(() => fields.fieldID),
    hide: integer(),
    orderIndex: integer(),
  },
  (table) => [
    index("itemTypeFields_fieldID").on(table.fieldID),
    primaryKey({
      columns: [table.itemTypeID, table.orderIndex],
      name: "itemTypeFields_pk",
    }),
  ],
);

export const itemTypeFieldsCombined = sqliteTable(
  "itemTypeFieldsCombined",
  {
    itemTypeID: integer().notNull(),
    fieldID: integer().notNull(),
    hide: integer(),
    orderIndex: integer().notNull(),
  },
  (table) => [
    index("itemTypeFieldsCombined_fieldID").on(table.fieldID),
    primaryKey({
      columns: [table.itemTypeID, table.orderIndex],
      name: "itemTypeFieldsCombined_pk",
    }),
  ],
);

export const baseFieldMappings = sqliteTable(
  "baseFieldMappings",
  {
    itemTypeID: integer().references(() => itemTypes.itemTypeID),
    baseFieldID: integer().references(() => fields.fieldID),
    fieldID: integer().references(() => fields.fieldID),
  },
  (table) => [
    index("baseFieldMappings_fieldID").on(table.fieldID),
    index("baseFieldMappings_baseFieldID").on(table.baseFieldID),
    primaryKey({
      columns: [table.itemTypeID, table.baseFieldID, table.fieldID],
      name: "baseFieldMappings_pk",
    }),
  ],
);

export const baseFieldMappingsCombined = sqliteTable(
  "baseFieldMappingsCombined",
  {
    itemTypeID: integer(),
    baseFieldID: integer(),
    fieldID: integer(),
  },
  (table) => [
    index("baseFieldMappingsCombined_fieldID").on(table.fieldID),
    index("baseFieldMappingsCombined_baseFieldID").on(table.baseFieldID),
    primaryKey({
      columns: [table.itemTypeID, table.baseFieldID, table.fieldID],
      name: "baseFieldMappingsCombined_pk",
    }),
  ],
);

export const creatorTypes = sqliteTable("creatorTypes", {
  creatorTypeID: integer().primaryKey(),
  creatorType: text(),
});

export const itemTypeCreatorTypes = sqliteTable(
  "itemTypeCreatorTypes",
  {
    itemTypeID: integer().references(() => itemTypes.itemTypeID),
    creatorTypeID: integer().references(() => creatorTypes.creatorTypeID),
    primaryField: integer(),
  },
  (table) => [
    index("itemTypeCreatorTypes_creatorTypeID").on(table.creatorTypeID),
    primaryKey({
      columns: [table.itemTypeID, table.creatorTypeID],
      name: "itemTypeCreatorTypes_pk",
    }),
  ],
);

export const version = sqliteTable(
  "version",
  {
    schema: text().primaryKey(),
    version: integer().notNull(),
  },
  (table) => [index("schema").on(table.schema)],
);

export const settings = sqliteTable(
  "settings",
  {
    setting: text(),
    key: text(),
    value: sqliteAny(),
  },
  (table) => [
    primaryKey({ columns: [table.setting, table.key], name: "settings_pk" }),
  ],
);

export const syncedSettings = sqliteTable(
  "syncedSettings",
  {
    setting: text().notNull(),
    libraryID: integer()
      .notNull()
      .references(() => libraries.libraryID, { onDelete: "cascade" }),
    value: sqliteAny().notNull(),
    version: integer().default(0).notNull(),
    synced: integer().default(0).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.setting, table.libraryID],
      name: "syncedSettings_pk",
    }),
  ],
);

export const items = sqliteTable(
  "items",
  {
    itemID: integer().primaryKey(),
    itemTypeID: integer().notNull(),
    dateAdded: timestamp().default(currentTimestamp).notNull(),
    dateModified: timestamp().default(currentTimestamp).notNull(),
    clientDateModified: timestamp().default(currentTimestamp).notNull(),
    libraryID: integer()
      .notNull()
      .references(() => libraries.libraryID, { onDelete: "cascade" }),
    key: text().notNull(),
    version: integer().default(0).notNull(),
    synced: integer().default(0).notNull(),
  },
  (table) => [index("items_synced").on(table.synced)],
);

export const itemDataValues = sqliteTable(
  "itemDataValues",
  {
    valueID: integer().primaryKey(),
    value: noType(),
  },
  (table) => [unique("itemDataValues_value_unique").on(table.value)],
);

export const itemData = sqliteTable(
  "itemData",
  {
    itemID: integer().references(() => items.itemID, { onDelete: "cascade" }),
    fieldID: integer().references(() => fieldsCombined.fieldID),
    valueID: noTypeInt().references(() => itemDataValues.valueID),
  },
  (table) => [
    index("itemData_valueID").on(table.valueID),
    index("itemData_fieldID").on(table.fieldID),
    primaryKey({ columns: [table.itemID, table.fieldID], name: "itemData_pk" }),
  ],
);

export const itemNotes = sqliteTable(
  "itemNotes",
  {
    itemID: integer()
      .primaryKey()
      .references(() => items.itemID, { onDelete: "cascade" }),
    parentItemID: integer().references(() => items.itemID, {
      onDelete: "cascade",
    }),
    note: text(),
    title: text(),
  },
  (table) => [index("itemNotes_parentItemID").on(table.parentItemID)],
);

export const itemAttachments = sqliteTable(
  "itemAttachments",
  {
    itemID: integer()
      .primaryKey()
      .references(() => items.itemID, { onDelete: "cascade" }),
    parentItemID: integer().references(() => items.itemID, {
      onDelete: "cascade",
    }),
    linkMode: integer(),
    contentType: text(),
    charsetID: integer().references(() => charsets.charsetID, {
      onDelete: "set null",
    }),
    path: text(),
    syncState: integer().default(0),
    storageModTime: integer(),
    storageHash: text(),
    lastProcessedModificationTime: integer(),
    lastRead: integer(),
  },
  (table) => [
    index("itemAttachments_lastRead").on(table.lastRead),
    index("itemAttachments_lastProcessedModificationTime").on(
      table.lastProcessedModificationTime,
    ),
    index("itemAttachments_syncState").on(table.syncState),
    index("itemAttachments_contentType").on(table.contentType),
    index("itemAttachments_charsetID").on(table.charsetID),
    index("itemAttachments_parentItemID").on(table.parentItemID),
  ],
);

export const itemAnnotations = sqliteTable(
  "itemAnnotations",
  {
    itemID: integer()
      .primaryKey()
      .references(() => items.itemID, { onDelete: "cascade" }),
    parentItemID: integer()
      .notNull()
      .references(() => itemAttachments.itemID),
    type: integer().notNull(),
    authorName: text(),
    text: text(),
    comment: text(),
    color: text(),
    pageLabel: text(),
    sortIndex: text().notNull(),
    position: text().notNull(),
    isExternal: integer().notNull(),
  },
  (table) => [index("itemAnnotations_parentItemID").on(table.parentItemID)],
);

export const tags = sqliteTable(
  "tags",
  {
    tagID: integer().primaryKey(),
    name: text().notNull(),
  },
  (table) => [unique("tags_name_unique").on(table.name)],
);

export const itemRelations = sqliteTable(
  "itemRelations",
  {
    itemID: integer()
      .notNull()
      .references(() => items.itemID, { onDelete: "cascade" }),
    predicateID: integer()
      .notNull()
      .references(() => relationPredicates.predicateID, {
        onDelete: "cascade",
      }),
    object: text().notNull(),
  },
  (table) => [
    index("itemRelations_object").on(table.object),
    index("itemRelations_predicateID").on(table.predicateID),
    primaryKey({
      columns: [table.itemID, table.predicateID, table.object],
      name: "itemRelations_pk",
    }),
  ],
);

export const itemTags = sqliteTable(
  "itemTags",
  {
    itemID: integer()
      .notNull()
      .references(() => items.itemID, { onDelete: "cascade" }),
    tagID: integer()
      .notNull()
      .references(() => tags.tagID, { onDelete: "cascade" }),
    type: integer().notNull(),
  },
  (table) => [
    index("itemTags_tagID").on(table.tagID),
    primaryKey({ columns: [table.itemID, table.tagID], name: "itemTags_pk" }),
  ],
);

export const creators = sqliteTable("creators", {
  creatorID: integer().primaryKey(),
  firstName: text(),
  lastName: text(),
  fieldMode: integer(),
});

export const itemCreators = sqliteTable(
  "itemCreators",
  {
    itemID: integer()
      .notNull()
      .references(() => items.itemID, { onDelete: "cascade" }),
    creatorID: integer()
      .notNull()
      .references(() => creators.creatorID, { onDelete: "cascade" }),
    creatorTypeID: integer()
      .default(1)
      .notNull()
      .references(() => creatorTypes.creatorTypeID),
    orderIndex: integer().default(0).notNull(),
  },
  (table) => [
    index("itemCreators_creatorTypeID").on(table.creatorTypeID),
    primaryKey({
      columns: [
        table.itemID,
        table.creatorID,
        table.creatorTypeID,
        table.orderIndex,
      ],
      name: "itemCreators_pk",
    }),
  ],
);

export const collections = sqliteTable(
  "collections",
  {
    collectionID: integer().primaryKey(),
    collectionName: text().notNull(),
    parentCollectionID: integer()
      .default(sql`NULL`)
      .references((): AnySQLiteColumn => collections.collectionID, {
        onDelete: "cascade",
      }),
    clientDateModified: timestamp().default(currentTimestamp).notNull(),
    libraryID: integer()
      .notNull()
      .references(() => libraries.libraryID, { onDelete: "cascade" }),
    key: text().notNull(),
    version: integer().default(0).notNull(),
    synced: integer().default(0).notNull(),
  },
  (table) => [index("collections_synced").on(table.synced)],
);

export const collectionItems = sqliteTable(
  "collectionItems",
  {
    collectionID: integer()
      .notNull()
      .references(() => collections.collectionID, { onDelete: "cascade" }),
    itemID: integer()
      .notNull()
      .references(() => items.itemID, { onDelete: "cascade" }),
    orderIndex: integer().default(0).notNull(),
  },
  (table) => [
    index("collectionItems_itemID").on(table.itemID),
    primaryKey({
      columns: [table.collectionID, table.itemID],
      name: "collectionItems_pk",
    }),
  ],
);

export const collectionRelations = sqliteTable(
  "collectionRelations",
  {
    collectionID: integer()
      .notNull()
      .references(() => collections.collectionID, { onDelete: "cascade" }),
    predicateID: integer()
      .notNull()
      .references(() => relationPredicates.predicateID, {
        onDelete: "cascade",
      }),
    object: text().notNull(),
  },
  (table) => [
    index("collectionRelations_object").on(table.object),
    index("collectionRelations_predicateID").on(table.predicateID),
    primaryKey({
      columns: [table.collectionID, table.predicateID, table.object],
      name: "collectionRelations_pk",
    }),
  ],
);

export const feeds = sqliteTable(
  "feeds",
  {
    libraryID: integer()
      .primaryKey()
      .references(() => libraries.libraryID, { onDelete: "cascade" }),
    name: text().notNull(),
    url: text().notNull(),
    lastUpdate: timestamp(),
    lastCheck: timestamp(),
    lastCheckError: text(),
    cleanupReadAfter: integer(),
    cleanupUnreadAfter: integer(),
    refreshInterval: integer(),
  },
  (table) => [unique("feeds_url_unique").on(table.url)],
);

export const feedItems = sqliteTable(
  "feedItems",
  {
    itemID: integer()
      .primaryKey()
      .references(() => items.itemID, { onDelete: "cascade" }),
    guid: text().notNull(),
    readTime: timestamp(),
    translatedTime: timestamp(),
  },
  (table) => [unique("feedItems_guid_unique").on(table.guid)],
);

export const savedSearches = sqliteTable(
  "savedSearches",
  {
    savedSearchID: integer().primaryKey(),
    savedSearchName: text().notNull(),
    clientDateModified: timestamp().default(currentTimestamp).notNull(),
    libraryID: integer()
      .notNull()
      .references(() => libraries.libraryID, { onDelete: "cascade" }),
    key: text().notNull(),
    version: integer().default(0).notNull(),
    synced: integer().default(0).notNull(),
  },
  (table) => [index("savedSearches_synced").on(table.synced)],
);

export const savedSearchConditions = sqliteTable(
  "savedSearchConditions",
  {
    savedSearchID: integer()
      .notNull()
      .references(() => savedSearches.savedSearchID, { onDelete: "cascade" }),
    searchConditionID: integer().notNull(),
    condition: text().notNull(),
    operator: text(),
    value: text(),
    required: noneType(),
  },
  (table) => [
    primaryKey({
      columns: [table.savedSearchID, table.searchConditionID],
      name: "savedSearchConditions_pk",
    }),
  ],
);

export const deletedCollections = sqliteTable(
  "deletedCollections",
  {
    collectionID: integer()
      .primaryKey()
      .references(() => collections.collectionID, { onDelete: "cascade" }),
    dateDeleted: noTypeDate().default(currentTimestamp).notNull(),
  },
  (table) => [index("deletedCollections_dateDeleted").on(table.dateDeleted)],
);

export const deletedItems = sqliteTable(
  "deletedItems",
  {
    itemID: integer()
      .primaryKey()
      .references(() => items.itemID, { onDelete: "cascade" }),
    dateDeleted: noTypeDate().default(currentTimestamp).notNull(),
  },
  (table) => [
    index("deletedSearches_dateDeleted").on(table.dateDeleted),
    index("deletedItems_dateDeleted").on(table.dateDeleted),
  ],
);

export const deletedSearches = sqliteTable("deletedSearches", {
  savedSearchID: integer()
    .primaryKey()
    .references(() => savedSearches.savedSearchID, { onDelete: "cascade" }),
  dateDeleted: noTypeDate().default(currentTimestamp).notNull(),
});

export type LibraryType = "user" | "group";

export const libraries = sqliteTable("libraries", {
  libraryID: integer().primaryKey(),
  type: text().notNull().$type<LibraryType>(),
  editable: integer().notNull(),
  filesEditable: integer().notNull(),
  version: integer().default(0).notNull(),
  storageVersion: integer().default(0).notNull(),
  lastSync: integer().default(0).notNull(),
  archived: integer().default(0).notNull(),
  isAdmin: integer().default(0).notNull(),
});

export const users = sqliteTable("users", {
  userID: integer().primaryKey(),
  name: text().notNull(),
});

export const groups = sqliteTable(
  "groups",
  {
    groupID: integer().primaryKey(),
    libraryID: integer()
      .notNull()
      .references(() => libraries.libraryID, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text().notNull(),
    version: integer().notNull(),
  },
  (table) => [unique("groups_libraryID_unique").on(table.libraryID)],
);

export const groupItems = sqliteTable("groupItems", {
  itemID: integer()
    .primaryKey()
    .references(() => items.itemID, { onDelete: "cascade" }),
  createdByUserID: integer().references(() => users.userID, {
    onDelete: "set null",
  }),
  lastModifiedByUserID: integer().references(() => users.userID, {
    onDelete: "set null",
  }),
});

export const publicationsItems = sqliteTable("publicationsItems", {
  itemID: integer().primaryKey(),
});

export const retractedItems = sqliteTable("retractedItems", {
  itemID: integer()
    .primaryKey()
    .references(() => items.itemID, { onDelete: "cascade" }),
  data: text(),
  flag: integer().default(0),
});

export const fulltextItems = sqliteTable(
  "fulltextItems",
  {
    itemID: integer()
      .primaryKey()
      .references(() => items.itemID, { onDelete: "cascade" }),
    indexedPages: integer(),
    totalPages: integer(),
    indexedChars: integer(),
    totalChars: integer(),
    version: integer().default(0).notNull(),
    synced: integer().default(0).notNull(),
  },
  (table) => [
    index("fulltextItems_version").on(table.version),
    index("fulltextItems_synced").on(table.synced),
  ],
);

export const fulltextWords = sqliteTable(
  "fulltextWords",
  {
    wordID: integer().primaryKey(),
    word: text(),
  },
  (table) => [unique("fulltextWords_word_unique").on(table.word)],
);

export const fulltextItemWords = sqliteTable(
  "fulltextItemWords",
  {
    wordID: integer().references(() => fulltextWords.wordID),
    itemID: integer().references(() => items.itemID, { onDelete: "cascade" }),
  },
  (table) => [
    index("fulltextItemWords_itemID").on(table.itemID),
    primaryKey({
      columns: [table.wordID, table.itemID],
      name: "fulltextItemWords_pk",
    }),
  ],
);

export const syncCache = sqliteTable(
  "syncCache",
  {
    libraryID: integer()
      .notNull()
      .references(() => libraries.libraryID, { onDelete: "cascade" }),
    key: text().notNull(),
    syncObjectTypeID: integer()
      .notNull()
      .references(() => syncObjectTypes.syncObjectTypeID),
    version: integer().notNull(),
    data: text(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.libraryID,
        table.key,
        table.syncObjectTypeID,
        table.version,
      ],
      name: "syncCache_pk",
    }),
  ],
);

export const syncDeleteLog = sqliteTable("syncDeleteLog", {
  syncObjectTypeID: integer()
    .notNull()
    .references(() => syncObjectTypes.syncObjectTypeID),
  libraryID: integer()
    .notNull()
    .references(() => libraries.libraryID, { onDelete: "cascade" }),
  key: text().notNull(),
  dateDeleted: text()
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const syncQueue = sqliteTable(
  "syncQueue",
  {
    libraryID: integer()
      .notNull()
      .references(() => libraries.libraryID, { onDelete: "cascade" }),
    key: text().notNull(),
    syncObjectTypeID: integer()
      .notNull()
      .references(() => syncObjectTypes.syncObjectTypeID, {
        onDelete: "cascade",
      }),
    lastCheck: timestamp(),
    tries: integer(),
  },
  (table) => [
    primaryKey({
      columns: [table.libraryID, table.key, table.syncObjectTypeID],
      name: "syncQueue_pk",
    }),
  ],
);

export const storageDeleteLog = sqliteTable(
  "storageDeleteLog",
  {
    libraryID: integer()
      .notNull()
      .references(() => libraries.libraryID, { onDelete: "cascade" }),
    key: text().notNull(),
    dateDeleted: text()
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.libraryID, table.key],
      name: "storageDeleteLog_pk",
    }),
  ],
);

export const proxies = sqliteTable("proxies", {
  proxyID: integer().primaryKey(),
  multiHost: integer(),
  autoAssociate: integer(),
  scheme: text(),
});

export const proxyHosts = sqliteTable(
  "proxyHosts",
  {
    hostID: integer().primaryKey(),
    proxyID: integer().references(() => proxies.proxyID),
    hostname: text(),
  },
  (table) => [index("proxyHosts_proxyID").on(table.proxyID)],
);

export const relationPredicates = sqliteTable(
  "relationPredicates",
  {
    predicateID: integer().primaryKey(),
    predicate: text(),
  },
  (table) => [
    unique("relationPredicates_predicate_unique").on(table.predicate),
  ],
);

export const customItemTypes = sqliteTable("customItemTypes", {
  customItemTypeID: integer().primaryKey(),
  typeName: text(),
  label: text(),
  display: integer().default(1),
  icon: text(),
});

export const customFields = sqliteTable("customFields", {
  customFieldID: integer().primaryKey(),
  fieldName: text(),
  label: text(),
});

export const customItemTypeFields = sqliteTable(
  "customItemTypeFields",
  {
    customItemTypeID: integer()
      .notNull()
      .references(() => customItemTypes.customItemTypeID),
    fieldID: integer().references(() => fields.fieldID),
    customFieldID: integer().references(() => customFields.customFieldID),
    hide: integer().notNull(),
    orderIndex: integer().notNull(),
  },
  (table) => [
    index("customItemTypeFields_customFieldID").on(table.customFieldID),
    index("customItemTypeFields_fieldID").on(table.fieldID),
    primaryKey({
      columns: [table.customItemTypeID, table.orderIndex],
      name: "customItemTypeFields_pk",
    }),
  ],
);

export const customBaseFieldMappings = sqliteTable(
  "customBaseFieldMappings",
  {
    customItemTypeID: integer().references(
      () => customItemTypes.customItemTypeID,
    ),
    baseFieldID: integer().references(() => fields.fieldID),
    customFieldID: integer().references(() => customFields.customFieldID),
  },
  (table) => [
    index("customBaseFieldMappings_customFieldID").on(table.customFieldID),
    index("customBaseFieldMappings_baseFieldID").on(table.baseFieldID),
    primaryKey({
      columns: [table.customItemTypeID, table.baseFieldID, table.customFieldID],
      name: "customBaseFieldMappings_pk",
    }),
  ],
);

export const translatorCache = sqliteTable("translatorCache", {
  fileName: text().primaryKey(),
  metadataJSON: text(),
  lastModifiedTime: integer(),
});

export const dbDebug1 = sqliteTable("dbDebug1", {
  a: integer().primaryKey(),
});
