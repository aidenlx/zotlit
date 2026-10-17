// The conditions a filter offers over a Query Dataset, as Filter Expression
// text: each one is a field of the dataset, an operator and a value. The
// Query View's Filter and the Profile Match both offer them. The fields are
// dataset-relative: an Item's title is `title` on Items and `item.title` on
// Annotations. What a condition cannot read stays an expression row in the
// Match editor.
import { parseExpressionAst } from "@zotlit/filter-expression";
import type { ExpressionNode } from "@zotlit/filter-expression";

/** The records a filter selects. */
export type FilterDataset = "annotations" | "attachments" | "items";

/**
 * What a condition puts before a field of the Item and of the Attachment;
 * `null` where the dataset has no Attachment.
 */
const PREFIX: Record<
  FilterDataset,
  { readonly item: string; readonly attachment: string | null }
> = {
  annotations: { item: "item.", attachment: "attachment." },
  attachments: { item: "item.", attachment: "" },
  items: { item: "", attachment: null },
};

/** How a field's value is tested, and so which operators it offers. */
export type FilterValueType =
  | "text"
  | "list"
  | "collection"
  | "choice"
  | "number"
  | "date"
  | "boolean";

/**
 * The kind of a field the host adds beside a dataset's own, such as a vault
 * property of the Query View, named by the host.
 */
export type CustomFilterFieldKind = `custom:${string}`;

export type FilterFieldKind =
  | CustomFilterFieldKind
  | "color"
  | "tags"
  | "comment"
  | "text"
  | "page"
  | "date-added"
  | "date-modified"
  | "item-title"
  | "creators"
  | "first-author"
  | "year"
  | "item-type"
  | "collection"
  | "library"
  | "attachment-title"
  | "file-type";

export interface FilterField {
  readonly kind: FilterFieldKind;
  /**
   * The field's path in the view's dataset, as a condition writes it: a
   * name the dot cannot reach takes bracket access, as `vault["a-b"]` does.
   */
  readonly path: string;
  readonly type: FilterValueType;
  /** The name the kind picker shows; a field the host adds gives one. */
  readonly label?: string;
}

export type FilterOperator =
  | "contains"
  | "does-not-contain"
  | "contains-any"
  | "contains-all"
  | "within"
  | "not-within"
  | "is"
  | "is-not"
  | "is-empty"
  | "is-not-empty"
  | "before"
  | "after"
  | "on-or-before"
  | "on-or-after"
  | "is-true"
  | "is-false";

/** One condition row of the Query View's Filter. */
export interface FilterRow {
  readonly kind: FilterFieldKind;
  readonly operator: FilterOperator;
  /** The value of a one-value operator. */
  readonly value: string;
  /** The values of "contains any of" and "contains all of". */
  readonly values: readonly string[];
}

/** The operators of each value type, the first one a new row's. */
export const FILTER_OPERATORS: Record<
  FilterValueType,
  readonly FilterOperator[]
> = {
  text: [
    "contains",
    "does-not-contain",
    "is",
    "is-not",
    "is-empty",
    "is-not-empty",
  ],
  list: [
    "contains",
    "does-not-contain",
    "contains-any",
    "contains-all",
    "is-empty",
    "is-not-empty",
  ],
  collection: [
    "within",
    "not-within",
    "contains",
    "does-not-contain",
    "contains-any",
    "contains-all",
    "is-empty",
    "is-not-empty",
  ],
  choice: ["is", "is-not"],
  number: ["is", "is-not", "before", "after", "on-or-before", "on-or-after"],
  date: ["on-or-after", "after", "before", "on-or-before"],
  boolean: ["is-true", "is-false"],
};

