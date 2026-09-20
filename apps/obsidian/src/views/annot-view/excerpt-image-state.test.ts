import { describe, expect, it } from "vitest";

import { redPng } from "@/services/excerpt-image/__fixtures__/png";
import { ExcerptImageService } from "@/services/excerpt-image/service";
import type {
  ExcerptEntry,
  ExcerptOutcome,
} from "@/services/excerpt-image/service";

import {
  excerptImageForTarget,
  excerptImageTarget,
  transitionExcerptImage,
} from "./excerpt-image-state";
import type { ExcerptImageState } from "./excerpt-image-state";
import type { ExcerptImageTarget } from "./excerpt-image-state";

const input: Omit<ExcerptImageTarget, "key"> = {
  refresh: 0,
  sourceScope: "/fixture",
  annotation: {
    key: "INK",
    parentKey: "PDF",
    type: "ink",
    color: "#ff0000",
    comment: null,
    text: null,
    pageLabel: "1",
    tags: [],
    version: 1,
    position: { kind: "pdf-ink", pageIndex: 0, width: 2, paths: [[20, 30]] },
  },
  source: {
    kind: "zotero-db",
    database: { userID: 1, localUserKey: "local", serverID: "server" },
    libraryID: 1,
    libraryRevision: 1,
  },
};

