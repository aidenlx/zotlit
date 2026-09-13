import { expect, it } from "vitest";

import { jsonLayout, jsonPosition } from "./json-source";

it("formats JSON without changing numbers, escapes, or string whitespace", () => {
  const compact = String.raw`{"n":9007199254740993,"text":"a  b\n\u0041","items":[true,null]}`;
  const pretty = jsonLayout(compact, true).text;
  expect(pretty).toBe(String.raw`{
  "n": 9007199254740993,
  "text": "a  b\n\u0041",
  "items": [
    true,
    null
  ]
}`);
  expect(jsonLayout(pretty, false).text).toBe(compact);
  expect(jsonPosition(pretty, compact, pretty.indexOf("b\\n"))).toBe(
    compact.indexOf("b\\n"),
  );
});

it("keeps invalid-draft normalization stable and maps its token positions", () => {
  const draft = '{\n  "a": 1';
  const stored = '{ "a": 1';
  expect(jsonLayout(draft, false).text).toBe(stored);
  expect(jsonLayout(stored, false).text).toBe(stored);
  expect(jsonPosition(draft, stored, draft.indexOf("1"))).toBe(7);
  expect(jsonPosition(stored, draft, 7)).toBe(draft.indexOf("1"));
  expect(jsonLayout('{"a": 1 2}', false).text).toBe('{"a": 1 2}');
});
