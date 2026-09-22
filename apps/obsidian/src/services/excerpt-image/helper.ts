// Shared rendering and accounting for prepared excerpt links.
import type { App } from "obsidian";

import type { TemplateLink } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { syntheticFile } from "@/lib/markdown-link";

import type { MaterializedExcerpt } from "./materialize";

export interface ExcerptSummary {
  zotero: number;
  unchecked: number;
  unavailable: number;
  notRefreshed?: number;
}

export interface PreparedExcerpt {
  result: MaterializedExcerpt;
  sourceLink: string;
  used: boolean;
}

export function createExcerptLink(
  app: App,
  notePath: string,
  state: PreparedExcerpt,
): TemplateLink {
  const render = (embed: boolean, alias?: string, subpath?: string) => {
    state.used = true;
    const result = state.result;
    if (result.kind === "unavailable") {
      const explanation =
        result.reason === "disabled"
          ? m.excerpt_image_import_disabled()
          : m.excerpt_image_unavailable();
      return `${explanation}${state.sourceLink ? ` ${state.sourceLink}` : ""}`;
    }
    const link = app.fileManager.generateMarkdownLink(
      syntheticFile(result.path),
      notePath,
      subpath,
      alias,
    );
    return embed ? `!${link}` : link;
  };
  return Object.assign(
    (alias?: string, subpath?: string) => render(false, alias, subpath),
    {
      renderEmbed: (alias?: string, subpath?: string) =>
        render(true, alias, subpath),
    },
  );
}

export function summarizeExcerpts(
  states: Iterable<PreparedExcerpt>,
): ExcerptSummary {
  const summary: ExcerptSummary = { zotero: 0, unchecked: 0, unavailable: 0 };
  for (const { used, result } of states) {
    if (!used) continue;
    if (result.kind === "unavailable") summary.unavailable++;
    else if (result.kind === "retained")
      summary.notRefreshed = (summary.notRefreshed ?? 0) + 1;
    else if (result.outcome.provenance === "zotero") summary.zotero++;
    else if (result.outcome.freshness !== "checked") summary.unchecked++;
  }
  return summary;
}
