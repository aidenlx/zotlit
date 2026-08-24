// Installed Native Pandoc Workflow files and its focused CLI reference.

import type { CliData } from "obsidian";

import { CONTRACT_VERSION } from "./contract";
import {
  pandocCliFilter,
  pandocDefaults,
  PANDOC_DEFAULTS_FILENAME,
  PANDOC_FILTER_FILENAME,
} from "./filter";

export const PANDOC_FILES_COMMAND = "zotlit:pandoc-files";
export const PANDOC_GUIDE_COMMAND = "zotlit:pandoc-guide";

export { savePandocIntegrationFiles } from "./integration-save";
export type {
  SavePandocIntegrationOptions,
  SavePandocIntegrationResult,
} from "./integration-save";

type PandocIntegrationHandler = (params: CliData) => string;

export type PandocIntegrationHandlers = Record<
  typeof PANDOC_FILES_COMMAND | typeof PANDOC_GUIDE_COMMAND,
  PandocIntegrationHandler
>;

/** The version-matched pair distributed by one installed ZotLit build. */
export function pandocIntegrationFiles(): Record<string, string> {
  return {
    [PANDOC_FILTER_FILENAME]: pandocCliFilter,
    [PANDOC_DEFAULTS_FILENAME]: pandocDefaults,
  };
}

export function createPandocIntegrationHandlers(
  pluginVersion: string,
): PandocIntegrationHandlers {
  return {
    [PANDOC_FILES_COMMAND]: (params) => {
      assertNoParameters(PANDOC_FILES_COMMAND, params);
      return JSON.stringify(
        {
          contractVersion: CONTRACT_VERSION,
          // The namespace `contractVersion` belongs to (ADR 0026).
          command: PANDOC_FILES_COMMAND,
          pluginVersion,
          files: pandocIntegrationFiles(),
        },
        null,
        2,
      );
    },
    [PANDOC_GUIDE_COMMAND]: (params) => {
      assertNoParameters(PANDOC_GUIDE_COMMAND, params);
      return renderPandocGuide(pluginVersion);
    },
  };
}

function assertNoParameters(command: string, params: CliData): void {
  if (Object.keys(params).length > 0) {
    throw new TypeError(`${command} accepts no parameters`);
  }
}

/** Man-style reference for ZotLit's part of the Native Pandoc Workflow. */
export function renderPandocGuide(pluginVersion: string): string {
  return `ZOTLIT-PANDOC(1)

NAME
    zotlit-pandoc - use literature note citations with native Pandoc

VERSION
    ZotLit ${pluginVersion}

FILES
    ${PANDOC_FILTER_FILENAME} is the CLI filter. ${PANDOC_DEFAULTS_FILENAME} loads it before citeproc.
    Choose one user-owned workflow folder and keep both files together under
    these exact names. User Pandoc options belong on the command line or in a
    separate user-owned defaults file.

RETRIEVE OR REFRESH
    Run:

        obsidian ${PANDOC_FILES_COMMAND}

    The JSON response contains contractVersion, command, pluginVersion, and
    both exact files under files. Stage both files, compare both destination
    files, and replace the pair when either file differs. Refresh the pair after
    ZotLit is updated. The Citations settings page provides the same pair
    through Save integration files.

    contractVersion versions the pandoc commands alone; every other zotlit:*
    namespace versions its own CLI Contract independently.

CITATION STYLE
    A document selects a Zotero-installed style with the zotlit-csl property,
    which holds one CSL style ID:

        ---
        zotlit-csl: http://www.zotero.org/styles/nature
        ---

    The CLI filter resolves that property before citeproc runs, through:

        obsidian zotlit:csl style="http://www.zotero.org/styles/nature"

    Success returns contractVersion, command, the requested "styleId",
    "parentId" for a dependent style, and "path": the absolute CSL file citeproc
    opens. Failure returns { "errors": [...] } and stops the run.

    A dependent style resolves to its independent parent's formatting under its
    own default locale, which is why the response names a file of its own rather
    than the installed parent.

    path is addressed by the resolved content: the same content answers the same
    path, and a style edited in Zotero answers another. Resolve on every run and
    use the path the response carries; a path recorded from an earlier run can
    name content that no longer matches the installed style.

    Standard Pandoc inputs stay Pandoc's: a document that carries csl alone, or
    a run that passes --csl, is converted without ZotLit reading either. A
    document that carries both csl and zotlit-csl stops with csl-ambiguous.
    ZotLit leaves lang untouched, so the document keeps the language it declares.

    A pair saved under this contractVersion reads zotlit-csl. Refresh the pair
    as RETRIEVE OR REFRESH describes before a document relies on it.

RESOLVE
    The CLI filter calls this command during a normal Pandoc run:

        obsidian zotlit:resolve file="/absolute/path/to/input.md"

    Success returns { "citations": { "linkpath": "citationKey" } }. Failure
    returns { "errors": [...] }; any error stops all citation conversion.
    Direct resolver calls are for diagnosis of a failed workflow.

ERRORS
    file-not-found               The absolute input path is not a vault file.
    database-unavailable         ZotLit cannot read the configured Zotero database.
    item-not-found               A literature note names no live Zotero item.
    citation-key-missing         The resolved item has no citation key.
    duplicate-citation-key       Two cited items have the same citation key.
    unresolved-citation-intent   A #cite: target is not a literature note.
    style-missing                Zotero has no style installed under that CSL ID.
    parent-missing               The dependent style's independent parent is not installed.
    style-unreadable             A CSL file of that style refuses to be read.
    style-invalid                That style is no standalone CSL style.
    csl-write-failed             The resolved CSL style could not be written.
    csl-ambiguous                The document declares both csl and zotlit-csl.

COMPATIBILITY
    Pandoc 3.1.1 or newer.
    Obsidian 1.13.4 or newer.
    Obsidian installer 1.12.7 or newer, with Command line interface enabled.
    Zotero 7.0.31 or newer for native citation keys.
    Keep Obsidian running with the input vault and ZotLit loaded. Keep the
    obsidian launcher available to Pandoc.

BIBLIOGRAPHY
    Supply a CSL-JSON bibliography whose ids match the resolved citation keys.
    Reuse a bibliography the user supplies. Better BibTeX CSL-JSON auto-export
    is recommended for automatic refresh. Manual Zotero CSL JSON export is
    supported. ZotLit does not generate the native bibliography.

RUN
    pandoc "/absolute/path/to/input.md" --defaults "/absolute/path/to/workflow/${PANDOC_DEFAULTS_FILENAME}" --bibliography "/absolute/path/to/references.json" --fail-if-warnings --output "/absolute/path/to/output.docx"

ALTERNATIVE
    The built-in Export active note with Pandoc command uses ZotLit's sandbox
    filter and managed engine. It does not use this integration pair.`;
}
