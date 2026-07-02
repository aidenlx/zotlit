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
    itemTypeFields: r.many.itemTypeFields(),
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
    itemTypeCreatorTypes: r.many.itemTypeCreatorTypes(),
    itemTypeFields: r.many.itemTypeFields(),
    items: r.many.items(),
  },
  itemTypeCreatorTypes: {
    itemType: r.one.itemTypes({
      from: r.itemTypeCreatorTypes.itemTypeID,
      to: r.itemTypes.itemTypeID,
    }),
    creatorType: r.one.creatorTypes({
      from: r.itemTypeCreatorTypes.creatorTypeID,
      to: r.creatorTypes.creatorTypeID,
    }),
  },
  itemTypeFields: {
    itemType: r.one.itemTypes({
      from: r.itemTypeFields.itemTypeID,
      to: r.itemTypes.itemTypeID,
    }),
    field: r.one.fields({
      from: r.itemTypeFields.fieldID,
      to: r.fields.fieldID,
    }),
  },
  itemTypesCombined: {
    itemTypeFieldsCombined: r.many.itemTypeFieldsCombined(),
    baseFieldMappingsCombined: r.many.baseFieldMappingsCombined(),
  },
  itemTypeFieldsCombined: {
    itemType: r.one.itemTypesCombined({
      from: r.itemTypeFieldsCombined.itemTypeID,
      to: r.itemTypesCombined.itemTypeID,
    }),
    field: r.one.fieldsCombined({
      from: r.itemTypeFieldsCombined.fieldID,
      to: r.fieldsCombined.fieldID,
    }),
  },
  baseFieldMappingsCombined: {
    itemType: r.one.itemTypesCombined({
      from: r.baseFieldMappingsCombined.itemTypeID,
      to: r.itemTypesCombined.itemTypeID,
    }),
    baseField: r.one.fieldsCombined({
      from: r.baseFieldMappingsCombined.baseFieldID,
      to: r.fieldsCombined.fieldID,
      alias: "baseFieldMappingsCombined_baseFieldID_fieldsCombined_fieldID",
    }),
    field: r.one.fieldsCombined({
      from: r.baseFieldMappingsCombined.fieldID,
      to: r.fieldsCombined.fieldID,
      alias: "baseFieldMappingsCombined_fieldID_fieldsCombined_fieldID",
    }),
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
    itemTypeCreatorTypes: r.many.itemTypeCreatorTypes(),
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
    feed: r.one.feeds(),
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
    itemType: r.one.itemTypes({
      from: r.items.itemTypeID,
      to: r.itemTypes.itemTypeID,
      optional: false,
    }),
    itemData: r.many.itemData(),
    itemAttachments_parentItemID: r.many.itemAttachments({
      alias: "itemAttachments_parentItemID_items_itemID",
    }),
    itemAttachment_itemID: r.one.itemAttachments({
      alias: "itemAttachments_itemID_items_itemID",
    }),
    annotation: r.one.itemAnnotations({
      from: r.items.itemID,
      to: r.itemAnnotations.itemID,
    }),
    note: r.one.itemNotes({
      alias: "itemNotes_itemID_items_itemID",
    }),
    childNotes: r.many.itemNotes({
      alias: "itemNotes_parentItemID_items_itemID",
    }),
    itemTags: r.many.itemTags(),
    itemRelations: r.many.itemRelations(),
    collectionItems: r.many.collectionItems(),
    relationPredicates: r.many.relationPredicates(),
    tags: r.many.tags(),
    itemCreators: r.many.itemCreators(),
    collections: r.many.collections({
      from: r.items.itemID.through(r.collectionItems.itemID),
      to: r.collections.collectionID.through(r.collectionItems.collectionID),
    }),
    feedItem: r.one.feedItems(),
    deletedItem: r.one.deletedItems(),
    groupItem: r.one.groupItems(),
    retractedItem: r.one.retractedItems(),
    fulltextItem: r.one.fulltextItems(),
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
    itemTypeFieldsCombined: r.many.itemTypeFieldsCombined(),
    baseFieldMappingsCombined_baseFieldID: r.many.baseFieldMappingsCombined({
      alias: "baseFieldMappingsCombined_baseFieldID_fieldsCombined_fieldID",
    }),
    baseFieldMappingsCombined_fieldID: r.many.baseFieldMappingsCombined({
      alias: "baseFieldMappingsCombined_fieldID_fieldsCombined_fieldID",
    }),
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
      optional: false,
    }),
    annotations: r.many.itemAnnotations({
      from: r.itemAttachments.itemID,
      to: r.itemAnnotations.parentItemID,
    }),
  },
  itemAnnotations: {
    item: r.one.items({
      from: r.itemAnnotations.itemID,
      to: r.items.itemID,
      optional: false,
    }),
    parentAttachment: r.one.itemAttachments({
      from: r.itemAnnotations.parentItemID,
      to: r.itemAttachments.itemID,
      optional: false,
    }),
  },
  itemNotes: {
    item: r.one.items({
      from: r.itemNotes.itemID,
      to: r.items.itemID,
      alias: "itemNotes_itemID_items_itemID",
      optional: false,
    }),
    parentItem: r.one.items({
      from: r.itemNotes.parentItemID,
      to: r.items.itemID,
      alias: "itemNotes_parentItemID_items_itemID",
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
    itemRelations: r.many.itemRelations(),
    collectionRelations: r.many.collectionRelations(),
  },
  itemRelations: {
    item: r.one.items({
      from: r.itemRelations.itemID,
      to: r.items.itemID,
    }),
    predicate: r.one.relationPredicates({
      from: r.itemRelations.predicateID,
      to: r.relationPredicates.predicateID,
    }),
  },
  collectionRelations: {
    collection: r.one.collections({
      from: r.collectionRelations.collectionID,
      to: r.collections.collectionID,
    }),
    predicate: r.one.relationPredicates({
      from: r.collectionRelations.predicateID,
      to: r.relationPredicates.predicateID,
    }),
  },
  tags: {
    items: r.many.items({
      from: r.tags.tagID.through(r.itemTags.tagID),
      to: r.items.itemID.through(r.itemTags.itemID),
    }),
    itemTags: r.many.itemTags(),
  },
  itemTags: {
    item: r.one.items({
      from: r.itemTags.itemID,
      to: r.items.itemID,
      optional: false,
    }),
    tag: r.one.tags({
      from: r.itemTags.tagID,
      to: r.tags.tagID,
      optional: false,
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
    collectionItems: r.many.collectionItems(),
    collectionRelations: r.many.collectionRelations(),
    deletedCollection: r.one.deletedCollections(),
  },
  collectionItems: {
    collection: r.one.collections({
      from: r.collectionItems.collectionID,
      to: r.collections.collectionID,
    }),
    item: r.one.items({
      from: r.collectionItems.itemID,
      to: r.items.itemID,
    }),
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
    deletedSearch: r.one.deletedSearches(),
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
