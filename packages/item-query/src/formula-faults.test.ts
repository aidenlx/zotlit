// The fault policy of Formulas on generated requests. Each request has a few
// Formulas whose texts mix valid parts, mistakes in their own text, custom
// fields the source lacks, and reads of other Formulas that form chains and
// cycles. An oracle independent of the Formula planner gives the expected
// outcome: the read graph from `formulaReferences`, each Formula's own
// mistake from its text planned alone with every Formula read stubbed, and
// the cycles from the strongly connected components of the graph.
import { Cause } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { collectQuery, formulaReferences, ItemQueryError, ITEMS } from ".";
import type { ItemQueryRequest } from ".";
import type { FormulaResolver } from "./filter-plan";
import { runEffect } from "./test-helpers";

/**
 * The fixed seed of the generated requests. A failure prints the seed and the
 * index of its request; add that request as a named case in
 * `formulas.test.ts`, then correct the engine.
 */
const GENERATED_SEED = 1503;
const GENERATED_COUNT = 250;

/** A seeded generator (mulberry32) of numbers in [0, 1). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Request = Omit<ItemQueryRequest, "libraries" | "onFormulaFault">;

/** The Formula names a text can read; `f` is never defined. */
const READ_NAMES = ["a", "b", "c", "d", "e", "f"] as const;
/** The Formula names a request can define with an identifier. */
const VALID_NAMES = ["a", "b", "c", "d", "e"] as const;
/** A Formula name that is not an identifier: only `fields` can read it. */
const INVALID_NAME = "2nd";
/** A `formula.<name>` column of `fields` that no request defines. */
const UNDEFINED_COLUMN = "zz";
/** The custom fields that the generated texts name and the source lacks. */
const ABSENT_CUSTOM_FIELDS = new Set(["absent", "dat"]);
const BASE_FILTER = 'indexedKey == "BK2MNTH2"';

function generateRequests(seed: number, count: number): Request[] {
  const next = random(seed);
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(next() * values.length)]!;
  const read = () => `formula.${pick(READ_NAMES)}`;
  // Each part reads a Formula only where any value type is valid, so a stub
  // of the read plans the text as the read Formula does.
  const term = (): string => {
    const roll = next();
    if (roll < 0.55) return read();
    if (roll < 0.67) return "date.year";
    if (roll < 0.8) return pick(["title * 2", "title.nope()"]);
    return pick(['custom["absent"]', "dat"]);
  };
  const text = (): string => {
    const roll = next();
    if (roll < 0.07) return `[${read()}, date.year`;
    if (roll < 0.12) return "/x/";
    if (roll < 0.27) return read();
    const length = 1 + Math.floor(next() * 4);
    return `[${Array.from({ length }, term).join(", ")}]`;
  };
  return Array.from({ length: count }, () => {
    const formulas: Record<string, string> = {};
    for (const name of VALID_NAMES) if (next() < 0.75) formulas[name] = text();
    if (next() < 0.25) formulas[INVALID_NAME] = text();
    const names = Object.keys(formulas);
    const valid = names.filter((name) => name !== INVALID_NAME);
    const fields = [
      ...(next() < 0.5 ? ["title"] : []),
      ...names.filter(() => next() < 0.5).map((name) => `formula.${name}`),
      ...(next() < 0.2 ? [`formula.${UNDEFINED_COLUMN}`] : []),
    ];
    // Shuffle fields, so the planning order of fields varies.
    for (let index = fields.length - 1; index > 0; index--) {
      const other = Math.floor(next() * (index + 1));
      [fields[index], fields[other]] = [fields[other]!, fields[index]!];
    }
    let filter = BASE_FILTER;
    if (valid.length > 0 && next() < 0.5) {
      const reads = Array.from(
        { length: 1 + Math.floor(next() * 2) },
        () => `formula.${pick(valid)} != null`,
      );
      filter = `${BASE_FILTER} && (${reads.join(" || ")})`;
    }
    return { filter, formulas, fields };
  });
}

// --- The oracle -----------------------------------------------------------

/** A mistake in the text of one Formula, planned alone. */
interface OwnFaults {
  /** The first mistake that planning finds, with its code and position. */
  readonly early: { readonly code: string; readonly from: number } | null;
  /** A result type that a Query Row cannot hold. */
  readonly result: boolean;
  /** A custom field that the source lacks. */
  readonly source: boolean;
}

/** The plan of `null`: the value of each stubbed Formula read. */
const STUB = (() => {
  const plan = ITEMS.planFilter("null");
  if ("kind" in plan) throw new Error("The stub does not plan.");
  return { root: plan.root, needs: plan.needs };
})();

