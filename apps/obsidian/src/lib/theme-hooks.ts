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
  templateFrontmatter: "zt-template-frontmatter",
  templateMarkdownListMarker: "zt-template-markdown-list-marker",
  templateMarkdownMarker: "zt-template-markdown-marker",
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
  /** The SVG ZotLit draws Zotero's Annotations into, one per rendered PDF page. */
  pdfAnnotationOverlay: "zt-pdf-annotation-overlay",
  /**
   * One Annotation Mark inside that overlay. `data-zotero-annotation-type`
   * names its Zotero type and `data-zotero-annotation-key` its Indexed Key;
   * the selected mark also carries Obsidian's own `is-selected`.
   */
  pdfAnnotationMark: "zt-pdf-annotation-mark",
  /** The filled rectangle of a highlight Annotation Mark, which blends with the page. */
  pdfAnnotationHighlight: "zt-pdf-annotation-highlight",
  /** The folded corner of a note Annotation Mark, which takes the page's own colour. */
  pdfAnnotationNoteFold: "zt-pdf-annotation-note-fold",
  /**
   * The always-present Editing Capability affordance in the PDF reader's own
   * toolbar. `data-zt-capability-tone` names the state it is showing —
   * `ready`, `action`, `busy` or `warning`.
   */
  pdfCapability: "zt-pdf-capability",
  /**
   * The Mark Popup, on Obsidian's own hover popover. Each control inside it
   * carries `data-zt-verb` — `color`, `comment`, `copy`, `delete`, `reveal`, or
   * `stack` for the stepper through overlapping marks.
   */
  pdfMarkPopup: "zt-pdf-mark-popup",
} as const;

/**
 * The stable CSS custom properties ZotLit reads, for a value a theme states
 * rather than a rule it writes. Set one anywhere the surface inherits from —
 * `body` reaches every one of them.
 */
export const themeProperty = {
  /** The initial color of a new native Literature Notes Group. */
  graphLiteratureNote: "--zt-graph-literature-note-color",
  /** The fill colour of a Cited Work Node in the graph views. */
  graphCitedWorkNode: "--zt-graph-cited-work-node-color",
  /** The line colour of a citation edge in the graph views. */
  graphCitationLink: "--zt-graph-citation-link-color",
} as const;
