// PROTOTYPE (#595) — throwaway. Minimal Filter Expression evaluator + sound pushdown lowering.
// Only the subset needed to compare candidate/relation plans; partial dates, Temporal,
// custom fields and the full function registry are deliberately out of scope.
import { parseExpression } from "../../filter-expression/dist/index.mjs";

export type Value = null | boolean | number | string | Value[];

export type Ast =
  | { t: "lit"; v: Value }
  | { t: "id"; name: string }
  | { t: "bin"; op: string; l: Ast; r: Ast }
  | { t: "un"; op: string; e: Ast }
  | { t: "call"; callee: Ast; args: Ast[] }
  | { t: "member"; obj: Ast; prop: string }
  | { t: "index"; obj: Ast; idx: Ast }
  | { t: "arr"; items: Ast[] };

const EXPR = new Set([
  "LogicalExpression",
  "EqualityExpression",
  "RelationalExpression",
  "AdditiveExpression",
  "MultiplicativeExpression",
  "UnaryExpression",
  "Call",
  "ArrayAccess",
  "ObjectAccess",
  "Identifier",
  "NullLiteral",
  "BooleanLiteral",
  "RealNumber",
  "String",
  "RegExp",
  "Array",
  "GroupedExpression",
]);

export function parse(src: string): Ast {
  const { tree, error } = parseExpression(src);
  if (error) throw new Error(`syntax error at ${error.from}`);
  const top = tree.topNode.firstChild;
  if (!top) throw new Error("empty expression");
  return convert(top, src);
}

function kids(node: any): any[] {
  const out = [];
  for (let c = node.firstChild; c; c = c.nextSibling)
    if (EXPR.has(c.name)) out.push(c);
  return out;
}

function convert(node: any, src: string): Ast {
  const text = src.slice(node.from, node.to);
  const k = kids(node);
  switch (node.name) {
    case "GroupedExpression":
      return convert(k[0], src);
    case "NullLiteral":
      return { t: "lit", v: null };
    case "BooleanLiteral":
      return { t: "lit", v: text === "true" };
    case "RealNumber":
      return { t: "lit", v: Number(text) };
    case "String":
      return { t: "lit", v: unescape(text.slice(1, -1)) };
    case "Identifier":
      return { t: "id", name: text };
    case "Array":
      return { t: "arr", items: k.map((c) => convert(c, src)) };
    case "UnaryExpression":
      return {
        t: "un",
        op: src.slice(node.from, k[0].from).trim(),
        e: convert(k[0], src),
      };
    case "ObjectAccess":
      return {
        t: "member",
        obj: convert(k[0], src),
        prop: src.slice(k[1].from, k[1].to),
      };
    case "ArrayAccess":
      return { t: "index", obj: convert(k[0], src), idx: convert(k[1], src) };
    case "Call":
      return {
        t: "call",
        callee: convert(k[0], src),
        args: k.slice(1).map((c) => convert(c, src)),
      };
    case "RegExp":
      throw new Error("regexp unsupported");
    default:
      return {
        t: "bin",
        op: src.slice(k[0].to, k[1].from).trim(),
        l: convert(k[0], src),
        r: convert(k[1], src),
      };
  }
}

function unescape(s: string): string {
  return s.replaceAll(
    /\\(.)/g,
    (_, c) => ({ n: "\n", t: "\t", r: "\r" })[c as "n"] ?? c,
  );
}

// ---------------------------------------------------------------- evaluator

export interface EvalItem {
  id: number;
  key: string;
  itemTypeID: number;
  itemType: string;
  dateAdded: string;
  dateModified: string;
  /** canonical field name and base-field alias -> value */
  fields: Map<string, string>;
  loadedFieldIDs: Set<number> | "all";
  creators?: {
    firstName: string;
    lastName: string;
    fieldMode: number;
    creatorType: string;
  }[];
  tags?: string[];
  collections?: string[];
  hasAttachment?: boolean;
}

