/**
 * A range of a text in UTF-16 offsets, `from` inclusive and `to` exclusive:
 * a token, or the place a Fault names.
 */
export interface Span {
  readonly from: number;
  readonly to: number;
}
