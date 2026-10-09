// PROTOTYPE — the pure query module for the ZotLit query CLI redesign.
// Throwaway. No DOM. The page calls `createEngine(data).run(commandLine)`.
//
// The question: can ONE `zotlit:query` with `from=items|attachments|annotations`
// and two-way relation lists answer SQL-style cross-entity questions, while the
// argument form stays as simple as an Obsidian Bases view?

// ---------- values ----------
export class PartialDate {
  constructor(year, month = null, day = null, instant = null) {
    this.year = year;
    this.month = month;
    this.day = day;
    this.instant = instant;
  }
  static parse(text) {
    if (text == null || text === "") return null;
    if (/T/.test(text)) {
      const ms = Date.parse(text);
      if (Number.isNaN(ms)) return null;
      const d = new Date(ms);
      return new PartialDate(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        ms,
      );
    }
    const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(text.trim());
    if (!m) return null;
    return new PartialDate(+m[1], m[2] ? +m[2] : null, m[3] ? +m[3] : null);
  }
  get precision() {
    return this.day != null ? 3 : this.month != null ? 2 : 1;
  }
  startMs() {
    return (
      this.instant ?? Date.UTC(this.year, (this.month ?? 1) - 1, this.day ?? 1)
    );
  }
  toJSON() {
    if (this.instant != null)
      return new Date(this.instant).toISOString().replace(/\.\d{3}Z$/, "Z");
    const p = (n) => String(n).padStart(2, "0");
    return this.day != null
      ? `${this.year}-${p(this.month)}-${p(this.day)}`
      : this.month != null
        ? `${this.year}-${p(this.month)}`
        : String(this.year);
  }
  toString() {
    return this.toJSON();
  }
}
export class Duration {
  constructor(ms) {
    this.ms = ms;
  }
  toJSON() {
    return `${this.ms / 86400000} days`;
  }
}

const COLOR_NAMES = {
  "#ffd400": "yellow",
  "#ff6666": "red",
  "#5fb236": "green",
  "#2ea8e5": "blue",
  "#a28ae5": "purple",
  "#e56eee": "magenta",
  "#f19837": "orange",
  "#aaaaaa": "gray",
};

export function indexedKey(key, library) {
  return library === "personal" ? key : `${key}g${library.slice(6)}`;
}

// ---------- records (lazy relations, cycles allowed) ----------
function buildRecords(data) {
  const items = new Map(),
    attachments = new Map(),
    annotations = new Map();
  const libOf = (sel) => data.LIBRARIES.find((l) => l.selector === sel);
  const rec = (type, fields) => {
    const r = { __type: type };
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v === "function")
        Object.defineProperty(r, k, { get: v, enumerable: true });
      else r[k] = v;
    }
    return r;
  };
  for (const it of data.ITEMS) {
    const ik = indexedKey(it.key, it.library);
    const base = { ...it };
    delete base.creators;
    delete base.tags;
    delete base.collections;
    delete base.custom;
    delete base.date;
    delete base.dateAdded;
    delete base.dateModified;
    delete base.library;
    items.set(
      ik,
      rec("item", {
        ...base,
        indexedKey: ik,
        library: libOf(it.library).selector,
        creators: it.creators.map(([family, given, role]) =>
          rec("creator", {
            family,
            given,
            role,
            fullName: `${given} ${family}`.trim(),
          }),
        ),
        tags: [...it.tags].sort(),
        collections: [...it.collections].sort(),
        custom: { ...it.custom },
        date: PartialDate.parse(it.date),
        dateAdded: PartialDate.parse(it.dateAdded),
        dateModified: PartialDate.parse(it.dateModified),
        attachments: () =>
          [...attachments.values()].filter((a) => a.item === items.get(ik)),
        annotations: () =>
          [...annotations.values()].filter((a) => a.item === items.get(ik)),
      }),
    );
  }
  for (const at of data.ATTACHMENTS) {
    const ik = indexedKey(at.key, at.library),
      parentKey = indexedKey(at.parent, at.library);
    attachments.set(
      ik,
      rec("attachment", {
        indexedKey: ik,
        key: at.key,
        library: at.library,
        title: at.title,
        contentType: at.contentType,
        linkMode: at.linkMode,
        path: at.path,
        exists: at.exists,
        tags: [...at.tags].sort(),
        dateAdded: PartialDate.parse(at.dateAdded),
        dateModified: PartialDate.parse(at.dateModified),
        item: () => items.get(parentKey),
        annotations: () =>
          [...annotations.values()].filter(
            (a) => a.attachment === attachments.get(ik),
          ),
      }),
    );
  }
  for (const an of data.ANNOTATIONS) {
    const ik = indexedKey(an.key, an.library),
      attKey = indexedKey(an.attachment, an.library);
    annotations.set(
      ik,
      rec("annotation", {
        indexedKey: ik,
        key: an.key,
        library: an.library,
        type: an.type,
        text: an.text,
        comment: an.comment,
        color: an.color,
        colorName: COLOR_NAMES[an.color] ?? null,
        pageLabel: an.pageLabel,
        pageIndex: an.pageIndex,
        tags: [...an.tags].sort(),
        sortIndex: an.sortIndex,
        dateAdded: PartialDate.parse(an.dateAdded),
        dateModified: PartialDate.parse(an.dateModified),
        hasExcerptImage: an.type === "image" || an.type === "ink",
        position:
          an.pageIndex == null
            ? { kind: "epub-cfi", value: "epubcfi(/6/14!/4/2/2)" }
            : {
                kind: an.type === "ink" ? "pdf-ink" : "pdf-rects",
                pageIndex: an.pageIndex,
                rects: [
                  [72, 500 - an.pageIndex * 7, 300, 512 - an.pageIndex * 7],
                ],
              },
        attachment: () => attachments.get(attKey),
        item: () => attachments.get(attKey).item,
      }),
    );
  }
  return { items, attachments, annotations };
}

// ---------- datasets ----------
const ITEM_SCALARS = [
  "itemType",
  "title",
  "citationKey",
  "publicationTitle",
  "publisher",
  "proceedingsTitle",
  "university",
  "abstractNote",
  "key",
  "indexedKey",
  "library",
];
export const DATASETS = {
  items: {
    name: "items",
    label: "Item",
    root: "items",
    fields: [
      ...ITEM_SCALARS,
      "date",
      "dateAdded",
      "dateModified",
      "creators",
      "tags",
      "collections",
      "custom",
      "attachments",
      "annotations",
    ],
    relations: { attachments: "attachments", annotations: "annotations" },
    defaultFields: ["itemType", "title", "creators", "date", "dateModified"],
    defaultSort: "-dateModified",
    sortable: [...ITEM_SCALARS, "date", "dateAdded", "dateModified"],
    summary: ["indexedKey", "title", "citationKey"],
    searchText: (r) =>
      [
        r.title,
        r.abstractNote,
        ...r.creators.map((c) => c.fullName),
        r.publicationTitle ?? "",
      ].join(" "),
  },
  attachments: {
    name: "attachments",
    label: "Attachment",
    root: "attachments",
    fields: [
      "indexedKey",
      "key",
      "library",
      "title",
      "contentType",
      "linkMode",
      "path",
      "exists",
      "tags",
      "dateAdded",
      "dateModified",
      "item",
      "annotations",
    ],
    relations: { item: "items", annotations: "annotations" },
    defaultFields: [
      "title",
      "contentType",
      "linkMode",
      "path",
      "exists",
      "item.title",
    ],
    defaultSort: "-dateModified",
    sortable: [
      "title",
      "contentType",
      "linkMode",
      "path",
      "exists",
      "dateAdded",
      "dateModified",
      "item.title",
      "item.date",
      "item.dateModified",
    ],
    summary: ["indexedKey", "title", "contentType", "path", "exists"],
    searchText: (r) => [r.title, r.path ?? "", r.item.title].join(" "),
  },
  annotations: {
    name: "annotations",
    label: "Annotation",
    root: "annotations",
    fields: [
      "indexedKey",
      "key",
      "library",
      "type",
      "text",
      "comment",
      "color",
      "colorName",
      "pageLabel",
      "pageIndex",
      "tags",
      "sortIndex",
      "dateAdded",
      "dateModified",
      "hasExcerptImage",
      "position",
      "attachment",
      "item",
    ],
    relations: { attachment: "attachments", item: "items" },
    defaultFields: [
      "type",
      "text",
      "comment",
      "colorName",
      "pageLabel",
      "pageIndex",
      "tags",
      "hasExcerptImage",
      "item.title",
      "item.citationKey",
    ],
    defaultSort: "-item.dateModified,attachment.indexedKey,sortIndex",
    sortable: [
      "type",
      "color",
      "colorName",
      "pageIndex",
      "sortIndex",
      "dateAdded",
      "dateModified",
      "item.title",
      "item.date",
      "item.dateModified",
      "attachment.indexedKey",
      "attachment.title",
    ],
    summary: ["indexedKey", "type", "text", "pageLabel"],
    searchText: (r) => [r.text, r.comment, r.item.title].join(" "),
  },
};