export const RELATIONS = [
  "creators",
  "tags",
  "collections",
  "hasAttachment",
] as const;
export type Relation = (typeof RELATIONS)[number];
const BASE = new Set(["itemType", "key", "dateAdded", "dateModified"]);

export function resolve(item: EvalItem, name: string): Value {
  switch (name) {
    case "itemType":
      return item.itemType;
    case "key":
      return item.key;
    case "dateAdded":
      return item.dateAdded;
    case "dateModified":
      return item.dateModified;
    case "creators":
      return item.creators!.map((c) =>
        c.fieldMode === 1 ? c.lastName : `${c.firstName} ${c.lastName}`.trim(),
      );
    case "tags":
      return item.tags!;
    case "collections":
      return item.collections!;
    case "hasAttachment":
      return item.hasAttachment!;
    default:
      return item.fields.get(name) ?? null;
  }
}

export function truthy(v: Value): boolean {
  if (v === null || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function looseEq(a: Value, b: Value): boolean {
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => looseEq(x, b[i]!));
  if (Array.isArray(a) && a.length === 1) return looseEq(a[0]!, b);
  if (Array.isArray(b) && b.length === 1) return looseEq(a, b[0]!);
  // oxlint-disable-next-line eqeqeq -- adopted loose-equality semantics
  return a == b;
}

function rel(op: string, a: Value, b: Value): Value {
  if (a === null || b === null) return null;
  const [x, y] =
    typeof a === "number" && typeof b === "number"
      ? [a, b]
      : [String(a), String(b)];
  return op === "<"
    ? x < y
    : op === "<="
      ? x <= y
      : op === ">"
        ? x > y
        : x >= y;
}

export function evaluate(ast: Ast, item: EvalItem): Value {
  switch (ast.t) {
    case "lit":
      return ast.v;
    case "id":
      return resolve(item, ast.name);
    case "arr":
      return ast.items.map((e) => evaluate(e, item));
    case "un": {
      const v = evaluate(ast.e, item);
      return ast.op === "!" ? !truthy(v) : typeof v === "number" ? -v : null;
    }
    case "bin": {
      if (ast.op === "&&") {
        const l = evaluate(ast.l, item);
        return truthy(l) ? evaluate(ast.r, item) : l;
      }
      if (ast.op === "||") {
        const l = evaluate(ast.l, item);
        return truthy(l) ? l : evaluate(ast.r, item);
      }
      const l = evaluate(ast.l, item),
        r = evaluate(ast.r, item);
      switch (ast.op) {
        case "==":
          return looseEq(l, r);
        case "!=":
          return !looseEq(l, r);
        case "+":
          if (typeof l === "number" && typeof r === "number") return l + r;
          if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
          return l === null || r === null ? null : String(l) + String(r);
        default:
          return rel(ast.op, l, r);
      }
    }
    case "member": {
      const o = evaluate(ast.obj, item);
      if (o === null) return null;
      if (ast.prop === "length" && (typeof o === "string" || Array.isArray(o)))
        return o.length;
      throw new Error(`unknown property ${ast.prop}`);
    }
    case "index": {
      const o = evaluate(ast.obj, item),
        i = evaluate(ast.idx, item);
      if (!Array.isArray(o) || typeof i !== "number") return null;
      return o[i < 0 ? o.length + i : i] ?? null;
    }
    case "call": {
      if (ast.callee.t !== "member")
        throw new Error("global functions unsupported in prototype");
      const self = evaluate(ast.callee.obj, item);
      const args = ast.args.map((a) => evaluate(a, item));
      return method(ast.callee.prop, self, args);
    }
  }
}

const METHODS = new Set([
  "contains",
  "containsAny",
  "containsAll",
  "startsWith",
  "endsWith",
  "lower",
  "isEmpty",
]);

function method(name: string, self: Value, args: Value[]): Value {
  if (name === "isEmpty") return !truthy(self);
  if (self === null || args.some((a) => a === null)) return null;
  if (Array.isArray(self)) {
    const has = (x: Value) => self.some((e) => looseEq(e, x));
    if (name === "contains") return has(args[0]!);
    if (name === "containsAny") return args.some(has);
    if (name === "containsAll") return args.every(has);
  } else if (typeof self === "string") {
    const s = args.map(String);
    if (name === "contains") return self.includes(s[0]!);
    if (name === "containsAny") return s.some((x) => self.includes(x));
    if (name === "containsAll") return s.every((x) => self.includes(x));
    if (name === "startsWith") return self.startsWith(s[0]!);
    if (name === "endsWith") return self.endsWith(s[0]!);
    if (name === "lower") return self.toLowerCase();
  }
  throw new Error(`bad method ${name}`);
}

// ---------------------------------------------------------------- schema + needs

export interface Schema {
  fieldID: Map<string, number>;
  fieldName: Map<number, string>;
  /** base field name -> field IDs that answer it (itself + type-specific variants) */
  answers: Map<string, number[]>;
  /** `${itemTypeID}:${fieldID}` -> base field name */
  aliasOf: Map<string, string>;
  dateLike: Set<string>;
}

export interface Needs {
  fields: Set<number> | "all";
  relations: Set<Relation>;
}

export function validate(ast: Ast, schema: Schema): void {
  const walk = (a: Ast): void => {
    switch (a.t) {
      case "id":
        if (
          !BASE.has(a.name) &&
          !(RELATIONS as readonly string[]).includes(a.name) &&
          !schema.answers.has(a.name)
        )
          throw new Error(`unknown field ${a.name}`);
        return;
      case "bin":
        walk(a.l);
        walk(a.r);
        return;
      case "un":
        walk(a.e);
        return;
      case "arr":
        a.items.forEach(walk);
        return;
      case "index":
        walk(a.obj);
        walk(a.idx);
        return;
      case "member":
        if (a.prop !== "length") throw new Error(`unknown property ${a.prop}`);
        walk(a.obj);
        return;
      case "call":
        if (a.callee.t !== "member" || !METHODS.has(a.callee.prop))
          throw new Error("unknown function");
        walk(a.callee.obj);
        a.args.forEach(walk);
        return;
    }
  };
  walk(ast);
}

export function needsOf(names: Iterable<string>, schema: Schema): Needs {
  const fields = new Set<number>();
  const relations = new Set<Relation>();
  for (const n of names) {
    if ((RELATIONS as readonly string[]).includes(n))
      relations.add(n as Relation);
    else if (!BASE.has(n))
      for (const id of schema.answers.get(n) ?? []) fields.add(id);
  }
  return { fields, relations };
}

export function idsIn(ast: Ast | null): Set<string> {
  const out = new Set<string>();
  const walk = (a: Ast): void => {
    if (a.t === "id") out.add(a.name);
    else if (a.t === "bin") {
      walk(a.l);
      walk(a.r);
    } else if (a.t === "un") walk(a.e);
    else if (a.t === "arr") a.items.forEach(walk);
    else if (a.t === "index") {
      walk(a.obj);
      walk(a.idx);
    } else if (a.t === "member") walk(a.obj);
    else if (a.t === "call") {
      walk(a.callee);
      a.args.forEach(walk);
    }
  };
  if (ast) walk(ast);
  return out;
}

// ---------------------------------------------------------------- sound pushdown lowering

export type Term =
  | { k: "all" }
  | { k: "and" | "or"; xs: Term[] }
  | { k: "not"; x: Term }
  | { k: "field"; fieldIDs: number[]; value: string }
  | { k: "tag"; name: string }
  | { k: "coll"; name: string }
  | { k: "att" }
  | { k: "type"; name: string }
  | { k: "key"; key: string };

/** `exact` = the term selects exactly the matching Items, so it may be negated. */
export function lower(
  ast: Ast | null,
  schema: Schema,
): { term: Term; exact: boolean } {
  if (!ast) return { term: { k: "all" }, exact: true };
  const ALL = { term: { k: "all" } as Term, exact: false };
  const strLit = (a: Ast) =>
    a.t === "lit" && typeof a.v === "string" ? a.v : null;
  if (ast.t === "id" && ast.name === "hasAttachment")
    return { term: { k: "att" }, exact: true };
  if (ast.t === "bin" && ast.op === "==") {
    for (const [f, l] of [
      [ast.l, ast.r],
      [ast.r, ast.l],
    ] as const) {
      const v = strLit(l);
      if (f.t !== "id" || v === null) continue;
      if (f.name === "itemType")
        return { term: { k: "type", name: v }, exact: true };
      if (f.name === "key") return { term: { k: "key", key: v }, exact: true };
      const ids = schema.answers.get(f.name);
      if (ids && !schema.dateLike.has(f.name))
        return { term: { k: "field", fieldIDs: ids, value: v }, exact: true };
    }
    return ALL;
  }
  if (
    ast.t === "call" &&
    ast.callee.t === "member" &&
    ast.callee.prop === "contains" &&
    ast.args.length === 1
  ) {
    const obj = ast.callee.obj,
      v = strLit(ast.args[0]!);
    if (obj.t === "id" && v !== null) {
      if (obj.name === "tags")
        return { term: { k: "tag", name: v }, exact: true };
      if (obj.name === "collections")
        return { term: { k: "coll", name: v }, exact: true };
    }
    return ALL;
  }
  if (ast.t === "bin" && (ast.op === "&&" || ast.op === "||")) {
    const l = lower(ast.l, schema),
      r = lower(ast.r, schema);
    if (ast.op === "&&") {
      const xs = [l, r].filter((x) => x.term.k !== "all").map((x) => x.term);
      return {
        term:
          xs.length === 0
            ? { k: "all" }
            : xs.length === 1
              ? xs[0]!
              : { k: "and", xs },
        exact: l.exact && r.exact,
      };
    }
    if (l.term.k === "all" || r.term.k === "all") return ALL;
    return {
      term: { k: "or", xs: [l.term, r.term] },
      exact: l.exact && r.exact,
    };
  }
  if (ast.t === "un" && ast.op === "!") {
    const x = lower(ast.e, schema);
    return x.exact && x.term.k !== "all"
      ? { term: { k: "not", x: x.term }, exact: true }
      : ALL;
  }
  return ALL;
}

/** Zotero may hold numeric-looking values with INTEGER/REAL storage class; bind both. */
export function valueParams(v: string): (string | number)[] {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) && String(n) === v
    ? [v, n]
    : [v];
}

