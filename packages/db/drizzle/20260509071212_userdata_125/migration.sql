-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE `fieldFormats` (
	`fieldFormatID` integer,
	`regex` text,
	`isInteger` integer,
	CONSTRAINT `fieldFormats_pk` PRIMARY KEY(`fieldFormatID`)
);
--> statement-breakpoint
CREATE TABLE `charsets` (
	`charsetID` integer,
	`charset` text UNIQUE,
	CONSTRAINT `charsets_pk` PRIMARY KEY(`charsetID`)
);
--> statement-breakpoint
CREATE TABLE `fileTypes` (
	`fileTypeID` integer,
	`fileType` text UNIQUE,
	CONSTRAINT `fileTypes_pk` PRIMARY KEY(`fileTypeID`)
);
--> statement-breakpoint
CREATE TABLE `fileTypeMimeTypes` (
	`fileTypeID` integer,
	`mimeType` text,
	CONSTRAINT `fileTypeMimeTypes_pk` PRIMARY KEY(`fileTypeID`, `mimeType`),
	CONSTRAINT `fk_fileTypeMimeTypes_fileTypeID_fileTypes_fileTypeID_fk` FOREIGN KEY (`fileTypeID`) REFERENCES `fileTypes`(`fileTypeID`)
);
--> statement-breakpoint
CREATE TABLE `syncObjectTypes` (
	`syncObjectTypeID` integer,
	`name` text,
	CONSTRAINT `syncObjectTypes_pk` PRIMARY KEY(`syncObjectTypeID`)
);
--> statement-breakpoint
CREATE TABLE `itemTypes` (
	`itemTypeID` integer,
	`typeName` text,
	`templateItemTypeID` integer,
	`display` integer DEFAULT 1,
	CONSTRAINT `itemTypes_pk` PRIMARY KEY(`itemTypeID`)
);
--> statement-breakpoint
CREATE TABLE `itemTypesCombined` (
	`itemTypeID` integer,
	`typeName` text NOT NULL,
	`display` integer DEFAULT 1 NOT NULL,
	`custom` integer NOT NULL,
	CONSTRAINT `itemTypesCombined_pk` PRIMARY KEY(`itemTypeID`)
);
--> statement-breakpoint
CREATE TABLE `fields` (
	`fieldID` integer,
	`fieldName` text,
	`fieldFormatID` integer,
	CONSTRAINT `fields_pk` PRIMARY KEY(`fieldID`),
	CONSTRAINT `fk_fields_fieldFormatID_fieldFormats_fieldFormatID_fk` FOREIGN KEY (`fieldFormatID`) REFERENCES `fieldFormats`(`fieldFormatID`)
);
--> statement-breakpoint
CREATE TABLE `fieldsCombined` (
	`fieldID` integer,
	`fieldName` text NOT NULL,
	`label` text,
	`fieldFormatID` integer,
	`custom` integer NOT NULL,
	CONSTRAINT `fieldsCombined_pk` PRIMARY KEY(`fieldID`)
);
--> statement-breakpoint
CREATE TABLE `itemTypeFields` (
	`itemTypeID` integer,
	`fieldID` integer,
	`hide` integer,
	`orderIndex` integer,
	CONSTRAINT `itemTypeFields_pk` PRIMARY KEY(`itemTypeID`, `orderIndex`),
	CONSTRAINT `fk_itemTypeFields_fieldID_fields_fieldID_fk` FOREIGN KEY (`fieldID`) REFERENCES `fields`(`fieldID`),
	CONSTRAINT `fk_itemTypeFields_itemTypeID_itemTypes_itemTypeID_fk` FOREIGN KEY (`itemTypeID`) REFERENCES `itemTypes`(`itemTypeID`)
);
--> statement-breakpoint
CREATE TABLE `itemTypeFieldsCombined` (
	`itemTypeID` integer NOT NULL,
	`fieldID` integer NOT NULL,
	`hide` integer,
	`orderIndex` integer NOT NULL,
	CONSTRAINT `itemTypeFieldsCombined_pk` PRIMARY KEY(`itemTypeID`, `orderIndex`)
);
--> statement-breakpoint
CREATE TABLE `baseFieldMappings` (
	`itemTypeID` integer,
	`baseFieldID` integer,
	`fieldID` integer,
	CONSTRAINT `baseFieldMappings_pk` PRIMARY KEY(`itemTypeID`, `baseFieldID`, `fieldID`),
	CONSTRAINT `fk_baseFieldMappings_fieldID_fields_fieldID_fk` FOREIGN KEY (`fieldID`) REFERENCES `fields`(`fieldID`),
	CONSTRAINT `fk_baseFieldMappings_baseFieldID_fields_fieldID_fk` FOREIGN KEY (`baseFieldID`) REFERENCES `fields`(`fieldID`),
	CONSTRAINT `fk_baseFieldMappings_itemTypeID_itemTypes_itemTypeID_fk` FOREIGN KEY (`itemTypeID`) REFERENCES `itemTypes`(`itemTypeID`)
);
--> statement-breakpoint
CREATE TABLE `baseFieldMappingsCombined` (
	`itemTypeID` integer,
	`baseFieldID` integer,
	`fieldID` integer,
	CONSTRAINT `baseFieldMappingsCombined_pk` PRIMARY KEY(`itemTypeID`, `baseFieldID`, `fieldID`)
);
--> statement-breakpoint
CREATE TABLE `creatorTypes` (
	`creatorTypeID` integer,
	`creatorType` text,
	CONSTRAINT `creatorTypes_pk` PRIMARY KEY(`creatorTypeID`)
);
--> statement-breakpoint
CREATE TABLE `itemTypeCreatorTypes` (
	`itemTypeID` integer,
	`creatorTypeID` integer,
	`primaryField` integer,
	CONSTRAINT `itemTypeCreatorTypes_pk` PRIMARY KEY(`itemTypeID`, `creatorTypeID`),
	CONSTRAINT `fk_itemTypeCreatorTypes_creatorTypeID_creatorTypes_creatorTypeID_fk` FOREIGN KEY (`creatorTypeID`) REFERENCES `creatorTypes`(`creatorTypeID`),
	CONSTRAINT `fk_itemTypeCreatorTypes_itemTypeID_itemTypes_itemTypeID_fk` FOREIGN KEY (`itemTypeID`) REFERENCES `itemTypes`(`itemTypeID`)
);
--> statement-breakpoint
CREATE TABLE `version` (
	`schema` text,
	`version` integer NOT NULL,
	CONSTRAINT `version_pk` PRIMARY KEY(`schema`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`setting` text,
	`key` text,
	`value` ,
	CONSTRAINT `settings_pk` PRIMARY KEY(`setting`, `key`)
);
--> statement-breakpoint
CREATE TABLE `syncedSettings` (
	`setting` text NOT NULL,
	`libraryID` integer NOT NULL,
	`value`  NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`synced` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `syncedSettings_pk` PRIMARY KEY(`setting`, `libraryID`),
	CONSTRAINT `fk_syncedSettings_libraryID_libraries_libraryID_fk` FOREIGN KEY (`libraryID`) REFERENCES `libraries`(`libraryID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `items` (
	`itemID` integer,
	`itemTypeID` integer NOT NULL,
	`dateAdded` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`dateModified` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`clientDateModified` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`libraryID` integer NOT NULL,
	`key` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`synced` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `items_pk` PRIMARY KEY(`itemID`),
	CONSTRAINT `fk_items_libraryID_libraries_libraryID_fk` FOREIGN KEY (`libraryID`) REFERENCES `libraries`(`libraryID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `itemDataValues` (
	`valueID` integer,
	`value`  UNIQUE,
	CONSTRAINT `itemDataValues_pk` PRIMARY KEY(`valueID`)
);
--> statement-breakpoint
CREATE TABLE `itemData` (
	`itemID` integer,
	`fieldID` integer,
	`valueID` ,
	CONSTRAINT `itemData_pk` PRIMARY KEY(`itemID`, `fieldID`),
	CONSTRAINT `fk_itemData_valueID_itemDataValues_valueID_fk` FOREIGN KEY (`valueID`) REFERENCES `itemDataValues`(`valueID`),
	CONSTRAINT `fk_itemData_fieldID_fieldsCombined_fieldID_fk` FOREIGN KEY (`fieldID`) REFERENCES `fieldsCombined`(`fieldID`),
	CONSTRAINT `fk_itemData_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `itemNotes` (
	`itemID` integer,
	`parentItemID` integer,
	`note` text,
	`title` text,
	CONSTRAINT `itemNotes_pk` PRIMARY KEY(`itemID`),
	CONSTRAINT `fk_itemNotes_parentItemID_items_itemID_fk` FOREIGN KEY (`parentItemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE,
	CONSTRAINT `fk_itemNotes_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `itemAttachments` (
	`itemID` integer,
	`parentItemID` integer,
	`linkMode` integer,
	`contentType` text,
	`charsetID` integer,
	`path` text,
	`syncState` integer DEFAULT 0,
	`storageModTime` integer,
	`storageHash` text,
	`lastProcessedModificationTime` integer,
	`lastRead` integer,
	CONSTRAINT `itemAttachments_pk` PRIMARY KEY(`itemID`),
	CONSTRAINT `fk_itemAttachments_charsetID_charsets_charsetID_fk` FOREIGN KEY (`charsetID`) REFERENCES `charsets`(`charsetID`) ON DELETE SET NULL,
	CONSTRAINT `fk_itemAttachments_parentItemID_items_itemID_fk` FOREIGN KEY (`parentItemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE,
	CONSTRAINT `fk_itemAttachments_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `itemAnnotations` (
	`itemID` integer,
	`parentItemID` integer NOT NULL,
	`type` integer NOT NULL,
	`authorName` text,
	`text` text,
	`comment` text,
	`color` text,
	`pageLabel` text,
	`sortIndex` text NOT NULL,
	`position` text NOT NULL,
	`isExternal` integer NOT NULL,
	CONSTRAINT `itemAnnotations_pk` PRIMARY KEY(`itemID`),
	CONSTRAINT `fk_itemAnnotations_parentItemID_itemAttachments_itemID_fk` FOREIGN KEY (`parentItemID`) REFERENCES `itemAttachments`(`itemID`),
	CONSTRAINT `fk_itemAnnotations_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`tagID` integer,
	`name` text NOT NULL UNIQUE,
	CONSTRAINT `tags_pk` PRIMARY KEY(`tagID`)
);
--> statement-breakpoint
CREATE TABLE `itemRelations` (
	`itemID` integer NOT NULL,
	`predicateID` integer NOT NULL,
	`object` text NOT NULL,
	CONSTRAINT `itemRelations_pk` PRIMARY KEY(`itemID`, `predicateID`, `object`),
	CONSTRAINT `fk_itemRelations_predicateID_relationPredicates_predicateID_fk` FOREIGN KEY (`predicateID`) REFERENCES `relationPredicates`(`predicateID`) ON DELETE CASCADE,
	CONSTRAINT `fk_itemRelations_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `itemTags` (
	`itemID` integer NOT NULL,
	`tagID` integer NOT NULL,
	`type` integer NOT NULL,
	CONSTRAINT `itemTags_pk` PRIMARY KEY(`itemID`, `tagID`),
	CONSTRAINT `fk_itemTags_tagID_tags_tagID_fk` FOREIGN KEY (`tagID`) REFERENCES `tags`(`tagID`) ON DELETE CASCADE,
	CONSTRAINT `fk_itemTags_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `creators` (
	`creatorID` integer,
	`firstName` text,
	`lastName` text,
	`fieldMode` integer,
	CONSTRAINT `creators_pk` PRIMARY KEY(`creatorID`)
);
--> statement-breakpoint
CREATE TABLE `itemCreators` (
	`itemID` integer NOT NULL,
	`creatorID` integer NOT NULL,
	`creatorTypeID` integer DEFAULT 1 NOT NULL,
	`orderIndex` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `itemCreators_pk` PRIMARY KEY(`itemID`, `creatorID`, `creatorTypeID`, `orderIndex`),
	CONSTRAINT `fk_itemCreators_creatorTypeID_creatorTypes_creatorTypeID_fk` FOREIGN KEY (`creatorTypeID`) REFERENCES `creatorTypes`(`creatorTypeID`),
	CONSTRAINT `fk_itemCreators_creatorID_creators_creatorID_fk` FOREIGN KEY (`creatorID`) REFERENCES `creators`(`creatorID`) ON DELETE CASCADE,
	CONSTRAINT `fk_itemCreators_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`collectionID` integer,
	`collectionName` text NOT NULL,
	`parentCollectionID` integer DEFAULT NULL,
	`clientDateModified` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`libraryID` integer NOT NULL,
	`key` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`synced` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `collections_pk` PRIMARY KEY(`collectionID`),
	CONSTRAINT `fk_collections_parentCollectionID_collections_collectionID_fk` FOREIGN KEY (`parentCollectionID`) REFERENCES `collections`(`collectionID`) ON DELETE CASCADE,
	CONSTRAINT `fk_collections_libraryID_libraries_libraryID_fk` FOREIGN KEY (`libraryID`) REFERENCES `libraries`(`libraryID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `collectionItems` (
	`collectionID` integer NOT NULL,
	`itemID` integer NOT NULL,
	`orderIndex` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `collectionItems_pk` PRIMARY KEY(`collectionID`, `itemID`),
	CONSTRAINT `fk_collectionItems_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE,
	CONSTRAINT `fk_collectionItems_collectionID_collections_collectionID_fk` FOREIGN KEY (`collectionID`) REFERENCES `collections`(`collectionID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `collectionRelations` (
	`collectionID` integer NOT NULL,
	`predicateID` integer NOT NULL,
	`object` text NOT NULL,
	CONSTRAINT `collectionRelations_pk` PRIMARY KEY(`collectionID`, `predicateID`, `object`),
	CONSTRAINT `fk_collectionRelations_predicateID_relationPredicates_predicateID_fk` FOREIGN KEY (`predicateID`) REFERENCES `relationPredicates`(`predicateID`) ON DELETE CASCADE,
	CONSTRAINT `fk_collectionRelations_collectionID_collections_collectionID_fk` FOREIGN KEY (`collectionID`) REFERENCES `collections`(`collectionID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `feeds` (
	`libraryID` integer,
	`name` text NOT NULL,
	`url` text NOT NULL UNIQUE,
	`lastUpdate` TIMESTAMP,
	`lastCheck` TIMESTAMP,
	`lastCheckError` text,
	`cleanupReadAfter` integer,
	`cleanupUnreadAfter` integer,
	`refreshInterval` integer,
	CONSTRAINT `feeds_pk` PRIMARY KEY(`libraryID`),
	CONSTRAINT `fk_feeds_libraryID_libraries_libraryID_fk` FOREIGN KEY (`libraryID`) REFERENCES `libraries`(`libraryID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `feedItems` (
	`itemID` integer,
	`guid` text NOT NULL UNIQUE,
	`readTime` TIMESTAMP,
	`translatedTime` TIMESTAMP,
	CONSTRAINT `feedItems_pk` PRIMARY KEY(`itemID`),
	CONSTRAINT `fk_feedItems_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `savedSearches` (
	`savedSearchID` integer,
	`savedSearchName` text NOT NULL,
	`clientDateModified` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`libraryID` integer NOT NULL,
	`key` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`synced` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `savedSearches_pk` PRIMARY KEY(`savedSearchID`),
	CONSTRAINT `fk_savedSearches_libraryID_libraries_libraryID_fk` FOREIGN KEY (`libraryID`) REFERENCES `libraries`(`libraryID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `savedSearchConditions` (
	`savedSearchID` integer NOT NULL,
	`searchConditionID` integer NOT NULL,
	`condition` text NOT NULL,
	`operator` text,
	`value` text,
	`required` NONE,
	CONSTRAINT `savedSearchConditions_pk` PRIMARY KEY(`savedSearchID`, `searchConditionID`),
	CONSTRAINT `fk_savedSearchConditions_savedSearchID_savedSearches_savedSearchID_fk` FOREIGN KEY (`savedSearchID`) REFERENCES `savedSearches`(`savedSearchID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `deletedCollections` (
	`collectionID` integer,
	`dateDeleted`  DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT `deletedCollections_pk` PRIMARY KEY(`collectionID`),
	CONSTRAINT `fk_deletedCollections_collectionID_collections_collectionID_fk` FOREIGN KEY (`collectionID`) REFERENCES `collections`(`collectionID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `deletedItems` (
	`itemID` integer,
	`dateDeleted`  DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT `deletedItems_pk` PRIMARY KEY(`itemID`),
	CONSTRAINT `fk_deletedItems_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `deletedSearches` (
	`savedSearchID` integer,
	`dateDeleted`  DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT `deletedSearches_pk` PRIMARY KEY(`savedSearchID`),
	CONSTRAINT `fk_deletedSearches_savedSearchID_savedSearches_savedSearchID_fk` FOREIGN KEY (`savedSearchID`) REFERENCES `savedSearches`(`savedSearchID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `libraries` (
	`libraryID` integer,
	`type` text NOT NULL,
	`editable` integer NOT NULL,
	`filesEditable` integer NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`storageVersion` integer DEFAULT 0 NOT NULL,
	`lastSync` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`isAdmin` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `libraries_pk` PRIMARY KEY(`libraryID`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`userID` integer,
	`name` text NOT NULL,
	CONSTRAINT `users_pk` PRIMARY KEY(`userID`)
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`groupID` integer,
	`libraryID` integer NOT NULL UNIQUE,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`version` integer NOT NULL,
	CONSTRAINT `groups_pk` PRIMARY KEY(`groupID`),
	CONSTRAINT `fk_groups_libraryID_libraries_libraryID_fk` FOREIGN KEY (`libraryID`) REFERENCES `libraries`(`libraryID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `groupItems` (
	`itemID` integer,
	`createdByUserID` integer,
	`lastModifiedByUserID` integer,
	CONSTRAINT `groupItems_pk` PRIMARY KEY(`itemID`),
	CONSTRAINT `fk_groupItems_lastModifiedByUserID_users_userID_fk` FOREIGN KEY (`lastModifiedByUserID`) REFERENCES `users`(`userID`) ON DELETE SET NULL,
	CONSTRAINT `fk_groupItems_createdByUserID_users_userID_fk` FOREIGN KEY (`createdByUserID`) REFERENCES `users`(`userID`) ON DELETE SET NULL,
	CONSTRAINT `fk_groupItems_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `publicationsItems` (
	`itemID` integer,
	CONSTRAINT `publicationsItems_pk` PRIMARY KEY(`itemID`)
);
--> statement-breakpoint
CREATE TABLE `retractedItems` (
	`itemID` integer,
	`data` text,
	`flag` integer DEFAULT 0,
	CONSTRAINT `retractedItems_pk` PRIMARY KEY(`itemID`),
	CONSTRAINT `fk_retractedItems_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `fulltextItems` (
	`itemID` integer,
	`indexedPages` integer,
	`totalPages` integer,
	`indexedChars` integer,
	`totalChars` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`synced` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fulltextItems_pk` PRIMARY KEY(`itemID`),
	CONSTRAINT `fk_fulltextItems_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `fulltextWords` (
	`wordID` integer,
	`word` text UNIQUE,
	CONSTRAINT `fulltextWords_pk` PRIMARY KEY(`wordID`)
);
--> statement-breakpoint
CREATE TABLE `fulltextItemWords` (
	`wordID` integer,
	`itemID` integer,
	CONSTRAINT `fulltextItemWords_pk` PRIMARY KEY(`wordID`, `itemID`),
	CONSTRAINT `fk_fulltextItemWords_itemID_items_itemID_fk` FOREIGN KEY (`itemID`) REFERENCES `items`(`itemID`) ON DELETE CASCADE,
	CONSTRAINT `fk_fulltextItemWords_wordID_fulltextWords_wordID_fk` FOREIGN KEY (`wordID`) REFERENCES `fulltextWords`(`wordID`)
);
--> statement-breakpoint
CREATE TABLE `syncCache` (
	`libraryID` integer NOT NULL,
	`key` text NOT NULL,
	`syncObjectTypeID` integer NOT NULL,
	`version` integer NOT NULL,
	`data` text,
	CONSTRAINT `syncCache_pk` PRIMARY KEY(`libraryID`, `key`, `syncObjectTypeID`, `version`),
	CONSTRAINT `fk_syncCache_syncObjectTypeID_syncObjectTypes_syncObjectTypeID_fk` FOREIGN KEY (`syncObjectTypeID`) REFERENCES `syncObjectTypes`(`syncObjectTypeID`),
	CONSTRAINT `fk_syncCache_libraryID_libraries_libraryID_fk` FOREIGN KEY (`libraryID`) REFERENCES `libraries`(`libraryID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `syncDeleteLog` (
	`syncObjectTypeID` integer NOT NULL,
	`libraryID` integer NOT NULL,
	`key` text NOT NULL,
	`dateDeleted` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT `fk_syncDeleteLog_libraryID_libraries_libraryID_fk` FOREIGN KEY (`libraryID`) REFERENCES `libraries`(`libraryID`) ON DELETE CASCADE,
	CONSTRAINT `fk_syncDeleteLog_syncObjectTypeID_syncObjectTypes_syncObjectTypeID_fk` FOREIGN KEY (`syncObjectTypeID`) REFERENCES `syncObjectTypes`(`syncObjectTypeID`)
);
--> statement-breakpoint
CREATE TABLE `syncQueue` (
	`libraryID` integer NOT NULL,
	`key` text NOT NULL,
	`syncObjectTypeID` integer NOT NULL,
	`lastCheck` TIMESTAMP,
	`tries` integer,
	CONSTRAINT `syncQueue_pk` PRIMARY KEY(`libraryID`, `key`, `syncObjectTypeID`),
	CONSTRAINT `fk_syncQueue_syncObjectTypeID_syncObjectTypes_syncObjectTypeID_fk` FOREIGN KEY (`syncObjectTypeID`) REFERENCES `syncObjectTypes`(`syncObjectTypeID`) ON DELETE CASCADE,
	CONSTRAINT `fk_syncQueue_libraryID_libraries_libraryID_fk` FOREIGN KEY (`libraryID`) REFERENCES `libraries`(`libraryID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `storageDeleteLog` (
	`libraryID` integer NOT NULL,
	`key` text NOT NULL,
	`dateDeleted` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT `storageDeleteLog_pk` PRIMARY KEY(`libraryID`, `key`),
	CONSTRAINT `fk_storageDeleteLog_libraryID_libraries_libraryID_fk` FOREIGN KEY (`libraryID`) REFERENCES `libraries`(`libraryID`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `proxies` (
	`proxyID` integer,
	`multiHost` integer,
	`autoAssociate` integer,
	`scheme` text,
	CONSTRAINT `proxies_pk` PRIMARY KEY(`proxyID`)
);
--> statement-breakpoint
CREATE TABLE `proxyHosts` (
	`hostID` integer,
	`proxyID` integer,
	`hostname` text,
	CONSTRAINT `proxyHosts_pk` PRIMARY KEY(`hostID`),
	CONSTRAINT `fk_proxyHosts_proxyID_proxies_proxyID_fk` FOREIGN KEY (`proxyID`) REFERENCES `proxies`(`proxyID`)
);
--> statement-breakpoint
CREATE TABLE `relationPredicates` (
	`predicateID` integer,
	`predicate` text UNIQUE,
	CONSTRAINT `relationPredicates_pk` PRIMARY KEY(`predicateID`)
);
--> statement-breakpoint
CREATE TABLE `customItemTypes` (
	`customItemTypeID` integer,
	`typeName` text,
	`label` text,
	`display` integer DEFAULT 1,
	`icon` text,
	CONSTRAINT `customItemTypes_pk` PRIMARY KEY(`customItemTypeID`)
);
--> statement-breakpoint
CREATE TABLE `customFields` (
	`customFieldID` integer,
	`fieldName` text,
	`label` text,
	CONSTRAINT `customFields_pk` PRIMARY KEY(`customFieldID`)
);
--> statement-breakpoint
CREATE TABLE `customItemTypeFields` (
	`customItemTypeID` integer NOT NULL,
	`fieldID` integer,
	`customFieldID` integer,
	`hide` integer NOT NULL,
	`orderIndex` integer NOT NULL,
	CONSTRAINT `customItemTypeFields_pk` PRIMARY KEY(`customItemTypeID`, `orderIndex`),
	CONSTRAINT `fk_customItemTypeFields_customFieldID_customFields_customFieldID_fk` FOREIGN KEY (`customFieldID`) REFERENCES `customFields`(`customFieldID`),
	CONSTRAINT `fk_customItemTypeFields_fieldID_fields_fieldID_fk` FOREIGN KEY (`fieldID`) REFERENCES `fields`(`fieldID`),
	CONSTRAINT `fk_customItemTypeFields_customItemTypeID_customItemTypes_customItemTypeID_fk` FOREIGN KEY (`customItemTypeID`) REFERENCES `customItemTypes`(`customItemTypeID`)
);
--> statement-breakpoint
CREATE TABLE `customBaseFieldMappings` (
	`customItemTypeID` integer,
	`baseFieldID` integer,
	`customFieldID` integer,
	CONSTRAINT `customBaseFieldMappings_pk` PRIMARY KEY(`customItemTypeID`, `baseFieldID`, `customFieldID`),
	CONSTRAINT `fk_customBaseFieldMappings_customFieldID_customFields_customFieldID_fk` FOREIGN KEY (`customFieldID`) REFERENCES `customFields`(`customFieldID`),
	CONSTRAINT `fk_customBaseFieldMappings_baseFieldID_fields_fieldID_fk` FOREIGN KEY (`baseFieldID`) REFERENCES `fields`(`fieldID`),
	CONSTRAINT `fk_customBaseFieldMappings_customItemTypeID_customItemTypes_customItemTypeID_fk` FOREIGN KEY (`customItemTypeID`) REFERENCES `customItemTypes`(`customItemTypeID`)
);
--> statement-breakpoint
CREATE TABLE `translatorCache` (
	`fileName` text,
	`metadataJSON` text,
	`lastModifiedTime` integer,
	CONSTRAINT `translatorCache_pk` PRIMARY KEY(`fileName`)
);
--> statement-breakpoint
CREATE TABLE `dbDebug1` (
	`a` integer,
	CONSTRAINT `dbDebug1_pk` PRIMARY KEY(`a`)
);
--> statement-breakpoint
CREATE INDEX `baseFieldMappings_fieldID` ON `baseFieldMappings` (`fieldID`);--> statement-breakpoint
CREATE INDEX `baseFieldMappings_baseFieldID` ON `baseFieldMappings` (`baseFieldID`);--> statement-breakpoint
CREATE INDEX `baseFieldMappingsCombined_fieldID` ON `baseFieldMappingsCombined` (`fieldID`);--> statement-breakpoint
CREATE INDEX `baseFieldMappingsCombined_baseFieldID` ON `baseFieldMappingsCombined` (`baseFieldID`);--> statement-breakpoint
CREATE INDEX `charsets_charset` ON `charsets` (`charset`);--> statement-breakpoint
CREATE INDEX `collectionItems_itemID` ON `collectionItems` (`itemID`);--> statement-breakpoint
CREATE INDEX `collectionRelations_object` ON `collectionRelations` (`object`);--> statement-breakpoint
CREATE INDEX `collectionRelations_predicateID` ON `collectionRelations` (`predicateID`);--> statement-breakpoint
CREATE INDEX `collections_synced` ON `collections` (`synced`);--> statement-breakpoint
CREATE INDEX `customBaseFieldMappings_customFieldID` ON `customBaseFieldMappings` (`customFieldID`);--> statement-breakpoint
CREATE INDEX `customBaseFieldMappings_baseFieldID` ON `customBaseFieldMappings` (`baseFieldID`);--> statement-breakpoint
CREATE INDEX `customItemTypeFields_customFieldID` ON `customItemTypeFields` (`customFieldID`);--> statement-breakpoint
CREATE INDEX `customItemTypeFields_fieldID` ON `customItemTypeFields` (`fieldID`);--> statement-breakpoint
CREATE INDEX `deletedCollections_dateDeleted` ON `deletedCollections` (`dateDeleted`);--> statement-breakpoint
CREATE INDEX `deletedSearches_dateDeleted` ON `deletedItems` (`dateDeleted`);--> statement-breakpoint
CREATE INDEX `deletedItems_dateDeleted` ON `deletedItems` (`dateDeleted`);--> statement-breakpoint
CREATE INDEX `fileTypeMimeTypes_mimeType` ON `fileTypeMimeTypes` (`mimeType`);--> statement-breakpoint
CREATE INDEX `fileTypes_fileType` ON `fileTypes` (`fileType`);--> statement-breakpoint
CREATE INDEX `fulltextItems_version` ON `fulltextItems` (`version`);--> statement-breakpoint
CREATE INDEX `fulltextItems_synced` ON `fulltextItems` (`synced`);--> statement-breakpoint
CREATE INDEX `fulltextItemWords_itemID` ON `fulltextItemWords` (`itemID`);--> statement-breakpoint
CREATE INDEX `itemAnnotations_parentItemID` ON `itemAnnotations` (`parentItemID`);--> statement-breakpoint
CREATE INDEX `itemAttachments_lastRead` ON `itemAttachments` (`lastRead`);--> statement-breakpoint
CREATE INDEX `itemAttachments_lastProcessedModificationTime` ON `itemAttachments` (`lastProcessedModificationTime`);--> statement-breakpoint
CREATE INDEX `itemAttachments_syncState` ON `itemAttachments` (`syncState`);--> statement-breakpoint
CREATE INDEX `itemAttachments_contentType` ON `itemAttachments` (`contentType`);--> statement-breakpoint
CREATE INDEX `itemAttachments_charsetID` ON `itemAttachments` (`charsetID`);--> statement-breakpoint
CREATE INDEX `itemAttachments_parentItemID` ON `itemAttachments` (`parentItemID`);--> statement-breakpoint
CREATE INDEX `itemCreators_creatorTypeID` ON `itemCreators` (`creatorTypeID`);--> statement-breakpoint
CREATE INDEX `itemData_valueID` ON `itemData` (`valueID`);--> statement-breakpoint
CREATE INDEX `itemData_fieldID` ON `itemData` (`fieldID`);--> statement-breakpoint
CREATE INDEX `itemNotes_parentItemID` ON `itemNotes` (`parentItemID`);--> statement-breakpoint
CREATE INDEX `itemRelations_object` ON `itemRelations` (`object`);--> statement-breakpoint
CREATE INDEX `itemRelations_predicateID` ON `itemRelations` (`predicateID`);--> statement-breakpoint
CREATE INDEX `items_synced` ON `items` (`synced`);--> statement-breakpoint
CREATE INDEX `itemTags_tagID` ON `itemTags` (`tagID`);--> statement-breakpoint
CREATE INDEX `itemTypeCreatorTypes_creatorTypeID` ON `itemTypeCreatorTypes` (`creatorTypeID`);--> statement-breakpoint
CREATE INDEX `itemTypeFields_fieldID` ON `itemTypeFields` (`fieldID`);--> statement-breakpoint
CREATE INDEX `itemTypeFieldsCombined_fieldID` ON `itemTypeFieldsCombined` (`fieldID`);--> statement-breakpoint
CREATE INDEX `proxyHosts_proxyID` ON `proxyHosts` (`proxyID`);--> statement-breakpoint
CREATE INDEX `savedSearches_synced` ON `savedSearches` (`synced`);--> statement-breakpoint
CREATE INDEX `syncObjectTypes_name` ON `syncObjectTypes` (`name`);--> statement-breakpoint
CREATE INDEX `schema` ON `version` (`schema`);
*/