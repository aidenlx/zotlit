// The authoring tabs, in the order the pane offers them, with the label and
// the lede each opens with. The Template Document kind picks the set.

import type {
  WorkbenchDocumentKind,
  WorkbenchProblem,
} from "#/document/controller";

import type { WorkbenchMessages } from "./generated/messages";
import type { WorkbenchMessageLabel } from "./messages";
export type WorkbenchTab =
  | "note"
  | "annotation"
  | "properties"
  | "name"
  | "profile"
  | "match"
  | "citation"
  | "partial";

/** The tabs a Profile document opens with, which is also the web Workbench's set. */
export const TABS: readonly WorkbenchTab[] = [
  "note",
  "properties",
  "annotation",
  "name",
  "match",
  "profile",
];

/** The manifest's `details` fields the Profile tab edits; the rest are the Name and folder tab's. */
const PROFILE_FIELDS: readonly string[] = [
  "name",
  "description",
  "version",
  "author",
  "sampleItemType",
  "language",
];

/** Whether `problem` names a manifest field the Profile tab edits. */
export const isProfileProblem = (
  problem: Pick<WorkbenchProblem, "slice" | "params">,
): boolean =>
  problem.slice === "details" &&
  PROFILE_FIELDS.includes(problem.params?.field ?? "");

const KIND_TABS: Record<WorkbenchDocumentKind, readonly WorkbenchTab[]> = {
  profile: TABS,
  citation: ["citation"],
  partial: ["partial"],
};

/** The tabs `kind` shows, in the order the tab strip offers them. */
export function tabsFor(kind: WorkbenchDocumentKind): readonly WorkbenchTab[] {
  return KIND_TABS[kind];
}

const TAB_LABEL: Record<WorkbenchTab, WorkbenchMessageLabel> = {
  note: "workbench_tab_note",
  annotation: "workbench_tab_annotation",
  properties: "workbench_tab_properties",
  match: "workbench_tab_match",
  name: "workbench_tab_name_and_folder",
  profile: "workbench_tab_profile",
  citation: "workbench_tab_citation",
  partial: "workbench_tab_partial",
};

const TAB_LEDE: Record<WorkbenchTab, WorkbenchMessageLabel> = {
  note: "workbench_note_lede",
  annotation: "workbench_annotation_lede",
  properties: "workbench_properties_lede",
  match: "workbench_match_conditions_desc",
  name: "workbench_name_lede",
  profile: "workbench_profile_lede",
  citation: "workbench_citation_lede",
  partial: "workbench_partial_lede",
};

/** The docs page that shows how to write each tab's part of the template. */
const TAB_DOCS: Record<
  WorkbenchTab,
  { readonly label: WorkbenchMessageLabel; readonly path: string }
> = {
  note: {
    label: "workbench_docs_note",
    path: "/docs/reference/templates/syntax",
  },
  annotation: {
    label: "workbench_docs_annotation",
    path: "/docs/tutorial/customize-template",
  },
  properties: {
    label: "workbench_docs_properties",
    path: "/docs/how-to/configure-frontmatter-properties",
  },
  match: {
    label: "workbench_docs_match",
    path: "/docs/how-to/use-different-templates",
  },
  name: {
    label: "workbench_docs_name",
    path: "/docs/how-to/customize-a-template",
  },
  profile: { label: "workbench_docs_profile", path: "/docs/concepts/profiles" },
  citation: {
    label: "workbench_docs_citation",
    path: "/docs/how-to/customize-a-template#citation-text",
  },
  partial: {
    label: "workbench_docs_partial",
    path: "/docs/how-to/customize-a-template#share-a-partial",
  },
};

/** The guide link for `tab`: its text and its path under the docs site. */
export function tabDocs(
  m: WorkbenchMessages,
  tab: WorkbenchTab,
): { label: string; path: string } {
  const { label, path } = TAB_DOCS[tab];
  return { label: m[label](), path };
}

export function tabLabel(m: WorkbenchMessages, tab: WorkbenchTab): string {
  return m[TAB_LABEL[tab]]();
}

export function tabLede(m: WorkbenchMessages, tab: WorkbenchTab): string {
  return m[TAB_LEDE[tab]]();
}
