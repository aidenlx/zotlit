export type {
  ObsidianGlyph,
  ObsidianTextItem,
  Rect,
  StructuredChar,
  StructuredPage,
  ZoteroChar,
} from "@/chars";
export { structurePage, toZoteroChars } from "@/chars";
export type { PageLabelSource, PreviousAnnotation } from "@/page-label";
export { alignPageLabel, extractPageLabels } from "@/page-label";
export type { PdfPageSource } from "@/session";
export { PdfTextStructure } from "@/session";
export type {
  PdfInkPosition,
  PdfPosition,
  PdfRectsPosition,
} from "@/sort-index";
export { computeSortIndex } from "@/sort-index";
export type {
  PagePoint,
  RangeAdjustment,
  RangeEnd,
  SelectedText,
  TextLayerSelection,
  TextSelection,
} from "@/text-selection";
