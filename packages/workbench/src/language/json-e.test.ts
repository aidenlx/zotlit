import { expect, it } from "vitest";

import { completionEdit, hoverHint, suggestions } from "./suggestions";
import type { SuggestionConfig } from "./suggestions";

const config: SuggestionConfig = {
  root: "note",
  partials: [],
  language: "json-e",
  sample: { title: "Paper" },
};

it("completes a JSON-e field without changing the expression or JSON quotes", () => {
  const source = '{"$eval":"zt.ti + \' suffix\'"}';
  const result = suggestions(source, source.indexOf(" +"), config)!;
  const option = result.options.find((item) => item.label === "title")!;
  const edit = completionEdit(source, result, option);
  expect(source.slice(0, edit.from) + edit.insert + source.slice(edit.to)).toBe(
    '{"$eval":"zt.title + \' suffix\'"}',
  );
  expect(edit.continue).toBe(false);
  expect(
    hoverHint('{"$eval":"zt.title"}', 14, config)?.options[0],
  ).toMatchObject({ label: "title", example: 'Sample: "Paper"' });
  expect(suggestions('{"literal":"zt.ti"}', 17, config)).toBeNull();
});

it.each([
  '{"$if":"zt.ti| == null","then":1}',
  '{"name":"Paper ${zt.ti|}"}',
  '{"${zt.ti|}":1}',
  '{"$switch":{"zt.ti| != null":1,"$default":0}}',
  '{"$match":{"zt.ti| != null":1}}',
  '{"$find":[],"each(x)":"zt.ti| == x"}',
  '{"$sort":[],"by(x)":"zt.ti|"}',
  '{"$map":[],"each(x)":{"$eval":"zt.ti|"}}',
  '{"$eval":"zt.ti|',
])("recognizes JSON-e expression positions in %s", (marked) => {
  const position = marked.indexOf("|");
  const source = marked.replace("|", "");
  expect(
    suggestions(source, position, config)?.options.map((item) => item.label),
  ).toContain("title");
});

it("keeps escaped interpolation and expression string literals inert", () => {
  for (const marked of ['{"text":"$${zt.ti|}"}', '{"$eval":"\'zt.ti|\'"}']) {
    expect(
      suggestions(marked.replace("|", ""), marked.indexOf("|"), config),
    ).toBeNull();
  }
});

it.each([
  '{"$map":{"$eval":"zt.authors"},"each(author)":{"$eval":"author.fam|"}}',
  '{"$let":{"paper":{"$eval":"zt"}},"in":{"$eval":"paper.ti|"}}',
  '{"$find":{"$eval":"zt.authors"},"each(author,index)":"author.fam| == index"}',
  '{"$sort":{"$eval":"zt.authors"},"by(author)":"author.fam|"}',
  '{"$reduce":{"$eval":"zt.authors"},"initial":"","each(acc,author,index)":{"$eval":"author.fam|"}}',
  '{"$eval":"zt.authors[0].fam|"}',
  '{"$eval":"zt[\\"authors\\"][0].fam|"}',
])("resolves contract paths and scoped locals in %s", (marked) => {
  const result = suggestions(
    marked.replace("|", ""),
    marked.indexOf("|"),
    config,
  )!;
  expect(result.options.map((item) => item.label)).toContain(
    marked.includes(".ti|") ? "title" : "family",
  );
});

it("offers uncertain locals without inventing members or sharing sibling let bindings", () => {
  const marked =
    '{"$let":{"a":{"$eval":"dynamic()"},"b":{"$eval":"a|"}},"in":{"$eval":"a"}}';
  expect(
    suggestions(
      marked.replace("|", ""),
      marked.indexOf("|"),
      config,
    )?.options.map((item) => item.label),
  ).not.toContain("a");
  const source = '{"$let":{"a":{"$eval":"dynamic()"}},"in":{"$eval":"a"}}';
  expect(
    suggestions(source, source.lastIndexOf('a"') + 1, config)?.options,
  ).toContainEqual(expect.objectContaining({ label: "a", type: "unknown" }));
});

