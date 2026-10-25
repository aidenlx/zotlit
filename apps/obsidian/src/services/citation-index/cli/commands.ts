// Decodes citation questions and presents complete index answers as contract 4 JSON.
import { Cause, Effect } from "effect";
import type { CliData } from "obsidian";

import type { CliCommandHandler } from "@/lib/cli-command";
import { catchRejection } from "@/lib/cli-params";
import { withLogCategory } from "@/lib/effect-log";
import type {
  CitationIndex,
  DocumentCitationSet,
} from "@/services/citation-index/service";

import {
  ambiguousCitekeyDiagnostic,
  citekeyNotFoundDiagnostic,
  diagnostic,
  envelope,
  fileNotFoundDiagnostic,
  keyNotFoundDiagnostic,
  notSettledDiagnostic,
  rejectionDiagnostic,
  reportCandidates,
  reportAnnotationUses,
  reportGroups,
  reportOccurrences,
} from "./envelope";
import type {
  CitationsCommand,
  CitationsIdentity,
  Diagnostic,
  ReferenceEntry,
  EnvelopeTail,
} from "./envelope";
import { renderCitationsGuide } from "./guide";
import {
  parseAnnotationUsesRequest,
  parseCitedByRequest,
  parseGuideRequest,
  parseReferencesRequest,
  targetMismatch,
} from "./request";

export type { CitationsIdentity } from "./envelope";
export const CITED_BY_COMMAND = "zotlit:cited-by" as const;
export const REFERENCES_COMMAND = "zotlit:references" as const;
export const ANNOTATION_USES_COMMAND = "zotlit:annotation-uses" as const;
export const CITATIONS_GUIDE_COMMAND = "zotlit:citations-guide" as const;
export type CitationsCliHandlers = Record<CitationsCommand, CliCommandHandler>;

interface CitationsCliDeps {
  getIdentity(): Effect.Effect<CitationsIdentity>;
  settleTimeoutMs?: number;
  index: Pick<
    CitationIndex["Service"],
    "readCitedBy" | "readReferences" | "readAnnotationUses"
  >;
}

