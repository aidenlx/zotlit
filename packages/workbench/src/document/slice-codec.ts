// How a pane shows its slice's stored text, and how it stores the reader's text back.
import { jsonLayout, jsonPosition, ruleDisplay } from "./json-source";
import {
  scalarDisplay,
  scalarSource,
  scalarStyle,
  scalarToDisplay,
  scalarToSource,
} from "./scalar-source";

/**
 * The two-way rule between a pane's own text, `shown`, and the text its slice
 * holds in the master document, `stored`.
 */
export interface SliceCodec {
  /** The pane's text for `stored`, which follows `prefix` on its first line. */
  show(stored: string, prefix: string): string;
  /** The slice text that holds `shown` in place of `stored`. */
  store(shown: string, stored: string): string;
  /** A caret in `shown` as an offset into `stored`. */
  toStored(shown: string, stored: string, position: number): number;
  /** An offset into `stored` as a caret in `shown`. */
  toShown(stored: string, shown: string, position: number): number;
}

/** The pane holds the stored text itself. */
export const sourceCodec: SliceCodec = {
  show: (stored) => stored,
  store: (shown) => shown,
  toStored: (_shown, _stored, position) => position,
  toShown: (_stored, _shown, position) => position,
};

/** A JSON-e rule: the pane lays the JSON out, and the manifest stores it compact. */
export const jsonCodec: SliceCodec = {
  show: ruleDisplay,
  store: (shown) => jsonLayout(shown, false).text,
  toStored: jsonPosition,
  toShown: jsonPosition,
};

/**
 * A YAML scalar: the pane shows the text the scalar reads as, and the manifest
 * stores a spelling that reads back as exactly the reader's text.
 */
export const scalarCodec: SliceCodec = {
  show: scalarDisplay,
  store: (shown, stored) => scalarSource(shown, scalarStyle(stored)),
  toStored: scalarToSource,
  toShown: scalarToDisplay,
};
