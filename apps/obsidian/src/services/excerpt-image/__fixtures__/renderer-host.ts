// The host modules the excerpt tree also reaches, as the browser trials see
// them: a trial drives the plugin's own logic in Chromium, and the seams that
// belong to Obsidian or to Node are aliased here. Every one of them throws, so
// a trial that accidentally needs a PDF host, a file, or a Zotero database
// fails loudly instead of quietly passing.

/** Obsidian's PDF.js host, which only a detached render reaches. */
export function loadPdfJs(): never {
  throw new Error("No PDF.js host in a browser trial");
}

/** The filesystem, which only the Zotero fallback read reaches. */
export function open(): never {
  throw new Error("No filesystem in a browser trial");
}

export function stat(): never {
  throw new Error("No filesystem in a browser trial");
}

/** Node's zlib, which only the external PNG check reaches. */
export function crc32(): never {
  throw new Error("No zlib in a browser trial");
}

export function inflateSync(): never {
  throw new Error("No zlib in a browser trial");
}

/** The Zotero database, which only a real request build reaches. */
export function getAttachmentByKey(): never {
  throw new Error("No Zotero database in a browser trial");
}

export function getZoteroDatabaseIdentity(): never {
  throw new Error("No Zotero database in a browser trial");
}

export function parseIndexedKey(): never {
  throw new Error("No Zotero database in a browser trial");
}

export function resolveIndexedKeyLibrary(): never {
  throw new Error("No Zotero database in a browser trial");
}

export function attachmentAbsPath(): never {
  throw new Error("No Zotero database in a browser trial");
}

export function resolveAnnotCachePath(): never {
  throw new Error("No Zotero database in a browser trial");
}