/** The conditions of a view's dataset, in the order the kind picker lists them. */
export function filterFields(dataset: FilterDataset): FilterField[] {
  const { item, attachment } = PREFIX[dataset];
  const fields: FilterField[] = [];
  if (dataset === "annotations")
    fields.push(
      { kind: "color", path: "colorName", type: "choice" },
      { kind: "tags", path: "tags", type: "list" },
      { kind: "comment", path: "comment", type: "text" },
      { kind: "text", path: "text", type: "text" },
      { kind: "page", path: "pageLabel", type: "text" },
      { kind: "date-added", path: "dateAdded", type: "date" },
      { kind: "date-modified", path: "dateModified", type: "date" },
    );
  fields.push(
    { kind: "item-title", path: `${item}title`, type: "text" },
    { kind: "creators", path: `${item}creators`, type: "list" },
    {
      kind: "first-author",
      path: `${item}firstAuthor.fullName`,
      type: "text",
    },
    { kind: "year", path: `${item}date.year`, type: "number" },
    { kind: "item-type", path: `${item}itemType`, type: "choice" },
    { kind: "collection", path: `${item}collections`, type: "collection" },
    { kind: "library", path: "library", type: "choice" },
  );
  // An Annotation lists the Tags of its own above; an Item, those of the Item.
  if (dataset === "items")
    fields.push({ kind: "tags", path: "tags", type: "list" });
  if (attachment !== null)
    fields.push(
      { kind: "attachment-title", path: `${attachment}title`, type: "text" },
      { kind: "file-type", path: `${attachment}fileType`, type: "choice" },
    );
  return fields;
}

/** A row of `field` with its first operator and no value yet. */
export function freshFilterRow(field: FilterField): FilterRow {
  const operator = FILTER_OPERATORS[field.type][0]!;
  return { kind: field.kind, operator, value: "", values: [] };
}

/** `row` with another operator, keeping what its values still mean. */
export function withOperator(
  row: FilterRow,
  operator: FilterOperator,
): FilterRow {
  const many = (op: FilterOperator) =>
    op === "contains-any" || op === "contains-all";
  if (many(operator) && !many(row.operator))
    return {
      ...row,
      operator,
      values: row.value === "" ? [] : [row.value],
    };
  if (!many(operator) && many(row.operator))
    return { ...row, operator, value: row.values[0] ?? "" };
  return { ...row, operator };
}

const COMPARISON: Partial<Record<FilterOperator, string>> = {
  is: "==",
  "is-not": "!=",
  before: "<",
  after: ">",
  "on-or-before": "<=",
  "on-or-after": ">=",
};

const NUMBER = /^-?\d+(\.\d+)?$/;

function literal(field: FilterField, value: string): string {
  if (field.type === "number" && NUMBER.test(value)) return value;
  if (field.type === "date") return `date(${JSON.stringify(value)})`;
  return JSON.stringify(value);
}

function fieldOf(
  kind: FilterFieldKind,
  fields: readonly FilterField[],
): FilterField {
  const field = fields.find((entry) => entry.kind === kind);
  if (!field) throw new Error(`Unknown filter field: ${kind}`);
  return field;
}

/** Whether a row has the value its operator tests, so that it stores a condition. */
export function hasFilterValue(row: FilterRow): boolean {
  switch (row.operator) {
    case "is-empty":
    case "is-not-empty":
    case "is-true":
    case "is-false":
      return true;
    case "contains-any":
    case "contains-all":
      return row.values.some((value) => value !== "");
    default:
      return row.value !== "";
  }
}

/** The Filter Expression of one row; `null` while the row has no value. */
export function formatFilterRow(
  row: FilterRow,
  fields: readonly FilterField[],
): string | null {
  if (!hasFilterValue(row)) return null;
  const field = fieldOf(row.kind, fields);
  const { path } = field;
  const one = JSON.stringify(row.value);
  switch (row.operator) {
    case "contains":
      return `${path}.contains(${one})`;
    case "does-not-contain":
      return `!${path}.contains(${one})`;
    case "contains-any":
    case "contains-all":
      return `${path}.${row.operator === "contains-any" ? "containsAny" : "containsAll"}(${row.values
        .map((value) => JSON.stringify(value))
        .join(", ")})`;
    case "within":
      return `${path}.within(${one})`;
    case "not-within":
      return `!${path}.within(${one})`;
    case "is-empty":
      return `${path}.isEmpty()`;
    case "is-not-empty":
      return `!${path}.isEmpty()`;
    case "is-true":
      return `${path} == true`;
    case "is-false":
      return `${path} == false`;
    default:
      return `${path} ${COMPARISON[row.operator]} ${literal(field, row.value)}`;
  }
}

