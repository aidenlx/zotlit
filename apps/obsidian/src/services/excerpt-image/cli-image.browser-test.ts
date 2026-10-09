import { check } from "./__fixtures__/check";
import { answerAnnotationImage } from "./cli-image";
import type { AnnotationImagePorts } from "./cli-image";
import type { ExcerptRequest } from "./contract";
import { encodeExcerptImage } from "./encode";

export async function run(): Promise<string[]> {
  const canvas = document.createElement("canvas");
  canvas.width = 3;
  canvas.height = 2;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 3, 2);
  const image = await encodeExcerptImage(canvas, new AbortController().signal);
  const request: ExcerptRequest = {
    annotation: {
      key: "ABCDEFGH",
      parentKey: "JKLMNPQR",
      type: "image",
      color: null,
      text: null,
      comment: null,
      pageLabel: "1",
      sortIndex: "",
      tags: [],
      position: { kind: "pdf-rects", pageIndex: 0, rects: [[0, 0, 3, 2]] },
      version: null,
      lock: null,
    },
    source: {
      kind: "zotero-db",
      database: { userID: 1, localUserKey: null, serverID: null },
      libraryID: 1,
      libraryRevision: null,
    },
    sourceScope: "/zotero",
    attachmentKey: "JKLMNPQR",
    libraryID: 1,
    pdfPath: "/paper.pdf",
    zoteroPngPath: "/zotero/cache/ABCDEFGH.png",
  };
  const passed: string[] = [];
  const ports: AnnotationImagePorts = {
    read: async () => request,
    resolve: async () => ({
      kind: "available",
      provenance: "rendered",
      freshness: "checked",
      ...image,
      identity: { key: "a".repeat(64), fingerprint: "image", pdf: null },
    }),
    publish: async (_fingerprint, bytes) => {
      check(bytes[0] === 137 && bytes[1] === 80, "Published bytes must be PNG");
      const bitmap = await createImageBitmap(
        new Blob([bytes as BlobPart], { type: "image/png" }),
      );
      check(
        bitmap.width === 3 && bitmap.height === 2,
        "PNG dimensions survive conversion",
      );
      context.clearRect(0, 0, 3, 2);
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixel = context.getImageData(0, 0, 1, 1).data;
      check(
        pixel[0] === 255 && pixel[1] === 0 && pixel[3] === 255,
        "PNG pixels survive conversion",
      );
      return "/temp/zotlit-excerpts/image.png";
    },
    exists: async () => true,
  };
  for (const provenance of ["rendered", "cache", "zotero"] as const) {
    const answer = JSON.parse(
      await answerAnnotationImage(
        { key: "ABCDEFGH" },
        {
          ...ports,
          resolve: async () => ({
            kind: "available",
            provenance,
            freshness: "checked",
            ...image,
            identity: { key: "a".repeat(64), fingerprint: "image", pdf: null },
          }),
        },
      ),
    );
    check(
      answer.ok === true &&
        answer.format === "png" &&
        answer.provenance === provenance,
      `Available ${provenance} image`,
    );
    check(
      answer.path ===
        (provenance === "zotero"
          ? request.zoteroPngPath
          : "/temp/zotlit-excerpts/image.png"),
      "Correct image path",
    );
    passed.push(provenance);
  }
  for (const code of [
    "annotation-not-found",
    "not-an-image-annotation",
    "file-unavailable",
    "render-failed",
    "render-timeout",
  ]) {
    const answer = JSON.parse(
      await answerAnnotationImage(
        { key: "ABCDEFGH" },
        {
          ...ports,
          read: async () =>
            code === "annotation-not-found"
              ? null
              : code === "not-an-image-annotation"
                ? {
                    ...request,
                    annotation: { ...request.annotation, type: "highlight" },
                  }
                : request,
          resolve: async () => {
            if (code === "render-timeout")
              throw new DOMException("Deadline", "TimeoutError");
            return { kind: "unavailable" };
          },
          exists: async () => code !== "file-unavailable",
        },
      ),
    );
    check(
      answer.ok === false &&
        answer.diagnostic.code === code &&
        answer.diagnostic.hint.length > 10,
      `${code} has a recovery hint`,
    );
    passed.push(code);
  }
  return passed;
}
