import { expect, it } from "vitest";

import { PAGE } from "./page-gestures.ts";

// Every gesture in the prelude goes through `press`, whose checks catch a
// control that is hidden, folded away or covered; a raw `.click()` skips
// them and lets a case press what no reader could.
it("clicks only inside press", () => {
  const press =
    /const press=\(el,what\)=>\{.*?el\.click\(\);return el;\};/.exec(PAGE);
  expect(press).not.toBeNull();
  expect(PAGE.replace(press![0], "")).not.toMatch(/\.click\(/);
});
