// Draft citations use their own source and presentation, without entering the saved-note cache.
import type { App } from "obsidian";

import {
  getItemsByKey,
  getZoteroIdentity,
  isChildItemFields,
  itemToCsl,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";
import type { CslItemData } from "@zotlit/db";
import type { RenderDiagnostic } from "@zotlit/workbench/render";

import type { CitationSource } from "@/lib/citation-source";
import * as m from "@/lib/i18n/generated/messages";
import type { WikilinkCitation } from "@/lib/wikilink-citation";
import {
  citationOfRun,
  citationRuns,
  wikilinkCitation,
} from "@/lib/wikilink-citation";
import {
  maskExclusions,
  scanDocumentCitations,
} from "@/services/citation-index/scan";
import type { CitationIndex } from "@/services/citation-index/service";
import type { PresentedCitation } from "@/services/citation-text/present";
import type { DatabaseService } from "@/services/database/service";
import { resolveLiteratureNote } from "@/services/note-index/service";
import { holdsNote } from "@/services/pandoc/inline-content";
import type {
  BibliographyRenderCache,
  HeldRenderOutcome,
} from "@/services/pandoc/render-cache";

export interface NativeCitationDeps {
  app: App;
  db: Pick<DatabaseService, "acquireRead">;
  bibliographyRender: Pick<
    BibliographyRenderCache,
    "renderCitations" | "render" | "vaultPresentation" | "on"
  >;
  citationIndex: Pick<
    CitationIndex,
    "resolveCitekey" | "citekeyOf" | "whenResolved"
  >;
}
export interface PreviewCitation extends PresentedCitation {
  source: string;
  start: number;
  /** An empty list identifies a literal Citation. */
  links: readonly { target: string; citation: WikilinkCitation }[];
}
interface DraftCitation extends CitationSource {
  start: number;
  works: (string | null)[];
  links: readonly { target: string; citation: WikilinkCitation }[];
}

export async function renderDraftCitations(
  deps: NativeCitationDeps,
  input: {
    markdown: string;
    sourcePath: string;
    styleId: string | null;
    locale: string | null;
    wikilinks: boolean;
  },
): Promise<{
  citations: readonly PreviewCitation[];
  diagnostics: RenderDiagnostic[];
}> {
  await deps.citationIndex.whenResolved();
  const placed: DraftCitation[] = scanDocumentCitations(input.markdown).map(
    ({ start, end, keys }) => ({
      start,
      source: input.markdown.slice(start, end),
      links: [],
      keys: keys.map((key) => ({
        ...key,
        start: key.start - start,
        end: key.end - start,
      })),
      works: keys.map(({ citekey }) => {
        const found = deps.citationIndex.resolveCitekey(citekey);
        return found?.kind === "unique" ? found.item.indexedKey : null;
      }),
    }),
  );
  if (input.wikilinks) {
    const links = draftLinks(input.markdown);
    const runs = citationRuns(
      links,
      (link) =>
        wikilinkCitation(link.target, {
          enabled: true,
          literatureNote: (linkpath) => {
            const note = resolveLiteratureNote(
              linkpath,
              input.sourcePath,
              deps,
            );
            return (
              note && {
                ...note,
                citationKey: deps.citationIndex.citekeyOf(note.indexedKey),
              }
            );
          },
        }),
      (left, right) => input.markdown.slice(left.end, right.start),
    );
    for (const run of runs)
      placed.push({
        ...citationOfRun(run),
        start: run[0]!.source.start,
        links: run.map(({ source, citation }) => ({
          target: source.target,
          citation,
        })),
      });
  }
  placed.sort((left, right) => left.start - right.start);
  if (placed.length === 0) return { citations: [], diagnostics: [] };
  const items = new Map<string, CslItemData>();
  {
    using lease = await deps.db.acquireRead();
    const user = getZoteroIdentity(lease.client);
    for (const key of new Set(placed.flatMap(({ works }) => works))) {
      if (key === null) continue;
      const selector = resolveIndexedKeyLibrary(lease.client, key);
      if (!selector) continue;
      const item = getItemsByKey(lease.client, selector.libraryID, [
        selector.key,
      ])[0];
      if (item && !isChildItemFields(item.fields))
        items.set(key, { ...itemToCsl(item, user), id: key });
    }
  }
  const complete = placed.filter(({ works }) =>
    works.every((key) => key !== null && items.has(key)),
  );
  if (complete.length === 0) return { citations: [], diagnostics: [] };
  const sources = complete.map(namedSource);
  const presentation = { styleId: input.styleId, locale: input.locale };
  const result = await settled(() =>
    deps.bibliographyRender.renderCitations(
      sources,
      [...items.values()],
      presentation,
    ),
  );
  if (result.kind !== "held")
    return {
      citations: [],
      diagnostics: [
        {
          code: "citation-style-error",
          part: "render",
          message:
            result.reason === "engine-absent"
              ? m.profile_preview_citation_engine_absent()
              : result.reason === "style-missing"
                ? m.profile_preview_citation_style_missing()
                : m.profile_preview_citation_failed(),
        },
      ],
    };
  const formatted = result.record.value;
  const serials = new Map<string, number>();
  if (formatted.some(({ content }) => holdsNote(content))) {
    const bibliography = await settled(() =>
      deps.bibliographyRender.render([...items.values()], presentation),
    );
    if (bibliography.kind === "held")
      bibliography.record.value.entries.forEach(({ id }, index) =>
        serials.set(id, index + 1),
      );
  }
  return {
    citations: formatted.map((text, index) => ({
      source: complete[index]!.source,
      start: complete[index]!.start,
      links: complete[index]!.links,
      text,
      serials: holdsNote(text.content)
        ? text.citations.map(({ id }) => serials.get(id))
        : [],
    })),
    diagnostics: [],
  };
}
async function settled<T>(
  read: () => Promise<HeldRenderOutcome<T>>,
): Promise<HeldRenderOutcome<T>> {
  let result = await read();
  while (result.kind === "held" && result.record.status === "revalidating") {
    await result.record.settled;
    result = await read();
  }
  return result;
}
function namedSource(citation: DraftCitation): string {
  let source = citation.source;
  for (let index = citation.keys.length - 1; index >= 0; index--) {
    const key = citation.keys[index]!;
    const marker = source[key.start] === "-" ? "-@" : "@";
    source = `${source.slice(0, key.start)}${marker}${citation.works[index]}${source.slice(key.end)}`;
  }
  return source;
}
/** Mask the same non-prose zones as the Citation Index before reading native wikilinks. */
function draftLinks(
  markdown: string,
): { start: number; end: number; target: string }[] {
  const masked = maskExclusions(markdown);
  const links: { start: number; end: number; target: string }[] = [];
  let cursor = 0;
  while (cursor < masked.length) {
    const start = masked.indexOf("[[", cursor);
    if (start < 0) break;
    const close = masked.indexOf("]]", start + 2);
    if (close < 0) break;
    cursor = close + 2;
    const target = masked.slice(start + 2, close);
    if (
      masked[start - 1] === "!" ||
      masked[start - 1] === "\\" ||
      target.includes("|") ||
      target.includes("\n")
    )
      continue;
    links.push({ start, end: cursor, target });
  }
  return links;
}
