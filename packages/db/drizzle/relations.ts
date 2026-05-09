import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  fileTypeMimeTypes: {
    fileType: r.one.fileTypes({
      from: r.fileTypeMimeTypes.fileTypeID,
      to: r.fileTypes.fileTypeID,
    }),
  },
  fileTypes: {
    fileTypeMimeTypes: r.many.fileTypeMimeTypes(),
  },
  fields: {
    fieldFormat: r.one.fieldFormats({
      from: r.fields.fieldFormatID,
      to: r.fieldFormats.fieldFormatID,
    }),
    itemTypes: r.many.itemTypes({
      from: r.fields.fieldID.through(r.itemTypeFields.fieldID),
      to: r.itemTypes.itemTypeID.through(r.itemTypeFields.itemTypeID),
    }),
    baseFieldMappings_fieldID: r.many.baseFieldMappings({
      alias: "baseFieldMappings_fieldID_fields_fieldID",
    }),
    baseFieldMappings_baseFieldID: r.many.baseFieldMappings({
      alias: "baseFieldMappings_baseFieldID_fields_fieldID",
    }),
    customItemTypeFields: r.many.customItemTypeFields(),
    customBaseFieldMappings: r.many.customBaseFieldMappings(),
  },
  fieldFormats: {
    fields: r.many.fields(),
  },
  itemTypes: {
    fields: r.many.fields(),
    baseFieldMappings: r.many.baseFieldMappings(),
    creatorTypes: r.many.creatorTypes(),
  },
  baseFieldMappings: {
    field_fieldID: r.one.fields({
      from: r.baseFieldMappings.fieldID,
      to: r.fields.fieldID,
      alias: "baseFieldMappings_fieldID_fields_fieldID",
    }),
    field_baseFieldID: r.one.fields({
      from: r.baseFieldMappings.baseFieldID,
      to: r.fields.fieldID,
      alias: "baseFieldMappings_baseFieldID_fields_fieldID",
    }),
    itemType: r.one.itemTypes({
      from: r.baseFieldMappings.itemTypeID,
      to: r.itemTypes.itemTypeID,
    }),
  },
  creatorTypes: {
    itemTypes: r.many.itemTypes({
      from: r.creatorTypes.creatorTypeID.through(
        r.itemTypeCreatorTypes.creatorTypeID,
      ),
      to: r.itemTypes.itemTypeID.through(r.itemTypeCreatorTypes.itemTypeID),
    }),
    itemCreators: r.many.itemCreators(),
  },
  syncedSettings: {
    library: r.one.libraries({
      from: r.syncedSettings.libraryID,
      to: r.libraries.libraryID,
    }),
  },
  libraries: {
    syncedSettings: r.many.syncedSettings(),
    items: r.many.items(),
    collections: r.many.collections(),
    feeds: r.many.feeds(),
    savedSearches: r.many.savedSearches(),
    groups: r.one.groups(),
    syncObjectTypes_via_syncCache: r.many.syncObjectTypes({
      alias:
        "syncObjectTypes_syncObjectTypeID_libraries_libraryID_via_syncCache",
    }),
    syncObjectTypes_via_syncDeleteLog: r.many.syncObjectTypes({
      from: r.libraries.libraryID.through(r.syncDeleteLog.libraryID),
      to: r.syncObjectTypes.syncObjectTypeID.through(
        r.syncDeleteLog.syncObjectTypeID,
      ),
      alias:
        "libraries_libraryID_syncObjectTypes_syncObjectTypeID_via_syncDeleteLog",
    }),
    syncObjectTypes_via_syncQueue: r.many.syncObjectTypes({
      alias:
        "syncObjectTypes_syncObjectTypeID_libraries_libraryID_via_syncQueue",
    }),
    storageDeleteLogs: r.many.storageDeleteLog(),
  },
  items: {
    library: r.one.libraries({
      from: r.items.libraryID,
      to: r.libraries.libraryID,
    }),
    itemData: r.many.itemData(),
    itemAttachments_parentItemID: r.many.itemAttachments({
      alias: "itemAttachments_parentItemID_items_itemID",
    }),
    itemAttachments_itemID: r.many.itemAttachments({
      alias: "itemAttachments_itemID_items_itemID",
    }),
    itemAttachments_via_itemAnnotations: r.many.itemAttachments({
      alias: "itemAttachments_itemID_items_itemID_via_itemAnnotations",
    }),
    relationPredicates: r.many.relationPredicates(),
    tags: r.many.tags(),
    itemCreators: r.many.itemCreators(),
    collections: r.many.collections({
      from: r.items.itemID.through(r.collectionItems.itemID),
      to: r.collections.collectionID.through(r.collectionItems.collectionID),
    }),
    feedItems: r.many.feedItems(),
    deletedItems: r.many.deletedItems(),
    groupItems: r.many.groupItems(),
    retractedItems: r.many.retractedItems(),
    fulltextItems: r.many.fulltextItems(),
    fulltextWords: r.many.fulltextWords({
      from: r.items.itemID.through(r.fulltextItemWords.itemID),
      to: r.fulltextWords.wordID.through(r.fulltextItemWords.wordID),
    }),
  },
  itemData: {
    itemDataValue: r.one.itemDataValues({
      from: r.itemData.valueID,
      to: r.itemDataValues.valueID,
    }),
    fieldsCombined: r.one.fieldsCombined({
      from: r.itemData.fieldID,
      to: r.fieldsCombined.fieldID,
    }),
    item: r.one.items({
      from: r.itemData.itemID,
      to: r.items.itemID,
    }),
  },
  itemDataValues: {
    itemData: r.many.itemData(),
  },
  fieldsCombined: {
    itemData: r.many.itemData(),
  },
  itemAttachments: {
    charset: r.one.charsets({
      from: r.itemAttachments.charsetID,
      to: r.charsets.charsetID,
    }),
    item_parentItemID: r.one.items({
      from: r.itemAttachments.parentItemID,
      to: r.items.itemID,
      alias: "itemAttachments_parentItemID_items_itemID",
    }),
    item_itemID: r.one.items({
      from: r.itemAttachments.itemID,
      to: r.items.itemID,
      alias: "itemAttachments_itemID_items_itemID",
    }),
    items: r.many.items({
      from: r.itemAttachments.itemID.through(r.itemAnnotations.parentItemID),
      to: r.items.itemID.through(r.itemAnnotations.itemID),
      alias: "itemAttachments_itemID_items_itemID_via_itemAnnotations",
    }),
  },
  charsets: {
    itemAttachments: r.many.itemAttachments(),
  },
  relationPredicates: {
    items: r.many.items({
      from: r.relationPredicates.predicateID.through(
        r.itemRelations.predicateID,
      ),
      to: r.items.itemID.through(r.itemRelations.itemID),
    }),
    collections: r.many.collections({
      from: r.relationPredicates.predicateID.through(
        r.collectionRelations.predicateID,
      ),
      to: r.collections.collectionID.through(
        r.collectionRelations.collectionID,
      ),
    }),
  },
  tags: {
    items: r.many.items({
      from: r.tags.tagID.through(r.itemTags.tagID),
      to: r.items.itemID.through(r.itemTags.itemID),
    }),
  },
  itemCreators: {
    creatorType: r.one.creatorTypes({
      from: r.itemCreators.creatorTypeID,
      to: r.creatorTypes.creatorTypeID,
    }),
    creator: r.one.creators({
      from: r.itemCreators.creatorID,
      to: r.creators.creatorID,
    }),
    item: r.one.items({
      from: r.itemCreators.itemID,
      to: r.items.itemID,
    }),
  },
  creators: {
    itemCreators: r.many.itemCreators(),
  },
  collections: {
    libraries: r.many.libraries({
      from: r.collections.collectionID.through(
        r.collections.parentCollectionID,
      ),
      to: r.libraries.libraryID.through(r.collections.libraryID),
    }),
    items: r.many.items(),
    relationPredicates: r.many.relationPredicates(),
    deletedCollections: r.many.deletedCollections(),
  },
  feeds: {
    library: r.one.libraries({
      from: r.feeds.libraryID,
      to: r.libraries.libraryID,
    }),
  },
  feedItems: {
    item: r.one.items({
      from: r.feedItems.itemID,
      to: r.items.itemID,
    }),
  },
  savedSearches: {
    library: r.one.libraries({
      from: r.savedSearches.libraryID,
      to: r.libraries.libraryID,
    }),
    savedSearchConditions: r.many.savedSearchConditions(),
    deletedSearches: r.many.deletedSearches(),
  },
  savedSearchConditions: {
    savedSearch: r.one.savedSearches({
      from: r.savedSearchConditions.savedSearchID,
      to: r.savedSearches.savedSearchID,
    }),
  },
  deletedCollections: {
    collection: r.one.collections({
      from: r.deletedCollections.collectionID,
      to: r.collections.collectionID,
    }),
  },
  deletedItems: {
    item: r.one.items({
      from: r.deletedItems.itemID,
      to: r.items.itemID,
    }),
  },
  deletedSearches: {
    savedSearch: r.one.savedSearches({
      from: r.deletedSearches.savedSearchID,
      to: r.savedSearches.savedSearchID,
    }),
  },
  groups: {
    library: r.one.libraries({
      from: r.groups.libraryID,
      to: r.libraries.libraryID,
    }),
  },
  groupItems: {
    user_lastModifiedByUserID: r.one.users({
      from: r.groupItems.lastModifiedByUserID,
      to: r.users.userID,
      alias: "groupItems_lastModifiedByUserID_users_userID",
    }),
    user_createdByUserID: r.one.users({
      from: r.groupItems.createdByUserID,
      to: r.users.userID,
      alias: "groupItems_createdByUserID_users_userID",
    }),
    item: r.one.items({
      from: r.groupItems.itemID,
      to: r.items.itemID,
    }),
  },
  users: {
    groupItems_lastModifiedByUserID: r.many.groupItems({
      alias: "groupItems_lastModifiedByUserID_users_userID",
    }),
    groupItems_createdByUserID: r.many.groupItems({
      alias: "groupItems_createdByUserID_users_userID",
    }),
  },
  retractedItems: {
    item: r.one.items({
      from: r.retractedItems.itemID,
      to: r.items.itemID,
    }),
  },
  fulltextItems: {
    item: r.one.items({
      from: r.fulltextItems.itemID,
      to: r.items.itemID,
    }),
  },
  fulltextWords: {
    items: r.many.items(),
  },
  syncObjectTypes: {
    libraries_via_syncCache: r.many.libraries({
      from: r.syncObjectTypes.syncObjectTypeID.through(
        r.syncCache.syncObjectTypeID,
      ),
      to: r.libraries.libraryID.through(r.syncCache.libraryID),
      alias:
        "syncObjectTypes_syncObjectTypeID_libraries_libraryID_via_syncCache",
    }),
    libraries_via_syncDeleteLog: r.many.libraries({
      alias:
        "libraries_libraryID_syncObjectTypes_syncObjectTypeID_via_syncDeleteLog",
    }),
    libraries_via_syncQueue: r.many.libraries({
      from: r.syncObjectTypes.syncObjectTypeID.through(
        r.syncQueue.syncObjectTypeID,
      ),
      to: r.libraries.libraryID.through(r.syncQueue.libraryID),
      alias:
        "syncObjectTypes_syncObjectTypeID_libraries_libraryID_via_syncQueue",
    }),
  },
  storageDeleteLog: {
    library: r.one.libraries({
      from: r.storageDeleteLog.libraryID,
      to: r.libraries.libraryID,
    }),
  },
  proxyHosts: {
    proxy: r.one.proxies({
      from: r.proxyHosts.proxyID,
      to: r.proxies.proxyID,
    }),
  },
  proxies: {
    proxyHosts: r.many.proxyHosts(),
  },
  customItemTypeFields: {
    customField: r.one.customFields({
      from: r.customItemTypeFields.customFieldID,
      to: r.customFields.customFieldID,
    }),
    field: r.one.fields({
      from: r.customItemTypeFields.fieldID,
      to: r.fields.fieldID,
    }),
    customItemType: r.one.customItemTypes({
      from: r.customItemTypeFields.customItemTypeID,
      to: r.customItemTypes.customItemTypeID,
    }),
  },
  customFields: {
    customItemTypeFields: r.many.customItemTypeFields(),
    customBaseFieldMappings: r.many.customBaseFieldMappings(),
  },
  customItemTypes: {
    customItemTypeFields: r.many.customItemTypeFields(),
    customBaseFieldMappings: r.many.customBaseFieldMappings(),
  },
  customBaseFieldMappings: {
    customField: r.one.customFields({
      from: r.customBaseFieldMappings.customFieldID,
      to: r.customFields.customFieldID,
    }),
    field: r.one.fields({
      from: r.customBaseFieldMappings.baseFieldID,
      to: r.fields.fieldID,
    }),
    customItemType: r.one.customItemTypes({
      from: r.customBaseFieldMappings.customItemTypeID,
      to: r.customItemTypes.customItemTypeID,
    }),
  },
}));