/** Plan `text` alone, each read of a defined Formula stubbed. */
function ownFaults(
  name: string,
  text: string,
  defined: Readonly<Record<string, string>>,
): OwnFaults {
  const stub: FormulaResolver<any, any> = (read, at) =>
    Object.hasOwn(defined, read)
      ? STUB
      : {
          kind: "unknown",
          role: "formula",
          name: read,
          at,
          formulas: Object.keys(defined),
        };
  const plan = ITEMS.planFilter(text, undefined, stub);
  if ("kind" in plan) {
    if (plan.kind === "reads-faulted-formula")
      throw new Error("A stubbed read has no mistake.");
    const error = new ItemQueryError({
      dataset: ITEMS,
      fault: plan,
      location: { argument: "formulas", path: name },
      argumentText: text,
    });
    const from = plan.kind === "syntax" ? plan.fault.from : plan.at.from;
    return {
      early: { code: error.diagnostic.code, from },
      result: false,
      source: false,
    };
  }
  return {
    early: null,
    result: ["duration", "regexp", "record"].includes(plan.root.valueType),
    source: plan.customFields.some((use) => ABSENT_CUSTOM_FIELDS.has(use.name)),
  };
}

/** The Formula analysis of one request. */
interface Analysis {
  readonly invalid: readonly string[];
  /** The defined Formulas that each defined Formula reads, in text order. */
  readonly reads: ReadonlyMap<
    string,
    readonly { name: string; from: number }[]
  >;
  readonly own: ReadonlyMap<string, OwnFaults>;
  /** Each Formula on a cycle of reads. */
  readonly cyclic: ReadonlySet<string>;
  /** Each strongly connected component with a cycle, as its Formulas. */
  readonly components: readonly (readonly string[])[];
  /** The Formulas that the filter reads, in text order. */
  readonly filterReads: readonly string[];
}

function analyze(request: Request): Analysis {
  const defined = request.formulas ?? {};
  const names = Object.keys(defined);
  const invalid = names.filter((name) => !/^[A-Za-z_]\w*$/.test(name));
  const reads = new Map(
    names.map((name) => [
      name,
      // A Formula without an identifier name is never planned.
      invalid.includes(name)
        ? []
        : formulaReferences(defined[name]!)
            .filter((read) => Object.hasOwn(defined, read.name))
            .map(({ name: read, from }) => ({ name: read, from })),
    ]),
  );
  const own = new Map(
    names
      .filter((name) => !invalid.includes(name))
      .map((name) => [name, ownFaults(name, defined[name]!, defined)]),
  );
  // Tarjan's strongly connected components.
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const components: string[][] = [];
  const connect = (name: string) => {
    index.set(name, index.size);
    low.set(name, index.get(name)!);
    stack.push(name);
    for (const { name: next } of reads.get(name)!) {
      if (!index.has(next)) {
        connect(next);
        low.set(name, Math.min(low.get(name)!, low.get(next)!));
      } else if (stack.includes(next)) {
        low.set(name, Math.min(low.get(name)!, index.get(next)!));
      }
    }
    if (low.get(name) === index.get(name)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        component.push(member);
      } while (member !== name);
      const selfRead = reads.get(name)!.some((read) => read.name === name);
      if (component.length > 1 || selfRead) components.push(component);
    }
  };
  for (const name of names) if (!index.has(name)) connect(name);
  return {
    invalid,
    reads,
    own,
    cyclic: new Set(components.flat()),
    components,
    filterReads: formulaReferences(request.filter ?? "").map(
      (read) => read.name,
    ),
  };
}

/** The Formulas that `fields` reads, and its undefined Formula columns. */
function fieldReads(request: Request) {
  const defined = request.formulas ?? {};
  const read: string[] = [];
  const undefinedColumns: string[] = [];
  for (const field of request.fields ?? []) {
    if (!field.startsWith("formula.")) continue;
    const name = field.slice("formula.".length);
    (Object.hasOwn(defined, name) ? read : undefinedColumns).push(name);
  }
  return { read, undefinedColumns };
}

/** Each Formula that `start` reads, also through other Formulas. */
function closure(analysis: Analysis, start: readonly string[]): Set<string> {
  const reached = new Set<string>();
  const queue = [...start];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    if (reached.has(name)) continue;
    reached.add(name);
    for (const read of analysis.reads.get(name)!) queue.push(read.name);
  }
  return reached;
}

/**
 * The outcome under `"leave-out"`: the code of each Formula Diagnostic, the
 * failure of a filter that reads a faulted Formula, and the columns of a row.
 */
