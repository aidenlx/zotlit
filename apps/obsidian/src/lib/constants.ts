import { regex } from "arkregex";

export const FIELD_ZOTERO_KEY = "zotero-key";
export const PATTERN_ZOTERO_KEY = regex(
  "^(?<key>[23456789A-NP-Z]{8})(?:g(?<groupID>\\d+))?$",
);

export const FIELD_CITEKEY = "citekey";
export const FIELD_ATTACHMENTS = "zt-attachments";

export const MARKER_START = "%%zt-managed%%";
export const MARKER_END = "%%/zt-managed%%";

export const ZOTERO_DB_FILENAME = "zotero.sqlite";
export const ZOTERO_WAL_FILENAME = "zotero.sqlite-wal";
export const ZOTERO_DB_READ_TEMP_PREFIX = "zotlit-db-";