// ---------- expression language (Bases-like) ----------
const PUNCT = [
  "&&",
  "||",
  "==",
  "!=",
  "<=",
  ">=",
  "<",
  ">",
  "(",
  ")",
  "[",
  "]",
  ",",
  ".",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
];
export function tokenize(src) {
  const out = [];
  let i = 0;
  const prevAllowsRegex = () => {
    const p = out.at(-1);
    return !p || (p.kind === "punct" && ![")", "]"].includes(p.text));
  };
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const m = /^\d+(\.\d+)?/.exec(src.slice(i));
      out.push({ kind: "number", value: +m[0], from: i, to: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1,
        s = "";
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\") {
          j++;
          s += src[j] ?? "";
        } else s += src[j];
        j++;
      }
      if (j >= src.length)
        throw syntaxFault(src, i, `unclosed ${ch}`, ["closing quote"]);
      out.push({ kind: "string", value: s, from: i, to: j + 1 });
      i = j + 1;
      continue;
    }
    if (ch === "/" && prevAllowsRegex()) {
      let j = i + 1,
        s = "";
      while (j < src.length && src[j] !== "/") {
        if (src[j] === "\\") {
          s += src[j] + (src[j + 1] ?? "");
          j += 2;
          continue;
        }
        s += src[j];
        j++;
      }
      if (j >= src.length)
        throw syntaxFault(src, i, "unclosed /", ["closing /"]);
      j++;
      let flags = "";
      while (j < src.length && /[a-z]/.test(src[j])) flags += src[j++];
      out.push({ kind: "regexp", value: new RegExp(s, flags), from: i, to: j });
      i = j;
      continue;
    }
    if (/[A-Za-z_一-鿿]/.test(ch)) {
      const m = /^[A-Za-z_一-鿿][A-Za-z0-9_一-鿿]*/.exec(src.slice(i));
      out.push({ kind: "ident", value: m[0], from: i, to: i + m[0].length });
      i += m[0].length;
      continue;
    }
    const p = PUNCT.find((p) => src.startsWith(p, i));
    if (!p)
      throw syntaxFault(src, i, `unexpected ${JSON.stringify(ch)}`, [
        "an operator",
        "a name",
        "a value",
      ]);
    out.push({ kind: "punct", text: p, from: i, to: i + p.length });
    i += p.length;
  }
  return out;
}
function syntaxFault(src, at, found, expected) {
  const e = new Error("syntax");
  e.fault = { code: "syntax-error", at, found, expected, src };
  return e;
}

export function parseExpression(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i],
    at = (t) => peek()?.kind === "punct" && peek().text === t;
  const eat = (t) => {
    if (!at(t))
      throw syntaxFault(
        src,
        peek()?.from ?? src.length,
        peek()
          ? JSON.stringify(peek().text ?? peek().value)
          : "end of expression",
        [t],
      );
    return toks[i++];
  };
  const node = (n, from, to) => Object.assign(n, { from, to });
  function or() {
    let l = and();
    while (at("||")) {
      eat("||");
      const r = and();
      l = node({ t: "or", l, r }, l.from, r.to);
    }
    return l;
  }
  function and() {
    let l = eq();
    while (at("&&")) {
      eat("&&");
      const r = eq();
      l = node({ t: "and", l, r }, l.from, r.to);
    }
    return l;
  }
  function eq() {
    let l = cmp();
    while (at("==") || at("!=")) {
      const op = toks[i++].text;
      const r = cmp();
      l = node({ t: "bin", op, l, r }, l.from, r.to);
    }
    return l;
  }
  function cmp() {
    let l = add();
    while (at("<") || at("<=") || at(">") || at(">=")) {
      const op = toks[i++].text;
      const r = add();
      l = node({ t: "bin", op, l, r }, l.from, r.to);
    }
    return l;
  }
  function add() {
    let l = mul();
    while (at("+") || at("-")) {
      const op = toks[i++].text;
      const r = mul();
      l = node({ t: "bin", op, l, r }, l.from, r.to);
    }
    return l;
  }
  function mul() {
    let l = unary();
    while (at("*") || at("/") || at("%")) {
      const op = toks[i++].text;
      const r = unary();
      l = node({ t: "bin", op, l, r }, l.from, r.to);
    }
    return l;
  }
  function unary() {
    if (at("!")) {
      const s = eat("!");
      const e = unary();
      return node({ t: "not", e }, s.from, e.to);
    }
    if (at("-")) {
      const s = eat("-");
      const e = unary();
      return node({ t: "neg", e }, s.from, e.to);
    }
    return postfix();
  }
  function args() {
    eat("(");
    const a = [];
    if (!at(")")) {
      a.push(or());
      while (at(",")) {
        eat(",");
        a.push(or());
      }
    }
    const c = eat(")");
    return { a, to: c.to };
  }
  function postfix() {
    let e = primary();
    for (;;) {
      if (at(".")) {
        eat(".");
        const n = peek();
        if (n?.kind !== "ident")
          throw syntaxFault(
            src,
            n?.from ?? src.length,
            n ? JSON.stringify(n.text ?? n.value) : "end of expression",
            ["a name"],
          );
        i++;
        if (at("(")) {
          const { a, to } = args();
          e = node(
            {
              t: "call",
              on: e,
              name: n.value,
              args: a,
              nameFrom: n.from,
              nameTo: n.to,
            },
            e.from,
            to,
          );
        } else
          e = node(
            {
              t: "member",
              on: e,
              name: n.value,
              nameFrom: n.from,
              nameTo: n.to,
            },
            e.from,
            n.to,
          );
        continue;
      }
      if (at("[")) {
        eat("[");
        const idx = or();
        const c = eat("]");
        e = node({ t: "index", on: e, idx }, e.from, c.to);
        continue;
      }
      break;
    }
    return e;
  }
  function primary() {
    const t = peek();
    if (!t)
      throw syntaxFault(src, src.length, "end of expression", ["a value"]);
    if (t.kind === "number" || t.kind === "string" || t.kind === "regexp") {
      i++;
      return node({ t: "lit", v: t.value }, t.from, t.to);
    }
    if (t.kind === "ident") {
      i++;
      if (t.value === "true" || t.value === "false")
        return node({ t: "lit", v: t.value === "true" }, t.from, t.to);
      if (t.value === "null") return node({ t: "lit", v: null }, t.from, t.to);
      if (at("(")) {
        const { a, to } = args();
        return node({ t: "fn", name: t.value, args: a }, t.from, to);
      }
      return node({ t: "id", name: t.value }, t.from, t.to);
    }
    if (at("(")) {
      eat("(");
      const e = or();
      const c = eat(")");
      return node({ t: "group", e }, t.from, c.to);
    }
    if (at("[")) {
      eat("[");
      const xs = [];
      if (!at("]")) {
        xs.push(or());
        while (at(",")) {
          eat(",");
          xs.push(or());
        }
      }
      const c = eat("]");
      return node({ t: "list", xs }, t.from, c.to);
    }
    throw syntaxFault(src, t.from, JSON.stringify(t.text ?? t.value), [
      "a value",
    ]);
  }
  const e = or();
  if (i < toks.length)
    throw syntaxFault(
      src,
      toks[i].from,
      JSON.stringify(toks[i].text ?? toks[i].value),
      ["end of expression", "an operator"],
    );
  return e;
}

