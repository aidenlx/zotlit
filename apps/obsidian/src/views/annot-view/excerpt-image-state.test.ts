import { describe, expect, it } from "vitest";

import {
  excerptImageForTarget,
  transitionExcerptImage,
} from "./excerpt-image-state";
import type { ExcerptImageState } from "./excerpt-image-state";

describe("Annotation Card image lifecycle", () => {
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
