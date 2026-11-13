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

  it("keeps the camera calm by default", () => {
    const s = defaultClipSettings;
    expect(s.zoom).toBeLessThanOrEqual(1.4);
    expect(s.hold).toBeGreaterThanOrEqual(2.5);
    expect(s.ease).toBeGreaterThanOrEqual(1);
    expect(s.minEase).toBeGreaterThanOrEqual(0.6);
    // The first and last frames rest about 2.5 s with the pads.
    expect(s.opening + s.openHold + s.openPad).toBeGreaterThanOrEqual(2.5);
    expect(s.rest + s.endPad).toBeGreaterThanOrEqual(2.5);
  });

  it("fills the settings a clip was recorded without from the defaults", () => {
    const {
      hold: _,
      openPad: __,
      endPad: ___,
      context: ____,
      ...recorded
    } = defaultClipSettings;
    expect(clipSettings({ ...recorded, zoom: 2 })).toMatchObject({
      zoom: 2,
      hold: defaultClipSettings.hold,
      openPad: defaultClipSettings.openPad,
      endPad: defaultClipSettings.endPad,
    });
  });

  it("refuses a setting it does not know", () => {
    process.env.DOCS_WALK_CLIP = '{"zoon":1.5}';
    expect(() => clipSettings()).toThrow("unknown clip setting zoon");
  });
});
