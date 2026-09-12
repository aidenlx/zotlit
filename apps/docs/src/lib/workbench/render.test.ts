import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PROFILE_SOURCE,
  SAMPLE_ANNOTATIONS,
  SAMPLE_ITEMS,
} from "@zotlit/workbench/render";
import type {
  TemplateRenderResult,
  RenderRequest,
} from "@zotlit/workbench/render";

import { renderInThread } from "./render";

// The synchronous renderer stands in for the real one, so a test can read the
// runtime it was handed and the value the caller gets back.
const { renderProfile } = vi.hoisted(() => ({
  renderProfile: vi.fn<() => TemplateRenderResult>(),
}));

vi.mock("@zotlit/workbench/render", async (importActual) => ({
  ...(await importActual<typeof import("@zotlit/workbench/render")>()),
  renderProfile,
}));

const PAPER = SAMPLE_ITEMS[0]!;
const EXAMPLE = SAMPLE_ANNOTATIONS[0]!;

// Every part of one render, so an argument the transport drops is visible.
const REQUEST: RenderRequest = {
  source: DEFAULT_PROFILE_SOURCE,
  snapshot: PAPER,
  mode: "update",
  annotation: EXAMPLE,
};

const RESULT = { filename: "Kept work.md" } as TemplateRenderResult;

const present = globalThis.Temporal;

beforeEach(() => {
  renderProfile.mockReset();
  renderProfile.mockReturnValue(RESULT);
});

afterEach(() => {
  globalThis.Temporal = present;
});

describe("renderInThread", () => {
  it("has Temporal in place before the render runs", async () => {
    // @ts-expect-error the runtime without Temporal is what the await is for
    delete globalThis.Temporal;
    let seen: typeof globalThis.Temporal | undefined;
    renderProfile.mockImplementation(() => {
      seen = globalThis.Temporal;
      return RESULT;
    });

    const rendering = renderInThread(REQUEST);
    expect(renderProfile).not.toHaveBeenCalled();
    await rendering;

    expect(seen?.PlainDate.from("2026-09-08").year).toBe(2026);
  });

  it("hands the renderer the draft, the paper, and the whole request", async () => {
    const rendering = renderInThread(REQUEST);

    expect(rendering).toBeInstanceOf(Promise);
    await expect(rendering).resolves.toBe(RESULT);
    expect(renderProfile).toHaveBeenCalledExactlyOnceWith(
      DEFAULT_PROFILE_SOURCE,
      PAPER,
      {
        source: DEFAULT_PROFILE_SOURCE,
        snapshot: PAPER,
        mode: "update",
        annotation: EXAMPLE,
      },
    );
  });
});
