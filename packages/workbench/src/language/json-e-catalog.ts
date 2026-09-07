// JSON-e operator shapes and function documentation from upstream docs/src and specification.yml.
// These describe authoring choices; the JSON-e renderer owns semantic validation.
export const jsonOperators: Record<
  string,
  { description: string; value: unknown; siblings?: Record<string, unknown> }
> = {
  $eval: {
    description: "Evaluate an expression and return its value.",
    value: "zt.title",
  },
  $if: {
    description:
      "Evaluate a condition and render the selected branch. A missing branch omits the value.",
    value: "true",
    // oxlint-disable-next-line unicorn/no-thenable -- JSON-e names the branch then.
    siblings: { then: null, else: null },
  },
  $let: {
    description:
      "Evaluate bindings in the outer context, then expose them inside in.",
    value: {},
    siblings: { in: null },
  },
  $map: {
    description: "Render a template for each array entry or object property.",
    value: [],
    siblings: { "each(value)": null },
  },
  $reduce: {
    description:
      "Fold an array with an accumulator, entry, and optional index.",
    value: [],
    siblings: { initial: null, "each(acc, value)": null },
  },
  $find: {
    description: "Return the first array entry whose expression is true.",
    value: [],
    siblings: { "each(value)": "true" },
  },
  $sort: {
    description: "Sort an array, optionally by an expression for each entry.",
    value: [],
    siblings: { "by(value)": "value" },
  },
  $match: {
    description:
      "Render every matching condition and return the results in an array.",
    value: {},
  },
  $switch: {
    description:
      "Render the single matching condition, or $default. Multiple matches are an error.",
    value: {},
  },
  $flatten: {
    description: "Flatten one level of a rendered array.",
    value: [],
  },
  $flattenDeep: { description: "Flatten all nested arrays.", value: [] },
  $merge: {
    description: "Merge an array of objects; later values win.",
    value: [],
  },
  $mergeDeep: {
    description: "Merge nested objects and concatenate arrays.",
    value: [],
  },
  $reverse: { description: "Reverse a rendered array.", value: [] },
  $json: {
    description: "Serialize a rendered value as JSON text.",
    value: null,
  },
  $fromNow: {
    description:
      "Return a timestamp relative to now or an explicit from timestamp.",
    value: "1 day",
    siblings: { from: "${now}" },
  },
};

export const jsonFunctions: Record<
  string,
  { type: string; description: string }
> = {
  now: {
    type: "string",
    description: "The fixed timestamp for this render operation.",
  },
  len: {
    type: "len(value): number",
    description: "Return the length of a string or array.",
  },
  defined: {
    type: "defined(name): boolean",
    description:
      "Test whether a variable name is defined in the current context.",
  },
  typeof: {
    type: "typeof(value): string",
    description: "Return the JSON-e type name of a value.",
  },
  fromNow: {
    type: "fromNow(offset, from?): string",
    description: "Return a timestamp relative to the supplied time or now.",
  },
  range: {
    type: "range(start, end, step?): number[]",
    description: "Generate integers from start inclusive to end exclusive.",
  },
  min: {
    type: "min(...numbers): number",
    description: "Return the smallest argument.",
  },
  max: {
    type: "max(...numbers): number",
    description: "Return the largest argument.",
  },
  sqrt: {
    type: "sqrt(number): number",
    description: "Return the square root.",
  },
  ceil: {
    type: "ceil(number): number",
    description: "Round up to an integer.",
  },
  floor: {
    type: "floor(number): number",
    description: "Round down to an integer.",
  },
  abs: {
    type: "abs(number): number",
    description: "Return the absolute value.",
  },
  lowercase: {
    type: "lowercase(string): string",
    description: "Convert text to lowercase.",
  },
  uppercase: {
    type: "uppercase(string): string",
    description: "Convert text to uppercase.",
  },
  str: {
    type: "str(value): string",
    description: "Convert a string, number, or boolean to text.",
  },
  number: {
    type: "number(string): number",
    description: "Convert text to a number.",
  },
  strip: {
    type: "strip(string): string",
    description: "Remove surrounding whitespace.",
  },
  lstrip: {
    type: "lstrip(string): string",
    description: "Remove leading whitespace.",
  },
  rstrip: {
    type: "rstrip(string): string",
    description: "Remove trailing whitespace.",
  },
  split: {
    type: "split(string, separator): string[]",
    description: "Split text at a separator.",
  },
  join: {
    type: "join(array, separator): string",
    description: "Join strings or numbers using a separator.",
  },
  has: {
    type: "has(items, key, value): boolean",
    description: "Test whether an entry has the requested property value.",
  },
  uniq: {
    type: "uniq(items): array",
    description: "Remove duplicate values from an array.",
  },
  basename: {
    type: "basename(path, extension?): string",
    description: "Return the filename, optionally removing an extension.",
  },
};
