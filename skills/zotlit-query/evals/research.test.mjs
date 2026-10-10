import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validate } from "./check.mjs";
import { resolveExpected } from "./research.mjs";
import { checkAnswer } from "./run.mjs";
const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);
for (const [name, spec] of Object.entries(oracle.cases).filter(
  ([, v]) => v.kind === "research",
)) {
  await test(`${name}: validates evidence and final details; rejects changed values`, () => {
    const expected = resolveExpected(spec, "/run");
    const envelope = {
      ok: true,
      contractVersion: 3,
      command: "zotlit:query",
      identity: {
        source: { databasePath: "/run/zotero-data/zotero.sqlite" },
        vault: { path: "/run/zt-fixture-vault" },
      },
      request: {
        from: spec.from,
        fields: spec.fields,
        limit: null,
        group: spec.group,
      },
      returnedCount: spec.count,
      totalCount: spec.count,
      truncated: false,
      warnings: [],
      ...(expected.rows
        ? { rows: expected.rows }
        : { groups: expected.groups }),
    };
    assert.deepEqual(validate(name, envelope, { runRoot: "/run" }), []);
    const answer = {
      answer: "Complete results.",
      count: spec.count,
      rows: structuredClone(
        expected.rows ?? expected.groups.flatMap((g) => g.rows),
      ),
      groups: (expected.groups ?? []).map(({ value, count }) => ({
        value,
        count,
      })),
      limitation: spec.limitation ?? null,
      exportPath: spec.csv ? "/advisor.csv" : null,
    };
    assert.deepEqual(
      checkAnswer(name, answer, {
        runRoot: "/run",
        resultPath: "/result.json",
        envelope,
      }),
      [],
    );
    answer.rows[0].indexedKey = "WRONG";
    assert.ok(
      checkAnswer(name, answer, {
        runRoot: "/run",
        resultPath: "/result.json",
        envelope,
      }).length > 0,
    );
    const wrong = structuredClone(envelope);
    wrong.request.from = "wrong";
    assert.ok(
      validate(name, wrong, { runRoot: "/run" }).some((e) =>
        e.includes("Dataset"),
      ),
    );
    if (expected.groups) {
      wrong.groups[0].count++;
      assert.ok(
        validate(name, wrong, { runRoot: "/run" }).some((e) =>
          e.includes("count"),
        ),
      );
    } else {
      wrong.rows.pop();
      assert.ok(
        validate(name, wrong, { runRoot: "/run" }).some((e) =>
          e.includes("missing"),
        ),
      );
    }
  });
}

await test("group statistics accept a bounded sample and an equivalent parent title grouping", async () => {
  const live = JSON.parse(
    await readFile(new URL("./live-projections.json", import.meta.url), "utf8"),
  );
  const { envelope, answer } = structuredClone(live.count_per_paper);
  envelope.request.group = "item.title";
  envelope.request.limit = 1;
  envelope.groups = envelope.groups
    .map((g) => ({
      ...g,
      value: g.rows[0].values["item.title"],
      rows: g.rows.slice(0, 1),
    }))
    .sort((a, b) => a.value.localeCompare(b.value, "und"));
  envelope.returnedCount = 2;
  envelope.truncated = true;
  answer.rows = envelope.groups.flatMap((g) => g.rows);
  answer.groups = envelope.groups.map(({ value, count }) => ({ value, count }));
  const context = {
    runRoot: "/evaluation-run/corpus",
    vaultPath: envelope.identity.vault.path,
    envelope,
  };
  assert.deepEqual(validate("count_per_paper", envelope, context), []);
  assert.deepEqual(checkAnswer("count_per_paper", answer, context), []);
  envelope.groups[0].count = 1;
  assert.ok(validate("count_per_paper", envelope, context).length > 0);
});

await test("group answers can list the same counts in any order", async () => {
  const live = JSON.parse(
    await readFile(new URL("./live-projections.json", import.meta.url), "utf8"),
  );
  for (const name of ["attachment_types", "count_by_year", "count_per_paper"]) {
    const { envelope, answer } = structuredClone(live[name]);
    const context = { runRoot: "/evaluation-run/corpus", envelope };
    answer.groups.reverse();
    assert.deepEqual(checkAnswer(name, answer, context), []);
    const wrongCount = structuredClone(answer);
    wrongCount.groups[0].count++;
    assert.match(
      checkAnswer(name, wrongCount, context).join("\n"),
      /wrong group counts/,
    );
    answer.groups[0] = answer.groups[1];
    assert.match(
      checkAnswer(name, answer, context).join("\n"),
      /wrong group counts/,
    );
  }
});

await test("paper group answers can label Indexed Key groups with their paper titles", async () => {
  const live = JSON.parse(
    await readFile(new URL("./live-projections.json", import.meta.url), "utf8"),
  );
  const { envelope, answer } = structuredClone(live.count_per_paper);
  const context = { runRoot: "/evaluation-run/corpus", envelope };
  answer.groups = envelope.groups.map((g) => ({
    value: g.rows[0].values["item.title"],
    count: g.count,
  }));
  assert.deepEqual(checkAnswer("count_per_paper", answer, context), []);
  answer.groups.reverse();
  assert.deepEqual(checkAnswer("count_per_paper", answer, context), []);
  const wrong = structuredClone(answer);
  [wrong.groups[0].count, wrong.groups[1].count] = [
    wrong.groups[1].count,
    wrong.groups[0].count,
  ];
  assert.match(
    checkAnswer("count_per_paper", wrong, context).join("\n"),
    /wrong group counts/,
  );
  answer.groups[0].value = "Another paper";
  assert.match(
    checkAnswer("count_per_paper", answer, context).join("\n"),
    /wrong group counts/,
  );
});

await test("attachment counts require grouped query evidence even when local counts are correct", async () => {
  const live = JSON.parse(
    await readFile(new URL("./live-projections.json", import.meta.url), "utf8"),
  );
  const { envelope, answer } = structuredClone(live.attachment_types);
  envelope.rows = envelope.groups.flatMap((g) => g.rows);
  delete envelope.groups;
  delete envelope.request.group;
  delete envelope.totalCount;
  answer.groups = [];
  const context = {
    runRoot: "/evaluation-run/corpus",
    vaultPath: envelope.identity.vault.path,
    envelope,
  };
  assert.match(
    validate("attachment_types", envelope, context).join("\n"),
    /wrong group path/,
  );
  assert.match(
    checkAnswer("attachment_types", answer, context).join("\n"),
    /wrong group counts/,
  );
});

await test("reading plan answers accept Library display names as well as selectors", async () => {
  const live = JSON.parse(
    await readFile(new URL("./live-projections.json", import.meta.url), "utf8"),
  );
  const { envelope, answer } = structuredClone(live.reading_plan);
  const context = { runRoot: "/evaluation-run/corpus", envelope };
  for (const row of answer.rows)
    row.values.library =
      row.values.library === "personal" ? "My Library" : "Lab Archive";
  assert.deepEqual(checkAnswer("reading_plan", answer, context), []);
  answer.rows[0].values.library = "group:999";
  assert.match(
    checkAnswer("reading_plan", answer, context).join("\n"),
    /wrong library/,
  );
});
