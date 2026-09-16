// Types for the shared fingerprint helper, which ships as JS so the Node-only
// oracle script and the TypeScript parity test can both reach it. The parameter
// is spelled structurally, because this file sits outside `src` and so outside
// the path mapping that would reach `StructuredChar`.

export declare function fingerprint(char: {
  offset: number;
  c: string;
  u: string;
  rect: readonly number[];
  inlineRect: readonly number[];
  rotation: number;
  baseline: number;
  fontSize: number;
  fontName: string;
  spaceAfter?: boolean;
  wordBreakAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
  ignorable?: boolean;
}): string;
