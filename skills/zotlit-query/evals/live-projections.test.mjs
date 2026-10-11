import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validate } from "./check.mjs";
import { checkAnswer } from "./run.mjs";

// Saved live responses and explicitly labelled, corpus-verified contract examples.
const live = JSON.parse(
  await readFile(new URL("./live-projections.json", import.meta.url), "utf8"),
);
const context = (entry) => ({
  runRoot: "/evaluation-run/corpus",
  vaultPath: entry.envelope.identity.vault.path,
  itemEnvelope: entry.itemEnvelope,
});

for (const name of [
  "reading_plan",
  "attachment",
  "colors",
  "missing_source",
  "export_annotations",
]) {
  await test(`${name} accepts its live query projection`, () => {
    const entry = live[name];
    assert.deepEqual(validate(name, entry.envelope, context(entry)), []);
  });
}

await test("reading plan answer compares paper values, including zero, regardless of property order", () => {
  const { envelope, answer } = live.reading_plan;
  assert.deepEqual(
    checkAnswer("reading_plan", answer, {
      envelope,
      runRoot: "/evaluation-run/corpus",
    }),
    [],
  );

  const wrongCount = structuredClone(answer);
  wrongCount.rows.find((paper) => paper.indexedKey === "QANZR222").values[
    "annotations.length"
  ] = 1;
  assert.match(
    checkAnswer("reading_plan", wrongCount, {
      envelope,
      runRoot: "/evaluation-run/corpus",
    }).join("\n"),
    /wrong annotations.length/,
  );

  const duplicate = structuredClone(answer);
  duplicate.rows[2] = { ...duplicate.rows[0] };
  assert.match(
    checkAnswer("reading_plan", duplicate, {
      envelope,
      runRoot: "/evaluation-run/corpus",
    }).join("\n"),
    /duplicate identities/,
  );
});

await test("a projected source path proves the requested path; missing-file availability must be explicit", () => {
  const attachment = structuredClone(live.attachment);
  assert.deepEqual(
    checkAnswer("attachment", attachment.answer, {
      envelope: attachment.envelope,
    }),
    [],
  );
  attachment.envelope.rows[0].values["attachment.path"] = "/wrong.pdf";
  assert.match(
    validate("attachment", attachment.envelope, context(attachment)).join("\n"),
    /wrong source file/,
  );
  attachment.envelope.rows[0].values["attachment.path"] =
    "/wrong/zotero-data/storage/QANPDF22/rougier-2014.pdf";
  assert.match(
    validate("attachment", attachment.envelope, context(attachment)).join("\n"),
    /wrong source file/,
  );

  const missing = structuredClone(live.missing_source);
  assert.match(
    checkAnswer("missing_source", missing.answer, {
      envelope: missing.envelope,
    }).join("\n"),
    /attachmentExists/,
  );
  delete missing.envelope.rows[0].values["attachment.exists"];
  assert.match(
    validate("missing_source", missing.envelope, context(missing)).join("\n"),
    /attachment\.exists|source file/,
  );
});

await test("page label and Item filter can select the blue personal mark", () => {
  const colors = structuredClone(live.colors);
  assert.deepEqual(validate("colors", colors.envelope, context(colors)), []);
  colors.envelope.rows[0].values.colorName = "red";
  assert.match(
    validate("colors", colors.envelope, context(colors)).join("\n"),
    /wrong colorName/,
  );
});

await test("saved export result and final path match the live receipt", () => {
  const { envelope, answer, receipt } = live.export_annotations;
  assert.deepEqual(
    validate("export_annotations", envelope, context(live.export_annotations)),
    [],
  );
  assert.deepEqual(
    checkAnswer("export_annotations", answer, {
      envelope,
      resultPath: "/evaluation-run/result.json",
    }),
    [],
  );
  assert.equal(receipt.file.path, "/evaluation-run/agent/query-result.json");
  assert.equal(receipt.file.format, "json");
});