function leaveOutOracle(request: Request) {
  const analysis = analyze(request);
  const codes = new Map<string, string | null>();
  const code = (name: string): string | null => {
    if (codes.has(name)) return codes.get(name)!;
    let found: string | null;
    if (analysis.invalid.includes(name)) found = "invalid-formula-name";
    else if (analysis.cyclic.has(name)) found = "formula-cycle";
    else {
      // The first mistake in text order: a read of a faulted Formula or the
      // first mistake of planning. A result type or a custom field the source
      // lacks shows after every read is planned.
      const own = analysis.own.get(name)!;
      const reads = analysis.reads.get(name)!;
      const earlyAt = own.early?.from ?? Infinity;
      const faultedRead = (from: number, to: number) =>
        reads.some(
          (read) => read.from >= from && read.from < to && code(read.name),
        );
      if (faultedRead(0, earlyAt)) found = "reads-faulted-formula";
      else if (own.early) found = own.early.code;
      else if (faultedRead(0, Infinity)) found = "reads-faulted-formula";
      else if (own.result) found = "invalid-formula-result";
      else if (own.source) found = "unknown-field";
      else found = null;
    }
    codes.set(name, found);
    return found;
  };
  const fields = fieldReads(request);
  const reached = closure(analysis, [...fields.read, ...analysis.filterReads]);
  const diagnostics: Record<string, string> = {};
  for (const name of [...reached, ...analysis.invalid]) {
    const found = code(name);
    if (found) diagnostics[name] = found;
  }
  for (const name of fields.undefinedColumns)
    diagnostics[name] = "unknown-formula";
  const filterFails = analysis.filterReads.some((name) => code(name));
  return {
    analysis,
    outcome: filterFails
      ? {
          failure: { code: "reads-faulted-formula", argument: "filter" },
          diagnostics,
        }
      : {
          diagnostics,
          columns: (request.fields ?? [])
            .filter(
              (field) =>
                !field.startsWith("formula.") ||
                !Object.hasOwn(diagnostics, field.slice("formula.".length)),
            )
            .sort(),
        },
  };
}

interface Root {
  readonly code: string;
  readonly argument: string;
  readonly path: string;
}

/**
 * The failure under `"fail"`: the first root fault in planning order. Names
 * come first, then the reads of the filter, then `fields` in order; a Formula
 * plans its reads depth first in text order, and a read of a Formula that is
 * in planning closes a cycle at the reader. A custom field the source lacks
 * fails the request after planning, at one Formula that has it.
 */
function failOracle(request: Request): {
  root: Root | null;
  sourcePaths: string[];
} {
  const analysis = analyze(request);
  const [invalid] = analysis.invalid;
  if (invalid !== undefined) {
    return {
      root: {
        code: "invalid-formula-name",
        argument: "formulas",
        path: invalid,
      },
      sourcePaths: [],
    };
  }
  const roots = new Map<string, Root | null>();
  const planning: string[] = [];
  const own = (name: string, code: string): Root => ({
    code,
    argument: "formulas",
    path: name,
  });
  const plan = (name: string): Root | null => {
    if (roots.has(name)) return roots.get(name)!;
    const faults = analysis.own.get(name)!;
    const earlyAt = faults.early?.from ?? Infinity;
    planning.push(name);
    let root: Root | null = null;
    for (const read of analysis.reads.get(name)!) {
      if (read.from >= earlyAt) break;
      if (planning.includes(read.name)) root = own(name, "formula-cycle");
      else root = plan(read.name);
      if (root) break;
    }
    planning.pop();
    if (!root && faults.early) root = own(name, faults.early.code);
    if (!root && faults.result) root = own(name, "invalid-formula-result");
    roots.set(name, root);
    return root;
  };
  for (const name of analysis.filterReads) {
    const root = plan(name);
    if (root) return { root, sourcePaths: [] };
  }
  const defined = request.formulas ?? {};
  for (const [index, field] of (request.fields ?? []).entries()) {
    if (!field.startsWith("formula.")) continue;
    const name = field.slice("formula.".length);
    const root = Object.hasOwn(defined, name)
      ? plan(name)
      : {
          code: "unknown-formula",
          argument: "fields",
          path: `fields[${index}]`,
        };
    if (root) return { root, sourcePaths: [] };
  }
  const reached = closure(analysis, [
    ...fieldReads(request).read,
    ...analysis.filterReads,
  ]);
  const sourcePaths = [...reached].filter(
    (name) => analysis.own.get(name)!.source,
  );
  return {
    root:
      sourcePaths.length > 0
        ? { code: "unknown-field", argument: "formulas", path: sourcePaths[0]! }
        : null,
    sourcePaths,
  };
}

