// The site's names for the Template Directory's kinds, levels, facets, and example items.

import type {
  EntryFeature,
  EntryKind,
  EntryLevel,
  ResearchTask,
} from "@/lib/template-directory/entry";
import { kindLabels, levelLabels } from "@/lib/template-directory/kind-labels";
import type { SampleName, VariantKind } from "@/lib/template-directory/samples";
import type { SampleLabels } from "@/lib/template-directory/samples-markdown";
import type { Facet } from "@/lib/template-directory/search";
import type {
  ColorKeyRow,
  FacetOption,
  SampleProperty,
} from "@/lib/template-directory/site";
import type { AnnotationColor } from "@/lib/template-directory/verify";
import { m } from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";
import type { LocalizedString } from "@/paraglide/runtime.js";

export const KIND_LABEL = kindLabels(m);

export const LEVEL_LABEL = levelLabels(m);

/** The copy action's name for each kind, which the entry's steps also quote. */
export const COPY_LABEL = {
  profile: m.docs_directory_copy_file,
  partial: m.docs_directory_copy_template,
  citation: m.docs_directory_copy_template,
  "note-name": m.docs_directory_copy_template,
  property: m.docs_directory_copy_rule,
} satisfies Record<EntryKind, () => LocalizedString>;

/** The index's groups, one per level, in the order the index lists them. */
export const GROUPS = [
  {
    level: "ready-to-use",
    heading: m.docs_directory_group_ready,
    description: m.docs_directory_group_ready_description,
  },
  {
    level: "customize",
    heading: m.docs_directory_group_customize,
    description: m.docs_directory_group_customize_description,
  },
] as const satisfies readonly {
  level: EntryLevel;
  heading: () => string;
  description: () => string;
}[];

export const FACET_LABEL = {
  task: m.docs_directory_facet_task,
  kind: m.docs_directory_facet_kind,
  itemType: m.docs_directory_facet_item_type,
  feature: m.docs_directory_facet_feature,
  level: m.docs_directory_facet_level,
} satisfies Record<Facet, () => string>;

const TASK_LABEL = {
  "general-reading": m.docs_directory_task_general_reading,
  "literature-review": m.docs_directory_task_literature_review,
  "close-reading": m.docs_directory_task_close_reading,
  "reading-books": m.docs_directory_task_reading_books,
  "archival-research": m.docs_directory_task_archival_research,
  teaching: m.docs_directory_task_teaching,
  writing: m.docs_directory_task_writing,
} satisfies Record<ResearchTask, () => LocalizedString>;

const FEATURE_LABEL = {
  "source-links": m.docs_directory_feature_source_links,
  abstract: m.docs_directory_feature_abstract,
  "page-links": m.docs_directory_feature_page_links,
  comments: m.docs_directory_feature_comments,
  images: m.docs_directory_feature_images,
  "color-highlights": m.docs_directory_feature_color_highlights,
  "grouped-by-color": m.docs_directory_feature_grouped_by_color,
  "own-notes": m.docs_directory_feature_own_notes,
  prompts: m.docs_directory_feature_prompts,
  properties: m.docs_directory_feature_properties,
  "child-notes": m.docs_directory_feature_child_notes,
  "related-items": m.docs_directory_feature_related_items,
  "block-references": m.docs_directory_feature_block_references,
  tasks: m.docs_directory_feature_tasks,
  citations: m.docs_directory_feature_citations,
} satisfies Record<EntryFeature, () => LocalizedString>;

/** How the site names a Zotero item type where a sentence, a facet, or an example label needs it. */
interface ItemTypeNames {
  /** The item type as a facet value and a label: "Book chapter". */
  readonly name: () => LocalizedString;
  /** For several of them in a sentence ("for books"). */
  readonly plural: () => LocalizedString;
  /** For one of them in a sentence ("every book"). */
  readonly singular: () => LocalizedString;
  /** As the subject that starts an example variant's label: "A book chapter". */
  readonly subject: () => LocalizedString;
}

