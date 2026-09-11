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
  /** The popover that explains the template token under the pointer. */
  templateHover: "zt-template-hover",
} as const;

/**
 * The stable CSS custom properties ZotLit reads, for a value a theme states
 * rather than a rule it writes. Set one anywhere the surface inherits from —
 * `body` reaches every one of them.
 */
export const themeProperty = {
  /** The fill colour of a Literature Note's node in the graph views. */
  graphLiteratureNote: "--zt-graph-literature-note-color",
  /** The fill colour of a Cited Work Node in the graph views. */
  graphCitedWorkNode: "--zt-graph-cited-work-node-color",
  /** The line colour of a citation edge in the graph views. */
  graphCitationLink: "--zt-graph-citation-link-color",
} as const;