const GLOBAL_FNS = new Set([
  "if",
  "number",
  "min",
  "max",
  "now",
  "today",
  "date",
  "duration",
  "list",
]);
const LAMBDA_SCOPE = new Set(["value", "index", "acc"]);
const LIST_FIELDS = new Set([
  "tags",
  "collections",
  "creators",
  "attachments",
  "annotations",
]);
/** Static check: every bare name resolves to a field of the dataset (or lambda scope). Returns Query Warnings. */
export function validateExpression(ast, dataset, src) {
  const faults = [],
    warnings = [];
  const walk = (n, inLambda) => {
    if (!n || typeof n !== "object") return;
    if (n.t === "id") {
      if (
        !(
          dataset.fields.includes(n.name) ||
          (inLambda && LAMBDA_SCOPE.has(n.name)) ||
          n.name === "custom"
        )
      )
        faults.push({
          code: "unknown-field",
          from: n.from,
          to: n.to,
          found: n.name,
          candidates: dataset.fields,
        });
      return;
    }
    if (n.t === "fn") {
      if (!GLOBAL_FNS.has(n.name))
        faults.push({
          code: "unknown-function",
          from: n.from,
          to: n.from + n.name.length,
          found: n.name,
          candidates: [...GLOBAL_FNS],
        });
      n.args.forEach((a) => walk(a, inLambda));
      return;
    }
    if (n.t === "call") {
      walk(n.on, inLambda);
      const lam = ["filter", "map", "reduce", "any"].includes(n.name);
      n.args.forEach((a) => walk(a, inLambda || lam));
      return;
    }
    if (n.t === "bin" && (n.op === "==" || n.op === "!=")) {
      const listSide = [n.l, n.r].find(
        (x) =>
          x.t === "id" &&
          LIST_FIELDS.has(x.name) &&
          dataset.fields.includes(x.name),
      );
      const other = listSide === n.l ? n.r : n.l;
      if (listSide && other.t === "lit" && typeof other.v === "string")
        warnings.push({
          code: "never-equal",
          severity: "warning",
          message: `'${listSide.name}' is a list and never equals the text ${JSON.stringify(other.v)}; this comparison is ${n.op === "==" ? "never" : "always"} true.`,
          hint: `Use ${listSide.name}.contains(${JSON.stringify(other.v)}) to test membership.`,
          location: { argument: "filter", span: { from: n.from, to: n.to } },
          excerpt: {
            before: src.slice(Math.max(0, n.from - 24), n.from),
            at: src.slice(n.from, n.to),
            after: src.slice(n.to, n.to + 24),
          },
          report: [
            `'${listSide.name}' is a list and never equals a text.`,
            `  ${src.slice(n.from, n.to)}`,
            `Use ${listSide.name}.contains(${JSON.stringify(other.v)}).`,
          ],
        });
    }
    for (const k of ["l", "r", "e", "on", "idx"])
      if (n[k]) walk(n[k], inLambda);
    if (n.xs) n.xs.forEach((x) => walk(x, inLambda));
  };
  walk(ast, false);
  if (faults.length) {
    const f = faults[0];
    const e = new Error(f.code);
    e.fault = { ...f, src, at: f.from };
    throw e;
  }
  return warnings;
}

// value helpers
const isDate = (v) => v instanceof PartialDate,
  isList = Array.isArray,
  isRec = (v) => v && typeof v === "object" && v.__type;
const truthy = (v) =>
  v !== null &&
  v !== undefined &&
  v !== false &&
  v !== 0 &&
  v !== "" &&
  !(isList(v) && v.length === 0);
const typeOf = (v) =>
  v == null
    ? "null"
    : isDate(v)
      ? "date"
      : v instanceof Duration
        ? "duration"
        : v instanceof RegExp
          ? "regexp"
          : isList(v)
            ? "list"
            : isRec(v)
              ? "object"
              : typeof v === "object"
                ? "object"
                : typeof v;
const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "variant",
});
export function compareValues(a, b) {
  if (a == null || b == null) return null;
  if (isRec(a) && a.__type === "creator") a = a.fullName;
  if (isRec(b) && b.__type === "creator") b = b.fullName;
  const ta = typeOf(a),
    tb = typeOf(b);
  if (ta !== tb) return null;
  if (ta === "number") return a === b ? 0 : a < b ? -1 : 1;
  if (ta === "string") return collator.compare(a, b);
  if (ta === "boolean") return a === b ? 0 : a ? 1 : -1;
  if (ta === "date") {
    const p = Math.min(a.precision, b.precision);
    const key = (d) =>
      p === 1
        ? [d.year]
        : p === 2
          ? [d.year, d.month]
          : [d.year, d.month, d.day];
    const ka = key(a),
      kb = key(b);
    if (a.instant != null && b.instant != null)
      return a.instant === b.instant ? 0 : a.instant < b.instant ? -1 : 1;
    for (let i = 0; i < ka.length; i++)
      if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  }
  if (ta === "duration") return a.ms === b.ms ? 0 : a.ms < b.ms ? -1 : 1;
  return null;
}
const equals = (a, b) => {
  if (a == null && b == null) return null;
  if (a == null || b == null) return false;
  if (isList(a) && isList(b))
    return a.length === b.length && a.every((x, i) => equals(x, b[i]) === true);
  const c = compareValues(a, b);
  return c === null ? false : c === 0;
};
const asText = (v) =>
  v == null
    ? null
    : isRec(v) && v.__type === "creator"
      ? v.fullName
      : isDate(v)
        ? v.toJSON()
        : typeof v === "object" && !isList(v)
          ? JSON.stringify(v)
          : String(v);

