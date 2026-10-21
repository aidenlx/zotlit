import { expect, it } from "vitest";

import { ITEMS } from "@zotlit/item-query";

import { datasetVocabulary } from "./expression-vocabulary";
import { signatureAt } from "./signature-hint";

/** The hint at the `|` in `text`. */
function hintAt(
  text: string,
  options?: Parameters<typeof signatureAt>[2],
): ReturnType<typeof signatureAt> {
  const pos = text.indexOf("|");
  return signatureAt(text.replace("|", ""), pos, options);
}

const typed = { receiver: () => ({ type: "string" as const }) };

it("names the string slice with its second parameter marked inside title.slice(1, )", () => {
  expect(hintAt("title.slice(1, |)", typed)).toEqual({
    callee: "slice",
    signatures: [
      {
        receiver: "string",
        parameters: [
          {
            name: "start",
            type: "number",
            optional: false,
            rest: false,
            text: "start: number",
          },
          {
            name: "end",
            type: "number",
            optional: true,
            rest: false,
            text: "end?: number",
          },
        ],
        active: 1,
        returns: "string",
        description:
          "The part of the text from index `start` up to, not including, `end`, counted in UTF-16 code units; a negative index counts from the end.",
      },
    ],
  });
});

/** The callee and the marked parameter of each definition at the `|`. */
function marked(text: string, options?: Parameters<typeof signatureAt>[2]) {
  const hint = hintAt(text, options);
  return (
    hint && {
      callee: hint.callee,
      marked: hint.signatures.map(
        ({ receiver, parameters, active }) =>
          `${receiver ?? "global"}:${parameters[active]?.name ?? "-"}`,
      ),
    }
  );
}

it("names any as the result of a call whose result type varies", () => {
  expect(hintAt("if(|")?.signatures.map(({ returns }) => returns)).toEqual([
    "any",
  ]);
});

it("writes a parameter's texts and null as the reference does", () => {
  expect(
    hintAt("max(|")?.signatures[0]?.parameters.map(({ type }) => type),
  ).toEqual(["number | null"]);
});

it("follows the caret through a global function's arguments", () => {
  expect(marked("date(|")).toEqual({ callee: "date", marked: ["global:text"] });
  expect(marked('if(a, "b", |)')).toEqual({
    callee: "if",
    marked: ["global:else"],
  });
});

it("keeps the rest parameter marked for every further argument", () => {
  expect(marked("min(1, 2, |")).toEqual({
    callee: "min",
    marked: ["global:values"],
  });
  expect(marked("title.containsAny('a', 'b', |", typed)).toEqual({
    callee: "containsAny",
    marked: ["string:texts"],
  });
});

it("marks no parameter past the last one a call takes", () => {
  expect(marked("date('x', |)")).toEqual({
    callee: "date",
    marked: ["global:-"],
  });
});

it("names the innermost call that holds the caret", () => {
  expect(marked("min(1, max(2, |")).toEqual({
    callee: "max",
    marked: ["global:values"],
  });
  expect(marked("min(max(2, 3), |")).toEqual({
    callee: "min",
    marked: ["global:values"],
  });
  expect(marked("date((|")).toEqual({
    callee: "date",
    marked: ["global:text"],
  });
});

it("closes outside a call's arguments", () => {
  expect(hintAt("title.slice(1, 2)|", typed)).toBeNull();
  expect(hintAt("title.sl|ice(1, 2)", typed)).toBeNull();
  expect(hintAt("title.slice|(1, 2)", typed)).toBeNull();
  expect(hintAt("title.slice(1, 2) + |", typed)).toBeNull();
  expect(hintAt("|", typed)).toBeNull();
});

it("closes for a name the registry does not hold", () => {
  expect(hintAt("nothing(|")).toBeNull();
  expect(hintAt("title.nothing(|", typed)).toBeNull();
});

it("closes for a method the receiver's type does not have", () => {
  expect(
    hintAt("dateAdded.slice(|", {
      receiver: () => ({ type: "date" as const }),
    }),
  ).toBeNull();
});

it("names every definition of a method whose receiver's type is unknown", () => {
  expect(marked("title.slice(1, |")).toEqual({
    callee: "slice",
    marked: ["string:end", "list:end"],
  });
  expect(marked("title.slice(1, |", { receiver: () => undefined })).toEqual({
    callee: "slice",
    marked: ["string:end", "list:end"],
  });
});

it("names a method of every value for a typed receiver", () => {
  expect(marked("title.isType(|", typed)).toEqual({
    callee: "isType",
    marked: ["any:type"],
  });
});

it("asks for the receiver where it stands in the text", () => {
  const seen: [string, number, number][] = [];
  hintAt("tags.filter(value.contains(|", {
    receiver: (source, { from, to }) => {
      seen.push([source, from, to]);
      return undefined;
    },
  });
  expect(seen).toEqual([["tags.filter(value.contains(", 12, 17]]);
});

it("types a Formula and a bound name as the dataset's planner reads them", () => {
  const { receiver } = datasetVocabulary(ITEMS, {
    label: () => undefined,
    formulas: { short: "title.slice(0, 10)" },
  });
  expect(marked("formula.short.slice(1, |", { receiver })).toEqual({
    callee: "slice",
    marked: ["string:end"],
  });
  // `value` is an element of `tags` there, whose type is known per Item.
  expect(marked("tags.filter(value.slice(1, |", { receiver })).toEqual({
    callee: "slice",
    marked: ["string:end", "list:end"],
  });
});
