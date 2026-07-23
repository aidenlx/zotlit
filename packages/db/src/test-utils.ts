// Shared item-fixture builders for @zotlit/db consumers' tests.
import { Temporal } from "@zotlit/shared/temporal";
import { type ItemFields } from "@zotlit/zotero-types";

import { USER_LIBRARY_ID } from "./lib/constants";
import { type BaseItem, type Item } from "./queries/items";

/**
 * The one place that owns the Zotero fixture schema. Query tests call this to
 * create every table they might touch, then insert only their own rows — a
 * Zotero schema bump edits this DDL, not each `*.test.ts`.
 *
 * Every non-key column is nullable or defaulted so a test may insert any column
 * subset; the tables are a superset of the real Zotero columns the queries read.
 */
export function createFixtureSchema(db: { exec(sql: string): void }): void {
  db.exec(FIXTURE_DDL);
}

const FIXTURE_DDL = `
  create table libraries (
    libraryID integer primary key,
    type text not null,
    editable integer not null default 1,
    filesEditable integer not null default 1,
    version integer not null default 0,
    storageVersion integer not null default 0,
    lastSync integer not null default 0,
    archived integer not null default 0,
    isAdmin integer not null default 0
  );
  create table groups (
    groupID integer primary key,
    libraryID integer not null,
    name text not null default '',
    description text not null default '',
    version integer not null default 0
  );
  create table itemTypes (
    itemTypeID integer primary key,
    typeName text,
    templateItemTypeID integer,
    display integer
  );
  create table items (
    itemID integer primary key,
    itemTypeID integer not null default 0,
    dateAdded text not null default '',
    dateModified text not null default '',
    clientDateModified text not null default '',
    libraryID integer not null,
    key text not null,
    version integer not null default 0,
    synced integer not null default 0
  );
  create table deletedItems (
    itemID integer primary key,
    dateDeleted text not null default ''
  );
  create table fieldsCombined (
    fieldID integer primary key,
    fieldName text not null,
    label text,
    fieldFormatID integer,
    custom integer not null default 0
  );
  create table baseFieldMappingsCombined (
    itemTypeID integer not null,
    baseFieldID integer not null,
    fieldID integer not null,
    primary key (itemTypeID, baseFieldID, fieldID)
  );
  create table itemData (
    itemID integer,
    fieldID integer,
    valueID integer,
    primary key (itemID, fieldID)
  );
  create table itemDataValues (
    valueID integer primary key,
    value text
  );
  create table creators (
    creatorID integer primary key,
    firstName text,
    lastName text,
    fieldMode integer
  );
  create table creatorTypes (
    creatorTypeID integer primary key,
    creatorType text
  );
  create table itemCreators (
    itemID integer not null,
    creatorID integer not null,
    creatorTypeID integer not null,
    orderIndex integer not null default 0
  );
  create table itemTypeCreatorTypes (
    itemTypeID integer not null,
    creatorTypeID integer not null,
    primaryField integer,
    primary key (itemTypeID, creatorTypeID)
  );
  create table itemAttachments (
    itemID integer primary key,
    parentItemID integer,
    linkMode integer,
    contentType text,
    charsetID integer,
    path text,
    syncState integer default 0,
    storageModTime integer,
    storageHash text,
    lastProcessedModificationTime integer,
    lastRead integer
  );
  create table itemAnnotations (
    itemID integer primary key,
    parentItemID integer not null,
    type integer not null,
    authorName text,
    text text,
    comment text,
    color text,
    pageLabel text,
    sortIndex text not null default '',
    position text not null default '',
    isExternal integer not null default 0
  );
  create table itemNotes (
    itemID integer primary key,
    parentItemID integer,
    note text,
    title text
  );
  create table tags (
    tagID integer primary key,
    name text not null
  );
  create table itemTags (
    itemID integer not null,
    tagID integer not null,
    type integer not null default 0,
    primary key (itemID, tagID)
  );
  create table relationPredicates (
    predicateID integer primary key,
    predicate text
  );
  create table itemRelations (
    itemID integer not null,
    predicateID integer not null,
    object text not null,
    primary key (itemID, predicateID, object)
  );
  create table collections (
    collectionID integer primary key,
    collectionName text not null,
    parentCollectionID integer,
    libraryID integer not null,
    key text not null
  );
  create table deletedCollections (
    collectionID integer primary key,
    dateDeleted text not null default ''
  );
  create table collectionItems (
    collectionID integer not null,
    itemID integer not null,
    orderIndex integer not null default 0,
    primary key (collectionID, itemID)
  );
  create table settings (
    setting text,
    key text,
    value,
    primary key (setting, key)
  );
`;

/** A minimal full DB item fixture (Hensher2011-shaped defaults), overridable via `fields`/`base`. */
export function makeItem(
  fields: { itemType: string } & Record<string, string | null>,
  base?: Partial<BaseItem>,
): Item {
  return {
    itemID: 1,
    libraryID: USER_LIBRARY_ID,
    key: "KX67D9YM",
    indexedKey: "KX67D9YM",
    dateAdded: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    creators: [
      {
        firstName: "David",
        lastName: "Hensher",
        creatorType: "author",
        fieldMode: 0,
      },
    ],
    primaryCreatorType: "author",
    customFields: new Map(),
    groupID: null,
    ...base,
    fields: fields as ItemFields,
  };
}
