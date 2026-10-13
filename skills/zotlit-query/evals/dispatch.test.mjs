import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as annotations from "./annotations.mjs";
import { caseFamily, validate } from "./check.mjs";
import * as items from "./items.mjs";
import * as research from "./research.mjs";
import { checkAnswer } from "./run.mjs";

const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);
const cases = JSON.parse(
  await readFile(new URL("./cases.json", import.meta.url), "utf8"),
);
const families = { items, annotations, research };

await test("every case has an oracle entry with a family kind", () => {
  assert.deepEqual(Object.keys(oracle.cases), Object.keys(cases));
  for (const [name, spec] of Object.entries(oracle.cases))
    assert.ok(Object.hasOwn(families, spec.kind), `${name}: ${spec.kind}`);
});

await test("each family exports its checks, prompt, schema, and evidence steps", () => {
  for (const family of Object.values(families))
    for (const name of [
      "checkEnvelope",
      "checkAnswer",
      "prompt",
      "answerSchema",
      "retainEvidence",
      "loadEvidence",
      "checkRun",
    ])
      assert.equal(typeof family[name], "function", name);
});

await test("cases dispatch to the family their kind names", () => {
  for (const [name, spec] of Object.entries(oracle.cases)) {
    const resolved = caseFamily(name);
    assert.equal(resolved.family, families[spec.kind], name);
    assert.deepEqual(resolved.spec, oracle.cases[name]);
  }
});

await test("unknown cases are rejected before any check runs", () => {
  assert.throws(
    () => validate("no_such_case", {}, { runRoot: "/run" }),
    /unknown case: no_such_case/,
  );
  assert.throws(
    () => checkAnswer("no_such_case", {}, {}),
    /unknown case: no_such_case/,
  );
});
