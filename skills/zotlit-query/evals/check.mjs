#!/usr/bin/env node
// Check a saved ZotLit Query envelope against the committed evaluation oracle.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as annotations from "./annotations.mjs";
import * as items from "./items.mjs";
import * as research from "./research.mjs";

const oracle = JSON.parse(
  await readFile(new URL("./oracle.json", import.meta.url), "utf8"),
);
const families = { items, annotations, research };

/** Resolves a case's oracle entry and the family module named by its `kind`. */
export function caseFamily(caseName) {
  const spec = oracle.cases[caseName];
  if (!spec) throw new Error(`unknown case: ${caseName}`);
  const family = families[spec.kind];
  if (!family) throw new Error(`unknown case kind: ${spec.kind}`);
  return { spec, family };
}

export function validate(
  caseName,
  envelope,
  { runRoot, vaultPath = join(runRoot, "zt-fixture-vault") },
) {
  const { spec, family } = caseFamily(caseName);
  return family.checkEnvelope(spec, envelope, { runRoot, vaultPath });
}

async function main() {
  const [caseName, resultArg, runRootArg] = process.argv.slice(2);
  if (!caseName || !resultArg || !runRootArg)
    throw new Error(
      "usage: node check.mjs <case> <full-envelope.json> <absolute-run-root>",
    );
  const runRoot = resolve(runRootArg);
  const envelope = JSON.parse(await readFile(resultArg, "utf8"));
  const errors = validate(caseName, envelope, { runRoot });
  console.log(
    JSON.stringify(
      { case: caseName, pass: errors.length === 0, errors },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
