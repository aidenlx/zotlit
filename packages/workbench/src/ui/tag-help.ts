import type { LiquidTagName } from "#/language/semantics";

import type { WorkbenchMessages } from "./generated/messages";
// Localized descriptions for the shared Liquid tag syntax catalog.
import type { WorkbenchMessageLabel } from "./messages";

const DESCRIPTIONS = {
  assign: "workbench_tag_assign",
  capture: "workbench_tag_capture",
  endcapture: "workbench_tag_endcapture",
  for: "workbench_tag_for",
  endfor: "workbench_tag_endfor",
  if: "workbench_tag_if",
  endif: "workbench_tag_endif",
  unless: "workbench_tag_unless",
  endunless: "workbench_tag_endunless",
  else: "workbench_tag_else",
  elsif: "workbench_tag_elsif",
  case: "workbench_tag_case",
  when: "workbench_tag_when",
  endcase: "workbench_tag_endcase",
  break: "workbench_tag_break",
  continue: "workbench_tag_continue",
  cycle: "workbench_tag_cycle",
  increment: "workbench_tag_increment",
  decrement: "workbench_tag_decrement",
  echo: "workbench_tag_echo",
  render: "workbench_tag_render",
  include: "workbench_tag_include",
  layout: "workbench_tag_layout",
  block: "workbench_tag_block",
  endblock: "workbench_tag_endblock",
  tablerow: "workbench_tag_tablerow",
  endtablerow: "workbench_tag_endtablerow",
  raw: "workbench_tag_raw",
  endraw: "workbench_tag_endraw",
  comment: "workbench_tag_comment",
  endcomment: "workbench_tag_endcomment",
  "#": "workbench_tag_inline_comment",
  liquid: "workbench_tag_liquid",
  bq: "workbench_tag_bq",
  endbq: "workbench_tag_endbq",
  suffix: "workbench_tag_suffix",
  render_annotation: "workbench_tag_render_annotation",
  managed: "workbench_tag_managed",
  endmanaged: "workbench_tag_endmanaged",
} satisfies Record<LiquidTagName, WorkbenchMessageLabel>;

/** Read at use time so hover and completion use the active language. */
export function tagDescription(
  m: WorkbenchMessages,
  name: LiquidTagName,
): string {
  return m[DESCRIPTIONS[name]]();
}
