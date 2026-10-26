// The local image command reads one database Snapshot and renders in the renderer.
import { Effect, FileSystem, Layer } from "effect";

import { PluginHost } from "@/lib/plugin-host";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { ANNOTATION_IMAGE_COMMAND, answerAnnotationImage } from "./cli-image";
import { ExcerptImages } from "./layer";
import { ExcerptSourceUnavailable, excerptRequestForKey } from "./request";
import { publishExcerptPng } from "./temp-store";

/** The `zotlit:annotation-image` command. */
export const layerAnnotationImageCli: Layer.Layer<
  never,
  never,
  PluginHost | ZoteroReads | ZoteroPref | ExcerptImages | FileSystem.FileSystem
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const reads = yield* ZoteroReads;
    const pref = yield* ZoteroPref;
    const excerptImage = yield* ExcerptImages;
    const fs = yield* FileSystem.FileSystem;
    /**
     * The excerpt request of the Annotation `key` names, read from one
     * Snapshot under the paths of the active source.
     */
    const read = (key: string) =>
      Effect.gen(function* () {
        const { dataDir, baseAttachmentPath } = yield* pref.current;
        const snapshot = yield* reads.snapshot.pipe(
          Effect.mapError(
            (error) => new ExcerptSourceUnavailable({ message: error.message }),
          ),
        );
        return yield* excerptRequestForKey({
          reads: snapshot,
          key,
          paths: { dataDir, baseAttachmentPath },
        });
      }).pipe(Effect.scoped);
    host.registerCliCommand(ANNOTATION_IMAGE_COMMAND, {
      description:
        "Get a PNG file path for one image or ink Annotation as JSON",
      flags: {
        key: {
          value: "<indexed-key>",
          description: "The image or ink Annotation's Indexed Key",
          required: true,
        },
      },
      handler: (params) =>
        answerAnnotationImage(params, {
          read,
          resolve: (request, signal) => excerptImage.resolve(request, signal),
          publish: publishExcerptPng,
          // A path that cannot be read counts as no file, as an absent one does.
          exists: (path) =>
            fs.stat(path).pipe(
              Effect.map(({ type }) => type === "File"),
              Effect.orElseSucceed(() => false),
            ),
        }),
    });
  }),
);
