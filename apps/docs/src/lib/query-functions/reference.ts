// Renders the Functions and methods reference page body from the language
// half of the published Query Schema, so the page cannot drift from the
// registry that validates and runs a Filter Expression.

import { signatureText } from "@zotlit/item-query";
import type {
  ItemQuerySchema,
  SchemaFunction,
  SchemaMethod,
  SchemaProperty,
} from "@zotlit/item-query";

// A subpath import, so `node scripts/*.ts` resolves it as the bundler does.
import { plainMdxText } from "#mdx-text";

/** The language definitions of the Query Schema that the page lists. */
export type LanguageVocabulary = Pick<
  ItemQuerySchema,
  "functions" | "methods" | "properties" | "types"
>;

/**
 * The page body: global functions, then methods and properties grouped by
 * receiver type in the schema's type order.
 * @returns The MDX of the page's sections, without frontmatter.
 * @throws When an entry has no description, or one that MDX would read as
 *   markup.
 */
export function renderFunctionsReference(
  vocabulary: LanguageVocabulary,
): string {
  return [
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
    ...receiverGroups("methods", ["any", ...vocabulary.types], {
      entries: vocabulary.methods,
      row: methodRow,
    }),
    "## Properties [#properties]",
    "A property is read from a value without a call, such as `title.length`.",
    ...receiverGroups("properties", vocabulary.types, {
      entries: vocabulary.properties,
      row: propertyRow,
    }),
  ].join("\n\n");
}

/** One anchored heading and table per receiver type that has entries. */
function receiverGroups<Entry extends { readonly on: string }>(
  kind: "methods" | "properties",
  receivers: readonly string[],
  {
    entries,
    row,
  }: {
    readonly entries: readonly Entry[];
    readonly row: (entry: Entry) => readonly [string, string];
  },
): string[] {
  return receivers.flatMap((type) => {
    const members = entries.filter((entry) => entry.on === type);
    if (members.length === 0) return [];
    const title =
      type === "any"
        ? `${capitalize(kind)} of every value`
        : `${capitalize(type)} ${kind}`;
    return [`### ${title} [#${type}-${kind}]`, table(members.map(row))];
  });
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

/** The entry's signature as a code span. */
const functionSignature = (name: string, entry: SchemaFunction): string =>
  `\`${signatureText(name, entry)}\``;

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
  return plainMdxText(text, `The description of ${name}`);
}

function table(rows: readonly (readonly [string, string])[]): string {
  return [
    "| Signature | Description |",
    "| --- | --- |",
    ...rows.map((cells) => `| ${cells.map(escapeCellPipes).join(" | ")} |`),
  ].join("\n");
}

/** A pipe ends a GFM table cell, even inside a code span, unless escaped. */
const escapeCellPipes = (text: string): string => text.replaceAll("|", "\\|");

const capitalize = (type: string): string =>
  `${type.charAt(0).toUpperCase()}${type.slice(1)}`;

function conjoin(terms: readonly string[]): string {
  if (terms.length <= 2) return terms.join(" and ");
  return `${terms.slice(0, -1).join(", ")}, and ${terms.at(-1)}`;
}
