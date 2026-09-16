import { expect, it } from "vitest";

import { createAccepted, createRefused } from "./__fixtures__";
import { readCreateResult } from "./wire";

const EXPECTED = { parentKey: "RGRPDF24", type: "highlight" } as const;

/** One create's answer, as the multi-object route writes it. */
const MADE = {
  key: "MADE2345",
  version: 42,
  type: "highlight",
  text: "Identify Your Message",
  color: "#2ea8e5",
  pageLabel: "1",
  sortIndex: "00000|002041|00170",
  position: { pageIndex: 0, rects: [[265.833, 611.202, 374.503, 620.019]] },
};

async function body(answer: Response): Promise<string> {
  return await answer.text();
}

it("answers the key Zotero generated", async () => {
  const result = readCreateResult(await body(createAccepted(MADE)), EXPECTED);

  expect(result).toEqual({ value: "MADE2345" });
});

it("fails the create on any entry Zotero refused, even under a 200", async () => {
  const result = readCreateResult(
    await body(createRefused(400, "Invalid annotationSortIndex")),
    EXPECTED,
  );

  expect(result).toEqual({
    failure: {
      kind: "invalid-response",
      issue: "create refused: 400 Invalid annotationSortIndex",
    },
  });
});

it("refuses an answer whose key is not the one it says it created", async () => {
  const mismatched = JSON.stringify({
    successful: {
      0: {
        key: "OTHR2345",
        data: {
          key: "OTHR2345",
          parentItem: "RGRPDF24",
          annotationType: "highlight",
        },
      },
    },
    success: { 0: "MADE2345" },
    failed: {},
  });

  expect(readCreateResult(mismatched, EXPECTED)).toMatchObject({
    failure: { kind: "invalid-response" },
  });
});

it("refuses an answer whose key is not a Zotero key", async () => {
  // `O` is outside Zotero's key alphabet, so this is a key nothing can hold.
  const result = readCreateResult(
    await body(createAccepted({ ...MADE, key: "MOOD2345" })),
    EXPECTED,
  );

  expect(result).toMatchObject({ failure: { kind: "invalid-response" } });
});

it("refuses an answer that hangs the Annotation from another Attachment", async () => {
  const result = readCreateResult(
    await body(createAccepted(MADE, { parentItem: "OTHERPDF" })),
    EXPECTED,
  );

  expect(result).toMatchObject({
    failure: {
      kind: "invalid-response",
      issue: expect.stringContaining("OTHERPDF"),
    },
  });
});

it("refuses an answer of another type than the one asked for", async () => {
  const result = readCreateResult(
    await body(createAccepted({ ...MADE, type: "underline" })),
    EXPECTED,
  );

  expect(result).toMatchObject({
    failure: {
      kind: "invalid-response",
      issue: expect.stringContaining("underline"),
    },
  });
});

it("refuses an answer that named no object at all", () => {
  const empty = JSON.stringify({ successful: {}, success: {}, failed: {} });

  expect(readCreateResult(empty, EXPECTED)).toEqual({
    failure: { kind: "invalid-response", issue: "create answered no object" },
  });
});

it("names the field when the answer is not the shape this client reads", () => {
  expect(readCreateResult("{}", EXPECTED)).toMatchObject({
    failure: {
      kind: "invalid-response",
      issue: expect.stringContaining("create result:"),
    },
  });
});