export function evaluate(ast, row, clock, scope = null) {
  const ev = (n, sc = scope) => evaluate(n, row, clock, sc);
  switch (ast.t) {
    case "lit":
      return ast.v;
    case "group":
      return ev(ast.e);
    case "list":
      return ast.xs.map((x) => ev(x));
    case "id": {
      if (scope && ast.name in scope) return scope[ast.name];
      const v = row[ast.name];
      return v === undefined ? null : v;
    }
    case "not":
      return !truthy(ev(ast.e));
    case "neg": {
      const v = ev(ast.e);
      return typeof v === "number" ? -v : null;
    }
    case "and":
      return truthy(ev(ast.l)) ? ev(ast.r) : false;
    case "or": {
      const l = ev(ast.l);
      return truthy(l) ? l : ev(ast.r);
    }
    case "bin": {
      const l = ev(ast.l),
        r = ev(ast.r);
      switch (ast.op) {
        case "==":
          return equals(l, r) === true;
        case "!=":
          return equals(l, r) !== true && !(l == null && r == null)
            ? true
            : l == null && r == null
              ? false
              : false;
        case "<":
        case "<=":
        case ">":
        case ">=": {
          const c = compareValues(l, r);
          if (c === null) return null;
          return ast.op === "<"
            ? c < 0
            : ast.op === "<="
              ? c <= 0
              : ast.op === ">"
                ? c > 0
                : c >= 0;
        }
        case "+":
          if (typeof l === "number" && typeof r === "number") return l + r;
          if (typeof l === "string" || typeof r === "string")
            return (asText(l) ?? "") + (asText(r) ?? "");
          if (isDate(l) && r instanceof Duration)
            return instantDate(l.startMs() + r.ms);
          if (isList(l) && isList(r)) return [...l, ...r];
          return null;
        case "-":
          if (typeof l === "number" && typeof r === "number") return l - r;
          if (isDate(l) && r instanceof Duration)
            return instantDate(l.startMs() - r.ms);
          if (isDate(l) && isDate(r))
            return new Duration(l.startMs() - r.startMs());
          return null;
        case "*":
          return typeof l === "number" && typeof r === "number" ? l * r : null;
        case "/":
          return typeof l === "number" && typeof r === "number" && r !== 0
            ? l / r
            : null;
        case "%":
          return typeof l === "number" && typeof r === "number" && r !== 0
            ? l % r
            : null;
      }
      return null;
    }
    case "member": {
      const on = ev(ast.on);
      return member(on, ast.name);
    }
    case "index": {
      const on = ev(ast.on),
        idx = ev(ast.idx);
      if (isList(on) && typeof idx === "number") return on.at(idx) ?? null;
      if (
        on &&
        typeof on === "object" &&
        !isList(on) &&
        typeof idx === "string"
      )
        return on[idx] ?? null;
      return null;
    }
    case "fn": {
      const a = ast.args;
      switch (ast.name) {
        case "if": {
          const c = ev(a[0]);
          return truthy(c) ? ev(a[1]) : a[2] ? ev(a[2]) : null;
        }
        case "number": {
          const v = ev(a[0]);
          const n =
            typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
          return Number.isNaN(n) ? null : n;
        }
        case "min":
        case "max": {
          const xs = a.map((x) => ev(x)).filter((x) => typeof x === "number");
          return xs.length ? Math[ast.name](...xs) : null;
        }
        case "now":
          return instantDate(clock.now);
        case "today": {
          const d = new Date(clock.now);
          return new PartialDate(
            d.getUTCFullYear(),
            d.getUTCMonth() + 1,
            d.getUTCDate(),
          );
        }
        case "date": {
          const v = ev(a[0]);
          return typeof v === "string"
            ? PartialDate.parse(v)
            : isDate(v)
              ? v
              : null;
        }
        case "duration": {
          const v = ev(a[0]);
          const m =
            typeof v === "string" &&
            /^(\d+)\s*(day|days|d|week|weeks|w|hour|hours|h|month|months|year|years|y)$/.exec(
              v.trim(),
            );
          if (!m) return null;
          const n = +m[1];
          const u = m[2][0];
          return new Duration(
            n *
              (u === "d"
                ? 864e5
                : u === "w"
                  ? 7 * 864e5
                  : u === "h"
                    ? 36e5
                    : u === "m"
                      ? 30 * 864e5
                      : 365 * 864e5),
          );
        }
        case "list": {
          const v = ev(a[0]);
          return v == null ? [] : isList(v) ? v : [v];
        }
      }
      return null;
    }
    case "call": {
      const on = ev(ast.on);
      const lam = (arg, value, index, acc) =>
        evaluate(arg, row, clock, { ...scope, value, index, acc });
      const args = ["filter", "map", "reduce"].includes(ast.name)
        ? []
        : ast.args.map((x) => ev(x));
      return method(on, ast.name, args, ast.args, lam, clock);
    }
  }
  return null;
}
function instantDate(ms) {
  const d = new Date(ms);
  return new PartialDate(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    ms,
  );
}
function member(on, name) {
  if (on == null) return null;
  if (isDate(on)) {
    if (name === "year") return on.year;
    if (name === "month") return on.month;
    if (name === "day") return on.day;
    return null;
  }
  if (typeof on === "string") return name === "length" ? on.length : null;
  if (isList(on)) return name === "length" ? on.length : null;
  if (typeof on === "object") {
    const v = on[name];
    return v === undefined ? null : v;
  }
  return null;
}
function method(on, name, args, rawArgs, lam, clock) {
  const ty = typeOf(on);
  if (name === "isTruthy") return truthy(on);
  if (name === "isType") return ty === args[0];
  if (name === "toString") return asText(on);
  if (name === "isEmpty")
    return on == null || on === "" || (isList(on) && on.length === 0);
  if (on == null) return null;
  if (ty === "string") {
    const a0 = args[0];
    switch (name) {
      case "contains":
        return typeof a0 === "string" ? on.includes(a0) : null;
      case "containsAny":
        return args.some((x) => typeof x === "string" && on.includes(x));
      case "containsAll":
        return args.every((x) => typeof x === "string" && on.includes(x));
      case "startsWith":
        return typeof a0 === "string" ? on.startsWith(a0) : null;
      case "endsWith":
        return typeof a0 === "string" ? on.endsWith(a0) : null;
      case "lower":
        return on.toLowerCase();
      case "upper":
        return on.toUpperCase();
      case "trim":
        return on.trim();
      case "title":
        return on.replaceAll(/\b\w/g, (c) => c.toUpperCase());
      case "slice":
        return on.slice(a0, args[1]);
      case "repeat":
        return on.repeat(a0);
      case "reverse":
        return [...on].reverse().join("");
      case "split":
        return on.split(a0, args[1]);
      case "replace":
        return on.replace(a0, args[1]);
      case "matches":
        return null;
    }
    return null;
  }
  if (ty === "regexp") {
    if (name === "matches")
      return typeof args[0] === "string" ? on.test(args[0]) : null;
    return null;
  }
  if (ty === "number") {
    switch (name) {
      case "round":
        return Number(on.toFixed(args[0] ?? 0));
      case "toFixed":
        return on.toFixed(args[0] ?? 0);
      case "abs":
        return Math.abs(on);
      case "floor":
        return Math.floor(on);
      case "ceil":
        return Math.ceil(on);
    }
    return null;
  }
  if (ty === "date") {
    switch (name) {
      case "date":
        return new PartialDate(on.year, on.month, on.day);
      case "format":
        return on.toJSON();
      case "relative":
        return `${Math.round((clock.now - on.startMs()) / 864e5)} days ago`;
      case "time":
        return on.instant != null
          ? new Date(on.instant).toISOString().slice(11, 19)
          : null;
    }
    return null;
  }
  if (ty === "list") {
    switch (name) {
      case "contains":
        return on.some((x) => equals(x, args[0]) === true);
      case "containsAny":
        return args.some((a) => on.some((x) => equals(x, a) === true));
      case "containsAll":
        return args.every((a) => on.some((x) => equals(x, a) === true));
      case "within":
        return (
          typeof args[0] === "string" &&
          on.some(
            (x) =>
              typeof x === "string" &&
              (x === args[0] || x.startsWith(`${args[0]  }/`)),
          )
        );
      case "filter":
        return on.filter((v, i) => truthy(lam(rawArgs[0], v, i, null)));
      case "map":
        return on.map((v, i) => lam(rawArgs[0], v, i, null));
      case "reduce": {
        let acc = rawArgs[1] ? lam(rawArgs[1], null, 0, null) : null;
        on.forEach((v, i) => {
          acc = lam(rawArgs[0], v, i, acc);
        });
        return acc;
      }
      case "sort":
        return [...on].sort((a, b) => {
          if (a == null) return 1;
          if (b == null) return -1;
          return compareValues(a, b) ?? 0;
        });
      case "unique": {
        const out = [];
        for (const x of on)
          if (!out.some((y) => equals(x, y) === true)) out.push(x);
        return out;
      }
      case "reverse":
        return [...on].reverse();
      case "slice":
        return on.slice(args[0], args[1]);
      case "flat":
        return on.flat();
      case "join":
        return on.map((x) => asText(x) ?? "").join(args[0] ?? ",");
      case "any":
        return on.some((v, i) => truthy(lam(rawArgs[0], v, i, null)));
    }
    return null;
  }
  if (ty === "object") {
    if (name === "keys") return Object.keys(on).filter((k) => k !== "__type");
    if (name === "values")
      return Object.keys(on)
        .filter((k) => k !== "__type")
        .map((k) => on[k]);
    return null;
  }
  return null;
}

