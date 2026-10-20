// Renders the Functions and methods reference page body from the language
// half of the published Query Schema, so the page cannot drift from the
// registry that validates and runs a Filter Expression.

import type {
  ItemQuerySchema,
  SchemaFunction,
  SchemaMethod,
  SchemaParameter,
  SchemaProperty,
} from "@zotlit/item-query";

/** The language definitions of the Query Schema that the page lists. */
export type LanguageVocabulary = Pick<
  ItemQuerySchema,
  "functions" | "methods" | "properties" | "types"
>;

/**
 * The page body: global functions, then methods and properties grouped by
 * receiver type in the schema's type order. Throws on an entry without a
 * description, or with one that MDX would read as markup.
 */
export function renderFunctionsReference(
  vocabulary: LanguageVocabulary,
): string {
  const receivers = ["any", ...vocabulary.types] as const;
  const blocks = [
    "## Global functions [#functions]",
    "A global function is called by its name, such as `today()`.",
    table(
      vocabulary.functions.map((entry) => [
        functionSignature(entry.name, entry),
        description(entry.name, entry),
      ]),
    ),
    "## Methods [#methods]",
    "A method is called on a value, such as `title.lower()`. Each group lists the methods of one value type.",
    ...receivers.flatMap((type) => {
      const methods = vocabulary.methods.filter((entry) => entry.on === type);
      if (methods.length === 0) return [];
      return [
        `### ${type === "any" ? "Methods of every value" : `${label(type)} methods`} [#${type}-methods]`,
        table(methods.map(methodRow)),
      ];
    }),
    "## Properties [#properties]",
    "A property is read from a value without a call, such as `title.length`.",
    ...vocabulary.types.flatMap((type) => {
      const properties = vocabulary.properties.filter(
        (entry) => entry.on === type,
      );
      if (properties.length === 0) return [];
      return [
        `### ${label(type)} properties [#${type}-properties]`,
        table(properties.map(propertyRow)),
      ];
    }),
  ];
  return blocks.join("\n\n");
}

function methodRow(entry: SchemaMethod): readonly [string, string] {
  const name = `${entry.on}.${entry.name}`;
  const scope = entry.scope
    ? ` The expression can use ${conjoin(entry.scope.map((term) => `\`${term}\``))}.`
    : "";
  return [
    functionSignature(name, entry),
    `${description(name, entry)}${scope}`,
  ];
}

function propertyRow(entry: SchemaProperty): readonly [string, string] {
  const name = `${entry.on}.${entry.name}`;
  return [`\`${name} → ${entry.returns}\``, description(name, entry)];
}

/** `name(param: type, optional?: type, ...rest: type) → type` as a code span. */
function functionSignature(name: string, entry: SchemaFunction): string {
  const parameters = [
    ...entry.parameters.map((parameter) => typed(parameter.name, parameter)),
    ...entry.optional.map((parameter) =>
      typed(`${parameter.name}?`, parameter),
    ),
    ...(entry.rest ? [typed(`...${entry.rest.name}`, entry.rest)] : []),
  ];
  // A null result type means the type of the result varies.
  return `\`${name}(${parameters.join(", ")}) → ${entry.returns ?? "any"}\``;
}

function typed(name: string, parameter: SchemaParameter): string {
  const types = parameter.values
    ? parameter.values.map((value) => JSON.stringify(value))
    : typeof parameter.type === "string"
      ? [parameter.type]
      : [...parameter.type];
  return `${name}: ${[...types, ...(parameter.nullable ? ["null"] : [])].join(" | ")}`;
}

/** The entry's description, checked to be present and plain MDX text. */
function description(
  name: string,
  entry: { readonly description?: string },
): string {
  const text = entry.description?.trim() ?? "";
  if (text === "") {
    throw new Error(
      `${name} has no description: add one to its entry in packages/item-query/src/filter-functions.ts.`,
    );
  }
  // MDX reads `{` and `<` as expression and element openers outside code spans.
  const opener = /[{}<]/.exec(text.replaceAll(/`[^`]*`/g, ""));
  if (opener) {
    throw new Error(
      `The description of ${name} carries the MDX opener ${opener[0]} outside a code span: ${text}`,
    );
  }
  return text;
}

function table(rows: readonly (readonly [string, string])[]): string {
  return [
    "| Signature | Description |",
    "| --- | --- |",
    ...rows.map((cells) => `| ${cells.map(cell).join(" | ")} |`),
  ].join("\n");
}

/** A pipe ends a GFM table cell, even inside a code span, unless escaped. */
const cell = (text: string): string => text.replaceAll("|", "\\|");

const label = (type: string): string =>
  `${type.charAt(0).toUpperCase()}${type.slice(1)}`;

function conjoin(terms: readonly string[]): string {
  if (terms.length <= 2) return terms.join(" and ");
  return `${terms.slice(0, -1).join(", ")}, and ${terms.at(-1)}`;
}