// --- The runs -------------------------------------------------------------

let scenario: ScenarioDatabase;

beforeAll(() => {
  scenario = openScenarioDatabase();
});

afterAll(() => {
  scenario.close();
});

async function answer(request: Request, onFormulaFault: "fail" | "leave-out") {
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [SCENARIO_LIBRARIES.personal],
      ...request,
      onFormulaFault,
    }),
    { client: scenario.db },
  );
  if (exit._tag === "Success")
    return { kind: "result", result: exit.value } as const;
  const error = Cause.squash(exit.cause);
  if (!(error instanceof ItemQueryError)) throw error;
  return { kind: "error", error } as const;
}

const codesOf = (
  diagnostics: Readonly<Record<string, { readonly code: string }>> | undefined,
) =>
  diagnostics &&
  Object.fromEntries(
    Object.entries(diagnostics).map(([name, { code }]) => [name, code]),
  );

describe("the Formula fault policy on generated requests", () => {
  const requests = generateRequests(GENERATED_SEED, GENERATED_COUNT);
  const cases = requests.map((request, index) => ({
    index,
    name: `${GENERATED_SEED}/${index}`,
    request,
  }));
  const reproduce = (index: number, request: Request) =>
    `Generated request ${index} of seed ${GENERATED_SEED}:\n${JSON.stringify(request, null, 2)}`;

  it("generates each shape that the policy must handle", () => {
    expect(generateRequests(GENERATED_SEED, GENERATED_COUNT)).toEqual(requests);
    const oracles = requests.map(leaveOutOracle);
    const codes = new Set(
      oracles.flatMap(({ outcome }) => Object.values(outcome.diagnostics)),
    );
    expect([...codes].sort()).toEqual([
      "formula-cycle",
      "invalid-filter",
      "invalid-formula-name",
      "invalid-formula-result",
      "reads-faulted-formula",
      "unknown-field",
      "unknown-formula",
      "unknown-function",
      "wrong-operand-type",
    ]);
    const count = (test: (oracle: (typeof oracles)[number]) => boolean) =>
      oracles.filter(test).length;
    // A filter that reads a faulted Formula.
    expect(count(({ outcome }) => "failure" in outcome)).toBeGreaterThan(20);
    // Two cycles that share a Formula: a component with more reads than
    // Formulas.
    expect(
      count(({ analysis }) =>
        analysis.components.some(
          (component) =>
            component
              .flatMap((name) => analysis.reads.get(name)!)
              .filter((read) => component.includes(read.name)).length >
            component.length,
        ),
      ),
    ).toBeGreaterThan(20);
    // A Formula that reads a faulted Formula before it reads another one.
    expect(
      count(({ analysis, outcome }) =>
        [...analysis.reads.values()].some(
          (reads) =>
            reads.length > 1 &&
            Object.hasOwn(outcome.diagnostics, reads[0]!.name),
        ),
      ),
    ).toBeGreaterThan(20);
  });

  it.each(cases)(
    'onFormulaFault: "leave-out" gives the oracle\'s Formula Diagnostics for request $name',
    async ({ index, request }) => {
      const { outcome } = leaveOutOracle(request);
      const answered = await answer(request, "leave-out");
      const actual =
        answered.kind === "error"
          ? {
              failure: {
                code: answered.error.diagnostic.code,
                argument: answered.error.diagnostic.location?.argument,
              },
              diagnostics: codesOf(answered.error.formulaDiagnostics),
            }
          : {
              diagnostics: codesOf(answered.result.formulaDiagnostics),
              columns: answered.result
                .rows!.flatMap((row) => Object.keys(row.values))
                .sort(),
            };
      expect(actual, reproduce(index, request)).toEqual(outcome);
    },
  );

  it.each(cases)(
    'onFormulaFault: "fail" fails with the first root fault for request $name',
    async ({ index, request }) => {
      const { root, sourcePaths } = failOracle(request);
      const answered = await answer(request, "fail");
      const actual =
        answered.kind === "error"
          ? {
              code: answered.error.diagnostic.code,
              argument: answered.error.diagnostic.location?.argument,
              path: answered.error.diagnostic.location?.path,
              diagnostics: answered.error.formulaDiagnostics,
            }
          : null;
      // The source check names one of its Formulas; the oracle does not
      // decide which.
      const expected = root && {
        ...root,
        path:
          actual && sourcePaths.includes(actual.path!)
            ? actual.path
            : root.path,
        diagnostics: undefined,
      };
      expect(actual, reproduce(index, request)).toEqual(expected);
    },
  );
});
