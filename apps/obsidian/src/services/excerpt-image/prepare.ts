// Prepares excerpt helpers once, then counts only helpers used by the final render.
import { Context, Effect, Layer } from "effect";
import type { FileSystem } from "effect";
import type { TFile } from "obsidian";

import {
  annotationHasCacheImage,
  annotationOpenUri,
  parseAnnotationPosition,
} from "@zotlit/db";
import type { Annotation, AnnotationResolvers, TemplateLink } from "@zotlit/db";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";

import { withLogCategory } from "@/lib/effect-log";
import { portCall } from "@/lib/legacy-port";
import { FileManager } from "@/lib/obsidian-file-manager";
import type { MetadataCache } from "@/lib/obsidian-metadata-cache";
import type { Vault } from "@/lib/obsidian-vault";
import type { Workspace } from "@/lib/obsidian-workspace";
import type { VaultError } from "@/lib/vault-errors";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { Settings } from "@/services/settings/schema";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import { createExcerptLink, summarizeExcerpts } from "./helper";
import type { ExcerptSummary } from "./helper";
import { ExcerptImages } from "./layer";
import {
  makePublicationGate,
  materializeExcerpt,
  recover,
  retainExcerpt,
} from "./materialize";
import type { MaterializedExcerpt, PublicationGate } from "./materialize";
import type { ExcerptOutcomeScope } from "./outcome-scope";
import { referencedExcerptPaths } from "./references";
import { annotationRecordOf } from "./request";
import type { ExcerptRequest } from "./service";
export type { ExcerptSummary } from "./helper";

const logged = withLogCategory("excerpt-prepare");

/** One collector belongs to one user operation, including partial or cancelled batches. */
export function collectExcerptSummary(): {
  add: (summary: ExcerptSummary) => void;
  /** The sum, or `undefined` while it counts no excerpt. */
  total: () => ExcerptSummary | undefined;
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
    total: () =>
      total.zotero || total.unchecked || total.unavailable || total.notRefreshed
        ? total
        : undefined,
  };
}

/** The reads of the write the excerpts serve, bound to its Snapshot. */
export type ExcerptPreparationReads = Pick<
  ZoteroReadsApi,
  "AttachmentsByKeys" | "DatabaseIdentity" | "Libraries"
>;

/**
 * What {@link PreparedExcerpts.prepare} fails with: a database read, or the
 * read of the previous note.
 */
export type ExcerptPrepareError =
  | Effect.Error<
      ReturnType<ExcerptPreparationReads[keyof ExcerptPreparationReads]>
    >
  | VaultError;

/** The excerpt helpers of one note write. */
export interface PreparedExcerpts {
  /** The template's image helper; it collects the excerpts the render asks for. */
  annotationImageLink: AnnotationResolvers["annotationImageLink"];
  /**
   * Resolve and write every collected excerpt. Every database input is read
   * before the vault. One excerpt that fails is logged and stays unavailable.
   */
  readonly prepare: Effect.Effect<void, ExcerptPrepareError>;
  /** The outcomes of the helpers the final render used. */
  summary(): ExcerptSummary;
}

/** The note write {@link ExcerptPreparation.forNote} prepares excerpts for. */
export interface NoteExcerptOptions {
  reads: ExcerptPreparationReads;
  notePath: string;
  settings: Readonly<Settings>;
  previousNote?: TFile;
  /**
   * The initiating batch's retained outcomes. Every note that batch writes —
   * including the Child Notes imported through this one's template — resolves
   * through this same scope, so repeated excerpts reuse one resolution.
   */
  outcomes?: ExcerptOutcomeScope;
}

/** The captured card {@link ExcerptPreparation.forCard} prepares an excerpt for. */
export interface CardExcerptOptions {
  annotation: AnnotationRecord;
  request: ExcerptRequest | null;
  settings: Readonly<Settings>;
  notePath: string;
  /** Markdown link the unavailable-excerpt text points back to the Annotation with. */
  sourceLink: string;
  /** Whether the insertion target is still current. */
  valid: Effect.Effect<boolean>;
}

