// TextMate grammar highlighting Eta v4 template markers only — the `<% %>`
// delimiters, output operators, and whitespace-trim markers. Tag contents are
// left unstyled: JavaScript is deliberately not embedded, which avoids the
// source.js `{` block swallowing the `%>` close across a tag boundary.
//
// Tag shape follows Eta's parser: `<%` + optional trim marker (`-`/`_`) +
// optional whitespace + optional operator (`=` escaped, `~` raw, empty exec),
// closed by an optional trim marker + `%>`.
// @see https://github.com/eta-dev/eta/blob/v4.0.0/src/parse.ts

type CaptureMap = Record<string, { name: string }>;

const endCaptures = {
  "1": { name: "keyword.control.whitespace.trim.eta" },
  "2": { name: "punctuation.section.embedded.end.eta" },
} satisfies CaptureMap;

const end = "([-_]?)(%>)";

const outputTag = (operator: string, scope: string) => ({
  name: `meta.tag.template.${scope}.eta`,
  begin: `(<%)([-_]?)\\s*(${RegExp.escape(operator)})`,
  beginCaptures: {
    "1": { name: "punctuation.section.embedded.begin.eta" },
    "2": { name: "keyword.control.whitespace.trim.eta" },
    "3": { name: "keyword.operator.output.eta" },
  } satisfies CaptureMap,
  end,
  endCaptures,
});

export const etaGrammar = {
  aliases: ["ejs"],
  embeddedLangs: [],
  fileTypes: ["eta", "eta.md", "ejs", "ejs.md"],
  name: "eta",
  patterns: [{ include: "#eta-tags" }],
  repository: {
    "eta-tags": {
      patterns: [
        {
          begin: "(<<%)([-_]?)\\s*(~)",
          beginCaptures: {
            "1": { name: "punctuation.section.embedded.begin.eta" },
            "2": { name: "keyword.control.whitespace.trim.eta" },
            "3": { name: "keyword.operator.output.raw.eta" },
          } as CaptureMap,
          end,
          endCaptures,
          name: "meta.tag.template.expression.raw.double.eta",
        },
        outputTag("~", "expression.raw"),
        outputTag("=", "expression.escaped"),
        {
          begin: "(<%)([-_]?)(?![=~])",
          beginCaptures: {
            "1": { name: "punctuation.section.embedded.begin.eta" },
            "2": { name: "keyword.control.whitespace.trim.eta" },
          } as CaptureMap,
          end,
          endCaptures,
          name: "meta.tag.template.script.eta",
        },
      ],
    },
  },
  scopeName: "text.html.eta",
};
