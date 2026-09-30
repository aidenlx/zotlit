// The site's names for the Template Directory's kinds, levels, and facets.

import type { EntryKind, EntryLevel } from "@/lib/template-directory/entry";
import { kindLabels, levelLabels } from "@/lib/template-directory/kind-labels";
import type { Facet } from "@/lib/template-directory/search";
import type { FacetOption } from "@/lib/template-directory/site";
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

/** A facet value as the reader reads it: the entry format's label, or the site's own. */
export function optionLabel(facet: Facet, option: FacetOption): string {
  if (option.label !== undefined) return option.label;
  if (facet === "kind") return KIND_LABEL[option.value as EntryKind]();
  if (facet === "level") return LEVEL_LABEL[option.value as EntryLevel]();
  return option.value;
}

/** The labels of `values` among a facet's options, in the order given. */
export function valueLabels(
  facet: Facet,
  options: readonly FacetOption[],
  values: readonly string[],
): string[] {
  return values.map((value) =>
    optionLabel(
      facet,
      options.find((option) => option.value === value) ?? { value },
    ),
  );
}
