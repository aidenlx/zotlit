import type { DisplayNode } from "#/explorer/index";

// Which fields a root lists, in which section and order, and the name a
// reader sees for each. Common fields lead; every other field has one home.
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";
import type { FieldLabelLocale } from "@zotlit/zotero-types/field-labels";

import { COMMON_FIELDS } from "./completion-fields";
import { commonRows, fieldValueText } from "./explorer-fields";
import type { FieldRow } from "./explorer-fields";
import type { WorkbenchMessages } from "./generated/messages";
import type { WorkbenchMessageLabel } from "./messages";
import type { TemplateRoot } from "./store";

import { buildDisplayTree } from "#/explorer/index";

export type ExplorerSectionId =
  | "common"
  | "reference"
  | "identifiers"
  | "content"
  | "organization"
  | "links"
  | "record"
  | "annotation"
  | "source"
  | "citation";

export interface ExplorerSection {
  readonly id: ExplorerSectionId;
  readonly label: string;
  readonly rows: readonly FieldRow[];
}

interface SectionSpec {
  readonly id: ExplorerSectionId;
  readonly keys: readonly string[];
}

const SECTION_LABELS: Record<ExplorerSectionId, WorkbenchMessageLabel> = {
  common: "workbench_explorer_section_common",
  reference: "workbench_explorer_section_reference",
  identifiers: "workbench_explorer_section_identifiers",
  content: "workbench_explorer_section_content",
  organization: "workbench_explorer_section_organization",
  links: "workbench_explorer_section_links",
  record: "workbench_explorer_section_record",
  annotation: "workbench_explorer_section_annotation",
  source: "workbench_explorer_section_source",
  citation: "workbench_explorer_section_citation",
};

/** Item fields follow Zotero's Info pane order inside each section. */
const ITEM_SECTIONS: readonly SectionSpec[] = [
  {
    id: "reference",
    keys: [
      "title",
      "shortTitle",
      "authors",
      "authorsShort",
      "creators",
      "primaryCreatorType",
      "date",
      "volume",
      "issue",
      "pages",
      "publisher",
      "place",
      "edition",
      "language",
      "itemType",
    ],
  },
  {
    id: "identifiers",
    keys: ["citationKey", "citekey", "DOI", "ISBN", "ISSN", "url", "extra"],
  },
  { id: "content", keys: ["abstract", "attachments", "annotations", "notes"] },
  { id: "organization", keys: ["tags", "collections", "relatedItems"] },
  { id: "links", keys: ["backlink", "weblink", "noteLink", "notePath"] },
  {
    id: "record",
    keys: [
      "key",
      "indexedKey",
      "libraryID",
      "groupID",
      "dateAdded",
      "dateModified",
    ],
  },
];

const SECTIONS: Record<TemplateRoot, readonly SectionSpec[]> = {
  note: ITEM_SECTIONS,
  filename: ITEM_SECTIONS,
  annotation: [
    {
      id: "annotation",
      keys: [
        "type",
        "text",
        "comment",
        "commentHtml",
        "colorName",
        "colorHex",
        "pageLabel",
        "page",
        "imgLink",
      ],
    },
    {
      id: "source",
      keys: ["parentItem", "parentAttachment", "fileLink", "citation"],
    },
    { id: "organization", keys: ["tags"] },
    { id: "links", keys: ["backlink"] },
    {
      id: "record",
      keys: [
        "key",
        "indexedKey",
        "libraryID",
        "authorName",
        "isExternal",
        "dateAdded",
        "dateModified",
      ],
    },
  ],
  // The citation root's three fields are all common, so this spec names none
  // of them and stands as the root's home for any field the taxonomy has yet
  // to place.
  citation: [{ id: "citation", keys: [] }],
};

/**
 * Fields a root lists once under another name. An item root carries both
 * halves of each CSL alias pair, so the Zotero spelling stands for
 * `abstract`, and `publicationTitle` stands for `containerTitle`; the
 * note-name root also carries link stubs that are empty for every item.
 */
const ITEM_HIDDEN: readonly string[] = ["abstractNote", "containerTitle"];
const HIDDEN: Record<TemplateRoot, ReadonlySet<string>> = {
  note: new Set(ITEM_HIDDEN),
  annotation: new Set(),
  filename: new Set([...ITEM_HIDDEN, "notePath", "noteLink"]),
  citation: new Set(),
};

/** ZotLit's own fields on an item root, which Zotero has no label for. */
const ITEM_LABELS: Readonly<Record<string, WorkbenchMessageLabel>> = {
  authorsShort: "workbench_field_authors_short",
  creators: "workbench_field_creators",
  primaryCreatorType: "workbench_field_primary_creator_type",
  citekey: "workbench_field_citekey",
  relatedItems: "workbench_field_related_items",
  notes: "workbench_field_notes",
  weblink: "workbench_field_weblink",
  key: "workbench_field_key",
  indexedKey: "workbench_field_indexed_key",
  libraryID: "workbench_field_library_id",
  groupID: "workbench_field_group_id",
  notePath: "workbench_field_note_path",
  noteLink: "workbench_field_note_link",
};

