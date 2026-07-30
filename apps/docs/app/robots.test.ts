import { expect, it } from "vitest";

import robots from "./robots";

it("excludes the well-known Agent Skills endpoint from robots", () => {
  const result = robots();
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules];

  expect(rules).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        disallow: expect.arrayContaining(["/.well-known/agent-skills/"]),
      }),
    ]),
  );
});
