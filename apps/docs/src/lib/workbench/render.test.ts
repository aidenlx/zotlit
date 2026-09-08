import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";
import type {
  ProfileRenderResult,
  RenderRequest,
} from "@zotlit/workbench/render";

import { renderInThread } from "./render";

// The synchronous renderer stands in for the real one, so a test can read the
// runtime it was handed and the value the caller gets back.
const { renderProfile } = vi.hoisted(() => ({
  renderProfile: vi.fn<() => ProfileRenderResult>(),
}));

vi.mock("@zotlit/workbench/render", async (importActual) => ({
  ...(await importActual<typeof import("@zotlit/workbench/render")>()),
  renderProfile,
}));

const REQUEST: RenderRequest = {
  source: DEFAULT_PROFILE_SOURCE,
  snapshot: SAMPLE_ITEMS[0]!,
};

const RESULT = { filename: "Kept work.md" } as ProfileRenderResult;

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

  it("answers one request with a promise of the render", async () => {
    const rendering = renderInThread(REQUEST);

    expect(rendering).toBeInstanceOf(Promise);
    await expect(rendering).resolves.toBe(RESULT);
  });
});
