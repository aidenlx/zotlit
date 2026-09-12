import { expect, it } from "vitest";

import { runTemplateWorkbenchAction } from "./actions";

it("reports success and consumes rejected editor actions", async () => {
  await expect(
    runTemplateWorkbenchAction("open-editor", async () => {}),
  ).resolves.toBe(true);
  await expect(
    runTemplateWorkbenchAction("open-editor", () =>
      Promise.reject(new Error("File unavailable")),
    ),
  ).resolves.toBe(false);
});