const ANNOTATION_LABELS: Readonly<Record<string, WorkbenchMessageLabel>> = {
  type: "workbench_field_annotation_type",
  commentHtml: "workbench_field_comment_html",
  colorHex: "workbench_field_color_hex",
  page: "workbench_field_page_number",
  parentAttachment: "workbench_field_parent_attachment",
  fileLink: "workbench_field_file_link",
  citation: "workbench_field_citation",
  authorName: "workbench_field_author_name",
  isExternal: "workbench_field_is_external",
  key: "workbench_field_key",
  indexedKey: "workbench_field_indexed_key",
  libraryID: "workbench_field_library_id",
};

/** `zt` names that differ from the Zotero field they carry. */
const ZOTERO_FIELD: Readonly<Record<string, string>> = {
  abstract: "abstractNote",
};

function schemaLocale(locale: string): FieldLabelLocale {
  return locale.startsWith("zh") ? "zh-CN" : "en-US";
}

/**
 * Lowers the capital that starts each later word when a lowercase letter
 * follows, so Zotero's "Date Added" reads "Date added" while "DOI" and "URL"
 * keep their case.
 */
export function sentenceCase(label: string): string {
  return label.replaceAll(/(?<=\S\s+)\p{Lu}(?=\p{Ll})/gu, (initial) =>
    initial.toLowerCase(),
  );
}

/** The reader a label or section is resolved for. */
export interface ExplorerReader {
  readonly m: WorkbenchMessages;
  readonly root: TemplateRoot;
  readonly locale: string;
}

/**
 * The name a reader sees for a top-level field: the common-field label, then
 * ZotLit's own label, then Zotero's label in the reader's locale, then the
 * raw key.
 */
export function fieldLabel(
  key: string,
  { m, root, locale }: ExplorerReader,
): string {
  const common = COMMON_FIELDS[root].find((field) => field.key === key);
  if (common) return m[common.label]();
  const own = (root === "annotation" ? ANNOTATION_LABELS : ITEM_LABELS)[key];
  if (own) return m[own]();
  const schema = schemaLocale(locale);
  const zotero = FIELD_LABELS[schema][ZOTERO_FIELD[key] ?? key];
  if (zotero === undefined) return key;
  return schema === "en-US" ? sentenceCase(zotero) : zotero;
}

/** Every section id a root can show, in display order. */
export function explorerSectionIds(root: TemplateRoot): ExplorerSectionId[] {
  return ["common", ...SECTIONS[root].map((section) => section.id)];
}

/** The sections `data` actually shows, so a host can tell "all closed" from the reader's view. */
export function visibleSectionIds(
  data: Record<string, unknown> | null,
  reader: ExplorerReader,
): ExplorerSectionId[] {
  if (!data) return [];
  const nodes = buildDisplayTree(data, { expanded: new Set() });
  return explorerSections(nodes, reader).map((section) => section.id);
}

/**
 * The sections for `root` over its top-level display nodes. Common fields
 * lead in their fixed order; each remaining field joins one section, and a
 * field the taxonomy does not name — an item-type field, a new contract key —
 * joins the first section in data order. Empty sections are dropped.
 */
export function explorerSections(
  nodes: readonly DisplayNode[],
  reader: ExplorerReader,
): ExplorerSection[] {
  const { m, root } = reader;
  const hidden = HIDDEN[root];
  const byKey = new Map(
    nodes.filter((node) => !hidden.has(node.key)).map((n) => [n.key, n]),
  );
  const row = (node: DisplayNode): FieldRow => ({
    node,
    label: fieldLabel(node.key, reader),
    value: fieldValueText(node),
  });
  const common = commonRows(m, root, [...byKey.values()]);
  const placed = new Set(common.map(({ node }) => node.key));
  const specs = SECTIONS[root];
  const rowsOf = new Map(specs.map((spec) => [spec.id, [] as FieldRow[]]));
  for (const spec of specs)
    for (const key of spec.keys) {
      const node = byKey.get(key);
      if (!node || placed.has(key)) continue;
      placed.add(key);
      rowsOf.get(spec.id)!.push(row(node));
    }
  const first = rowsOf.get(specs[0]!.id)!;
  for (const node of byKey.values())
    if (!placed.has(node.key)) first.push(row(node));
  const sections: ExplorerSection[] = [
    { id: "common", label: m[SECTION_LABELS.common](), rows: common },
  ];
  for (const spec of specs)
    sections.push({
      id: spec.id,
      label: m[SECTION_LABELS[spec.id]](),
      rows: rowsOf.get(spec.id)!,
    });
  return sections.filter((section) => section.rows.length > 0);
}
