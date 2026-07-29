// The page template for the generated template-data reference: which section
// documents which contract type, in which order, under which anchor.
//
// Anchors equal the slugs the hand-written page generated, so inbound links keep
// resolving. Rewording a title is safe; changing an `id` breaks shared links.

export interface SectionSpec {
  /** Explicit heading anchor. */
  id: string;
  title: string;
  level: 2 | 3;
  /** Named IR types documented here, in table order. */
  types?: readonly string[];
  /**
   * The expression a template author writes to reach this shape. Helper usage
   * examples are built from it, e.g. `{{ zt.noteLink }}`.
   */
  sample?: string;
  /** Rendered before every row name on this section's tables. */
  prefix?: string;
  /** One caption per table, in order; required when a section holds several. */
  captions?: readonly string[];
  /** Fixed prose under the heading, after the contract's own type description. */
  lead?: string;
  /** Hand-written partial inlined here, relative to the generated page. */
  include?: string;
  /** Emits the item-type → `zt` field map instead of contract tables. */
  itemTypes?: boolean;
}

/**
 * Every named type reachable from a Contract Root is listed here. Generation
 * fails on a type the registry does not place, so a new contract shape can never
 * land undocumented.
 */
export const SECTIONS: readonly SectionSpec[] = [
  {
    id: "note-and-content-templates",
    title: "Note and content templates",
    level: 2,
    types: ["NoteTemplateContext"],
    sample: "zt",
    prefix: "zt.",
    lead: "The note template (`zotlit-note.liquid.md`) and the content template (`zotlit-content.liquid.md`) share this context.",
  },
  {
    id: "annotation-template",
    title: "Annotation template",
    level: 2,
    types: ["AnnotationTemplateContext"],
    sample: "zt",
    prefix: "zt.",
    lead: "The annotation template (`zotlit-annotation.liquid.md`) receives a single annotation as `zt`.",
  },
  {
    id: "filename-template",
    title: "Filename template",
    level: 2,
    types: ["TemplateFilenameItemData"],
    sample: "zt",
    prefix: "zt.",
    lead: "The filename template (`zotlit-filename.liquid.md`) receives exactly the properties below.",
  },
  {
    id: "item-fields",
    title: "Item fields",
    level: 2,
    lead: "Every Zotero item field is a flat property on `zt`. The canonical Zotero field name is the primary accessor, and type-specific spellings normalize to their canonical base field: reach `blogTitle` as `zt.publicationTitle` and `studio` as `zt.publisher`. The type-specific spelling itself is not on `zt`.",
    include: "./_field-aliases.mdx",
  },
  {
    id: "common-fields",
    title: "Fields by item type",
    level: 3,
    itemTypes: true,
    lead: "Each Zotero item type exposes its own field set. Expand a type to see the `zt` property names it adds to the common fields above.",
  },
  {
    id: "citation-templates",
    title: "Citation templates",
    level: 2,
    include: "./_citation-templates.mdx",
  },
  {
    id: "annotation-entry",
    title: "Annotation entries",
    level: 2,
    types: ["TemplateAnnotation"],
    sample: "annotation",
    lead: "Loop over them with `{% for annotation in zt.annotations %}`.",
  },
  {
    id: "annotation-types",
    title: "Annotation types",
    level: 2,
    types: ["ResolvedAnnotationTypeName"],
  },
  {
    id: "parent-item",
    title: "Parent item",
    level: 2,
    types: ["TemplateParentItemData"],
    sample: "zt.parentItem",
  },
  {
    id: "creators",
    title: "Creators",
    level: 2,
    types: ["TemplateCreator"],
    sample: "creator",
    lead: "`zt.creators` lists every creator on the item; `zt.authors` narrows them to the item's primary creator type, falling back to all creators when none matches. Institutional creators (Zotero `fieldMode=1`) set `literal` and leave `family` and `given` empty.",
  },
  {
    id: "tags",
    title: "Tags",
    level: 2,
    types: ["TemplateTag"],
    sample: "tag",
  },
  {
    id: "collections",
    title: "Collections",
    level: 2,
    types: ["TemplateCollection"],
    sample: "collection",
    lead: 'Use the `collection_paths` filter to render the full ancestor path joined by a separator (`"/"` by default).',
  },
  {
    id: "date-format",
    title: "Date format",
    level: 2,
    types: ["ItemDateYMD", "ItemDateYearMonth", "ItemDateYear", "ItemDateText"],
    captions: ["Full date", "Year and month", "Year only", "Text"],
    sample: "zt.date",
    lead: '`zt.date` is one of four parsed variants, discriminated by `kind`. `{{ zt.date }}` renders an ISO date for `"date"`, an ISO year-month for `"yearMonth"`, a bare year for `"year"`, and the raw user text for `"text"`. Use `{{ zt.date | date: "%Y-%m-%d" }}` for explicit formatting with [strftime tokens](/docs/reference/templates/syntax#date-formatting-filter); a `"text"` date renders its raw text unchanged whatever the format string.',
  },
  {
    id: "extra-field",
    title: "Extra field",
    level: 2,
    types: ["ItemExtra"],
    sample: "zt.extra",
    lead: "`zt.extra` is a parsed view of Zotero's free-text Extra field, or `null` when the field is empty. `{{ zt.extra }}` renders the raw field text.",
  },
  {
    id: "extra-lines",
    title: "Extra lines",
    level: 3,
    types: ["ExtraLine"],
    captions: ["Pair row", "Text row"],
    sample: "line",
    lead: "Each entry of `zt.extra.lines`.",
  },
  {
    id: "attachments",
    title: "Attachments",
    level: 2,
    types: ["TemplateAttachment"],
    sample: "attachment",
  },
  {
    id: "related-items",
    title: "Related items",
    level: 2,
    types: ["TemplateRelatedItem"],
    sample: "relatedItem",
    lead: "Each entry also carries every [item field](#item-fields).",
  },
  {
    id: "notes",
    title: "Notes",
    level: 2,
    types: ["TemplateNoteLink"],
    sample: "note",
    lead: "See [Import Zotero notes](/docs/how-to/import-zotero-notes) for the import workflow.",
  },
  {
    id: "imported-note-frontmatter",
    title: "Imported note frontmatter",
    level: 3,
    include: "./_imported-note-frontmatter.mdx",
  },
  {
    id: "see-also",
    title: "See also",
    level: 2,
    lead: `<Cards>
  <Card
    title="Template syntax"
    description="Liquid markup, filters, and ZotLit's custom tags."
    href="/docs/reference/templates/syntax"
  />
  <Card
    title="Frontmatter reference"
    description="Merge strategies, reserved keys, and update behavior."
    href="/docs/reference/templates/frontmatter"
  />
  <Card
    title="Default templates"
    description="The built-in Liquid template for each type, annotated."
    href="/docs/reference/templates/defaults"
  />
  <Card
    title="Explore template data"
    description="Use the Template Data Explorer to discover properties interactively."
    href="/docs/how-to/explore-template-data"
  />
</Cards>`,
  },
];