export function createCitationsCliHandlers(
  deps: CitationsCliDeps,
): CitationsCliHandlers {
  const timeout = deps.settleTimeoutMs ?? 5_000;
  const answer = <A extends object, E>(
    command: CitationsCommand,
    decode: (params: CliData) => Effect.Effect<A, E>,
    read: (request: A) => Effect.Effect<EnvelopeTail, unknown>,
  ): CliCommandHandler =>
    Effect.fn(`CitationsCli.${command}`)(
      function* (params: CliData) {
        const request = yield* decode(params);
        const identity = yield* deps.getIdentity();
        const echoed = { request, identity };
        const mismatch = targetMismatch(params, identity);
        if (mismatch)
          return envelope(command, {
            ok: false,
            ...echoed,
            diagnostic: mismatch,
          });
        return yield* read(request).pipe(
          Effect.map((result) => envelope(command, { ...echoed, ...result })),
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) =>
              Effect.logWarning("Cannot read the Citation Index").pipe(
                Effect.annotateLogs({ command, cause }),
                withLogCategory("citation-index", "cli"),
                Effect.as(
                  envelope(command, {
                    ok: false,
                    ...echoed,
                    diagnostic: diagnostic(
                      "INDEX_NOT_READY",
                      "The Citation Index cannot read the latest citation lookup. Refresh the Zotero source and run the command again.",
                    ),
                  }),
                ),
              ),
          ),
        );
      },
      catchRejection((rejection) =>
        envelope(command, {
          ok: false,
          diagnostic: rejectionDiagnostic(rejection),
        }),
      ),
    );
  const rejected = (diagnostic: Diagnostic) => ({
    ok: false as const,
    diagnostic,
  });
  const timedOut = () => ({
    ...rejected(notSettledDiagnostic(timeout)),
    coverage: "indexing",
  });
  return {
    [ANNOTATION_USES_COMMAND]: answer(
      ANNOTATION_USES_COMMAND,
      parseAnnotationUsesRequest,
      ({ key }) =>
        deps.index.readAnnotationUses(key, timeout).pipe(
          Effect.map((result) =>
            result.kind === "timeout"
              ? timedOut()
              : {
                  ok: true as const,
                  groups: reportAnnotationUses(result.uses),
                  coverage: result.coverage,
                },
          ),
        ),
    ),
    [CITED_BY_COMMAND]: answer(
      CITED_BY_COMMAND,
      parseCitedByRequest,
      (selector) =>
        deps.index.readCitedBy(selector, timeout).pipe(
          Effect.map((result) => {
            switch (result.kind) {
              case "timeout":
                return timedOut();
              case "missing":
                return rejected(keyNotFoundDiagnostic(result.key));
              case "unresolved":
                return rejected(citekeyNotFoundDiagnostic(result.citekey));
              case "ambiguous":
                return rejected(
                  ambiguousCitekeyDiagnostic(
                    result.citekey,
                    reportCandidates(result.candidates),
                  ),
                );
              case "ready":
                return {
                  ok: true as const,
                  item: result.item,
                  groups: reportGroups(result.groups),
                  omittedSyntaxes: result.omittedSyntaxes,
                  coverage: result.coverage,
                  resolution: result.resolution,
                  syntaxes: result.syntaxes,
                };
            }
          }),
        ),
    ),
    [REFERENCES_COMMAND]: answer(
      REFERENCES_COMMAND,
      parseReferencesRequest,
      ({ file }) =>
        deps.index.readReferences(file, timeout).pipe(
          Effect.map((result) => {
            if (result.kind === "timeout") return timedOut();
            const set = result.document;
            if (!set) return rejected(fileNotFoundDiagnostic(file));
            return {
              ok: true as const,
              entries: referenceEntries(set),
              omittedSyntaxes: set.omittedSyntaxes,
              database: set.database,
              resolution: "fresh",
              syntaxes: set.syntaxes,
              coverage: set.coverage,
            };
          }),
        ),
    ),
    [CITATIONS_GUIDE_COMMAND]: (params) =>
      parseGuideRequest(params).pipe(
        Effect.map(() => renderCitationsGuide()),
        catchRejection((rejection) =>
          envelope(CITATIONS_GUIDE_COMMAND, {
            ok: false,
            diagnostic: rejectionDiagnostic(rejection),
          }),
        ),
      ),
  };
}

function referenceEntries(set: DocumentCitationSet): ReferenceEntry[] {
  const entries: ReferenceEntry[] = set.citations.map(
    ({ indexedKey, linkpath, outcome, refNumber, occurrences }) => {
      const base = { refNumber, occurrences: reportOccurrences(occurrences) };
      switch (outcome!.kind) {
        case "resolved": {
          const source = outcome!.source;
          return {
            ...base,
            kind: "resolved",
            key: indexedKey!,
            citekey: source.citekey,
            summary: source.summary,
            linkpath: source.linkpath,
          };
        }
        case "ineligible-item":
          return {
            ...base,
            kind: "resolved",
            key: outcome!.key,
            citekey: null,
            summary: null,
            linkpath,
          };
        case "missing-item":
          return { ...base, kind: "missing", key: outcome!.key };
        case "missing-annotation":
          return {
            ...base,
            kind: "unresolved",
            annotationKey: outcome!.annotationKey,
          };
        case "unresolved-key":
          return { ...base, kind: "unresolved", citekey: outcome!.citekey };
        case "ambiguous-key":
          return {
            ...base,
            kind: "ambiguous",
            citekey: outcome!.citekey,
            candidates: reportCandidates(outcome!.candidates),
          };
        case "unreadable":
          return { ...base, kind: "unreadable" };
        case "malformed":
          return { ...base, kind: "malformed" };
      }
    },
  );
  for (const { occurrence } of set.errors)
    entries.push({
      kind: "malformed",
      occurrences: reportOccurrences([occurrence]),
    });
  return entries.sort(
    (a, b) =>
      a.occurrences[0]!.position.start.offset -
      b.occurrences[0]!.position.start.offset,
  );
}
