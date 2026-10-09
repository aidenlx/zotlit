// The local image command reads one database Snapshot and renders in the renderer.
import { stat } from "node:fs/promises";
import type { Plugin } from "obsidian";

import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import { ANNOTATION_IMAGE_COMMAND, answerAnnotationImage } from "./cli-image";
import { excerptRequestForKey } from "./request";
import type { ExcerptImageService } from "./service";
import { publishExcerptPng } from "./temp-store";

interface AnnotationImageDeps {
  zoteroReads: ZoteroReadsService;
  zoteroPref: ZoteroPrefService;
  excerptImage: ExcerptImageService;
}

export function registerAnnotationImageCli(
  plugin: Plugin,
  deps: AnnotationImageDeps,
): void {
  const unload = new AbortController();
  plugin.register(() => unload.abort());
  plugin.registerCliHandler(
    ANNOTATION_IMAGE_COMMAND,
    "Get a PNG file path for one image or ink Annotation as JSON",
    {
      key: {
        value: "<indexed-key>",
        description: "The image or ink Annotation's Indexed Key",
        required: true,
      },
    },
    (params) =>
      answerAnnotationImage(
        params,
        {
          read: async (key, signal) => {
            await deps.zoteroPref.ready;
            const paths = {
              dataDir: deps.zoteroPref.dataDir,
              baseAttachmentPath: deps.zoteroPref.baseAttachmentPath,
            };
            await using lease = await deps.zoteroReads.acquireRead();
            return excerptRequestForKey({
              reads: lease.reads,
              key,
              paths,
              signal,
            });
          },
          resolve: (request, signal) =>
            deps.excerptImage.resolve(request, signal),
          publish: publishExcerptPng,
          exists: async (path) =>
            (await stat(path).catch(() => null))?.isFile() ?? false,
        },
        unload.signal,
      ),
  );
}
