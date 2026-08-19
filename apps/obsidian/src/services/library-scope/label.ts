// UI seam for Library Scope: the display name of one Library or selector.

import * as m from "@/lib/i18n/generated/messages";

import type { AvailableLibrary, LibrarySelector } from "./scope";

/** Zotero's live name for a Library, or its stable selector when unnamed. */
export function libraryLabel(library: AvailableLibrary): string {
  return library.name ?? selectorLabel(library.selector);
}

/**
 * A Library named by its stable selector alone — how an unavailable group
 * appears, since Library Scope persists no name to fall back on.
 */
export function selectorLabel(selector: LibrarySelector): string {
  return selector.type === "personal"
    ? m.settings_library_scope_personal()
    : m.settings_library_scope_group({ groupID: selector.groupID });
}
