import { expect, it } from "vitest";

import { signatureAt } from "./signature-hint";

/** The hint at the `|` in `text`. */
function hintAt(
  text: string,
  options?: Parameters<typeof signatureAt>[2],
): ReturnType<typeof signatureAt> {
  const pos = text.indexOf("|");
  return signatureAt(text.replace("|", ""), pos, options);
}

const typed = { receiverType: () => "string" as const };

it("names the string slice with its second parameter marked inside title.slice(1, )", () => {
  expect(hintAt("title.slice(1, |)", typed)).toEqual({
    callee: "slice",
    signatures: [
      {
        receiver: "string",
        parameters: [
          { name: "start", type: "number", optional: false, rest: false },
          { name: "end", type: "number", optional: true, rest: false },
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
    hintAt("dateAdded.slice(|", { receiverType: () => "date" }),
  ).toBeNull();
});

it("names every definition of a method whose receiver's type is unknown", () => {
  expect(marked("title.slice(1, |")).toEqual({
    callee: "slice",
    marked: ["string:end", "list:end"],
  });
  expect(marked("title.slice(1, |", { receiverType: () => undefined })).toEqual(
    { callee: "slice", marked: ["string:end", "list:end"] },
  );
});

it("names a method of every value for a typed receiver", () => {
  expect(marked("title.isType(|", typed)).toEqual({
    callee: "isType",
    marked: ["any:type"],
  });
});

it("types the receiver from its own text", () => {
  const seen: string[] = [];
  hintAt("tags.filter(value.contains(|", {
    receiverType: (text) => {
      seen.push(text);
      return undefined;
    },
  });
  expect(seen).toEqual(["value"]);
});
