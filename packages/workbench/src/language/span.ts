/**
 * A range of a text in UTF-16 offsets, `from` inclusive and `to` exclusive:
 * a token, or the place a Fault names.
 */
export interface Span {
  readonly from: number;
  readonly to: number;
}

/** Where a run found a Fault: the text it planned, and the span in that text. */
export interface PlacedFault {
  readonly text: string;
  readonly span: Span;
}
