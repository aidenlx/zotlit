// The order of a Local API session's events against the failed read that causes them, through the real layers.
import { expect, it } from "vitest";

import {
  annotationPage,
  ROUGIER_ANNOTATIONS,
  unreachable,
} from "@/services/zotero-local-api/__fixtures__";

import { writable } from "./__fixtures__";

it("hands a failed list read back only after the repository handled the source change it announced", async () => {
  await using stack = new AsyncDisposableStack();
  let failing = false;
  const { repository, localApi } = await writable(stack, {
    children: () =>
      failing ? unreachable() : annotationPage(ROUGIER_ANNOTATIONS),
  });
  using _hold = repository.hold(["RGRPDF24"]);
  await repository.read("RGRPDF24");

  // The session stands down on this failure and announces `changed`. The
  // repository handles that by announcing the Attachments it holds, which
  // nothing else in this case does.
  let announced = false;
  stack.defer(
    repository.listen("annotations-changed", (attachmentKey) => {
      if (attachmentKey === "RGRPDF24") announced = true;
    }),
  );
  failing = true;
  const failure = await localApi.listAnnotations("RGRPDF24");
  const announcedWhenCallerHasFailure = announced;

  expect(failure).toEqual({ failure: { kind: "unreachable" } });
  expect(announcedWhenCallerHasFailure).toBe(true);
});