/** A captured card's durable image helper, `null` for a card with no image. */
export interface PreparedCardExcerpt {
  helper: TemplateLink | null;
  summary(): ExcerptSummary;
}

/**
 * The Excerpt Image preparation of note writes and captured cards: it
 * resolves each excerpt through {@link ExcerptImages} and writes it into the
 * vault before the template renders its link.
 */
export class ExcerptPreparation extends Context.Service<
  ExcerptPreparation,
  {
    /** The excerpt helpers of one note write, at the Zotero data directory now. */
    forNote(options: NoteExcerptOptions): Effect.Effect<PreparedExcerpts>;
    /**
     * A captured card's helper, prepared before its one template render. An
     * interrupt cancels it and takes back the bytes it wrote.
     */
    forCard(options: CardExcerptOptions): Effect.Effect<PreparedCardExcerpt>;
  }
>()("zotlit/excerpt-image/ExcerptPreparation") {}

/** The services the preparation reads through their tags. */
export type ExcerptPreparationServices =
  | ExcerptImages
  | FileManager
  | FileSystem.FileSystem
  | MetadataCache
  | Vault
  | Workspace
  | ZoteroPref;

/** The preparation over the graph's tags; one publication gate for all of it. */
export const layerExcerptPreparation = Layer.effect(
  ExcerptPreparation,
  Effect.gen(function* () {
    const context = yield* Effect.context<ExcerptPreparationServices>();
    const gate = yield* makePublicationGate;
    const run = Effect.runSyncWith(context);
    const markdownLinkFrom =
      (notePath: string) => (file: TFile, subpath?: string, alias?: string) =>
        run(
          Effect.flatMap(FileManager, (fileManager) =>
            fileManager.generateMarkdownLink(file, notePath, {
              subpath,
              alias,
            }),
          ),
        );
    return ExcerptPreparation.of({
      forNote: Effect.fn("ExcerptPreparation.forNote")(function* (options) {
        const { dataDir, baseAttachmentPath } = yield* (yield* ZoteroPref)
          .current;
        return noteExcerpts(
          {
            gate,
            markdownLink: markdownLinkFrom(options.notePath),
            paths: { dataDir, baseAttachmentPath },
          },
          options,
          (effect) => Effect.provideContext(effect, context),
        );
      }, Effect.provideContext(context)),
      forCard: Effect.fn("ExcerptPreparation.forCard")((options) =>
        cardExcerpt(gate, markdownLinkFrom(options.notePath), options).pipe(
          Effect.provideContext(context),
        ),
      ),
    });
  }),
);

interface Candidate {
  annotation: Annotation;
  result: MaterializedExcerpt;
  sourceLink: string;
  used: boolean;
  helper: TemplateLink;
}

