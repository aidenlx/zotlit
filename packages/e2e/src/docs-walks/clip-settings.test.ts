import { afterEach, describe, expect, it } from "vitest";

import { clipSettings, defaultClipSettings } from "./clip-settings.ts";

describe("clipSettings", () => {
  afterEach(() => {
    delete process.env.DOCS_WALK_CLIP;
  });

  it("lays the walk's settings over the defaults, and the run's over both", () => {
    expect(clipSettings()).toEqual(defaultClipSettings);
    expect(clipSettings({ camera: false, opening: 0.3 })).toMatchObject({
      camera: false,
      opening: 0.3,
      zoom: defaultClipSettings.zoom,
    });
    process.env.DOCS_WALK_CLIP = '{"zoom":1.5,"opening":2}';
    expect(clipSettings({ opening: 0.3 })).toMatchObject({
      zoom: 1.5,
      opening: 2,
    });
  });

  it("refuses a setting it does not know", () => {
    process.env.DOCS_WALK_CLIP = '{"zoon":1.5}';
    expect(() => clipSettings()).toThrow("unknown clip setting zoon");
  });
});
