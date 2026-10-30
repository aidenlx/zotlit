import { it } from "@effect/vitest";
import { Cause, Deferred, Effect, Fiber, PlatformError } from "effect";
import { expect } from "vitest";

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

it.effect(
  "returns the Zotero cache path unchanged in the Annotation Image envelope",
  () =>
    Effect.gen(function* () {
      const answer = JSON.parse(
        yield* answerAnnotationImage(
          { key: "ABCDEFGH" },
          {
            read: () => Effect.succeed(request),
            resolve: () =>
              Effect.succeed({
                kind: "available",
                provenance: "zotero",
                freshness: "uncertain",
                bytes: redPng,
                format: PNG_FORMAT,
                identity: {
                  key: "a".repeat(64),
                  fingerprint: "image",
                  pdf: null,
                },
              }),
            publish: () =>
              Effect.die(new Error("Zotero image must keep its original path")),
            exists: () => Effect.succeed(false),
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
    }),
);

it.effect.each(["rendered", "cache"] as const)(
  "publishes %s bytes into the PNG store",
  (provenance) =>
    Effect.gen(function* () {
      const answer = JSON.parse(
        yield* answerAnnotationImage(
          { key: "ABCDEFGH" },
          {
            read: () => Effect.succeed(request),
            resolve: () =>
              Effect.succeed({
                kind: "available",
                provenance,
                freshness: "checked",
                bytes: redPng,
                format: PNG_FORMAT,
                identity: {
                  key: "a".repeat(64),
                  fingerprint: "image",
                  pdf: null,
                },
              }),
            publish: (fingerprint, bytes) =>
              Effect.sync(() => {
                expect(fingerprint).toBe("a".repeat(64));
                expect(bytes).toEqual(redPng);
                return "/temp/zotlit-excerpts/image.png";
              }),
            exists: () => Effect.succeed(true),
          },
        ),
      );
      expect(answer).toMatchObject({
        ok: true,
        path: "/temp/zotlit-excerpts/image.png",
        format: "png",
        provenance,
      });
    }),
);

it.effect.each(
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
)("gives a recovery hint for $code", ({ code, found, exists, timeout }) =>
  Effect.gen(function* () {
    const answer = JSON.parse(
      yield* answerAnnotationImage(
        { key: "ABCDEFGH" },
        {
          read: () => Effect.succeed(found),
          resolve: () =>
            timeout
              ? Effect.fail(new Cause.TimeoutError())
              : Effect.succeed({ kind: "unavailable" as const }),
          publish: () => Effect.die(new Error("No bytes")),
          exists: () => Effect.succeed(exists),
        },
      ),
    );
    expect(answer).toMatchObject({
      ok: false,
      diagnostic: { code, hint: expect.any(String) },
    });
    expect(answer.diagnostic.hint.length).toBeGreaterThan(10);
  }),
);

it.effect("reports a failed read with the reader's own message", () =>
  Effect.gen(function* () {
    const answer = JSON.parse(
      yield* answerAnnotationImage(
        { key: "ABCDEFGH" },
        {
          read: () =>
            Effect.fail(
              new ExcerptSourceUnavailable({
                message: "database disk is locked",
              }),
            ),
          resolve: () => Effect.succeed({ kind: "unavailable" }),
          publish: () => Effect.die(new Error("No bytes")),
          exists: () => Effect.succeed(false),
        },
      ),
    );
    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "source-unavailable",
        message: "database disk is locked",
      },
    });
  }),
);

it.effect("aborts the render when the answer is interrupted", () =>
  Effect.gen(function* () {
    const rendering = yield* Deferred.make<AbortSignal | undefined>();
    const answering = yield* Effect.forkChild(
      answerAnnotationImage(
        { key: "ABCDEFGH" },
        {
          read: () => Effect.succeed(request),
          resolve: () =>
            Effect.tryPromise((signal) => {
              Deferred.doneUnsafe(rendering, Effect.succeed(signal));
              return new Promise<never>(() => {});
            }),
          publish: () => Effect.die(new Error("No bytes")),
          exists: () => Effect.succeed(false),
        },
      ),
    );
    const signal = yield* Deferred.await(rendering);
    expect(signal?.aborted).toBe(false);

    yield* Fiber.interrupt(answering);

    expect(signal?.aborted).toBe(true);
  }),
);

it.effect("reports a PNG the store cannot publish as a failed render", () =>
  Effect.gen(function* () {
    const answer = JSON.parse(
      yield* answerAnnotationImage(
        { key: "ABCDEFGH" },
        {
          read: () => Effect.succeed(request),
          resolve: () =>
            Effect.succeed({
              kind: "available",
              provenance: "rendered",
              freshness: "checked",
              bytes: redPng,
              format: PNG_FORMAT,
              identity: {
                key: "a".repeat(64),
                fingerprint: "image",
                pdf: null,
              },
            }),
          publish: () =>
            Effect.fail(
              PlatformError.systemError({
                _tag: "PermissionDenied",
                module: "FileSystem",
                method: "writeFile",
                description: "permission denied",
              }),
            ),
          exists: () => Effect.succeed(true),
        },
      ),
    );
    expect(answer).toMatchObject({
      ok: false,
      diagnostic: {
        code: "render-failed",
        message: expect.stringMatching(
          /^The Excerpt Image could not be prepared: .*permission denied/i,
        ),
      },
    });
  }),
);
