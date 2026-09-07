// The authoring tabs, in the order the pane offers them, with the label and
// the lede each opens with.

import { m } from "./paraglide/messages.js";

export type WorkbenchTab =
  | "note"
  | "annotation"
  | "properties"
  | "name"
  | "match";

export const TABS: readonly WorkbenchTab[] = [
  "note",
  "properties",
  "annotation",
  "match",
  "name",
];

export const TAB_LABEL: Record<WorkbenchTab, () => string> = {
  note: m.workbench_tab_note,
  annotation: m.workbench_tab_annotation,
  properties: m.workbench_tab_properties,
  match: m.workbench_tab_match,
  name: m.workbench_tab_name_and_folder,
};

export const TAB_LEDE: Record<WorkbenchTab, () => string> = {
  note: m.workbench_note_lede,
  annotation: m.workbench_annotation_lede,
  properties: m.workbench_properties_lede,
  match: m.workbench_match_conditions_desc,
  name: m.workbench_name_lede,
};