/** The Zotero item types the index filters by, the example items' types, and each type an entry names, by the contract's item type. */
const ITEM_TYPE: Readonly<Record<string, ItemTypeNames | undefined>> = {
  journalArticle: {
    name: m.docs_directory_item_type_journal_article,
    plural: m.docs_directory_item_type_plural_journal_article,
    singular: m.docs_directory_item_type_singular_journal_article,
    subject: m.docs_directory_example_subject_journal_article,
  },
  conferencePaper: {
    name: m.docs_directory_item_type_conference_paper,
    plural: m.docs_directory_item_type_plural_conference_paper,
    singular: m.docs_directory_item_type_singular_conference_paper,
    subject: m.docs_directory_example_subject_conference_paper,
  },
  book: {
    name: m.docs_directory_item_type_book,
    plural: m.docs_directory_item_type_plural_book,
    singular: m.docs_directory_item_type_singular_book,
    subject: m.docs_directory_example_subject_book,
  },
  thesis: {
    name: m.docs_directory_item_type_thesis,
    plural: m.docs_directory_item_type_plural_thesis,
    singular: m.docs_directory_item_type_singular_thesis,
    subject: m.docs_directory_example_subject_thesis,
  },
  bookSection: {
    name: m.docs_directory_item_type_book_section,
    plural: m.docs_directory_item_type_plural_book_section,
    singular: m.docs_directory_item_type_singular_book_section,
    subject: m.docs_directory_example_subject_book_section,
  },
  letter: {
    name: m.docs_directory_item_type_letter,
    plural: m.docs_directory_item_type_plural_letter,
    singular: m.docs_directory_item_type_singular_letter,
    subject: m.docs_directory_example_subject_letter,
  },
  manuscript: {
    name: m.docs_directory_item_type_manuscript,
    plural: m.docs_directory_item_type_plural_manuscript,
    singular: m.docs_directory_item_type_singular_manuscript,
    subject: m.docs_directory_example_subject_manuscript,
  },
  interview: {
    name: m.docs_directory_item_type_interview,
    plural: m.docs_directory_item_type_plural_interview,
    singular: m.docs_directory_item_type_singular_interview,
    subject: m.docs_directory_example_subject_interview,
  },
  document: {
    name: m.docs_directory_item_type_document,
    plural: m.docs_directory_item_type_plural_document,
    singular: m.docs_directory_item_type_singular_document,
    subject: m.docs_directory_example_subject_document,
  },
  newspaperArticle: {
    name: m.docs_directory_item_type_newspaper_article,
    plural: m.docs_directory_item_type_plural_newspaper_article,
    singular: m.docs_directory_item_type_singular_newspaper_article,
    subject: m.docs_directory_example_subject_newspaper_article,
  },
};

/**
 * Item types as a sentence names them: the plural form joins them with "and"
 * ("letters, manuscripts, and interviews"), and the singular form joins them
 * with "or", as "every book or thesis" reads.
 */
export function itemTypesInSentence(
  itemTypes: readonly string[],
  form: "plural" | "singular",
): string {
  return new Intl.ListFormat(getLocale(), {
    type: form === "plural" ? "conjunction" : "disjunction",
  }).format(
    itemTypes.map(
      (type) =>
        ITEM_TYPE[type]?.[form]() ?? optionLabel("itemType", { value: type }),
    ),
  );
}

/** The samples and citation sets that an item type's name does not name, by id. */
const NAMED_EXAMPLE: Readonly<Record<string, () => LocalizedString>> = {
  "every-color": m.docs_directory_example_every_color,
  "many-authors": m.docs_directory_example_many_authors,
  "unsafe-title": m.docs_directory_example_unsafe_title,
  "no-author-date-or-citekey":
    m.docs_directory_example_no_author_date_or_citekey,
  "thesis-with-university": m.docs_directory_example_thesis_with_university,
  "book-with-edition": m.docs_directory_example_book_with_edition,
  "two-items": m.docs_directory_example_two_items,
  "item-with-page": m.docs_directory_example_item_with_page,
  "suppressed-author": m.docs_directory_example_suppressed_author,
  "prefix-and-suffix": m.docs_directory_example_prefix_and_suffix,
  "annotation-citation": m.docs_directory_example_annotation_citation,
};

/** What each example variant says differs: its details and its highlights. */
const VARIANT_LABEL: Readonly<
  Record<VariantKind, (inputs: { subject: string }) => LocalizedString>
> = {
  "full-details": m.docs_directory_example_full_details,
  "few-details": m.docs_directory_example_few_details,
  "no-annotations": m.docs_directory_example_no_annotations,
};

/** What each example variant adds to an item type's name when a page shows several item types. */
const SHORT_VARIANT_LABEL: Readonly<
  Record<VariantKind, ((inputs: { type: string }) => LocalizedString) | null>
> = {
  "full-details": null,
  "few-details": m.docs_directory_example_short_few_details,
  "no-annotations": m.docs_directory_example_short_no_annotations,
};

