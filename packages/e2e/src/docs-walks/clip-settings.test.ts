import { describe, expect, it } from "vitest";

import {
  clipSettings,
  defaultClipSettings,
  recutSettings,
} from "./clip-settings.ts";

/** Set `DOCS_WALK_CLIP` to `value` until disposal, which restores the old value. */
function withClipEnv(value: string): Disposable {
  const old = process.env.DOCS_WALK_CLIP;
  process.env.DOCS_WALK_CLIP = value;
  return {
    [Symbol.dispose]() {
      if (old === undefined) delete process.env.DOCS_WALK_CLIP;
      else process.env.DOCS_WALK_CLIP = old;
    },
  };
}

describe("clipSettings", () => {
  it("lays the walk's settings over the defaults, and the run's over both", () => {
    expect(clipSettings()).toEqual(defaultClipSettings);
    expect(clipSettings({ camera: false, opening: 0.3 })).toMatchObject({
      camera: false,
      opening: 0.3,
      zoom: defaultClipSettings.zoom,
    });
    using _clip = withClipEnv('{"zoom":1.5,"opening":2}');
    expect(clipSettings({ opening: 0.3 })).toMatchObject({
      zoom: 1.5,
      opening: 2,
    });
  });

  describe("recutSettings", () => {
    /** The settings of a clip recorded with another camera and pads. */
    const recorded = {
      zoom: 2,
      endPad: 0.2,
      camera: false,
      fps: 25,
      width: 1280,
      h264Crf: 30,
    };

    it("cuts with today's camera and pads, not the recorded ones", () => {
      expect(recutSettings(recorded)).toMatchObject({
        zoom: defaultClipSettings.zoom,
        endPad: defaultClipSettings.endPad,
      });
    });

    it("keeps the recording's own settings", () => {
      expect(recutSettings(recorded)).toMatchObject({
        camera: false,
        fps: 25,
        width: 1280,
        h264Crf: 30,
      });
    });

    it("leaves out a setting of the retired WebM encode that an older clip recorded", () => {
      const older = { ...recorded, vp9Crf: 42 };
      expect(recutSettings(older)).not.toHaveProperty("vp9Crf");
      expect(recutSettings(older)).toMatchObject({ fps: 25, h264Crf: 30 });
    });

    it("lays the run's overrides over today's camera", () => {
      using _clip = withClipEnv('{"zoom":1.2,"endPad":0}');
      expect(recutSettings(recorded)).toMatchObject({ zoom: 1.2, endPad: 0 });
    });
  });

  it("refuses a setting it does not know", () => {
    using _clip = withClipEnv('{"zoon":1.5}');
    expect(() => clipSettings()).toThrow("unknown clip setting zoon");
  });
});