function noteExcerpts(
  deps: {
    gate: PublicationGate;
    markdownLink: Parameters<typeof createExcerptLink>[0];
    paths: { dataDir: string; baseAttachmentPath: string | null };
  },
  { reads, notePath, settings, previousNote, outcomes }: NoteExcerptOptions,
  provide: <A, E>(
    effect: Effect.Effect<A, E, ExcerptPreparationServices>,
  ) => Effect.Effect<A, E>,
): PreparedExcerpts {
  const candidates = new Map<string, Candidate>();
  const prepare = Effect.gen(function* () {
    // Every database input is read before the vault, in one batch.
    const keysByLibrary = Map.groupBy(
      candidates.values(),
      ({ annotation }) => annotation.libraryID,
    );
    const [database, libraries, attachmentLists] = yield* Effect.all(
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
    );
    const attachments = new Map(
      attachmentLists.flat().map((a) => [a.itemID, a]),
    );
    const images = yield* ExcerptImages;
    const operation = yield* Effect.acquireDisposable(
      Effect.sync(() => images.operation({ outcomes })),
    );
    const previousPaths = previousNote
      ? yield* referencedExcerptPaths(previousNote)
      : [];
    for (const candidate of candidates.values()) {
      const a = candidate.annotation;
      yield* Effect.gen(function* () {
        const attachment = attachments.get(a.parentItemID);
        if (!attachment) return;
        const position = parseAnnotationPosition(
          a.position,
          attachment.contentType ?? "application/pdf",
        );
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
        yield* Effect.gen(function* () {
          if (!settings["attachment.import"]) {
            candidate.result = { kind: "unavailable", reason: "disabled" };
            return;
          }
          const outcome = yield* portCall("excerpt-resolve", (signal) =>
            operation.resolve(request, signal),
          );
          candidate.result = yield* materializeExcerpt({
            gate: deps.gate,
            notePath,
            settings,
            request,
            outcome,
          });
        }).pipe(
          recover(
            (cause) =>
              Effect.logDebug("Excerpt resolution failed").pipe(
                Effect.annotateLogs({ annotationKey: a.indexedKey, cause }),
                logged,
              ),
            Effect.void,
          ),
        );
        if (candidate.result.kind === "unavailable") {
          candidate.result =
            (yield* retainExcerpt({ request, paths: previousPaths })) ??
            candidate.result;
        }
      }).pipe(
        recover(
          (cause) =>
            Effect.logDebug("Excerpt preparation failed").pipe(
              Effect.annotateLogs({ annotationKey: a.indexedKey, cause }),
              logged,
            ),
          Effect.void,
        ),
      );
    }
  }).pipe(Effect.scoped, provide);
  return {
    annotationImageLink(annotation) {
      if (!annotationHasCacheImage(annotation.type)) return null;
      const prior = candidates.get(annotation.indexedKey);
      if (prior) return prior.helper;
      const candidate: Candidate = {
        annotation,
        result: { kind: "unavailable", reason: "source" },
        sourceLink: `[Zotero](${annotationOpenUri({ attachmentKey: annotation.parentKey, annotationKey: annotation.key, groupID: annotation.groupID, pageLabel: annotation.pageLabel })})`,
        used: false,
        helper: (() => "") as TemplateLink,
      };
      candidate.helper = createExcerptLink(deps.markdownLink, candidate);
      candidates.set(annotation.indexedKey, candidate);
      return candidate.helper;
    },
    prepare,
    summary() {
      return summarizeExcerpts(candidates.values());
    },
  };
}

const cardExcerpt = Effect.fnUntraced(function* (
  gate: PublicationGate,
  markdownLink: Parameters<typeof createExcerptLink>[0],
  options: CardExcerptOptions,
) {
  const { annotation, request, settings } = options;
  let result: MaterializedExcerpt = {
    kind: "unavailable",
    reason: settings["attachment.import"] ? "source" : "disabled",
  };
  const image = annotationHasCacheImage(annotation.type);
  if (
    image &&
    request &&
    settings["attachment.import"] &&
    (yield* options.valid)
  ) {
    const images = yield* ExcerptImages;
    yield* Effect.gen(function* () {
      const outcome = yield* portCall("excerpt-resolve", (signal) =>
        images.resolve(request, signal),
      );
      if (yield* options.valid)
        result = yield* materializeExcerpt({
          gate,
          notePath: options.notePath,
          settings,
          request,
          outcome,
          valid: options.valid,
        });
    }).pipe(
      recover(
        (cause) =>
          Effect.logDebug("Captured excerpt preparation failed").pipe(
            Effect.annotateLogs({ annotationKey: annotation.key, cause }),
            logged,
          ),
        Effect.void,
      ),
    );
  }
  const state = { used: false, result, sourceLink: options.sourceLink };
  const prepared: PreparedCardExcerpt = {
    helper: image ? createExcerptLink(markdownLink, state) : null,
    summary() {
      return summarizeExcerpts([state]);
    },
  };
  return prepared;
});
