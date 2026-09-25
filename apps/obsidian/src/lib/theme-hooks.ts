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
  /**
   * The ring traced round a selected Annotation Mark's own merged
   * silhouette, in the accent colour — one hairline hugging the run's
   * actual staircase shape, never a glow on every one of its rects.
   */
  pdfAnnotationSelectionOutline: "zt-pdf-annotation-selection-outline",
  /**
   * One Mark Handle on the selected Annotation Mark, drawn while editing is
   * live. `data-zt-grip` names the edges it moves — `tl`, `t`, `tr`, `r`,
   * `br`, `b`, `bl` or `l`, in PDF space — and the mark whose body moves it
   * carries `data-zt-grip="body"`.
   */
  pdfAnnotationHandle: "zt-pdf-annotation-handle",
  /**
   * The `<g>` a note Annotation Mark draws its glyph into, stroked in the
   * Annotation's own colour. Its `stroke-width` sets
   * both {@link themeHook.pdfAnnotationNoteFill} and
   * {@link themeHook.pdfAnnotationNoteCrease} through inheritance.
   */
  pdfAnnotationNoteIcon: "zt-pdf-annotation-note-icon",
  /** The glyph's body path, filled at low alpha in the Annotation's own colour. */
  pdfAnnotationNoteFill: "zt-pdf-annotation-note-fill",
  /**
   * The two segments that crease the glyph's folded bottom-right corner,
   * stroked in the group's own colour and width. It is a pair of open lines
   * rather than a closed shape, so `stroke` paints it and `fill` does not.
   */
  pdfAnnotationNoteCrease: "zt-pdf-annotation-note-crease",
  /**
   * The rectangle the armed image tool drags out on a page, in the tool's own
   * colour, faint while a side is under ten points. It stands in the page's
   * {@link themeHook.pdfAnnotationOverlay} until the capture ends.
   */
  pdfCaptureRect: "zt-pdf-capture-rect",
  /**
   * The stroke the armed ink tool is drawing on a page, drawn as a saved ink
   * mark is. It stands in the page's {@link themeHook.pdfAnnotationOverlay}
   * until the pointer is released or the stroke is discarded.
   */
  pdfLiveStroke: "zt-pdf-live-stroke",
  /**
   * A released ink stroke drawn on its page while Zotero saves it, under the
   * Annotation Marks, until the saved mark takes its place.
   */
  pdfPendingStroke: "zt-pdf-pending-stroke",
  /**
   * The textarea a Text Draft is typed into, over its page, in the text
   * tool's colour darkened as a saved text mark is drawn. It stands until the
   * draft is discarded or its saved mark takes its place.
   */
  pdfTextDraft: "zt-pdf-text-draft",
  /**
   * The editing indicator in the PDF reader's own toolbar, a status line
   * shown only while ZotLit waits for Zotero and during a cooldown, and never
   * a button. `data-zt-capability-tone` is `busy` in both states.
   */
  pdfCapability: "zt-pdf-capability",
  /**
   * The Creation Toolbar in the PDF reader's own right toolbar slot, which
   * also holds the editing indicator. Each control inside it
   * carries `data-zt-tool`. Each tool of its tool group is split in two — the
   * toggle under the tool's own name and the chevron that opens its colours
   * under `<tool>-color` — which today is `highlight`, `highlight-color`,
   * `underline`, `underline-color`, `note`, `note-color`, `text`,
   * `text-color`, `image`, `image-color`, `ink` and `ink-color`. `visibility`
   * stands outside the group.
   */
  pdfCreationToolbar: "zt-pdf-creation-toolbar",
  /**
   * One tool of that toolbar: the toggle that arms it and the chevron that
   * opens its colours, joined into a single split button. It carries Obsidian's
   * own `is-active` while that tool is armed, so the pair fills as one control;
   * the two halves stay separate controls and hover separately.
   */
  pdfTool: "zt-pdf-tool",
  /**
   * The Mark Popup, on Obsidian's own hover popover, in both of its modes.
   * Each control inside it carries `data-zt-verb` — `color`, `comment`,
   * `copy`, `delete`, `reveal`, and `stack` for the stepper through
   * overlapping marks when a mark is selected; `highlight`, `underline`,
   * the four most recently used of `color-1` to `color-8`, `comment` and
   * `copy` when a fresh text selection is waiting to be created.
   */
  pdfMarkPopup: "zt-pdf-mark-popup",
  /** The comment sheet the Mark Popup opens under its row, in either mode. */
  pdfCommentSheet: "zt-pdf-comment-sheet",
  /** The panel an Annotation Card shows while a Write Conflict stands on it. */
  annotConflict: "zt-annot-conflict",
  /**
   * The panel an Annotation Card or the Mark Popup shows over a comment or
   * tag draft Zotero has not taken.
   */
  annotDraft: "zt-annot-draft",
  /**
   * The Chooser popup: the anchored popover a filtering multi-select opens,
   * such as the Annotation View's tag filter. It is no Obsidian menu, so a
   * theme reaching `.menu` never reaches it; it takes the same look from the
   * `--menu-*` variables instead. `:popover-open` marks it while it stands.
   */
  chooser: "zt-chooser",
  /**
   * The control a Chooser hangs under, which is a `<button>` because that is
   * what the popover invoker attribute takes. It carries `aria-expanded` and
   * `data-open` while its popup stands, and its own Obsidian button styling is
   * reverted, so what draws it is the caller's classes alone.
   */
  chooserTrigger: "zt-chooser-trigger",
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

/**
 * The stable attributes ZotLit sets on a host element while a mode stands, for
 * a rule that applies only then. Each is present with an empty value, or
 * absent.
 */
export const themeAttribute = {
  /**
   * On the PDF view's container while the ink tool is armed. ZotLit's own rule
   * under it takes touch panning off the pages, so a finger draws.
   */
  pdfInking: "data-zt-inking",
} as const;