describe("Annotation Card image lifecycle", () => {
  it.each(["unavailable", "fallback", "checked"] as const)(
    "explicit Refresh resolves unchanged %s input again after PDF recovery or replacement",
    async (initial) => {
      let pdfReady = initial === "checked";
      let revision = 1;
      let renders = 0;
      const entries = new Map<string, ExcerptEntry>();
      await using service = new ExcerptImageService({
        stamp: async () => {
          if (!pdfReady) throw new Error("PDF absent");
          return { size: 100, mtimeMs: revision };
        },
        render: async () => {
          renders++;
          if (!pdfReady) throw new Error("PDF absent");
          return new Uint8Array([revision]);
        },
        read: async () => redPng,
        cache: {
          get: async (key) => entries.get(key),
          put: async (key, entry) => {
            entries.set(key, entry);
          },
        },
      });
      let target: ExcerptImageTarget | null = null;
      let result: ExcerptOutcome | undefined;
      // The card effect depends on this retained target, not the record object.
      const publish = async (published: Omit<ExcerptImageTarget, "key">) => {
        const next = excerptImageTarget(target, published);
        if (next === target) return;
        target = next;
        result = await service.resolve({
          annotation: next.annotation,
          source: next.source!,
          sourceScope: next.sourceScope!,
          attachmentKey: "PDF",
          libraryID: 1,
          pdfPath: "/paper.pdf",
          zoteroPngPath: initial === "fallback" ? "/cached.png" : null,
        });
      };
      await publish(input);
      expect(result).toMatchObject(
        initial === "unavailable"
          ? { kind: "unavailable" }
          : {
              kind: "available",
              provenance: initial === "fallback" ? "zotero" : "rendered",
            },
      );
      pdfReady = true;
      revision = 2;
      await publish({
        ...input,
        annotation: { ...input.annotation, comment: "saved comment" },
      });
      expect(renders).toBe(1);
      await publish({ ...input, refresh: 1 });
      expect(renders).toBe(2);
      expect(result).toMatchObject({
        kind: "available",
        provenance: "rendered",
        freshness: "checked",
        bytes: new Uint8Array([2]),
      });
    },
  );
  it("keeps pixels through comment edits but captures new saved color and source snapshots", () => {
    const first = excerptImageTarget(null, input);
    expect(
      excerptImageTarget(first, { ...input, sourceScope: "/other-install" }),
    ).not.toBe(first);
    expect(
      excerptImageTarget(first, {
        ...input,
        annotation: {
          ...input.annotation,
          comment: "confirmed comment",
          version: 2,
        },
      }),
    ).toBe(first);
    const recolored = excerptImageTarget(first, {
      ...input,
      annotation: { ...input.annotation, color: "#00ff00", version: 3 },
    });
    expect(recolored).not.toBe(first);
    const handoff = excerptImageTarget(recolored, {
      refresh: input.refresh,
      sourceScope: input.sourceScope,
      annotation: recolored.annotation,
      source: { kind: "zotero-local-api", serverID: "server" },
    });
    expect(handoff).not.toBe(recolored);
    expect(handoff.source).toEqual({
      kind: "zotero-local-api",
      serverID: "server",
    });
    const state = transitionExcerptImage(
      { kind: "available", target: first, url: "blob:red" },
      { kind: "start", target: handoff },
    );
    expect(state.release).toEqual(["blob:red"]);
    const current = transitionExcerptImage(state.state, {
      kind: "resolved",
      target: handoff,
      url: "blob:green",
    });
    expect(
      transitionExcerptImage(current.state, {
        kind: "resolved",
        target: recolored,
        url: "blob:old-source",
      }),
    ).toEqual({ state: current.state, release: ["blob:old-source"] });
    expect(
      transitionExcerptImage(current.state, {
        kind: "resolved",
        target: first,
        url: "blob:late-red",
      }),
    ).toEqual({ state: current.state, release: ["blob:late-red"] });
  });
  it("keeps the new target loading when an older request completes", () => {
    const first = {};
    const second = {};
    const loading = transitionExcerptImage(
      { kind: "disposed" },
      { kind: "start", target: first },
    );
    const switched = transitionExcerptImage(loading.state, {
      kind: "start",
      target: second,
    });
    const stale = transitionExcerptImage(switched.state, {
      kind: "resolved",
      target: first,
      url: "blob:old",
    });
    expect(stale).toEqual({
      state: { kind: "loading", target: second },
      release: ["blob:old"],
    });
    expect(
      transitionExcerptImage(stale.state, {
        kind: "resolved",
        target: second,
        url: "blob:new",
      }),
    ).toEqual({
      state: { kind: "available", target: second, url: "blob:new" },
      release: [],
    });
  });
  it("hides old pixels immediately on a target switch and releases them when starting", () => {
    const old: ExcerptImageState = {
      kind: "available",
      target: {},
      url: "blob:old",
    };
    const target = {};
    expect(excerptImageForTarget(old, target)).toEqual({
      kind: "loading",
      target,
    });
    expect(transitionExcerptImage(old, { kind: "start", target })).toEqual({
      state: { kind: "loading", target },
      release: ["blob:old"],
    });
  });
  it("shows unavailable on total failure or decode failure, releasing undecodable pixels", () => {
    const target = {};
    const pending: ExcerptImageState = { kind: "loading", target };
    expect(
      transitionExcerptImage(pending, { kind: "resolved", target, url: null })
        .state,
    ).toEqual({ kind: "unavailable", target });
    expect(
      transitionExcerptImage(pending, { kind: "failed", target }).state,
    ).toEqual({ kind: "unavailable", target });
    const decoded = transitionExcerptImage(pending, {
      kind: "resolved",
      target,
      url: "blob:broken",
    });
    expect(
      transitionExcerptImage(decoded.state, { kind: "failed", target }),
    ).toEqual({
      state: { kind: "unavailable", target },
      release: ["blob:broken"],
    });
  });
  it("disposes the current image and rejects later publication", () => {
    const target = {};
    const disposed = transitionExcerptImage(
      { kind: "available", target, url: "blob:shown" },
      { kind: "dispose" },
    );
    expect(disposed).toEqual({
      state: { kind: "disposed" },
      release: ["blob:shown"],
    });
    expect(
      transitionExcerptImage(disposed.state, {
        kind: "resolved",
        target,
        url: "blob:late",
      }),
    ).toEqual({ state: { kind: "disposed" }, release: ["blob:late"] });
    expect(
      transitionExcerptImage(disposed.state, { kind: "failed", target }),
    ).toEqual({ state: { kind: "disposed" }, release: [] });
  });
});
