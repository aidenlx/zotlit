// What one protocol link or pushed request ended with: the notice it shows
// reads it, and so do the tests.

import { Data } from "effect";
import type { Exit } from "effect";

import type { BatchUpdateResult } from "@/services/note-feature/update-batch";
import type { BatchImportResult } from "@/services/note-import/batch-import";

export type ProtocolOutcome = Data.TaggedEnum<{
  /** The link's query does not parse. */
  InvalidLink: {};
  /** The link names another Zotero, so the handler leaves it. */
  ForeignSource: {};
  /** The Zotero database is not ready for the item the link names. */
  DatabaseUnavailable: {};
  /** The link names an id with no live item. */
  ItemNotFound: {};
  /** The `profileId` text names neither `default` nor a Profile ID. */
  UnknownProfile: { readonly text: string };
  /** The note, the explorer or the Attachment picker the link names opened. */
  Opened: {};
  /** The batch update of an `update-many` link or a pushed update ended. */
  UpdateMany: { readonly exit: Exit.Exit<BatchUpdateResult, unknown> };
  /** The library-wide update of an `update-all` link ended. */
  UpdateAll: { readonly exit: Exit.Exit<BatchUpdateResult, unknown> };
  /** The import of an `import-note(s)` link or a pushed import ended. */
  ImportNotes: { readonly exit: Exit.Exit<BatchImportResult, unknown> };
  /** The library-wide import of an `import-all-notes` link ended. */
  ImportAllNotes: { readonly exit: Exit.Exit<BatchImportResult, unknown> };
  /** The clipboard Profile opened in the workbench. */
  ProfileOpened: {};
  /** The user closed the Profile import without a document. */
  ProfileImportCancelled: {};
  /** The clipboard Profile import or its open failed. */
  ProfileImportFailed: {};
}>;

export const ProtocolOutcome = Data.taggedEnum<ProtocolOutcome>();