/** A facet value as the reader reads it. */
export function optionLabel(facet: Facet, { value }: FacetOption): string {
  const labels: Readonly<Record<string, (() => LocalizedString) | undefined>> =
    {
      task: TASK_LABEL,
      kind: KIND_LABEL,
      itemType: Object.fromEntries(
        Object.entries(ITEM_TYPE).map(([type, names]) => [type, names?.name]),
      ),
      feature: FEATURE_LABEL,
      level: LEVEL_LABEL,
    }[facet];
  return labels[value]?.() ?? value;
}

/**
 * An example item or a citation set, as the entry page names it: a named
 * sample by its own words, an example variant by its item type and what
 * differs, any other item by its item type.
 */
export function exampleLabel({ id, itemType, variant }: SampleName): string {
  const named = NAMED_EXAMPLE[id];
  if (named !== undefined) return named();
  const type = itemType === null ? undefined : ITEM_TYPE[itemType];
  if (type === undefined) return id;
  return variant === null
    ? type.name()
    : VARIANT_LABEL[variant]({ subject: type.subject() });
}

/**
 * An example item as the tabs of a Profile that takes several item types
 * name it: the full variant by its item type ("Letter"), the other two
 * variants by the item type and what differs ("Letter, few details").
 */
export function shortExampleLabel(sample: SampleName): string {
  const { itemType, variant } = sample;
  const type = itemType === null ? undefined : ITEM_TYPE[itemType];
  if (variant === null || type === undefined) return exampleLabel(sample);
  const label = SHORT_VARIANT_LABEL[variant];
  return label === null ? type.name() : label({ type: type.name() });
}

/** A Sample Annotation, named by its type and color. */
export function annotationLabel({
  type,
  color,
}: {
  readonly type: string;
  readonly color: AnnotationColor;
}): string {
  const typeLabel = m.workbench_annotation_type({ type });
  if (color === null)
    return m.docs_directory_example_annotation({ type: typeLabel });
  return "name" in color
    ? m.docs_directory_example_annotation_color({
        type: typeLabel,
        color: color.name,
      })
    : m.docs_directory_example_annotation_custom_color({
        type: typeLabel,
        color: color.hex,
      });
}

const COLOR_LABEL: Readonly<Record<string, () => LocalizedString>> = {
  yellow: m.docs_directory_color_yellow,
  red: m.docs_directory_color_red,
  green: m.docs_directory_color_green,
  blue: m.docs_directory_color_blue,
  purple: m.docs_directory_color_purple,
  magenta: m.docs_directory_color_magenta,
  orange: m.docs_directory_color_orange,
  gray: m.docs_directory_color_gray,
  plum: m.docs_directory_color_plum,
};

/** One row of a color key: the Zotero color, an arrow, and what the Profile makes it mean. */
export function colorKeyText({ color, meaning }: ColorKeyRow): string {
  return m.docs_directory_color_key_row({
    color:
      color === null
        ? m.docs_directory_color_other()
        : (COLOR_LABEL[color]?.() ?? color),
    meaning,
  });
}

/** What the legend under an example's properties says of each mark. */
export const LEGEND_MARK_LABEL = {
  set: m.docs_directory_sample_mark_set,
  system: m.docs_directory_sample_mark_system,
} satisfies Record<SampleProperty["mark"], () => string>;

/** What each property's own row says of its mark: in the Markdown edition's table, and to a screen reader. */
export const ROW_MARK_LABEL = {
  set: m.docs_directory_sample_mark_set,
  system: m.docs_directory_sample_mark_system_row,
} satisfies Record<SampleProperty["mark"], () => string>;

/** The names and headings the Markdown edition and the samples files give the samples. */
export const SAMPLE_LABELS: SampleLabels = {
  example: exampleLabel,
  annotation: annotationLabel,
  annotations: () => m.docs_directory_samples_annotations(),
  item: () => m.docs_directory_samples_item(),
  noteName: () => m.docs_directory_sample_note_name(),
  property: () => m.docs_directory_sample_property(),
  value: () => m.docs_directory_value(),
  mark: () => m.docs_directory_sample_mark(),
  markName: (mark) => ROW_MARK_LABEL[mark](),
  empty: () => m.docs_directory_sample_empty(),
  cited: () => m.docs_directory_citation_cited(),
  main: () => m.docs_directory_citation_main(),
  alt: () => m.docs_directory_citation_alt(),
};

/** The labels of a facet's `values`, in the order given. */
export function valueLabels(facet: Facet, values: readonly string[]): string[] {
  return values.map((value) => optionLabel(facet, { value }));
}
