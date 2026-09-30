// The names of the Directory's entry kinds and levels, shared by the pages and by the social cards the build renders.

import type { EntryKind, EntryLevel } from "./entry.ts";

/**
 * The site's messages. The pages import them; the build loads them only once
 * Paraglide has generated them, so both hand them in.
 */
type Messages = typeof import("#paraglide/messages.js").m;

export function kindLabels(m: Messages) {
  return {
    profile: m.docs_directory_kind_profile,
    partial: m.docs_directory_kind_partial,
    citation: m.docs_directory_kind_citation,
    "note-name": m.docs_directory_kind_note_name,
    property: m.docs_directory_kind_property,
  } satisfies Record<EntryKind, () => string>;
}

export function levelLabels(m: Messages) {
  return {
    "ready-to-use": m.docs_directory_level_ready,
    customize: m.docs_directory_level_customize,
  } satisfies Record<EntryLevel, () => string>;
}
