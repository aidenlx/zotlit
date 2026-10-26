// The Note Feature over members a case states as Promises. A write's rejection
// is that write's typed failure, `NoteWriteAborted`, as a throwing render is.
import { Effect, Layer } from "effect";
import type { TFile } from "obsidian";

import type { ExcerptSummary } from "@/services/excerpt-image/prepare";

import { NoteWriteAborted } from "@/services/note-feature/errors";
import type { NoteFeatureHandle } from "@/services/note-feature/operations";
import { NoteFeature } from "@/services/note-feature/service";
import type {
  UpdateResult,
  WriteNoteUpdateOptions,
} from "@/services/note-feature/types";

/** The members a case gives, in the Promise shape of the edge handle. */
export interface PromiseNoteFeature extends Pick<
  NoteFeatureHandle,
  | "createNote"
  | "updateNote"
  | "resolveCompanionNote"
  | "resolveCreationProfile"
  | "planCreations"
> {
  reportExcerptImages(summary: ExcerptSummary): void;
  writeNoteUpdate(
    file: TFile,
    options: WriteNoteUpdateOptions,
  ): Promise<UpdateResult>;
}

const write = <A>(path: string, call: () => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => new NoteWriteAborted({ path, cause }),
  });

/**
 * The `NoteFeature` tag over what `feature` answers. Each call reads the
 * member as it is then, so a case may replace a member after the layer is
 * built.
 */
export function layerPromiseNoteFeature(
  feature: () => PromiseNoteFeature,
): Layer.Layer<NoteFeature> {
  return Layer.mock(NoteFeature, {
    reportExcerptImages: (summary) =>
      Effect.sync(() => feature().reportExcerptImages(summary)),
    createNote: (item, options) =>
      write("", () => feature().createNote(item, options)),
    updateNote: (file, options) =>
      write(file.path, () => feature().updateNote(file, options)),
    writeNoteUpdate: (file, options) =>
      write(file.path, () => feature().writeNoteUpdate(file, options)),
    resolveCompanionNote: (indexedKey, options) =>
      Effect.promise(() => feature().resolveCompanionNote(indexedKey, options)),
    resolveCreationProfile: (sources) =>
      Effect.promise(() => feature().resolveCreationProfile(sources)),
    planCreations: (indexedKeys, sources) =>
      Effect.map(
        Effect.promise(() => feature().planCreations(indexedKeys, sources)),
        (plans) =>
          new Map(
            [...plans].map(([key, plan]) => [
              key,
              {
                ...plan,
                previews: plan.previews.map((preview) => ({
                  ...preview,
                  create: (options?: Parameters<typeof preview.create>[0]) =>
                    write(preview.path ?? "", () => preview.create(options)),
                })),
              },
            ]),
          ),
      ),
  });
}
