import type { FrontmatterMergeStrategy } from "@zotlit/templates/constants";

import * as m from "@/lib/i18n/generated/messages";

export function frontmatterMergeStrategyLabel(
  strategy: FrontmatterMergeStrategy,
): string {
  switch (strategy) {
    case "replace":
      return m.settings_frontmatter_merge_replace();
    case "append":
      return m.settings_frontmatter_merge_append();
    case "keep":
      return m.settings_frontmatter_merge_keep();
  }
}

export function frontmatterFieldLabel(field: {
  key: string;
  merge: FrontmatterMergeStrategy;
}): string {
  const key = field.key || m.settings_note_frontmatter_empty_key();
  return `${key} (${frontmatterMergeStrategyLabel(field.merge)})`;
}
