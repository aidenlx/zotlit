// PROTOTYPE #743 — throwaway, delete after ticket resolution.
//
// A minimal typed subset of the pandoc-types 1.23 JSON encoding (issue #740):
// a discriminated union on the `t` field, content under `c`. Only the node
// kinds this prototype's fixtures need are modeled.

/** `[id, classes, key-value pairs]` — pandoc's Attr triple. */
export type Attr = readonly [
  id: string,
  classes: readonly string[],
  kvs: readonly (readonly [string, string])[],
];

export interface Str {
  readonly t: "Str";
  readonly c: string;
}

export interface Space {
  readonly t: "Space";
}

export interface Emph {
  readonly t: "Emph";
  readonly c: readonly Inline[];
}

export interface Strong {
  readonly t: "Strong";
  readonly c: readonly Inline[];
}

export interface Superscript {
  readonly t: "Superscript";
  readonly c: readonly Inline[];
}

export interface Subscript {
  readonly t: "Subscript";
  readonly c: readonly Inline[];
}

export interface Span {
  readonly t: "Span";
  readonly c: readonly [Attr, readonly Inline[]];
}

export interface Note {
  readonly t: "Note";
  readonly c: readonly Block[];
}

export type Inline =
  | Str
  | Space
  | Emph
  | Strong
  | Superscript
  | Subscript
  | Span
  | Note;

export interface Para {
  readonly t: "Para";
  readonly c: readonly Inline[];
}

export type Block = Para;

/** (a) Parenthetical author-year citation with an `Emph` inside. */
export const fixtureParenthetical: readonly Inline[] = [
  { t: "Str", c: "(" },
  { t: "Emph", c: [{ t: "Str", c: "see" }] },
  { t: "Space" },
  { t: "Str", c: "Doe" },
  { t: "Space" },
  { t: "Str", c: "2024" },
  { t: "Str", c: ")" },
];

/**
 * (b) Author-in-text citation whose content is a `Str` (author name) followed
 * by a `Note` containing a `Para` — per #738, note styles put the Str beside
 * the Note rather than inside it.
 */
export const fixtureAuthorInText: readonly Inline[] = [
  { t: "Str", c: "Doe" },
  {
    t: "Note",
    c: [
      {
        t: "Para",
        c: [{ t: "Str", c: "Doe," }, { t: "Space" }, { t: "Str", c: "2024." }],
      },
    ],
  },
];

/**
 * (c) Bibliography-entry-like run with `Span` nodes classed
 * `csl-right-inline` and styled inlines (`Strong`, `Superscript`).
 */
export const fixtureBibliographyEntry: readonly Inline[] = [
  { t: "Strong", c: [{ t: "Str", c: "Doe," }] },
  { t: "Space" },
  { t: "Str", c: "J." },
  { t: "Space" },
  { t: "Str", c: "(2024)." },
  { t: "Space" },
  {
    t: "Span",
    c: [
      ["", ["csl-right-inline"], []],
      [
        { t: "Str", c: "Title" },
        { t: "Superscript", c: [{ t: "Str", c: "2" }] },
      ],
    ],
  },
];
