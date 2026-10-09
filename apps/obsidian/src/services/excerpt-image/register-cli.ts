// The local image command reads one database Snapshot and renders in the renderer.
import { Effect } from "effect";
import { stat } from "node:fs/promises";
import type { Plugin } from "obsidian";

import {
  annotationTypeToName,
  parseAnnotationPosition,
  resolveIndexedKeyLibraryIn,
} from "@zotlit/db";

import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import { ANNOTATION_IMAGE_COMMAND, answerAnnotationImage } from "./cli-image";
import { excerptRequestFrom } from "./request";
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
          read: async (key) => {
            await deps.zoteroPref.ready;
            const paths = {
              dataDir: deps.zoteroPref.dataDir,
              baseAttachmentPath: deps.zoteroPref.baseAttachmentPath,
            };
            await using lease = await deps.zoteroReads.acquireRead();
            const [libraries, identity] = await Effect.runPromise(
              Effect.all(
                [lease.reads.Libraries({}), lease.reads.DatabaseIdentity({})],
                { concurrency: "unbounded" },
              ),
              { signal: unload.signal },
            );
            const target = resolveIndexedKeyLibraryIn(libraries, key);
            if (!target) return null;
            const sources = await Effect.runPromise(
              lease.reads.AnnotationSources({
                libraryID: target.libraryID,
                keys: [target.key],
              }),
              { signal: unload.signal },
            );
            const annotation = sources.annotations.find(
              (entry) => entry.indexedKey === key,
            );
            if (!annotation) return null;
            const attachment = sources.attachments.find(
              (entry) => entry.itemID === annotation.parentItemID,
            );
            if (!attachment) return null;
            return excerptRequestFrom({
              annotation: {
                key: annotation.indexedKey,
                parentKey: attachment.indexedKey,
                type: annotationTypeToName(annotation.type),
                text: annotation.text,
                comment: annotation.comment,
                color: annotation.color,
                pageLabel: annotation.pageLabel,
                sortIndex: annotation.sortIndex,
                tags: annotation.tags,
                position: parseAnnotationPosition(
                  annotation.position,
                  attachment.contentType ?? "",
                ),
                version: annotation.version,
                lock: null,
              },
              source: {
                kind: "zotero-db",
                database: identity,
                libraryID: target.libraryID,
                libraryRevision:
                  libraries.find(
                    (entry) => entry.libraryID === target.libraryID,
                  )?.clientVersion ?? null,
              },
              identity,
              attachment,
              paths,
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
