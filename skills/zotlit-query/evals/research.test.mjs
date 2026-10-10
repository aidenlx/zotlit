import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import { validate } from "./check.mjs";
import {
  researchSchema,
  resolveExpected,
  checkCollectionDiscovery,
} from "./research.mjs";
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
      // A record in two element groups is two row entries.
      returnedCount:
        expected.rows?.length ??
        expected.groups.reduce((sum, group) => sum + group.rows.length, 0),
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
        expected.rows ?? [
          ...new Map(
            expected.groups
              .flatMap((g) => g.rows)
              .map((row) => [row.indexedKey, row]),
          ).values(),
        ],
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
  for (const name of [
    "attachment_types",
    "count_by_year",
    "count_per_paper",
    "papers_per_tag",
  ]) {
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

for (const projection of ["annotations.length", "annotations[]"]) {
  await test(`paper counts accept Item Query ${projection} and reject wrong counts`, async () => {
    const live = JSON.parse(
      await readFile(
        new URL("./live-projections.json", import.meta.url),
        "utf8",
      ),
    );
    const { envelope, answer } = structuredClone(live.count_per_paper);
    envelope.rows = [
      {
        indexedKey: "QCSNG222",
        values: {
          title: "深度学习 in clinical attention",
          [projection]:
            projection === "annotations.length"
              ? 1
              : [{ indexedKey: "QCNT2222" }],
        },
      },
      {
        indexedKey: "QCTWN222",
        values: {
          title: "Clinical attention with two editions",
          [projection]:
            projection === "annotations.length"
              ? 2
              : [{ indexedKey: "QCMARKA2" }, { indexedKey: "QCMARKB2" }],
        },
      },
    ];
    envelope.request = {
      from: "items",
      library: ["personal"],
      filter: 'collections.within("Query thesis") && annotations.length > 0',
      fields: ["title", projection],
      limit: null,
    };
    delete envelope.groups;
    delete envelope.totalCount;
    envelope.returnedCount = 2;
    const context = {
      runRoot: "/evaluation-run/corpus",
      vaultPath: envelope.identity.vault.path,
      envelope,
    };
    answer.count = 2;
    answer.rows = structuredClone(envelope.rows);
    answer.groups = [];
    assert.deepEqual(validate("count_per_paper", envelope, context), []);
    assert.deepEqual(checkAnswer("count_per_paper", answer, context), []);
    const wrong = structuredClone(answer);
    wrong.rows[1].values[projection] =
      projection === "annotations.length" ? 1 : [];
    assert.match(
      checkAnswer("count_per_paper", wrong, context).join("\n"),
      /wrong.*count/,
    );
    // The saved Claude answer used the existing schema's item.title and explicit groups.
    answer.rows = answer.rows.map((row) => ({
      indexedKey: row.indexedKey,
      values: { "item.title": row.values.title },
    }));
    answer.groups = [
      { value: "深度学习 in clinical attention", count: 1 },
      { value: "Clinical attention with two editions", count: 2 },
    ];
    assert.deepEqual(checkAnswer("count_per_paper", answer, context), []);
    answer.groups[1].count = 1;
    assert.match(
      checkAnswer("count_per_paper", answer, context).join("\n"),
      /wrong group counts/,
    );
    envelope.rows[1].values[projection] =
      projection === "annotations.length" ? 1 : [];
    assert.match(
      validate("count_per_paper", envelope, context).join("\n"),
      /wrong.*count/,
    );
  });
}

await test("paper count answer schema permits both dataset shapes", async () => {
  const requireDb = createRequire(
    new URL("../../../packages/db/package.json", import.meta.url),
  );
  const Ajv = requireDb("ajv");
  const accepts = new Ajv({ strict: false }).compile(
    researchSchema(oracle.cases.count_per_paper),
  );
  const base = {
    answer: "Counts",
    count: 2,
    groups: [],
    limitation: null,
    exportPath: null,
  };
  for (const values of [
    { "item.title": "Paper" },
    { title: "Paper", "annotations.length": 1 },
    {
      title: "Paper",
      "annotations[]": [
        {
          indexedKey: "QCNT2222",
          type: "note",
          text: null,
          comment: "Read",
          pageLabel: "1",
          pageIndex: 0,
        },
      ],
    },
  ])
    assert.equal(
      accepts({ ...base, rows: [{ indexedKey: "QCSNG222", values }] }),
      true,
      JSON.stringify(accepts.errors),
    );
});

await test("attachment counts accept fileType groups and reject wrong counts", async () => {
  const live = JSON.parse(
    await readFile(new URL("./live-projections.json", import.meta.url), "utf8"),
  );
  const { envelope, answer } = structuredClone(live.attachment_types);
  const types = {
    "application/epub+zip": "epub",
    "application/pdf": "pdf",
    "text/html": "web",
  };
  envelope.request.group = "fileType";
  for (const group of envelope.groups) group.value = types[group.value];
  for (const group of answer.groups) group.value = types[group.value];
  const context = {
    runRoot: "/evaluation-run/corpus",
    vaultPath: envelope.identity.vault.path,
    envelope,
  };
  assert.deepEqual(validate("attachment_types", envelope, context), []);
  assert.deepEqual(checkAnswer("attachment_types", answer, context), []);
  envelope.groups[1].count = 3;
  assert.notDeepEqual(validate("attachment_types", envelope, context), []);
});

await test("Collection discovery requires a returned path before a matching query", () => {
  const spec = oracle.cases.discover_collection;
  const discovery = {
    argv: [
      "vault=v",
      "zotlit:query-values",
      "kind=collections",
      "library=personal",
    ],
    exitCode: 0,
    discovered: [{ library: "personal", values: ["Query thesis"] }],
  };
  const query = {
    argv: [
      "vault=v",
      "zotlit:query",
      'filter=collections.within("Query thesis")',
    ],
    exitCode: 0,
  };
  assert.deepEqual(checkCollectionDiscovery(spec, [discovery, query]), []);
  for (const calls of [
    [query],
    [query, discovery],
    [{ ...discovery, exitCode: 1 }, query],
    [{ ...discovery, discovered: [] }, query],
  ])
    assert.ok(checkCollectionDiscovery(spec, calls).length);
});

await test("tag groups overlap: a paper in two groups is one paper of the count", async () => {
  const live = JSON.parse(
    await readFile(new URL("./live-projections.json", import.meta.url), "utf8"),
  );
  const { envelope, answer } = structuredClone(live.papers_per_tag);
  const context = {
    runRoot: "/evaluation-run/corpus",
    vaultPath: envelope.identity.vault.path,
    envelope,
  };
  assert.deepEqual(validate("papers_per_tag", envelope, context), []);
  assert.deepEqual(checkAnswer("papers_per_tag", answer, context), []);
  // limit=4 cuts the five-paper group: five row entries, truncated.
  const limited = structuredClone(envelope);
  limited.request.limit = 4;
  limited.groups[0].rows = limited.groups[0].rows.slice(0, 4);
  limited.returnedCount = 5;
  limited.truncated = true;
  assert.deepEqual(validate("papers_per_tag", limited, context), []);
  limited.truncated = false;
  assert.match(
    validate("papers_per_tag", limited, context).join("\n"),
    /wrong grouped truncation/,
  );
  // The paper count is the number of papers, not the row entries.
  assert.match(
    checkAnswer("papers_per_tag", { ...answer, count: 6 }, context).join("\n"),
    /answer count is wrong/,
  );
  assert.match(
    checkAnswer(
      "papers_per_tag",
      { ...answer, groups: [{ value: "query-cross-eval", count: 5 }] },
      context,
    ).join("\n"),
    /wrong group counts/,
  );
});