function unwrap(node: ExpressionNode): ExpressionNode {
  return node.type === "group" ? unwrap(node.expression) : node;
}

function pathOf(node: ExpressionNode): string | null {
  if (node.type === "identifier") return node.name;
  if (node.type === "object-access") {
    const object = pathOf(node.object);
    return object === null ? null : `${object}.${node.property}`;
  }
  if (node.type === "array-access" && node.index.type === "string") {
    const object = pathOf(node.object);
    return object === null
      ? null
      : `${object}[${JSON.stringify(node.index.value)}]`;
  }
  return null;
}

function strings(nodes: readonly ExpressionNode[]): string[] | null {
  const values: string[] = [];
  for (const node of nodes) {
    if (node.type !== "string") return null;
    values.push(node.value);
  }
  return values;
}

function callRow({
  field,
  method,
  args,
  negated,
}: {
  field: FilterField;
  method: string;
  args: string[];
  negated: boolean;
}): FilterRow | null {
  const row = (operator: FilterOperator, value = "", values: string[] = []) =>
    FILTER_OPERATORS[field.type].includes(operator)
      ? { kind: field.kind, operator, value, values }
      : null;
  switch (method) {
    case "contains":
      return args.length === 1
        ? row(negated ? "does-not-contain" : "contains", args[0])
        : null;
    case "within":
      return args.length === 1
        ? row(negated ? "not-within" : "within", args[0])
        : null;
    case "isEmpty":
      return args.length === 0
        ? row(negated ? "is-not-empty" : "is-empty")
        : null;
    case "containsAny":
    case "containsAll":
      return negated || args.length === 0
        ? null
        : row(
            method === "containsAny" ? "contains-any" : "contains-all",
            "",
            args,
          );
    default:
      return null;
  }
}

function comparedValue(
  field: FilterField,
  node: ExpressionNode,
): string | null {
  if (field.type === "date") {
    if (
      node.type !== "call" ||
      node.callee.type !== "identifier" ||
      node.callee.name !== "date"
    )
      return null;
    const [value, ...rest] = strings(node.args) ?? [];
    return value !== undefined && rest.length === 0 ? value : null;
  }
  if (node.type === "string") return node.value;
  if (field.type === "number" && node.type === "number")
    return String(node.value);
  return null;
}

/**
 * The row one Filter Expression condition reads as, or `null` when no row
 * shows it as written.
 */
export function parseFilterRow(
  text: string,
  fields: readonly FilterField[],
): FilterRow | null {
  const { ast } = parseExpressionAst(text);
  if (!ast) return null;
  let node = unwrap(ast);
  let negated = false;
  if (node.type === "unary" && node.operator === "!") {
    negated = true;
    node = unwrap(node.operand);
  }
  const field = (path: string | null) =>
    path === null ? undefined : fields.find((entry) => entry.path === path);
  if (node.type === "call" && node.callee.type === "object-access") {
    const target = field(pathOf(node.callee.object));
    const args = strings(node.args);
    if (!target || !args) return null;
    return callRow({
      field: target,
      method: node.callee.property,
      args,
      negated,
    });
  }
  if (node.type === "binary" && !negated) {
    const target = field(pathOf(node.left));
    if (target?.type === "boolean") {
      const value = unwrap(node.right);
      return node.operator === "==" && value.type === "boolean"
        ? {
            kind: target.kind,
            operator: value.value ? "is-true" : "is-false",
            value: "",
            values: [],
          }
        : null;
    }
    const operator = (Object.keys(COMPARISON) as FilterOperator[]).find(
      (key) => COMPARISON[key] === node.operator,
    );
    if (!target || !operator) return null;
    if (!FILTER_OPERATORS[target.type].includes(operator)) return null;
    const value = comparedValue(target, node.right);
    if (value === null) return null;
    return { kind: target.kind, operator, value, values: [] };
  }
  return null;
}
