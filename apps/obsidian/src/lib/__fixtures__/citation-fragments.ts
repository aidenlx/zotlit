// Shared Citation Fragment vectors: the one corpus both the TypeScript parser
// and the Lua filter's checks run, so the grammar's two implementations cannot
// drift. `plain` is the Lua check's citeproc rendering for `[[Doe 2020#cite:<fragment>]]`;
// `display` is the Citation Display Text the TypeScript derivation renders for
// citation key `doe2020` / note `Doe 2020.md`.

import type { CitationFragment } from "@/lib/citation-fragment";

export interface CitationFragmentFixture {
  name: string;
  /** The raw text after `#cite:`; `null` means the link has no Citation Fragment. */
  fragment: string | null;
  /** The exporter-accepted details, present iff the fragment parses. */
  details?: CitationFragment;
  /** The exporter's fatal-error message, present iff the fragment is rejected. */
  error?: string;
  /** Expected citeproc plain rendering, used only by the Lua filter check. */
  plain?: string;
  /** Expected Citation Display Text, used only by the TypeScript tests. */
  display?: string;
}

export const CITATION_FRAGMENT_FIXTURES: readonly CitationFragmentFixture[] = [
  {
    name: "no fragment",
    fragment: null,
    display: "@doe2020",
  },
  {
    name: "locator",
    fragment: "locator=33",
    details: {
      mode: "normal",
      prefix: null,
      label: null,
      locator: "33",
      suffix: null,
    },
    plain: "(Doe 2020, 33)",
    display: "[@doe2020, p. 33]",
  },
  {
    name: "label and locator",
    fragment: "label=chapter&locator=3",
    details: {
      mode: "normal",
      prefix: null,
      label: "chapter",
      locator: "3",
      suffix: null,
    },
    plain: "(Doe 2020, chap. 3)",
    display: "[@doe2020, chap. 3]",
  },
  {
    name: "prefix, locator and suffix",
    fragment:
      "prefix=see%20also&label=chapter&locator=3&suffix=for%20context",
    details: {
      mode: "normal",
      prefix: "see also",
      label: "chapter",
      locator: "3",
      suffix: "for context",
    },
    plain: "(see also Doe 2020, chap. 3, for context)",
    display: "[see also @doe2020, chap. 3, for context]",
  },
  {
    name: "suppress-author",
    fragment: "mode=suppress-author&locator=7",
    details: {
      mode: "suppress-author",
      prefix: null,
      label: null,
      locator: "7",
      suffix: null,
    },
    plain: "(2020, 7)",
    display: "[-@doe2020, p. 7]",
  },
  {
    name: "author-in-text",
    fragment: "mode=author-in-text&locator=33",
    details: {
      mode: "author-in-text",
      prefix: null,
      label: null,
      locator: "33",
      suffix: null,
    },
    plain: "Doe (2020, 33)",
    display: "@doe2020 [p. 33]",
  },
  {
    name: "author-in-text without locator",
    fragment: "mode=author-in-text",
    details: {
      mode: "author-in-text",
      prefix: null,
      label: null,
      locator: null,
      suffix: null,
    },
    plain: "Doe (2020)",
    display: "@doe2020",
  },
  {
    name: "explicit normal mode",
    fragment: "mode=normal&locator=33",
    details: {
      mode: "normal",
      prefix: null,
      label: null,
      locator: "33",
      suffix: null,
    },
    plain: "(Doe 2020, 33)",
    display: "[@doe2020, p. 33]",
  },
  {
    name: "percent-encoded locator",
    fragment: "locator=6%2F7",
    details: {
      mode: "normal",
      prefix: null,
      label: null,
      locator: "6/7",
      suffix: null,
    },
    plain: "(Doe 2020, 6/7)",
    display: "[@doe2020, p. 6/7]",
  },
  {
    name: "equals inside a value",
    fragment: "suffix=a=b",
    details: {
      mode: "normal",
      prefix: null,
      label: null,
      locator: null,
      suffix: "a=b",
    },
    plain: "(Doe 2020, a=b)",
    display: "[@doe2020, a=b]",
  },
  {
    name: "suffix only",
    fragment: "suffix=for%20context",
    details: {
      mode: "normal",
      prefix: null,
      label: null,
      locator: null,
      suffix: "for context",
    },
    plain: "(Doe 2020, for context)",
    display: "[@doe2020, for context]",
  },
  {
    name: "prefix only",
    fragment: "prefix=see",
    details: {
      mode: "normal",
      prefix: "see",
      label: null,
      locator: null,
      suffix: null,
    },
    plain: "(see Doe 2020)",
    display: "[see @doe2020]",
  },
  {
    name: "prefix and locator",
    fragment: "prefix=see%20also&locator=40",
    details: {
      mode: "normal",
      prefix: "see also",
      label: null,
      locator: "40",
      suffix: null,
    },
    plain: "(see also Doe 2020, 40)",
    display: "[see also @doe2020, p. 40]",
  },
  {
    name: "suppress-author without locator",
    fragment: "mode=suppress-author",
    details: {
      mode: "suppress-author",
      prefix: null,
      label: null,
      locator: null,
      suffix: null,
    },
    plain: "(2020)",
    display: "[-@doe2020]",
  },
  {
    name: "author-in-text locator and suffix",
    fragment: "mode=author-in-text&locator=62&suffix=for%20context",
    details: {
      mode: "author-in-text",
      prefix: null,
      label: null,
      locator: "62",
      suffix: "for context",
    },
    plain: "Doe (2020, 62, for context)",
    display: "@doe2020 [p. 62, for context]",
  },
  {
    name: "suppress-author suffix only",
    fragment: "mode=suppress-author&suffix=for%20context",
    details: {
      mode: "suppress-author",
      prefix: null,
      label: null,
      locator: null,
      suffix: "for context",
    },
    plain: "(2020, for context)",
    display: "[-@doe2020, for context]",
  },
  {
    name: "accented locator",
    fragment: "locator=%C3%A9",
    details: {
      mode: "normal",
      prefix: null,
      label: null,
      locator: "é",
      suffix: null,
    },
    plain: "(Doe 2020, page é)",
    display: "[@doe2020, p. é]",
  },
  {
    name: "cyrillic locator",
    fragment: "locator=%D0%BF",
    details: {
      mode: "normal",
      prefix: null,
      label: null,
      locator: "п",
      suffix: null,
    },
    plain: "(Doe 2020, page п)",
    display: "[@doe2020, p. п]",
  },
  {
    name: "euro locator",
    fragment: "locator=%E2%82%AC",
    error: '"locator" has a control character',
  },
  {
    name: "ideographic space",
    fragment: "locator=%E3%80%80",
    error: '"locator" has a control character',
  },
  {
    name: "empty fragment",
    fragment: "",
    error: "the Citation Fragment is empty",
  },
  {
    name: "parameter without equals",
    fragment: "locator",
    error: '"locator" is missing its "="',
  },
  {
    name: "empty value",
    fragment: "locator=",
    error: '"locator" has an empty value',
  },
  {
    name: "unknown parameter",
    fragment: "page=33",
    error: '"page" is not a Citation Fragment parameter',
  },
  {
    name: "duplicate parameter",
    fragment: "locator=1&locator=2",
    error: '"locator" appears more than once',
  },
  {
    name: "empty parameter name",
    fragment: "=33",
    error: '"=33" has an empty parameter name',
  },
  {
    name: "malformed percent encoding",
    fragment: "locator=%zz",
    error: '"locator" has malformed percent encoding',
  },
  {
    name: "bare percent at the end",
    fragment: "locator=33%",
    error: '"locator" has malformed percent encoding',
  },
  {
    name: "invalid UTF-8 after decoding",
    fragment: "locator=%FF",
    error: '"locator" has invalid UTF-8 after decoding',
  },
  {
    name: "truncated UTF-8 after decoding",
    fragment: "locator=%C3",
    error: '"locator" has invalid UTF-8 after decoding',
  },
  {
    name: "unsupported mode",
    fragment: "mode=narrative",
    error: '"mode" does not support "narrative"',
  },
  {
    name: "unsupported label",
    fragment: "label=slide&locator=3",
    error: '"label" does not support "slide"',
  },
  {
    name: "label without locator",
    fragment: "label=chapter",
    error: '"label" needs a "locator"',
  },
  {
    name: "prefix with author-in-text",
    fragment: "mode=author-in-text&prefix=see",
    error:
      '"prefix" does not combine with mode=author-in-text; keep the introduction outside the link',
  },
  {
    name: "trailing whitespace",
    fragment: "locator=33%20",
    error: '"locator" has leading or trailing whitespace',
  },
  {
    name: "leading whitespace",
    fragment: "prefix=see%20",
    error: '"prefix" has leading or trailing whitespace',
  },
  {
    name: "leading newline counts as whitespace",
    fragment: "prefix=%0A",
    error: '"prefix" has leading or trailing whitespace',
  },
  {
    name: "line break",
    fragment: "locator=a%0Ab",
    error: '"locator" has a line break',
  },
  {
    name: "non-breaking space at the end",
    fragment: "locator=1%20%C2%A0",
    error: '"locator" has leading or trailing whitespace',
  },
  {
    name: "value ending in a 0xA0 continuation byte",
    fragment: "suffix=voil%C3%A0",
    error: '"suffix" has leading or trailing whitespace',
  },
  {
    name: "a 0xA0 continuation byte outranks a control byte",
    fragment: "suffix=x%E2%80%A0",
    error: '"suffix" has leading or trailing whitespace',
  },
  {
    name: "control character",
    fragment: "locator=a%01b",
    error: '"locator" has a control character',
  },
  {
    name: "null byte",
    fragment: "locator=%00",
    error: '"locator" has a control character',
  },
  {
    name: "empty mode value",
    fragment: "mode=",
    error: '"mode" has an empty value',
  },
  {
    name: "duplicate mode",
    fragment: "mode=normal&mode=author-in-text",
    error: '"mode" appears more than once',
  },
];