// ---------- projection paths ----------
/** `a.b[0].c`, `a[].b`, `custom["x.y"]` → segments */
export function parsePath(text) {
  const segs = [];
  let i = 0;
  const s = text.trim();
  const ident = () => {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (!m) throw pathFault(text, i, "a name");
    i += m[0].length;
    return m[0];
  };
  segs.push({ kind: "name", name: ident() });
  while (i < s.length) {
    if (s[i] === ".") {
      i++;
      segs.push({ kind: "name", name: ident() });
      continue;
    }
    if (s[i] === "[") {
      if (s[i + 1] === "]") {
        i += 2;
        segs.push({ kind: "each" });
        continue;
      }
      const m = /^\[(\d+)\]/.exec(s.slice(i));
      if (m) {
        i += m[0].length;
        segs.push({ kind: "index", index: +m[1] });
        continue;
      }
      const q = /^\["((?:[^"\\]|\\.)*)"\]/.exec(s.slice(i));
      if (q) {
        i += q[0].length;
        segs.push({ kind: "key", key: JSON.parse(`"${q[1]}"`) });
        continue;
      }
      throw pathFault(text, i, '[n], [] or ["name"]');
    }
    throw pathFault(text, i, ". or [");
  }
  return segs;
}
function pathFault(text, at, expected) {
  const e = new Error("bad path");
  e.fault = {
    code: "invalid-path",
    src: text,
    at,
    found: text[at] ?? "end",
    expected: [expected],
  };
  return e;
}
export function readPath(row, segs) {
  let v = row;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (v == null) return null;
    if (s.kind === "each") {
      if (!isList(v)) return null;
      const rest = segs.slice(i + 1);
      return v.map((x) => readPath(x, rest));
    }
    if (s.kind === "index") {
      v = isList(v) ? (v.at(s.index) ?? null) : null;
      continue;
    }
    const key = s.kind === "key" ? s.key : s.name;
    if (isList(v)) return null;
    v = member(v, key);
  }
  return v;
}
/** Serialize a value for the wire: dates → ISO, records → summary objects. */
export function toWire(v, depth = 0) {
  if (v == null) return null;
  if (isDate(v) || v instanceof Duration) return v.toJSON();
  if (v instanceof RegExp) return String(v);
  if (isList(v)) return v.map((x) => toWire(x, depth + 1));
  if (isRec(v)) {
    if (v.__type === "creator")
      return {
        family: v.family,
        given: v.given,
        role: v.role,
        fullName: v.fullName,
      };
    const ds =
      DATASETS[
        v.__type === "item"
          ? "items"
          : v.__type === "attachment"
            ? "attachments"
            : "annotations"
      ];
    const out = {};
    for (const f of ds.summary) out[f] = toWire(v[f], depth + 1);
    return out;
  }
  if (typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = toWire(x, depth + 1);
    return out;
  }
  return v;
}

// ---------- argument decoding ----------
/** Split a comma list, keeping commas inside quotes/brackets. */
export function splitList(text) {
  const out = [];
  let cur = "",
    depth = 0,
    q = null;
  for (const ch of text) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "" || out.length) out.push(cur.trim());
  return out.filter((x) => x !== "");
}
export function parseFields(text) {
  if (text == null) return null;
  if (text.trim().startsWith("[")) {
    const arr = JSON.parse(text);
    return arr;
  }
  return splitList(text);
}
export function parseSort(text) {
  if (text == null) return null;
  if (text.trim().startsWith("["))
    return JSON.parse(text).map((s) => ({
      field: s.field,
      direction: s.direction ?? "asc",
    }));
  return splitList(text).map((s) =>
    s.startsWith("-")
      ? { field: s.slice(1), direction: "desc" }
      : s.startsWith("+")
        ? { field: s.slice(1), direction: "asc" }
        : { field: s, direction: "asc" },
  );
}
/** Shell-like split of `obsidian vault=x zotlit:query k='v v' k2="v"` */
export function parseCommandLine(line) {
  const toks = [];
  let cur = "",
    q = null,
    has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === q) {
        q = null;
        continue;
      }
      if (
        ch === "\\" &&
        q === '"' &&
        (line[i + 1] === '"' || line[i + 1] === "\\")
      ) {
        cur += line[++i];
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur !== "" || has) {
        toks.push(cur);
        cur = "";
        has = false;
      }
      continue;
    }
    if (ch === "\\" && line[i + 1]) {
      cur += line[++i];
      continue;
    }
    cur += ch;
  }
  if (q) {
    const e = new Error("unclosed quote");
    e.fault = { code: "shell-quote", found: `unclosed ${q}` };
    throw e;
  }
  if (cur !== "" || has) toks.push(cur);
  const words = toks.filter((t) => t !== "obsidian");
  let command = null;
  const args = {};
  for (const w of words) {
    const m = /^([A-Za-z_][\w-]*)=([\s\S]*)$/.exec(w);
    if (m) {
      if (m[1] === "vault") continue;
      args[m[1]] = m[2];
    } else if (command === null) command = w;
    else {
      const e = new Error("stray");
      e.fault = {
        code: "invalid-argument",
        found: w,
        expected: ["name=value"],
      };
      throw e;
    }
  }
  return { command, args };
}

// ---------- diagnostics ----------
function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[m][n];
}
function nearMatches(name, candidates) {
  return candidates
    .map((c) => [c, levenshtein(name.toLowerCase(), c.toLowerCase())])
    .filter(([, d]) => d <= Math.max(2, Math.floor(name.length / 3)))
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([c]) => c);
}
function renderDiagnostic(argument, fault, hintOverride) {
  const d = {
    code: fault.code,
    severity: "error",
    message: "",
    hint: "",
    location: { argument },
    excerpt: null,
    found: fault.found ?? "",
    expected: fault.expected ?? [],
    suggestions: [],
    report: [],
  };
  const src = fault.src ?? "";
  if (fault.at != null && src) {
    const at = Math.min(fault.at, src.length);
    const to =
      fault.to ??
      Math.min(src.length, at + Math.max(1, String(fault.found ?? "").length));
    d.excerpt = {
      before: src.slice(Math.max(0, at - 24), at),
      at: src.slice(at, to),
      after: src.slice(to, to + 24),
    };
    d.location.span = { from: at, to };
  }
  switch (fault.code) {
    case "unknown-field":
      d.suggestions = nearMatches(fault.found, fault.candidates);
      d.message = `Unknown field '${fault.found}' in ${argument}.`;
      d.hint = d.suggestions.length
        ? `Did you mean ${d.suggestions.map((s) => `'${s}'`).join(", ")}? Run zotlit:query-schema from=<dataset> for every field.`
        : "Run zotlit:query-schema from=<dataset> for every field of this dataset.";
      break;
    case "unknown-function":
      d.suggestions = nearMatches(fault.found, fault.candidates);
      d.message = `Unknown function '${fault.found}'.`;
      d.hint = `Use one of ${fault.candidates.join(", ")}.`;
      break;
    case "syntax-error":
      d.message = `Syntax error in ${argument}: found ${fault.found}, expected ${fault.expected.join(" or ")}.`;
      d.hint =
        "Correct the expression at the marked place, then run the query again.";
      break;
    case "invalid-path":
      d.message = `Invalid Projection Path '${src}': expected ${fault.expected[0]} at position ${fault.at}.`;
      d.hint =
        'Write a path as name, name.name, name[0], name[] or custom["exact name"].';
      break;
    default:
      d.message = fault.message ?? fault.code;
      d.hint =
        hintOverride ??
        fault.hint ??
        "Correct the argument and run the command again.";
  }
  if (hintOverride) d.hint = hintOverride;
  d.report = [d.message];
  if (d.excerpt) {
    const line = `${d.excerpt.before}${d.excerpt.at}${d.excerpt.after}`;
    d.report.push(
      `  ${line}`,
      `  ${" ".repeat(d.excerpt.before.length)}${"^".repeat(Math.max(1, d.excerpt.at.length))}`,
    );
  }
  if (d.suggestions.length)
    d.report.push(`Suggestions: ${d.suggestions.join(", ")}`);
  d.report.push(d.hint);
  return d;
}
const err = (code, message, hint, extra = {}) => {
  const e = new Error(message);
  e.fault = { code, message, hint, ...extra };
  return e;
};