it("accepts whole arrays and omits Liquid array pseudo-members", () => {
  const source = '{"$eval":"zt.auth"}';
  const result = suggestions(source, source.indexOf("auth") + 4, config)!;
  const option = result.options.find((item) => item.label === "authors")!;
  expect(completionEdit(source, result, option).insert).toBe("authors");
  const array = '{"$eval":"zt.authors."}';
  expect(
    suggestions(array, array.indexOf('."') + 1, config)?.options ?? [],
  ).toEqual([]);
});

it("offers operator keys, companion keys, functions, and their hover facts", () => {
  expect(
    suggestions('{"$ev"}', 5, config)?.options.map((o) => o.label),
  ).toContain("$eval");
  const branch = '{"$if":"true", "th"}';
  const result = suggestions(branch, branch.indexOf('th"') + 2, config)!;
  const edit = completionEdit(
    branch,
    result,
    result.options.find((o) => o.label === "then")!,
  );
  expect(branch.slice(0, edit.from) + edit.insert + branch.slice(edit.to)).toBe(
    '{"$if":"true", "then": null}',
  );
  const call = '{"$eval":"le"}';
  expect(
    suggestions(call, call.indexOf('le"') + 2, config)?.options.map(
      (o) => o.label,
    ),
  ).toContain("len");
  expect(
    hoverHint('{"$eval":"len(zt.authors)"}', 11, config)?.options[0]?.detail,
  ).toContain("length");
  expect(hoverHint('{"$eval":"zt.title"}', 4, config)?.options[0]?.label).toBe(
    "$eval",
  );
});

it("maps escaped JSON and bracket member edits back to source offsets", () => {
  for (const marked of [
    '{"$eval":"zt[\\"ti|\\"]"}',
    '{"$eval":"zt.authors[-1].fam|"}',
    '{"$eval":"zt.\\u0074i|"}',
  ]) {
    const source = marked.replace("|", "");
    const result = suggestions(source, marked.indexOf("|"), config)!;
    const label = marked.includes("fam|") ? "family" : "title";
    const edit = completionEdit(
      source,
      result,
      result.options.find((o) => o.label === label)!,
    );
    const changed =
      source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
    expect(JSON.parse(changed).$eval).toBe(
      label === "family"
        ? "zt.authors[-1].family"
        : marked.includes("[\\")
          ? 'zt["title"]'
          : "zt.title",
    );
  }
});

it("uses source scopes for operator hover and isolates locals between rules", () => {
  const rule = '{"$eval":"zt.title"}';
  const source = `value: ${rule}\nother: kept`;
  expect(
    hoverHint(source, 11, {
      ...config,
      scope: { from: 7, to: 7 + rule.length },
    })?.options[0]?.label,
  ).toBe("$eval");
  expect(
    suggestions('{"$eval":"paper"}', 15, config)?.options.map((o) => o.label),
  ).not.toContain("paper");
});

it("completes and hovers non-identifier local object keys through JSON string escapes", () => {
  const rule = {
    $let: { obj: { 'quote"name': 1, "paper-title": "x" } },
    in: { $eval: "obj['quo']" },
  };
  const source = JSON.stringify(rule);
  const result = suggestions(source, source.lastIndexOf("quo") + 3, config)!;
  const edit = completionEdit(
    source,
    result,
    result.options.find((o) => o.label === 'quote"name')!,
  );
  expect(
    JSON.parse(source.slice(0, edit.from) + edit.insert + source.slice(edit.to))
      .in.$eval,
  ).toBe("obj['quote\"name']");
  const hovered = JSON.stringify({
    ...rule,
    in: { $eval: "obj['paper-title']" },
  });
  expect(
    hoverHint(hovered, hovered.lastIndexOf("title"), config)?.options[0]?.label,
  ).toBe("paper-title");
});

it("replaces the actual dot when a non-identifier key follows whitespace", () => {
  const source = JSON.stringify({
    $let: { obj: { "paper-title": "x" } },
    in: { $eval: "obj. pa" },
  });
  const result = suggestions(source, source.indexOf('pa"') + 2, config)!;
  const edit = completionEdit(
    source,
    result,
    result.options.find((o) => o.label === "paper-title")!,
  );
  expect(
    JSON.parse(source.slice(0, edit.from) + edit.insert + source.slice(edit.to))
      .in.$eval,
  ).toBe("obj['paper-title']");
});
