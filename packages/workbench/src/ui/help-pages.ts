// What the Workbench view's Help action opens, in both hosts: the docs pages
// a template author returns to, then the community for what they miss. Each
// path is on the docs site; a host joins it to the site it links to. The
// community link is the host's own `communityUrl`, which the Problems area
// offers too.
import type { WorkbenchMessageLabel } from "./messages";

interface HelpPage {
  readonly label: WorkbenchMessageLabel;
  readonly path: string;
}

/** The step-by-step guide, the syntax, and the field reference. */
export const HELP_PAGES: readonly HelpPage[] = [
  { label: "workbench_docs_guide", path: "/docs/how-to/customize-a-template" },
  { label: "workbench_docs_note", path: "/docs/reference/templates/syntax" },
  { label: "workbench_docs_data", path: "/docs/reference/templates/data" },
];
