// The landing's story: eight research jobs in the order a researcher meets
// them, and every feature of each job. Copy lives in `docs_home_*` messages;
// the facts (versions, badges, docs links) were checked against the changelog
// and the docs on this branch.
// @see apps/docs/DESIGN.md → Landing

import { m } from "@/paraglide/messages.js";

export const JOB_IDS = [
  "connect",
  "find",
  "read",
  "notes",
  "cite",
  "connections",
  "export",
  "customise",
] as const;
export type JobId = (typeof JOB_IDS)[number];

type Text = () => string;

export interface Job {
  id: JobId;
  name: Text;
  outcome: Text;
}

export const JOBS: readonly Job[] = [
  {
    id: "connect",
    name: m.docs_home_job_connect,
    outcome: m.docs_home_job_connect_outcome,
  },
  {
    id: "find",
    name: m.docs_home_job_find,
    outcome: m.docs_home_job_find_outcome,
  },
  {
    id: "read",
    name: m.docs_home_job_read,
    outcome: m.docs_home_job_read_outcome,
  },
  {
    id: "notes",
    name: m.docs_home_job_notes,
    outcome: m.docs_home_job_notes_outcome,
  },
  {
    id: "cite",
    name: m.docs_home_job_cite,
    outcome: m.docs_home_job_cite_outcome,
  },
  {
    id: "connections",
    name: m.docs_home_job_connections,
    outcome: m.docs_home_job_connections_outcome,
  },
  {
    id: "export",
    name: m.docs_home_job_export,
    outcome: m.docs_home_job_export_outcome,
  },
  {
    id: "customise",
    name: m.docs_home_job_customise,
    outcome: m.docs_home_job_customise_outcome,
  },
];

export interface Feature {
  id: string;
  job: JobId;
  name: Text;
  line: Text;
  /** The docs page, as a site path. */
  href: string;
  /** The release that brought it: "2.2" shows "New in 2.2", "2.1" "Since 2.1", "2.0" no badge. */
  since: "2.0" | "2.1" | "2.2";
  /** Shows "For power users". */
  power?: boolean;
  /** Shows "Needs ZotLit Companion". */
  companion?: boolean;
  /** A plain-words gloss of the technical term the feature uses. */
  plain?: Text;
}

const f = (
  job: JobId,
  id: string,
  rest: Omit<Feature, "id" | "job">,
): Feature => ({ id, job, ...rest });