// ---------- the engine ----------
export function createEngine(data, options = {}) {
  const records = buildRecords(data);
  const clock = { now: options.now ?? Date.parse("2025-10-10T09:00:00Z") };
  const libraryScope =
    options.libraryScope ?? data.LIBRARIES.map((l) => l.selector);
  const CONTRACT = 3;

  function resolveLibraries(text) {
    if (text == null) return [...libraryScope];
    if (text === "all") return data.LIBRARIES.map((l) => l.selector);
    const sels = text.trim().startsWith("[")
      ? JSON.parse(text)
      : splitList(text);
    for (const s of sels)
      if (!data.LIBRARIES.some((l) => l.selector === s))
        throw err(
          "library-not-found",
          `No Library '${s}' in the connected Zotero source.`,
          "Use personal, or group:<groupID> of a group Library the source holds; library=all reads every Library.",
          { parameter: "library" },
        );
    return data.LIBRARIES.map((l) => l.selector).filter((s) =>
      sels.includes(s),
    );
  }
  const libraryWire = (sel) => {
    const l = data.LIBRARIES.find((x) => x.selector === sel);
    return l.type === "personal"
      ? { type: "personal" }
      : { type: "group", groupID: l.groupID, name: l.name };
  };

  /** Normalized request → result. Shared by both CLI shapes. */
  function execute(req) {
    const ds = DATASETS[req.from];
    if (!ds)
      throw err(
        "invalid-argument",
        `Unknown dataset '${req.from}'.`,
        "Use from=items, from=attachments, or from=annotations.",
        { parameter: "from" },
      );
    const libraries = resolveLibraries(req.library);
    let rows = [...records[ds.root].values()].filter((r) =>
      libraries.includes(r.library),
    );
    // restrictions of the OLD shape (so the prototype shows what the current contract can and cannot say):
    // contract 2 exposes `attachments` on an Item as a boolean, not a list.
    const restricted = req.restrict ?? null;
    if (restricted?.booleanAttachments)
      rows = rows.map(
        (r) =>
          new Proxy(r, {
            get: (t, k) =>
              k === "attachments" ? t.attachments.length > 0 : t[k],
          }),
      );
    let ast = null;
    const warnings = [];
    if (req.filter != null) {
      if (req.filter.trim() === "")
        throw err(
          "invalid-argument",
          "filter is empty.",
          "Omit filter to match every row, or give an expression.",
          { parameter: "filter" },
        );
      ast = parseExpression(req.filter);
      const dsView = restricted
        ? {
            ...ds,
            fields: ds.fields.filter(
              (f) => !restricted.hiddenFields.includes(f),
            ),
          }
        : ds;
      warnings.push(...validateExpression(ast, dsView, req.filter));
    }
    if (ast) rows = rows.filter((r) => truthy(evaluate(ast, r, clock)));
    // search (ranked) — a stand-in for the MiniSearch engine of item-lookup
    let scores = null;
    if (req.search) {
      const terms = req.search.toLowerCase().split(/\s+/).filter(Boolean);
      scores = new Map();
      rows = rows.filter((r) => {
        const t = ds.searchText(r).toLowerCase();
        const hits = terms.filter((x) => t.includes(x)).length;
        if (hits === 0) return false;
        scores.set(r, hits + (t.includes(req.search.toLowerCase()) ? 1 : 0));
        return true;
      });
    }
    // sort
    const sortSpec = req.sort ?? (scores ? [] : parseSort(ds.defaultSort));
    for (const s of sortSpec) {
      if (!ds.sortable.includes(s.field))
        throw err(
          "unsortable-field",
          `'${s.field}' is not a Sortable Field of ${ds.name}.`,
          `Sort by one of: ${ds.sortable.join(", ")}.`,
          { parameter: "sort" },
        );
      if (!["asc", "desc"].includes(s.direction))
        throw err(
          "invalid-argument",
          `direction '${s.direction}' is not asc or desc.`,
          "Write sort=-field for descending, sort=field for ascending.",
          { parameter: "sort" },
        );
    }
    const sortSegs = sortSpec.map((s) => ({ ...s, segs: parsePath(s.field) }));
    const sortKeyOf = (r, segs) => {
      let v = readPath(r, segs);
      if (isDate(v)) v = v.startMs();
      return v;
    };
    rows.sort((a, b) => {
      if (scores) {
        const d = scores.get(b) - scores.get(a);
        if (d) return d;
      }
      for (const s of sortSegs) {
        const va = sortKeyOf(a, s.segs),
          vb = sortKeyOf(b, s.segs);
        if (va == null && vb == null) continue;
        if (va == null) return 1;
        if (vb == null) return -1;
        const c =
          typeof va === "string"
            ? collator.compare(va, vb)
            : va < vb
              ? -1
              : va > vb
                ? 1
                : 0;
        if (c) return s.direction === "desc" ? -c : c;
      }
      return a.indexedKey < b.indexedKey
        ? -1
        : a.indexedKey > b.indexedKey
          ? 1
          : 0;
    });
    // fields
    const fields = req.fields ?? ds.defaultFields;
    const fieldSegs = fields.map((f) => {
      const segs = parsePath(f);
      const root = segs[0].name;
      if (
        !ds.fields.includes(root) ||
        (restricted && restricted.hiddenFields.includes(root))
      )
        throw Object.assign(new Error("unknown-field"), {
          fault: {
            code: "unknown-field",
            src: f,
            at: 0,
            to: root.length,
            found: root,
            candidates: ds.fields,
            argument: "fields",
          },
        });
      return { path: f, segs };
    });
    const project = (r) => {
      const values = {};
      for (const f of fieldSegs) values[f.path] = toWire(readPath(r, f.segs));
      const row = { indexedKey: r.indexedKey, values };
      if (ds.name === "annotations") {
        row.attachmentIndexedKey = r.attachment.indexedKey;
        row.itemIndexedKey = r.item.indexedKey;
      }
      if (ds.name === "attachments") row.itemIndexedKey = r.item.indexedKey;
      return row;
    };
    // limit
    const limit =
      req.limit === "all" || (req.limit == null && req.limitDefault === null)
        ? null
        : req.limit == null
          ? 100
          : req.limit;
    const normalized = {
      from: ds.name,
      library: libraries,
      ...(req.search ? { search: req.search } : {}),
      filter: req.filter ?? null,
      fields,
      sort: sortSpec,
      limit,
      ...(req.group ? { group: req.group } : {}),
    };
    // group
    if (req.group) {
      const gsegs = parsePath(req.group);
      if (!ds.fields.includes(gsegs[0].name))
        throw Object.assign(new Error("unknown-field"), {
          fault: {
            code: "unknown-field",
            src: req.group,
            at: 0,
            found: gsegs[0].name,
            candidates: ds.fields,
            argument: "group",
          },
        });
      const groups = new Map();
      for (const r of rows) {
        const v = toWire(readPath(r, gsegs));
        const k = JSON.stringify(v);
        if (!groups.has(k)) groups.set(k, { value: v, count: 0, rows: [] });
        const g = groups.get(k);
        g.count++;
        if (limit == null || g.rows.length < limit) g.rows.push(project(r));
      }
      const list = [...groups.values()].sort((a, b) => {
        if (a.value == null) return 1;
        if (b.value == null) return -1;
        return typeof a.value === "string"
          ? collator.compare(a.value, b.value)
          : a.value < b.value
            ? -1
            : a.value > b.value
              ? 1
              : 0;
      });
      return {
        normalized,
        libraries,
        warnings,
        returnedCount: list.reduce((n, g) => n + g.rows.length, 0),
        totalCount: rows.length,
        truncated: list.some((g) => g.rows.length < g.count),
        groups: list,
        fields,
      };
    }
    const truncated = limit != null && rows.length > limit;
    const out = (limit == null ? rows : rows.slice(0, limit)).map(project);
    return {
      normalized,
      libraries,
      warnings,
      returnedCount: out.length,
      truncated,
      rows: out,
      fields,
    };
  }

  // --- the NEW shape: zotlit:query ---
  const NEW_PARAMS = [
    "from",
    "filter",
    "search",
    "fields",
    "sort",
    "limit",
    "library",
    "group",
    "format",
    "output",
    "id",
  ];
  function decodeNew(args) {
    for (const k of Object.keys(args))
      if (!NEW_PARAMS.includes(k))
        throw err(
          "invalid-argument",
          `Unknown parameter '${k}'.`,
          `Parameters: ${NEW_PARAMS.join(", ")}.`,
          { parameter: k },
        );
    const limit =
      args.limit == null
        ? undefined
        : args.limit === "all"
          ? "all"
          : /^\d+$/.test(args.limit) && +args.limit > 0
            ? +args.limit
            : (() => {
                throw err(
                  "invalid-argument",
                  `limit '${args.limit}' is not a positive integer or all.`,
                  "Use limit=<n> or limit=all.",
                  { parameter: "limit" },
                );
              })();
    let fields = null;
    try {
      fields = parseFields(args.fields);
    } catch (e) {
      if (e.fault) throw e;
      throw err(
        "invalid-argument",
        `fields '${args.fields}' is not a comma list or JSON array.`,
        "Write fields=title,date.year or a JSON array.",
        { parameter: "fields" },
      );
    }
    let sort = null;
    try {
      sort = parseSort(args.sort);
    } catch (e) {
      throw err(
        "invalid-argument",
        `sort '${args.sort}' is not a comma list or JSON array.`,
        "Write sort=-dateModified,title.",
        { parameter: "sort" },
      );
    }
    return {
      from: args.from ?? "items",
      filter: args.filter,
      search: args.search,
      fields,
      sort,
      limit,
      library: args.library,
      group: args.group,
      format: args.format ?? "json",
      output: args.output,
      id: args.id,
    };
  }

  // --- the OLD shape: zotlit:item-query / zotlit:annotation-query (contract 2) ---
  const OLD_PARAMS = {
    "zotlit:item-query": [
      "filter",
      "fields",
      "sort",
      "limit",
      "library",
      "libraries",
      "output",
      "id",
    ],
    "zotlit:annotation-query": [
      "filter",
      "item",
      "attachment",
      "fields",
      "sort",
      "limit",
      "library",
      "libraries",
      "output",
      "id",
    ],
  };
  function decodeOld(command, args) {
    const allowed = OLD_PARAMS[command];
    for (const k of Object.keys(args))
      if (!allowed.includes(k))
        throw err(
          "invalid-argument",
          `Unknown parameter '${k}' for ${command}.`,
          `Parameters: ${allowed.join(", ")}.`,
          { parameter: k },
        );
    const jsonArr = (name) => {
      if (args[name] == null) return null;
      let v;
      try {
        v = JSON.parse(args[name]);
      } catch {
        throw err(
          "invalid-argument",
          `${name} is not a JSON array.`,
          `Write ${name} as a JSON array, such as ${name}='["title","date.year"]'.`,
          { parameter: name },
        );
      }
      if (!Array.isArray(v))
        throw err(
          "invalid-argument",
          `${name} is not a JSON array.`,
          `Write ${name} as a JSON array.`,
          { parameter: name },
        );
      return v;
    };
    const fields = jsonArr("fields");
    const sortRaw = jsonArr("sort");
    const sort = sortRaw
      ? sortRaw.map((s) => ({ field: s.field, direction: s.direction }))
      : null;
    const limit =
      args.limit == null
        ? undefined
        : args.limit === "all"
          ? "all"
          : /^\d+$/.test(args.limit) && +args.limit > 0
            ? +args.limit
            : (() => {
                throw err(
                  "invalid-argument",
                  `limit '${args.limit}' is not a positive integer or all.`,
                  "Use limit=<n> or limit=all.",
                  { parameter: "limit" },
                );
              })();
    let library = args.libraries ?? args.library ?? null; // libraries wins
    const from = command === "zotlit:item-query" ? "items" : "annotations";
    let filter = args.filter;
    if (from === "annotations") {
      const keyFilter = (name, path) => {
        if (args[name] == null) return null;
        const keys = args[name].trim().startsWith("[")
          ? JSON.parse(args[name])
          : [args[name]];
        if (library != null)
          throw err(
            "invalid-argument",
            `${name} selects its own Library; do not add library or libraries.`,
            `Remove library/libraries, or select by filter instead of ${name}.`,
            { parameter: name },
          );
        return keys.length === 1
          ? `${path} == ${JSON.stringify(keys[0])}`
          : `[${keys.map((k) => JSON.stringify(k)).join(", ")}].contains(${path})`;
      };
      const parts = [
        keyFilter("item", "item.indexedKey"),
        keyFilter("attachment", "attachment.indexedKey"),
        filter,
      ].filter(Boolean);
      if (parts.length) filter = parts.map((p) => `(${p})`).join(" && ");
      if (args.item != null || args.attachment != null) library = "all";
    }
    // what contract 2 cannot say: Items have no attachments LIST and no annotations; `attachments` is a boolean
    const restrict =
      from === "items"
        ? { hiddenFields: ["annotations"], booleanAttachments: true }
        : { hiddenFields: [] };
    return {
      from,
      filter,
      fields,
      sort,
      limit,
      library,
      format: "json",
      output: args.output,
      id: args.id,
      restrict,
    };
  }

  function run(line) {
    let parsed;
    try {
      parsed = parseCommandLine(line);
    } catch (e) {
      return {
        ok: false,
        command: null,
        text: `Error: ${e.fault?.found ?? e.message}`,
        envelope: null,
      };
    }
    const { command, args } = parsed;
    const wrap = (cmd, tail) => ({
      contractVersion: CONTRACT,
      command: cmd,
      ...tail,
    });
    const fail = (cmd, e) => {
      if (!e.fault) throw e;
      const d = renderDiagnostic(
        e.fault.argument ?? e.fault.parameter ?? "filter",
        e.fault,
      );
      if (e.fault.parameter) d.details = { parameter: e.fault.parameter };
      const env = wrap(cmd, { ok: false, diagnostic: d });
      return {
        ok: false,
        command: cmd,
        envelope: env,
        text: JSON.stringify(env, null, 2),
      };
    };
    try {
      if (
        command === "zotlit:query" ||
        command === "zotlit:item-query" ||
        command === "zotlit:annotation-query"
      ) {
        const req =
          command === "zotlit:query"
            ? decodeNew(args)
            : decodeOld(command, args);
        const result = execute(req);
        const identity = {
          vault: "demo-vault",
          source: {
            kind: "zotero-database",
            path: "/Users/me/Zotero/zotero.sqlite",
          },
        };
        const body = {
          ok: true,
          identity,
          libraries: result.libraries.map(libraryWire),
          request: result.normalized,
          returnedCount: result.returnedCount,
          truncated: result.truncated,
          warnings: result.warnings,
        };
        if (result.groups) {
          body.totalCount = result.totalCount;
          body.groups = result.groups;
        } else body.rows = result.rows;
        if (req.output) {
          delete body.rows;
          delete body.groups;
          body.file = {
            path: req.output,
            bytes: JSON.stringify(
              wrap(command, { ...body, rows: result.rows ?? result.groups }),
            ).length,
            format: "json",
          };
        }
        const env = wrap(command, body);
        return {
          ok: true,
          command,
          envelope: env,
          request: req,
          result,
          text: formatResult(req.format, env, result, DATASETS[req.from]),
        };
      }
      if (
        command === "zotlit:query-schema" ||
        command === "zotlit:item-query-schema" ||
        command === "zotlit:annotation-query-schema"
      ) {
        const from =
          command === "zotlit:query-schema"
            ? (args.from ?? null)
            : command === "zotlit:item-query-schema"
              ? "items"
              : "annotations";
        const describe = (ds) => ({
          dataset: ds.name,
          fields: ds.fields.map((f) => ({
            path: f,
            relation: ds.relations[f] ?? null,
            sort: ds.sortable.includes(f),
          })),
          defaultFields: ds.defaultFields,
          defaultSort: ds.defaultSort,
        });
        const env = wrap(command, {
          ok: true,
          datasets: (from ? [DATASETS[from]] : Object.values(DATASETS)).map(
            describe,
          ),
          customFields: [{ path: 'custom["review.status"]', bareName: false }],
          defaults: {
            limit: 100,
            library: { source: "library-scope", value: libraryScope },
          },
        });
        return {
          ok: true,
          command,
          envelope: env,
          text: JSON.stringify(env, null, 2),
        };
      }
      if (command === "zotlit:annotation-image") {
        const a = records.annotations.get(args.key ?? "");
        if (!a)
          throw err(
            "annotation-not-found",
            `No Annotation with the key '${args.key ?? ""}'.`,
            "Pass the indexedKey of an Annotation Row.",
            { parameter: "key" },
          );
        if (!a.hasExcerptImage)
          throw err(
            "not-an-image-annotation",
            `Annotation '${a.indexedKey}' is a ${a.type}; it has no Excerpt Image.`,
            "Call this command for an image or ink Annotation (hasExcerptImage true).",
            { parameter: "key" },
          );
        if (!a.attachment.exists)
          throw err(
            "file-unavailable",
            "The source PDF is not on this device and Zotero has no cached image.",
            "Make the file available, then run the command again.",
            { parameter: "key" },
          );
        const env = wrap(command, {
          ok: true,
          key: a.indexedKey,
          path: `/tmp/zotlit-excerpts/${a.indexedKey}.png`,
          format: "png",
          provenance: a.type === "image" ? "zotero" : "rendered",
        });
        return {
          ok: true,
          command,
          envelope: env,
          text: JSON.stringify(env, null, 2),
        };
      }
      if (
        command === "zotlit:query-cancel" ||
        command === "zotlit:item-query-cancel"
      ) {
        const env = wrap(command, {
          ok: true,
          id: args.id ?? null,
          cancelRequested: false,
        });
        return {
          ok: true,
          command,
          envelope: env,
          text: JSON.stringify(env, null, 2),
        };
      }
      return {
        ok: false,
        command,
        envelope: null,
        text: `Error: unknown command '${command ?? ""}'. Try zotlit:query, zotlit:query-schema, zotlit:item-query, zotlit:annotation-query.`,
      };
    } catch (e) {
      return fail(command, e);
    }
  }

  return {
    run,
    records,
    datasets: DATASETS,
    libraries: data.LIBRARIES,
    clock,
    execute,
  };
}

