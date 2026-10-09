import { expect, it } from "vitest";

import { redPng } from "./__fixtures__/png";
import { answerAnnotationImage } from "./cli-image";
import type { ExcerptRequest } from "./contract";
import { PNG_FORMAT } from "./format";
import { ExcerptSourceUnavailable } from "./request";

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
    position: { kind: "pdf-rects", pageIndex: 0, rects: [[0, 0, 10, 10]] },
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
  pdfPath: null,
  zoteroPngPath: "/zotero/cache/ABCDEFGH.png",
};

it("returns the Zotero cache path unchanged in the Item Query envelope", async () => {
  const answer = JSON.parse(
    await answerAnnotationImage(
      { key: "ABCDEFGH" },
      {
        read: async () => request,
        resolve: async () => ({
          kind: "available",
          provenance: "zotero",
          freshness: "uncertain",
          bytes: redPng,
          format: PNG_FORMAT,
          identity: { key: "a".repeat(64), fingerprint: "image", pdf: null },
        }),
        publish: async () => {
          throw new Error("Zotero image must keep its original path");
        },
        exists: async () => false,
      },
    ),
  );
  expect(answer).toEqual({
    contractVersion: 2,
    command: "zotlit:annotation-image",
    ok: true,
    key: "ABCDEFGH",
    path: "/zotero/cache/ABCDEFGH.png",
    format: "png",
    provenance: "zotero",
  });
});

it.each(["rendered", "cache"] as const)(
  "publishes %s bytes into the PNG store",
  async (provenance) => {
    const answer = JSON.parse(
      await answerAnnotationImage(
        { key: "ABCDEFGH" },
        {
          read: async () => request,
          resolve: async () => ({
            kind: "available",
            provenance,
            freshness: "checked",
            bytes: redPng,
            format: PNG_FORMAT,
            identity: { key: "a".repeat(64), fingerprint: "image", pdf: null },
          }),
          publish: async (fingerprint, bytes) => {
            expect(fingerprint).toBe("a".repeat(64));
            expect(bytes).toEqual(redPng);
            return "/temp/zotlit-excerpts/image.png";
          },
          exists: async () => true,
        },
      ),
    );
    expect(answer).toMatchObject({
      ok: true,
      path: "/temp/zotlit-excerpts/image.png",
      format: "png",
      provenance,
    });
  },
);

it.each(
  (
    [
      ["annotation-not-found", null, false, false],
      [
        "not-an-image-annotation",
        {
          ...request,
          annotation: { ...request.annotation, type: "highlight" as const },
        },
        true,
        false,
      ],
      ["file-unavailable", request, false, false],
      ["render-failed", { ...request, pdfPath: "/paper.pdf" }, true, false],
      ["render-timeout", request, true, true],
    ] as const
  ).map(([code, found, exists, timeout]) => ({ code, found, exists, timeout })),
)(
  "gives a recovery hint for $code",
  async ({ code, found, exists, timeout }) => {
    const answer = JSON.parse(
      await answerAnnotationImage(
        { key: "ABCDEFGH" },
        {
          read: async () => found,
          resolve: async () => {
            if (timeout)
              throw new DOMException("The operation timed out", "TimeoutError");
            return { kind: "unavailable" };
          },
          publish: async () => {
            throw new Error("No bytes");
          },
          exists: async () => exists,
        },
      ),
    );
    expect(answer).toMatchObject({
      ok: false,
      diagnostic: { code, hint: expect.any(String) },
    });
    expect(answer.diagnostic.hint.length).toBeGreaterThan(10);
  },
);

it("reports a failed read with the reader's own message", async () => {
  const controller = new AbortController();
  const signals: (AbortSignal | undefined)[] = [];
  const answer = JSON.parse(
    await answerAnnotationImage(
      { key: "ABCDEFGH" },
      {
        read: async (_, signal) => {
          signals.push(signal);
          throw new ExcerptSourceUnavailable({
            message: "database disk is locked",
          });
        },
        resolve: async () => ({ kind: "unavailable" }),
        publish: async () => {
          throw new Error("No bytes");
        },
        exists: async () => false,
      },
      controller.signal,
    ),
  );
  expect(signals).toEqual([controller.signal]);
  expect(answer).toMatchObject({
    ok: false,
    diagnostic: {
      code: "source-unavailable",
      message: "database disk is locked",
    },
  });
});
