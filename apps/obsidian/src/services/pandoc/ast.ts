// The pandoc JSON AST as pandoc-types encodes it, as types alone — no runtime code.

/**
 * Pandoc's `-t json` output follows the `ToJSON` instances of pandoc-types, and
 * the plugin pins the binary that writes them (pandoc 3.10.1, pandoc-types
 * 1.23.1.2), so the encoding is a fixed contract rather than something to
 * validate. Every constructor is tagged by `t`, and one that takes arguments
 * carries them in `c` — a tuple when it takes several.
 *
 * @see https://github.com/jgm/pandoc-types/blob/1.23.1.2/src/Text/Pandoc/Definition.hs
 */

/** A constructor that takes no arguments, written as its tag alone. */
export interface Tag<T extends string> {
  readonly t: T;
}

/** A constructor that takes arguments, written as its tag and its payload. */
export interface Node<T extends string, C> extends Tag<T> {
  readonly c: C;
}

export type Inlines = readonly Inline[];
export type Blocks = readonly Block[];

/** Identifier, classes, and key-value pairs of an element that carries them. */
export type Attr = readonly [
  id: string,
  classes: readonly string[],
  keyValues: readonly (readonly [key: string, value: string])[],
];

export type Target = readonly [url: string, title: string];

/** The name of a raw block's or raw inline's output format, such as `html`. */
export type Format = string;

export type QuoteType = Tag<"SingleQuote" | "DoubleQuote">;
export type MathType = Tag<"DisplayMath" | "InlineMath">;
export type CitationMode = Tag<
  "AuthorInText" | "SuppressAuthor" | "NormalCitation"
>;
export type Alignment = Tag<
  "AlignLeft" | "AlignRight" | "AlignCenter" | "AlignDefault"
>;
export type ListNumberStyle = Tag<
  | "DefaultStyle"
  | "Example"
  | "Decimal"
  | "LowerRoman"
  | "UpperRoman"
  | "LowerAlpha"
  | "UpperAlpha"
>;
export type ListNumberDelim = Tag<
  "DefaultDelim" | "Period" | "OneParen" | "TwoParens"
>;

export type ListAttributes = readonly [
  start: number,
  style: ListNumberStyle,
  delimiter: ListNumberDelim,
];

export interface Citation {
  /** The CSL id the source cites the work by — a citekey spelling. */
  readonly citationId: string;
  readonly citationPrefix: Inlines;
  readonly citationSuffix: Inlines;
  readonly citationMode: CitationMode;
  readonly citationNoteNum: number;
  readonly citationHash: number;
}

export type Inline =
  | Node<"Str", string>
  | Node<"Emph", Inlines>
  | Node<"Underline", Inlines>
  | Node<"Strong", Inlines>
  | Node<"Strikeout", Inlines>
  | Node<"Superscript", Inlines>
  | Node<"Subscript", Inlines>
  | Node<"SmallCaps", Inlines>
  | Node<"Quoted", readonly [QuoteType, Inlines]>
  | Node<"Cite", readonly [readonly Citation[], Inlines]>
  | Node<"Code", readonly [Attr, string]>
  | Tag<"Space">
  | Tag<"SoftBreak">
  | Tag<"LineBreak">
  | Node<"Math", readonly [MathType, string]>
  | Node<"RawInline", readonly [Format, string]>
  | Node<"Link", readonly [Attr, Inlines, Target]>
  | Node<"Image", readonly [Attr, Inlines, Target]>
  | Node<"Note", Blocks>
  | Node<"Span", readonly [Attr, Inlines]>;

export type ColWidth = Node<"ColWidth", number> | Tag<"ColWidthDefault">;
export type ColSpec = readonly [alignment: Alignment, width: ColWidth];
export type Caption = readonly [short: Inlines | null, blocks: Blocks];
export type Cell = readonly [
  attr: Attr,
  alignment: Alignment,
  rowSpan: number,
  colSpan: number,
  blocks: Blocks,
];
export type Row = readonly [attr: Attr, cells: readonly Cell[]];
export type TableHead = readonly [attr: Attr, rows: readonly Row[]];
export type TableBody = readonly [
  attr: Attr,
  rowHeadColumns: number,
  intermediateHead: readonly Row[],
  rows: readonly Row[],
];
export type TableFoot = readonly [attr: Attr, rows: readonly Row[]];

export type Block =
  | Node<"Plain", Inlines>
  | Node<"Para", Inlines>
  | Node<"LineBlock", readonly Inlines[]>
  | Node<"CodeBlock", readonly [Attr, string]>
  | Node<"RawBlock", readonly [Format, string]>
  | Node<"BlockQuote", Blocks>
  | Node<"OrderedList", readonly [ListAttributes, readonly Blocks[]]>
  | Node<"BulletList", readonly Blocks[]>
  | Node<"DefinitionList", readonly (readonly [Inlines, readonly Blocks[]])[]>
  | Node<"Header", readonly [level: number, attr: Attr, inlines: Inlines]>
  | Tag<"HorizontalRule">
  | Node<
      "Table",
      readonly [
        attr: Attr,
        caption: Caption,
        columns: readonly ColSpec[],
        head: TableHead,
        bodies: readonly TableBody[],
        foot: TableFoot,
      ]
    >
  | Node<"Figure", readonly [attr: Attr, caption: Caption, blocks: Blocks]>
  | Node<"Div", readonly [attr: Attr, blocks: Blocks]>;

export type MetaValue =
  | Node<"MetaMap", Meta>
  | Node<"MetaList", readonly MetaValue[]>
  | Node<"MetaBool", boolean>
  | Node<"MetaString", string>
  | Node<"MetaInlines", Inlines>
  | Node<"MetaBlocks", Blocks>;

export type Meta = Readonly<Record<string, MetaValue>>;

/** One converted document. The array's length varies across API families. */
export interface Pandoc {
  readonly "pandoc-api-version": readonly number[];
  readonly meta: Meta;
  readonly blocks: Blocks;
}