// ---------- output formats ----------
const cell = (v) =>
  v == null
    ? ""
    : typeof v === "string"
      ? v
      : isList(v)
        ? v
            .map((x) =>
              x == null
                ? ""
                : typeof x === "object"
                  ? (x.fullName ?? x.indexedKey ?? JSON.stringify(x))
                  : String(x),
            )
            .join("; ")
        : typeof v === "object"
          ? (v.fullName ?? JSON.stringify(v))
          : String(v);
const dispWidth = (s) =>
  [...s].reduce(
    (n, ch) =>
      n +
      (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(
        ch,
      )
        ? 2
        : 1),
    0,
  );
export function formatResult(format, env, result, ds) {
  if (format === "json" || !result.rows) return JSON.stringify(env, null, 2);
  const cols = ["indexedKey", ...result.fields];
  const rows = result.rows.map((r) => [
    r.indexedKey,
    ...result.fields.map((f) => cell(r.values[f])),
  ]);
  if (format === "csv") {
    const q = (s) => (/[",\n]/.test(s) ? `"${s.replaceAll(/"/g, '""')}"` : s);
    return [cols.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join(
      "\n",
    );
  }
  if (format === "md")
    return [
      `| ${cols.join(" | ")} |`,
      `| ${cols.map(() => "---").join(" | ")} |`,
      ...rows.map(
        (r) => `| ${r.map((c) => c.replaceAll(/\|/g, "\\|")).join(" | ")} |`,
      ),
    ].join("\n");
  if (format === "table") {
    const widths = cols.map((c, i) =>
      Math.min(40, Math.max(dispWidth(c), ...rows.map((r) => dispWidth(r[i])))),
    );
    const fit = (s, w) => {
      let t = s;
      while (dispWidth(t) > w) t = `${[...t].slice(0, -2).join("")  }…`;
      return t + " ".repeat(Math.max(0, w - dispWidth(t)));
    };
    const lines = [
      cols.map((c, i) => fit(c, widths[i])).join("  "),
      widths.map((w) => "─".repeat(w)).join("  "),
      ...rows.map((r) => r.map((c, i) => fit(c, widths[i])).join("  ")),
    ];
    lines.push(
      `${result.returnedCount} row(s)${result.truncated ? ", truncated" : ""}`,
    );
    return lines.join("\n");
  }
  return JSON.stringify(env, null, 2);
}

/** The same request as a saved query file (the Bases-shaped form). */
export function toQueryFile(req) {
  const lines = [`from: ${req.from}`];
  if (req.library)
    lines.push(
      `library: ${Array.isArray(req.library) ? `[${req.library.join(", ")}]` : req.library}`,
    );
  if (req.search) lines.push(`search: ${JSON.stringify(req.search)}`);
  if (req.filter) {
    const parts = splitTopLevelAnd(req.filter);
    if (parts.length > 1) {
      lines.push("filters:", "  and:");
      for (const p of parts) lines.push(`    - ${yamlStr(p)}`);
    } else lines.push(`filters: ${yamlStr(req.filter)}`);
  }
  if (req.fields) {
    lines.push("fields:");
    for (const f of req.fields) lines.push(`  - ${yamlStr(f)}`);
  }
  if (req.sort) {
    lines.push("sort:");
    for (const s of req.sort)
      lines.push(`  - ${s.direction === "desc" ? "-" : ""}${s.field}`);
  }
  if (req.limit != null) lines.push(`limit: ${req.limit}`);
  if (req.group) lines.push(`group: ${req.group}`);
  return lines.join("\n");
}
const yamlStr = (s) =>
  /[:#'"[\]{}&*!|>%@`]/.test(s) || /^\s|\s$/.test(s) ? JSON.stringify(s) : s;
function splitTopLevelAnd(src) {
  try {
    const ast = parseExpression(src);
    const out = [];
    const walk = (n) => {
      if (n.t === "and") {
        walk(n.l);
        walk(n.r);
      } else out.push(src.slice(n.from, n.to));
    };
    walk(ast);
    return out;
  } catch {
    return [src];
  }
}
