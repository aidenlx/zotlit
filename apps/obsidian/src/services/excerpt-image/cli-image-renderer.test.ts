import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "./__fixtures__/electron-renderer";

it.skipIf(!testElectron)(
  "answers Annotation images and diagnostics in the Electron renderer",
  async () => {
    const report = await runInElectron({
      entry: resolve(import.meta.dirname, "cli-image.browser-test.ts"),
      name: "annotationImageTrial",
      marker: "ANNOTATION_IMAGE_RESULT",
    });
    expect(report).toEqual([
      "rendered",
      "cache",
      "zotero",
      "annotation-not-found",
      "not-an-image-annotation",
      "file-unavailable",
      "render-failed",
      "render-timeout",
    ]);
  },
  60_000,
);
