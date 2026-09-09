// The authoring tabs, in the order the pane offers them, with the label and
// the lede each opens with.

import type { WorkbenchMessages } from "./generated/messages";
import type { WorkbenchMessageLabel } from "./messages";
export type WorkbenchTab =
  | "note"
  | "annotation"
  | "properties"
  | "name"
  | "profile"
  | "match";

export const TABS: readonly WorkbenchTab[] = [
  "note",
  "properties",
  "annotation",
  "name",
  "match",
  "profile",
];

const TAB_LABEL: Record<WorkbenchTab, WorkbenchMessageLabel> = {
  note: "workbench_tab_note",
  annotation: "workbench_tab_annotation",
  properties: "workbench_tab_properties",
  match: "workbench_tab_match",
  name: "workbench_tab_name_and_folder",
  profile: "workbench_tab_profile",
};

const TAB_LEDE: Record<WorkbenchTab, WorkbenchMessageLabel> = {
  note: "workbench_note_lede",
  annotation: "workbench_annotation_lede",
  properties: "workbench_properties_lede",
  match: "workbench_match_conditions_desc",
  name: "workbench_name_lede",
  profile: "workbench_profile_lede",
};

export function tabLabel(m: WorkbenchMessages, tab: WorkbenchTab): string {
  return m[TAB_LABEL[tab]]();
}

export function tabLede(m: WorkbenchMessages, tab: WorkbenchTab): string {
  return m[TAB_LEDE[tab]]();
}
