// Prepares excerpt helpers once, then counts only helpers used by the final render.
import { Effect } from "effect";
import type { App, TFile } from "obsidian";

import {
  annotationHasCacheImage,
  annotationOpenUri,
  parseAnnotationPosition,
} from "@zotlit/db";
import type { Annotation, AnnotationResolvers, TemplateLink } from "@zotlit/db";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";

import { attachmentFileLink } from "@/lib/annotation-render";
import { getLogger } from "@/lib/log";
import type { Settings } from "@/services/settings/schema";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import { createExcerptLink, summarizeExcerpts } from "./helper";
import type { ExcerptSummary } from "./helper";
import { materializeExcerpt, retainExcerpt } from "./materialize";
import type { MaterializedExcerpt } from "./materialize";
import type { ExcerptOutcomeScope } from "./outcome-scope";
import { referencedExcerptPaths } from "./references";
import { annotationRecordOf } from "./request";
import type { ExcerptImageService, ExcerptRequest } from "./service";
export type { ExcerptSummary } from "./helper";

const logger = getLogger("excerpt-prepare");

/** One collector belongs to one user operation, including partial or cancelled batches. */
export function collectExcerptSummary(
  report: (summary: ExcerptSummary) => void,
): {
  add: (summary: ExcerptSummary) => void;
  [Symbol.dispose](): void;
} {
  const total: ExcerptSummary = { zotero: 0, unchecked: 0, unavailable: 0 };
  return {
    add(summary) {
      total.zotero += summary.zotero;
      total.unchecked += summary.unchecked;
      total.unavailable += summary.unavailable;
      if (summary.notRefreshed)
        total.notRefreshed = (total.notRefreshed ?? 0) + summary.notRefreshed;
    },
    [Symbol.dispose]() {
      if (
        total.zotero ||
        total.unchecked ||
        total.unavailable ||
        total.notRefreshed
      )
        report(total);
    },
  };
}
export interface PreparedExcerpts {
  annotationImageLink: AnnotationResolvers["annotationImageLink"];
  prepare(): Promise<void>;
  summary(): ExcerptSummary;
}
export type ExcerptPreparation = (options: {
  /** The reads of the write the excerpts serve, bound to its Snapshot. */
  reads: Pick<
    ZoteroReadsApi,
    "AttachmentsByKeys" | "DatabaseIdentity" | "Libraries"
  >;
  notePath: string;
  settings: Readonly<Settings>;
  previousNote?: TFile;
  /**
   * The initiating batch's retained outcomes. Every note that batch writes —
   * including the Child Notes imported through this one's template — resolves
   * through this same scope, so repeated excerpts reuse one resolution.
   */
  outcomes?: ExcerptOutcomeScope;
}) => PreparedExcerpts;

export function createExcerptPreparation(deps: {
  app: App;
  resolver: Pick<ExcerptImageService, "operation">;
  paths: AttachmentPathContext;
}): ExcerptPreparation {
  return ({ reads, notePath, settings, previousNote, outcomes }) => {
    const candidates = new Map<
      string,
      {
        annotation: Annotation;
        result: MaterializedExcerpt;
        sourceLink: string;
        used: boolean;
        helper: TemplateLink;
      }
    >();
    return {
      annotationImageLink(annotation) {
        if (!annotationHasCacheImage(annotation.type)) return null;
        const prior = candidates.get(annotation.indexedKey);
        if (prior) return prior.helper;
        const candidate = {
          annotation,
          result: {
            kind: "unavailable",
            reason: "source",
          } as MaterializedExcerpt,
          sourceLink: `[Zotero](${annotationOpenUri({ attachmentKey: annotation.parentKey, annotationKey: annotation.key, groupID: annotation.groupID, pageLabel: annotation.pageLabel })})`,
          used: false,
          helper: (() => "") as TemplateLink,
        };
        candidate.helper = createExcerptLink(deps.app, notePath, candidate);
        candidates.set(annotation.indexedKey, candidate);
        return candidate.helper;
      },
      async prepare() {
        // Every database input is read before the vault, in one batch.
        const keysByLibrary = Map.groupBy(
          candidates.values(),
          ({ annotation }) => annotation.libraryID,
        );
        const [database, libraries, attachmentLists] = await Effect.runPromise(
          Effect.all(
            [
              reads.DatabaseIdentity({}),
              reads.Libraries({}),
              Effect.forEach(
                keysByLibrary,
                ([libraryID, group]) =>
                  reads.AttachmentsByKeys({
                    libraryID,
                    keys: group.map(({ annotation }) => annotation.parentKey),
                  }),
                { concurrency: "unbounded" },
              ),
            ],
            { concurrency: "unbounded" },
          ),
        );
        const attachments = new Map(
          attachmentLists.flat().map((a) => [a.itemID, a]),
        );
        await using operation = deps.resolver.operation({ outcomes });
        const previousPaths = previousNote
          ? await referencedExcerptPaths(deps.app, previousNote)
          : [];
        for (const candidate of candidates.values()) {
          const a = candidate.annotation;
          try {
            const attachment = attachments.get(a.parentItemID);
            if (!attachment) continue;
            const position = parseAnnotationPosition(
              a.position,
              attachment.contentType ?? "application/pdf",
            );
            candidate.sourceLink =
              attachmentFileLink(attachment, deps.paths, {
                annotation: a.indexedKey,
                page: "pageIndex" in position ? position.pageIndex + 1 : null,
              })() ?? candidate.sourceLink;
            const request: ExcerptRequest = {
              annotation: annotationRecordOf(a, attachment, position),
              source: {
                kind: "zotero-db",
                database,
                libraryID: a.libraryID,
                libraryRevision:
                  libraries.find((l) => l.libraryID === a.libraryID)
                    ?.clientVersion ?? null,
              },
              sourceScope: deps.paths.dataDir,
              libraryID: a.libraryID,
              attachmentKey: attachment.indexedKey,
              pdfPath: attachmentAbsPath(attachment, deps.paths),
              zoteroPngPath: resolveAnnotCachePath(a, {
                dataDir: deps.paths.dataDir,
                groupID: a.groupID,
              }),
            };
            try {
              if (!settings["attachment.import"]) {
                candidate.result = { kind: "unavailable", reason: "disabled" };
              } else {
                const outcome = await operation.resolve(request);
                candidate.result = await materializeExcerpt({
                  app: deps.app,
                  notePath,
                  settings,
                  request,
                  outcome,
                });
              }
            } catch (error) {
              logger.debug("Excerpt resolution failed", {
                annotationKey: a.indexedKey,
                error,
              });
            }
            if (candidate.result.kind === "unavailable") {
              candidate.result =
                (await retainExcerpt({
                  app: deps.app,
                  request,
                  paths: previousPaths,
                })) ?? candidate.result;
            }
          } catch (error) {
            logger.debug("Excerpt preparation failed", {
              annotationKey: a.indexedKey,
              error,
            });
          }
        }
      },
      summary() {
        return summarizeExcerpts(candidates.values());
      },
    };
  };
}
