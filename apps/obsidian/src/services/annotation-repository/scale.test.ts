// The Annotation Repository at library scale: one batch read for many
// Attachments, and a published list kept only while a surface holds it.

import { expect, it } from "vitest";

import { setup } from "./__fixtures__";

it("reads the Annotations of several Attachments in one batch read", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, acquireRead } = await setup(stack);
  acquireRead.mockClear();

  const lists = await repository.readMany(["RGRPDF24", "EPUBBKS2"]);

  expect(acquireRead).toHaveBeenCalledTimes(1);
  expect(lists.get("RGRPDF24")?.annotations).toHaveLength(7);
  expect(lists.get("EPUBBKS2")?.annotations.map(({ key }) => key)).toEqual([
    "EPUBMRK2",
  ]);
});
