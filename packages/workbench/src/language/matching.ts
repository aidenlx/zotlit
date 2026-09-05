// Shared ranking for template field and language suggestions.
import type { Suggestion, SuggestionConfig } from "./suggestions";

/** Rank once in the core so host widgets display the same order. */
export function rankSuggestions(
  options: Suggestion[],
  query: string,
  config: SuggestionConfig,
): Suggestion[] {
  const fields = config.fields ?? [];
  return options
    .map((option, index) => {
      const common = fields.findIndex((field) => field.path === option.path);
      const displayLabel = common < 0 ? option.label : fields[common]!.label;
      const score = query
        ? Math.min(
            ...[option.label, displayLabel, option.path ?? ""].map((text) =>
              matchScore(text, query),
            ),
          )
        : 0;
      return {
        option: common < 0 ? option : { ...option, displayLabel },
        score,
        order: common < 0 ? fields.length + index : common,
      };
    })
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map(({ option }) => option);
}

function matchScore(value: string, search: string): number {
  const text = value.toLowerCase();
  const query = search.toLowerCase();
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  let offset = 0;
  for (const char of query) {
    const found = text.indexOf(char, offset);
    if (found < 0) return Infinity;
    offset = found + 1;
  }
  return 2;
}
