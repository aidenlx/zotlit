import { afterEach, describe, expect, it } from "vitest";

import {
  clipSettings,
  defaultClipSettings,
  recutSettings,
} from "./clip-settings.ts";

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

  describe("recutSettings", () => {
    /** The settings of a clip recorded under the busy camera, without the newer keys. */
    const {
      hold: _,
      openPad: __,
      endPad: ___,
      context: ____,
      ...older
    } = defaultClipSettings;
    const recorded = {
      ...older,
      zoom: 2,
      openHold: 0.7,
      lead: 0.15,
      ease: 0.6,
      minEase: 0.35,
      central: 0.6,
      camera: false,
      fps: 25,
      width: 1280,
      vp9Crf: 30,
    };

    it("cuts with today's camera and pads, not the recorded ones", () => {
      const s = recutSettings(recorded);
      expect(s).toMatchObject({
        zoom: defaultClipSettings.zoom,
        hold: defaultClipSettings.hold,
        openHold: defaultClipSettings.openHold,
        lead: defaultClipSettings.lead,
        ease: defaultClipSettings.ease,
        minEase: defaultClipSettings.minEase,
        central: defaultClipSettings.central,
        context: defaultClipSettings.context,
        openPad: defaultClipSettings.openPad,
        endPad: defaultClipSettings.endPad,
      });
    });

    it("keeps the recording's own settings", () => {
      expect(recutSettings(recorded)).toMatchObject({
        camera: false,
        fps: 25,
        width: 1280,
        vp9Crf: 30,
      });
    });

    it("lays the run's overrides over today's camera", () => {
      process.env.DOCS_WALK_CLIP = '{"zoom":1.2,"endPad":0}';
      expect(recutSettings(recorded)).toMatchObject({ zoom: 1.2, endPad: 0 });
    });
  });

  it("refuses a setting it does not know", () => {
    process.env.DOCS_WALK_CLIP = '{"zoon":1.5}';
    expect(() => clipSettings()).toThrow("unknown clip setting zoon");
  });
});