// Badges and links checked on 2026-11-11 against apps/docs/content/changelog
// and apps/docs/content/docs: the release that introduced each feature, and
// the docs page that explains it.
export const FEATURES: readonly Feature[] = [
  // Bring your library
  f("connect", "direct", {
    name: m.docs_home_f_direct,
    line: m.docs_home_f_direct_line,
    href: "/docs/setup/what-zotlit-reads-and-writes",
    since: "2.0",
  }),
  f("connect", "libraries", {
    name: m.docs_home_f_libraries,
    line: m.docs_home_f_libraries_line,
    href: "/docs/reference/settings#library-scope",
    since: "2.1",
  }),
  f("connect", "zotero10", {
    name: m.docs_home_f_zotero10,
    line: m.docs_home_f_zotero10_line,
    href: "/docs/how-to/keep-zotero-and-obsidian-in-sync",
    since: "2.1",
  }),
  f("connect", "welcome", {
    name: m.docs_home_f_welcome,
    line: m.docs_home_f_welcome_line,
    href: "/learn/connect-zotero-to-obsidian",
    since: "2.0",
  }),
  f("connect", "companion", {
    name: m.docs_home_f_companion,
    line: m.docs_home_f_companion_line,
    href: "/docs/install-companion",
    since: "2.0",
    companion: true,
  }),
  f("connect", "chinese", {
    name: m.docs_home_f_chinese,
    line: m.docs_home_f_chinese_line,
    href: "/docs/reference/settings#chinese-segmenter",
    since: "2.0",
  }),
  // Find a paper
  f("find", "library", {
    name: m.docs_home_f_library,
    line: m.docs_home_f_library_line,
    href: "/docs/how-to/use-library-view",
    since: "2.2",
  }),
  f("find", "readingCard", {
    name: m.docs_home_f_readingCard,
    line: m.docs_home_f_readingCard_line,
    href: "/docs/how-to/use-library-view#reading-card",
    since: "2.2",
  }),
  f("find", "recent", {
    name: m.docs_home_f_recent,
    line: m.docs_home_f_recent_line,
    href: "/docs/how-to/use-library-view#recent",
    since: "2.2",
  }),
  f("find", "switcher", {
    name: m.docs_home_f_switcher,
    line: m.docs_home_f_switcher_line,
    href: "/docs/how-to/create-and-open-notes#quick-switcher",
    since: "2.0",
  }),
  f("find", "showInLibrary", {
    name: m.docs_home_f_showInLibrary,
    line: m.docs_home_f_showInLibrary_line,
    href: "/docs/how-to/use-library-view#show-in-library",
    since: "2.2",
  }),
  // Read and annotate
  f("read", "pdf", {
    name: m.docs_home_f_pdf,
    line: m.docs_home_f_pdf_line,
    href: "/docs/how-to/open-pdf-in-obsidian",
    since: "2.2",
  }),
  f("read", "pdfEdit", {
    name: m.docs_home_f_pdfEdit,
    line: m.docs_home_f_pdfEdit_line,
    href: "/docs/how-to/edit-pdf-annotations",
    since: "2.2",
  }),
  f("read", "annotationView", {
    name: m.docs_home_f_annotationView,
    line: m.docs_home_f_annotationView_line,
    href: "/docs/how-to/use-annotation-view",
    since: "2.0",
  }),
  f("read", "excerpts", {
    name: m.docs_home_f_excerpts,
    line: m.docs_home_f_excerpts_line,
    href: "/docs/reference/excerpt-images",
    since: "2.2",
  }),
  f("read", "annotationPopover", {
    name: m.docs_home_f_annotationPopover,
    line: m.docs_home_f_annotationPopover_line,
    href: "/docs/how-to/open-pdf-in-obsidian#file-links",
    since: "2.2",
  }),
  // Take literature notes
  f("notes", "litNote", {
    name: m.docs_home_f_litNote,
    line: m.docs_home_f_litNote_line,
    href: "/docs/how-to/create-and-open-notes",
    since: "2.0",
  }),
  f("notes", "dragAnnotation", {
    name: m.docs_home_f_dragAnnotation,
    line: m.docs_home_f_dragAnnotation_line,
    href: "/docs/how-to/use-annotation-view",
    since: "2.0",
  }),
  f("notes", "liveAnnotations", {
    name: m.docs_home_f_liveAnnotations,
    line: m.docs_home_f_liveAnnotations_line,
    href: "/docs/reference/how-queries-work",
    since: "2.2",
  }),
  f("notes", "keepWriting", {
    name: m.docs_home_f_keepWriting,
    line: m.docs_home_f_keepWriting_line,
    href: "/docs/how-to/keep-notes-updated",
    since: "2.0",
  }),
  f("notes", "batch", {
    name: m.docs_home_f_batch,
    line: m.docs_home_f_batch_line,
    href: "/docs/how-to/create-and-open-notes#bulk",
    since: "2.0",
    companion: true,
  }),
  f("notes", "importNotes", {
    name: m.docs_home_f_importNotes,
    line: m.docs_home_f_importNotes_line,
    href: "/docs/how-to/import-zotero-notes",
    since: "2.0",
  }),
  f("notes", "readingStatus", {
    name: m.docs_home_f_readingStatus,
    line: m.docs_home_f_readingStatus_line,
    href: "/docs/how-to/track-reading-status",
    since: "2.2",
  }),
  // Cite while you write
  f("cite", "suggester", {
    name: m.docs_home_f_suggester,
    line: m.docs_home_f_suggester_line,
    href: "/docs/how-to/insert-citations",
    since: "2.0",
  }),
  f("cite", "livePreview", {
    name: m.docs_home_f_livePreview,
    line: m.docs_home_f_livePreview_line,
    href: "/docs/how-to/insert-citations",
    since: "2.1",
  }),
  f("cite", "popover", {
    name: m.docs_home_f_popover,
    line: m.docs_home_f_popover_line,
    href: "/docs/how-to/insert-citations",
    since: "2.1",
  }),
  f("cite", "styles", {
    name: m.docs_home_f_styles,
    line: m.docs_home_f_styles_line,
    href: "/docs/reference/settings#citation-style",
    since: "2.1",
  }),
  f("cite", "wikilinkCites", {
    name: m.docs_home_f_wikilinkCites,
    line: m.docs_home_f_wikilinkCites_line,
    href: "/docs/reference/citation-links",
    since: "2.1",
  }),
  // See how your sources connect
  f("connections", "references", {
    name: m.docs_home_f_references,
    line: m.docs_home_f_references_line,
    href: "/docs/how-to/review-copy-troubleshoot-references",
    since: "2.1",
  }),
  f("connections", "citedBy", {
    name: m.docs_home_f_citedBy,
    line: m.docs_home_f_citedBy_line,
    href: "/docs/how-to/create-and-open-notes",
    since: "2.1",
  }),
  f("connections", "graph", {
    name: m.docs_home_f_graph,
    line: m.docs_home_f_graph_line,
    href: "/docs/how-to/explore-citations-in-graph",
    since: "2.2",
  }),
  f("connections", "query", {
    name: m.docs_home_f_query,
    line: m.docs_home_f_query_line,
    href: "/docs/how-to/use-query-files",
    since: "2.2",
  }),
  // Export and submit
  f("export", "exportWord", {
    name: m.docs_home_f_exportWord,
    line: m.docs_home_f_exportWord_line,
    href: "/docs/how-to/export-note-with-citations",
    since: "2.1",
  }),
  f("export", "copyBib", {
    name: m.docs_home_f_copyBib,
    line: m.docs_home_f_copyBib_line,
    href: "/docs/how-to/review-copy-troubleshoot-references",
    since: "2.1",
  }),
  f("export", "pandoc", {
    name: m.docs_home_f_pandoc,
    line: m.docs_home_f_pandoc_line,
    href: "/docs/how-to/pandoc-citation-workflow",
    since: "2.1",
    power: true,
    plain: m.docs_home_plain_pandoc,
  }),
  // Make it yours
  f("customise", "workbench", {
    name: m.docs_home_f_workbench,
    line: m.docs_home_f_workbench_line,
    href: "/docs/reference/template-workbench-view",
    since: "2.2",
    power: true,
    plain: m.docs_home_plain_workbench,
  }),
  f("customise", "profiles", {
    name: m.docs_home_f_profiles,
    line: m.docs_home_f_profiles_line,
    href: "/docs/reference/templates/how-templates-work",
    since: "2.2",
    power: true,
    plain: m.docs_home_plain_profiles,
  }),
  f("customise", "dataExplorer", {
    name: m.docs_home_f_dataExplorer,
    line: m.docs_home_f_dataExplorer_line,
    href: "/docs/how-to/explore-template-data",
    since: "2.0",
    power: true,
    plain: m.docs_home_plain_dataExplorer,
  }),
  f("customise", "agents", {
    name: m.docs_home_f_agents,
    line: m.docs_home_f_agents_line,
    href: "/docs/install-skill",
    since: "2.0",
    power: true,
  }),
  f("customise", "queryCli", {
    name: m.docs_home_f_queryCli,
    line: m.docs_home_f_queryCli_line,
    href: "/docs/how-to/query-zotero-library",
    since: "2.2",
    power: true,
  }),
];

export const featuresOf = (job: JobId) => FEATURES.filter((x) => x.job === job);

/** "01" … "08": the job's number as the contents list and section heads print it. */
export const jobNumber = (i: number) => String(i + 1).padStart(2, "0");

/** The id of a job's section, the target of the key, the contents and the phone bar. */
export const jobAnchor = (id: JobId) => `job-${id}`;
