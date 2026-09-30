// The site's names for the Template Directory's kinds, levels, facets, and example items.

import type {
  EntryFeature,
  EntryKind,
  EntryLevel,
  ResearchTask,
} from "@/lib/template-directory/entry";
import { kindLabels, levelLabels } from "@/lib/template-directory/kind-labels";
import type { SampleLabels } from "@/lib/template-directory/samples-markdown";
import type { Facet } from "@/lib/template-directory/search";
import type { FacetOption } from "@/lib/template-directory/site";
import type { AnnotationColor } from "@/lib/template-directory/verify";
import { m } from "@/paraglide/messages.js";
import type { LocalizedString } from "@/paraglide/runtime.js";

export const KIND_LABEL = kindLabels(m);

export const LEVEL_LABEL = levelLabels(m);

/** The copy action's name for each kind, which the entry's steps also quote. */
export const COPY_LABEL = {
  profile: m.docs_directory_copy_profile,
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

/** The Zotero item types the index filters by: the example items' types and each type an entry names. */
const ITEM_TYPE_LABEL: Readonly<Record<string, () => LocalizedString>> = {
  journalArticle: m.docs_directory_item_type_journal_article,
  conferencePaper: m.docs_directory_item_type_conference_paper,
  book: m.docs_directory_item_type_book,
  thesis: m.docs_directory_item_type_thesis,
  bookSection: m.docs_directory_item_type_book_section,
  letter: m.docs_directory_item_type_letter,
  manuscript: m.docs_directory_item_type_manuscript,
  interview: m.docs_directory_item_type_interview,
  document: m.docs_directory_item_type_document,
  newspaperArticle: m.docs_directory_item_type_newspaper_article,
};

/** The example items and citation sets an entry page renders, by id. */
const EXAMPLE_LABEL: Readonly<Record<string, () => LocalizedString>> = {
  "journal-article": m.docs_directory_example_journal_article,
  "conference-paper": m.docs_directory_example_conference_paper,
  book: m.docs_directory_example_book,
  thesis: m.docs_directory_example_thesis,
  "book-section": m.docs_directory_example_book_section,
  letter: m.docs_directory_example_letter,
  manuscript: m.docs_directory_example_manuscript,
  interview: m.docs_directory_example_interview,
  document: m.docs_directory_example_document,
  "every-color": m.docs_directory_example_every_color,
  "many-authors": m.docs_directory_example_many_authors,
  "unsafe-title": m.docs_directory_example_unsafe_title,
  "no-author-date-or-citekey":
    m.docs_directory_example_no_author_date_or_citekey,
  "thesis-with-university": m.docs_directory_example_thesis_with_university,
  "book-with-edition": m.docs_directory_example_book_with_edition,
  "newspaper-article": m.docs_directory_example_newspaper_article,
  "two-items": m.docs_directory_example_two_items,
  "item-with-page": m.docs_directory_example_item_with_page,
  "suppressed-author": m.docs_directory_example_suppressed_author,
  "prefix-and-suffix": m.docs_directory_example_prefix_and_suffix,
  "annotation-citation": m.docs_directory_example_annotation_citation,
};

/** A facet value as the reader reads it. */
export function optionLabel(facet: Facet, { value }: FacetOption): string {
  const labels: Readonly<Record<string, () => LocalizedString>> = {
    task: TASK_LABEL,
    kind: KIND_LABEL,
    itemType: ITEM_TYPE_LABEL,
    feature: FEATURE_LABEL,
    level: LEVEL_LABEL,
  }[facet];
  return labels[value]?.() ?? value;
}

/** An example item or a citation set, as the entry page names it. */
export function exampleLabel(id: string): string {
  return EXAMPLE_LABEL[id]?.() ?? id;
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

/** The names and headings the Markdown edition and the samples files give the samples. */
export const SAMPLE_LABELS: SampleLabels = {
  example: exampleLabel,
  annotation: annotationLabel,
  annotations: () => m.docs_directory_samples_annotations(),
  item: () => m.docs_directory_samples_item(),
  noteName: () => m.docs_directory_sample_note_name(),
  cited: () => m.docs_directory_citation_cited(),
  main: () => m.docs_directory_citation_main(),
  alt: () => m.docs_directory_citation_alt(),
};

/** The labels of a facet's `values`, in the order given. */
export function valueLabels(facet: Facet, values: readonly string[]): string[] {
  return values.map((value) => optionLabel(facet, { value }));
}
