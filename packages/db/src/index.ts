export {
  getLibraries,
  getLibrariesAsync,
  getLibraryByGroupID,
  type Library,
} from "./queries/libraries";
export { type GroupIDMemo } from "./queries/_groups";
export {
  getItemsByID,
  getItemTypeByKey,
  getItemsByLibrary,
  getItemsByKey,
  getItemsByLibraryAsync,
  isChildItemFields,
  type BaseItem,
  type ChildItemFields,
  type Creator,
  type Item,
} from "./queries/items";
export {
  itemToCsl,
  type CslDate,
  type CslItemData,
  type CslName,
} from "./lib/zt-csl-item";
export { getZoteroIdentity, type ZoteroUserIdentity } from "./queries/account";
export {
  getItemDisplayInfoByID,
  getItemDisplayRefByID,
  getItemRefByID,
  type ItemDisplayInfo,
  type ItemRef,
} from "./queries/item-ref";
export {
  formatIndexedKey,
  isIndexedKey,
  parseIndexedKey,
  type ParsedIndexedKey,
  resolveIndexedKeyLibrary,
} from "./lib/zt-key";
export { isItemKey } from "./lib/zt-item-key";
export {
  annotationOpenUri,
  attachmentOpenUri,
  itemSelectUri,
} from "./lib/zt-uri";
export { USER_LIBRARY_ID } from "./lib/constants";
export {
  getAnnotationsByKey,
  getAnnotationsByItemId,
} from "./queries/annotations";
export {
  getAttachmentByKey,
  getAttachmentsByParents,
} from "./queries/attachments";
export {
  getChildNotesByParentIDs,
  getNoteByItemID,
  getNoteByKey,
  getNoteRefsByItemIDs,
  getTrashedNoteItemIDs,
  type ChildNote,
  type Note,
} from "./queries/notes";
export { getCitekeyByItemKey, getItemIDByCitekey } from "./queries/citekey";
export { resolveItemTags, type TagMemo } from "./queries/tags";
export { CollectionCache, type TemplateCollection } from "./lib/zt-collection";
export {
  getAnnotViewAnnotations,
  getAnnotViewAttachments,
  type AnnotViewAttachment,
  type AnnotViewItem,
} from "./queries/annot-view";
export { type ItemTag, type TemplateTag } from "./lib/zt-tag";
export { type Attachment } from "./lib/zt-attach";
export {
  getCollectionIDByKey,
  getIndexedItemIDsByCollection,
  getNoteItemIDsByCollection,
  getNoteItemIDsByLibrary,
} from "./queries/batch-scope";
export {
  getIndexedItemIDsByLibrary,
  getIndexedItemsByID,
  getIndexSignature,
  type IndexedCreator,
  type IndexedItem,
  type IndexSignature,
} from "./queries/index-items";
export { formatItemDate, parseItemDate, type ItemDate } from "./lib/zt-date";
export { parseItemExtra, type ExtraLine, type ItemExtra } from "./lib/zt-extra";
export {
  annotationTypeToName,
  type Annotation,
  type AnnotationType,
  type ResolvedAnnotationTypeName,
} from "./lib/zt-annot";
export {
  withAnnotationCitation,
  type AnnotationTemplateContext,
  type TemplateAnnotation,
} from "./lib/context/zt-template-annot";
export {
  type FallibleTemplateLink,
  type TemplateFilenameItemData,
  type TemplateItemData,
  type TemplateLink,
  type TemplateParentItemData,
} from "./lib/context/zt-template-item";
export {
  citekeysToCiteTemplateData,
  DEFAULT_LOCATOR_LABEL_SHORT,
  narrowBaseDataToCiteItemData,
  resolveCitedItem,
  type CiteRef,
  type ResolvedCiteRef,
} from "./lib/context/zt-template-cite";
export { attachmentToTemplateData } from "./lib/context/zt-template-attach";
export {
  annotationColorToName,
  type AnnotationColorName,
  highlightColorToName,
  textColorToName,
} from "./lib/zt-color";
export {
  createLanguageLookup,
  parseItemLanguage,
  type ItemLanguage,
  type LanguageNameLookup,
} from "./lib/zt-lang";
export {
  parseAnnotationData,
  parseCitationData,
  parseEmbeddedCitationItems,
  parseEmbeddedCitationSnapshot,
  type AnnotationInfo,
  type CitationInfo,
  type CitationItem,
  type ZoteroRef,
} from "./lib/zt-note-mark";
export {
  buildFilenameContext,
  type NoteTemplateContext,
  type TemplateNoteLink,
} from "./lib/context/zt-template-note";
export {
  fetchAnnotationsTemplateData,
  fetchNoteContext,
  type AnnotationResolvers,
  type NoteResolvers,
} from "./lib/context/note-context";
export {
  CONTRACT_ROOTS,
  CONTRACT_VERSION,
  TEMPLATE_SLOT_ROOTS,
  templateSlotsForRoot,
  type ContractRoot,
  type TemplateSlot,
} from "./contract/roots";
