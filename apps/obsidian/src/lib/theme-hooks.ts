// The stable CSS hooks ZotLit exposes to themes and CSS snippets.

export const themeHook = {
  citation: "zt-citation",
  citationKey: "zt-citation-key",
  citationKeyPending: "zt-citation-key-pending",
  citationKeyUnresolved: "zt-citation-key-unresolved",
  citationKeyPartiallyUnresolved: "zt-citation-key-partially-unresolved",
  citationKeyAmbiguous: "zt-citation-key-ambiguous",
  literatureNoteLink: "zt-literature-note-link",
  entrySerial: "zt-entry-serial",
  /** A template editor pane; the `--zt-template-*` colors are set here. */
  templateEditor: "zt-template-editor",
  templateDelimiter: "zt-template-delimiter",
  templateKeyword: "zt-template-keyword",
  templateVariable: "zt-template-variable",
  templateProperty: "zt-template-property",
  templateFilter: "zt-template-filter",
  templateString: "zt-template-string",
  templateValue: "zt-template-value",
  templateOperator: "zt-template-operator",
  templatePunctuation: "zt-template-punctuation",
  templateComment: "zt-template-comment",
  templateInvalid: "zt-template-invalid",
} as const;
