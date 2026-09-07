// Localized descriptions for the shared Liquid tag syntax catalog.
import type { LiquidTagName } from "@zotlit/workbench/completion";

import { m } from "@/paraglide/messages.js";

const DESCRIPTIONS = {
  assign: m.workbench_tag_assign,
  capture: m.workbench_tag_capture,
  endcapture: m.workbench_tag_endcapture,
  for: m.workbench_tag_for,
  endfor: m.workbench_tag_endfor,
  if: m.workbench_tag_if,
  endif: m.workbench_tag_endif,
  unless: m.workbench_tag_unless,
  endunless: m.workbench_tag_endunless,
  else: m.workbench_tag_else,
  elsif: m.workbench_tag_elsif,
  case: m.workbench_tag_case,
  when: m.workbench_tag_when,
  endcase: m.workbench_tag_endcase,
  break: m.workbench_tag_break,
  continue: m.workbench_tag_continue,
  cycle: m.workbench_tag_cycle,
  increment: m.workbench_tag_increment,
  decrement: m.workbench_tag_decrement,
  echo: m.workbench_tag_echo,
  render: m.workbench_tag_render,
  include: m.workbench_tag_include,
  layout: m.workbench_tag_layout,
  block: m.workbench_tag_block,
  endblock: m.workbench_tag_endblock,
  tablerow: m.workbench_tag_tablerow,
  endtablerow: m.workbench_tag_endtablerow,
  raw: m.workbench_tag_raw,
  endraw: m.workbench_tag_endraw,
  comment: m.workbench_tag_comment,
  endcomment: m.workbench_tag_endcomment,
  "#": m.workbench_tag_inline_comment,
  liquid: m.workbench_tag_liquid,
  bq: m.workbench_tag_bq,
  endbq: m.workbench_tag_endbq,
  suffix: m.workbench_tag_suffix,
  render_annotation: m.workbench_tag_render_annotation,
  managed: m.workbench_tag_managed,
  endmanaged: m.workbench_tag_endmanaged,
} satisfies Record<LiquidTagName, () => string>;

/** Read at use time so hover and completion use the active language. */
export function tagDescription(name: LiquidTagName): string {
  return DESCRIPTIONS[name]();
}