// ---------------------------------------------------------------- query + sort + projection

export interface ItemQuery {
  filter: string | null;
  sort: { field: string; direction: "asc" | "desc" }[];
  fields: string[];
  limit: number | null;
}

export const DEFAULT_SORT = [
  { field: "dateModified", direction: "desc" as const },
];
export const DEFAULT_FIELDS = [
  "itemType",
  "title",
  "creators",
  "date",
  "dateModified",
];

export function isDefaultSort(sort: ItemQuery["sort"]): boolean {
  return (
    sort.length === 1 &&
    sort[0]!.field === "dateModified" &&
    sort[0]!.direction === "desc"
  );
}

export function comparator(sort: ItemQuery["sort"]) {
  return (a: EvalItem, b: EvalItem): number => {
    for (const { field, direction } of sort) {
      const x = resolve(a, field),
        y = resolve(b, field);
      if (x === y) continue;
      if (x === null) return 1; // nulls last in both directions
      if (y === null) return -1;
      const c = x < y ? -1 : x > y ? 1 : 0;
      if (c) return direction === "asc" ? c : -c;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  };
}

export function project(
  item: EvalItem,
  paths: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of paths) {
    out[p] =
      p === "creators"
        ? item.creators!.map((c) => ({
            firstName: c.firstName,
            lastName: c.lastName,
            creatorType: c.creatorType,
          }))
        : resolve(item, p);
  }
  return out;
}
