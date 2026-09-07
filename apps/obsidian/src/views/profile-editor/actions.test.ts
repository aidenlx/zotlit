import { expect, it } from "vitest";

import { runProfileEditorAction } from "./actions";

it("reports success and consumes rejected editor actions", async () => {
  await expect(
    runProfileEditorAction("open-editor", async () => {}),
  ).resolves.toBe(true);
  await expect(
    runProfileEditorAction("open-editor", () =>
      Promise.reject(new Error("File unavailable")),
    ),
  ).resolves.toBe(false);
});
