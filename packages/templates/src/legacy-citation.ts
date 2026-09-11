// Fold of the 2.1.x `cite` and `cite2` Legacy Template Files into one Citation Template source.

import type { TemplateLanguage } from "./constants";

// `@zotlit/db` declares the Citation Variant, and depends on this package, so
// the fold states the two gesture names rather than importing them back.
type CitationVariant = "main" | "alt";

/**
 * What the 2.1.x `cite` and `cite2` slots rendered with no vault file, per
 * language. A vault that overrode only one of the two keeps the other gesture
 * on the text it already produced.
 */
export const DEFAULT_CITATION_BRANCHES = {
  liquid: {
    main: "{{ zt.citations | pandoc_cite }}",
    alt: '{{ zt.citations | pandoc_cite: "prefer-author-in-text" }}',
  },
  eta: {
    main: "<%= pandocCite(zt.citations) %>",
    alt: '<%= pandocCite(zt.citations, "prefer-author-in-text") %>',
  },
} as const satisfies Record<TemplateLanguage, Record<CitationVariant, string>>;

const BRANCH_TAGS = {
  liquid: {
    open: '{% if zt.variant == "alt" %}',
    otherwise: "{% else %}",
    close: "{% endif %}",
  },
  eta: {
    open: '<% if (zt.variant === "alt") { %>',
    otherwise: "<% } else { %>",
    close: "<% } %>",
  },
} as const satisfies Record<TemplateLanguage, object>;

export interface LegacyCitationSources {
  /** The language both branches are written in. */
  readonly language: TemplateLanguage;
  /** The `cite` file's source; the built-in main text stands in for none. */
  readonly main?: string;
  /** The `cite2` file's source; the built-in alternate text stands in for none. */
  readonly alt?: string;
}

/**
 * Build the Citation Template source that renders `main` on the main Citation
 * Variant and `alt` on the alternate one — the if/else form the built-in
 * Citation Template itself takes, so a folded pair of built-in branches is
 * byte-identical to the packaged document.
 */
export function foldLegacyCitationTemplates({
  language,
  main,
  alt,
}: LegacyCitationSources): string {
  const branches = DEFAULT_CITATION_BRANCHES[language];
  const tags = BRANCH_TAGS[language];
  return [
    tags.open,
    indentBranch(alt ?? branches.alt),
    tags.otherwise,
    indentBranch(main ?? branches.main),
    tags.close,
    "",
  ].join("\n");
}

/**
 * Two spaces before every non-empty line, so a folded branch reads as one
 * block. Indentation only ever follows a line break, which the inline form a
 * citation is inserted as collapses, so the rendered citation is unchanged.
 */
function indentBranch(source: string): string {
  return source.trimEnd().replaceAll(/^(?!$)/gm, "  ");
}
