// The renderer-side answer of the local Annotation image command.
import type { CliData } from "obsidian";

import { parseIndexedKey } from "@zotlit/db";

import { diagnostic } from "@/services/item-query/contract";
import { contractVersion } from "@/services/item-query/contract-version.json";
import { invalid, rejectParameters } from "@/services/item-query/decode";

import type { ExcerptRequest } from "./contract";
import type { ExcerptImage } from "./format";
import type { ExcerptOutcome } from "./service";

export const ANNOTATION_IMAGE_COMMAND = "zotlit:annotation-image";

export interface AnnotationImagePorts {
  read(key: string): Promise<ExcerptRequest | null>;
  resolve(
    request: ExcerptRequest,
    signal?: AbortSignal,
  ): Promise<ExcerptOutcome>;
  publish(fingerprint: string, bytes: Uint8Array): Promise<string>;
  exists(path: string): Promise<boolean>;
}

function envelope(tail: object): string {
  return JSON.stringify(
    { contractVersion, command: ANNOTATION_IMAGE_COMMAND, ...tail },
    null,
    2,
  );
}

export async function answerAnnotationImage(
  params: CliData,
  ports: AnnotationImagePorts,
  signal?: AbortSignal,
): Promise<string> {
  const rejected = rejectParameters(params, ["key"]);
  if (rejected) return envelope({ ok: false, diagnostic: rejected });
  const key = params.key;
  if (!key || !parseIndexedKey(key))
    return envelope({
      ok: false,
      diagnostic: invalid(
        "key",
        "Give one Annotation Indexed Key as key=<indexed-key>.",
      ),
    });
  let request: ExcerptRequest | null;
  try {
    request = await ports.read(key);
  } catch (error) {
    signal?.throwIfAborted();
    return envelope({
      ok: false,
      diagnostic: diagnostic("source-unavailable", String(error)),
    });
  }
  if (!request)
    return imageFailure(
      "annotation-not-found",
      `No Annotation has the key '${key}'.`,
    );
  if (request.annotation.type !== "image" && request.annotation.type !== "ink")
    return imageFailure(
      "not-an-image-annotation",
      `Annotation '${key}' has no Excerpt Image.`,
    );
  try {
    const outcome = await ports.resolve(request, signal);
    signal?.throwIfAborted();
    if (outcome.kind === "available") {
      const path =
        outcome.provenance === "zotero"
          ? request.zoteroPngPath
          : await ports.publish(
              outcome.identity.key,
              await pngBytes(outcome, signal),
            );
      if (!path)
        return imageFailure(
          "render-failed",
          "The Excerpt Image has no file path.",
        );
      return envelope({
        ok: true,
        key,
        path,
        format: "png",
        provenance: outcome.provenance,
      });
    }
    const pdfExists =
      request.pdfPath !== null && (await ports.exists(request.pdfPath));
    const cacheExists =
      request.zoteroPngPath !== null &&
      (await ports.exists(request.zoteroPngPath));
    return !pdfExists && !cacheExists
      ? imageFailure(
          "file-unavailable",
          "The PDF and Zotero cache image are unavailable on this device.",
        )
      : imageFailure(
          "render-failed",
          "The Excerpt Image could not be rendered.",
        );
  } catch (error) {
    signal?.throwIfAborted();
    return error instanceof Error && error.name === "TimeoutError"
      ? imageFailure(
          "render-timeout",
          "The Excerpt Image exceeded the 35 second rendering deadline.",
        )
      : imageFailure(
          "render-failed",
          `The Excerpt Image could not be prepared: ${String(error)}`,
        );
  }
}

const IMAGE_HINTS = {
  "annotation-not-found": "Use an Annotation key from zotlit:annotation-query.",
  "not-an-image-annotation":
    "Use the key of an image or ink Annotation with hasExcerptImage=true.",
  "file-unavailable":
    "Ask the user to download the PDF in Zotero, then run the command again.",
  "render-failed":
    "Ask the user to open the PDF in Zotero and check the marked region, then run the command again; check the plugin log if it still fails.",
  "render-timeout":
    "Run the command again; if the image still times out, ask the user to open the PDF in Zotero so it can generate a cache image.",
} as const;

function imageFailure(code: keyof typeof IMAGE_HINTS, message: string): string {
  return envelope({
    ok: false,
    diagnostic: { code, message, hint: IMAGE_HINTS[code] },
  });
}

/** The CLI publishes PNG while the shared renderer and cache keep their format. */
async function pngBytes(
  image: ExcerptImage,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (image.format.format === "png") return image.bytes;
  const bitmap = await createImageBitmap(
    new Blob([image.bytes as BlobPart], { type: image.format.mimeType }),
  );
  try {
    signal?.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot create the Excerpt Image canvas");
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (encoded) =>
          encoded ? resolve(encoded) : reject(new Error("PNG encoding failed")),
        "image/png",
      ),
    );
    signal?.throwIfAborted();
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}
