// The local image command reads one database Snapshot and renders in the renderer.
import { stat } from "node:fs/promises";

import type { CliHost } from "@/lib/cli-command";
import { Effect } from "@/lib/effect";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import { ANNOTATION_IMAGE_COMMAND, answerAnnotationImage } from "./cli-image";
import { ExcerptSourceUnavailable, excerptRequestForKey } from "./request";
import type { ExcerptImageService } from "./service";
import { publishExcerptPng } from "./temp-store";

interface AnnotationImageDeps {
  zoteroReads: ZoteroReadsService;
  zoteroPref: Pick<PlainZoteroPref, "dataDir" | "baseAttachmentPath">;
  excerptImage: ExcerptImageService;
}

export function registerAnnotationImageCli(
  host: CliHost,
  deps: AnnotationImageDeps,
): void {
  host.registerCliCommand(ANNOTATION_IMAGE_COMMAND, {
    description: "Get a PNG file path for one image or ink Annotation as JSON",
    flags: {
      key: {
        value: "<indexed-key>",
        description: "The image or ink Annotation's Indexed Key",
        required: true,
      },
    },
    handler: (params) =>
      answerAnnotationImage(params, {
        read: (key) => readExcerptRequest(deps, key),
        resolve: (request, signal) =>
          deps.excerptImage.resolve(request, signal),
        publish: publishExcerptPng,
        exists: async (path) =>
          (await stat(path).catch(() => null))?.isFile() ?? false,
      }),
  });
}

/**
 * The excerpt request of the Annotation `key` names, read from one Snapshot
 * under the paths of the active source.
 */
function readExcerptRequest(deps: AnnotationImageDeps, key: string) {
  const unavailable = (error: unknown) =>
    new ExcerptSourceUnavailable({
      message: error instanceof Error ? error.message : String(error),
    });
  return Effect.gen(function* () {
    const paths = {
      dataDir: deps.zoteroPref.dataDir,
      baseAttachmentPath: deps.zoteroPref.baseAttachmentPath,
    };
    const lease = yield* acquireAsyncDisposable(() =>
      deps.zoteroReads.acquireRead(),
    ).pipe(Effect.mapError(({ cause }) => unavailable(cause)));
    return yield* excerptRequestForKey({ reads: lease.reads, key, paths });
  }).pipe(Effect.scoped);
}
