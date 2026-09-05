// JSON-e expression regions and field facts, independent of the editor host.
import { regex } from "arkregex";
import { findNodeAtOffset, getLocation, parseTree } from "jsonc-parser";
import type { Node } from "jsonc-parser";

import type { ContractType } from "@zotlit/db/contract/ir";

import { contract, describe, members, resolve, sampleValue } from "./contract";
import { jsonOperators, jsonFunctions } from "./json-e-catalog";
import { rankSuggestions } from "./matching";
import type {
  Suggestion,
  SuggestionConfig,
  SuggestionResult,
} from "./suggestions";

type Binding = { type?: ContractType; path?: string[] };
type Scope = Map<string, Binding>;
export interface JsonExpression {
  text: string;
  offsets: number[];
  scope: Scope;
}

/** Preserve original JSON escape offsets while examining decoded expression text. */
function stringSource(source: string, node: Node) {
  let text = "";
  const offsets = [node.offset + 1];
  const end = node.offset + node.length;
  for (let at = node.offset + 1; at < end && source[at] !== '"'; ) {
    const start = at;
    let char = source[at++]!;
    if (char === "\\") {
      at += source[at] === "u" ? 5 : 1;
      try {
        char = JSON.parse(`"${source.slice(start, at)}"`) as string;
      } catch {
        break;
      }
    }
    text += char;
    offsets.push(at);
  }
  return { text, offsets };
}

/** Tokens retain string boundaries so braces and dots inside literals stay inert. */
export function jsonExpressionTokens(text: string) {
  return [
    ...text.matchAll(
      regex(
        "[A-Za-z_][A-Za-z_0-9]*|[0-9]+(?:\\.[0-9]+)?|'[^']*(?:'|$)|\"[^\"]*(?:\"|$)|\\*\\*|&&|\\|\\||[=!<>]=|[^\\s]",
        "g",
      ),
    ),
  ].map((match) => ({
    text: match[0],
    from: match.index,
    to: match.index + match[0].length,
  }));
}

function nodeValue(node: Node, key: string) {
  return node.children?.find((p) => p.children?.[0]?.value === key)
    ?.children?.[1];
}
function member(binding: Binding, key: string): Binding {
  const type = binding.type && resolve(binding.type);
  return {
    type:
      type?.kind === "array" && regex("^-?[0-9]+$").test(key)
        ? type.items
        : binding.type &&
          fields(binding.type).find((f) => f.name === key)?.type,
    path: binding.path && [...binding.path, key],
  };
}
const PATH = regex(
  "^[A-Za-z_]\\w*(?:(?:\\.\\w+)|(?:\\[(?:-?[0-9]+|'[^']*'|\"[^\"]*\")\\]))*$",
);
function pathBinding(text: string, scope: Scope): Binding {
  if (!PATH.test(text.trim())) return {};
  const tokens = jsonExpressionTokens(text);
  let value = scope.get(tokens.shift()!.text) ?? {};
  for (let i = 0; i < tokens.length; ) {
    const separator = tokens[i++]!.text;
    let key = tokens[i++]!.text;
    if (key === "-") key += tokens[i++]!.text;
    value = member(
      value,
      key.startsWith("'") || key.startsWith('"') ? key.slice(1, -1) : key,
    );
    if (separator === "[") i++;
  }
  return value;
}
function infer(node: Node | undefined, scope: Scope): Binding {
  if (!node) return {};
  const expression = nodeValue(node, "$eval");
  if (expression?.type === "string")
    return pathBinding(expression.value as string, scope);
  if (node.type === "array")
    return {
      type: {
        kind: "array",
        items: infer(node.children?.[0], scope).type ?? { kind: "unknown" },
      },
    };
  if (
    node.type === "object" &&
    node.children?.some((p) =>
      Object.hasOwn(jsonOperators, p.children?.[0]?.value as string),
    )
  )
    return {};
  if (node.type === "object")
    return {
      type: {
        kind: "object",
        members: (node.children ?? []).flatMap((p) => {
          const [key, value] = p.children ?? [];
          return key
            ? [
                {
                  name: key.value as string,
                  optional: false,
                  type: infer(value, scope).type ?? {
                    kind: "unknown" as const,
                  },
                },
              ]
            : [];
        }),
      },
    };
  return {
    type: {
      kind: "primitive",
      type:
        node.type === "string"
          ? "string"
          : node.type === "number"
            ? "number"
            : node.type === "boolean"
              ? "boolean"
              : "null",
    },
  };
}
function localScope(node: Node, key: string, outer: Scope): Scope {
  const scope = new Map(outer);
  const letNode = nodeValue(node, "$let");
  if (letNode && key === "in")
    for (const p of letNode.children ?? []) {
      const [name, value] = p.children ?? [];
      if (name) scope.set(name.value as string, infer(value, outer));
    }
  const loop = regex("^(?:each|by)\\((?<names>[^)]*)\\)$").exec(key);
  if (!loop) return scope;
  const names = loop.groups.names.split(",").map((name) => name.trim());
  const operator = ["$map", "$reduce", "$find", "$sort"].find((name) =>
    nodeValue(node, name),
  );
  if (!operator) return scope;
  const input = infer(nodeValue(node, operator), outer);
  const type = input.type && resolve(input.type);
  const item: Binding =
    type?.kind === "array"
      ? { type: type.items, path: input.path && [...input.path, "0"] }
      : {};
  let values: Binding[] = [
    item,
    { type: { kind: "primitive", type: "number" } },
  ];
  if (operator === "$map" && type?.kind === "object") {
    const options = fields(type).map((field) => field.type);
    const value: ContractType = options.length
      ? { kind: "union", options }
      : { kind: "unknown" };
    const keyType: ContractType = { kind: "primitive", type: "string" };
    values =
      names.length === 1
        ? [
            {
              type: {
                kind: "object",
                members: [
                  { name: "key", type: keyType, optional: false },
                  { name: "val", type: value, optional: false },
                ],
              },
            },
          ]
        : [{ type: value }, { type: keyType }];
  }
  if (operator === "$reduce") values.unshift({});
  names.forEach((name, i) => {
    if (regex("^[A-Za-z_]\\w*$").test(name)) scope.set(name, values[i] ?? {});
  });
  return scope;
}

/** Locate expressions using the recovered JSON tree, including unfinished strings. */
export function jsonExpressions(
  source: string,
  config: SuggestionConfig,
): JsonExpression[] {
  const root = parseTree(source);
  const scope: Scope = new Map([
    [
      "zt",
      {
        type: { kind: "ref", name: contract.roots[config.root]!.type },
        path: [],
      },
    ],
  ]);
  const result: JsonExpression[] = [];
  function visit(
    node: Node,
    bindings: Scope,
    {
      expression = false,
      conditions = false,
    }: { expression?: boolean; conditions?: boolean } = {},
  ) {
    if (node.type === "string") {
      const decoded = stringSource(source, node);
      if (expression) result.push({ ...decoded, scope: bindings });
      else {
        let search = 0;
        while (search < decoded.text.length) {
          const marker = decoded.text.indexOf("${", search);
          if (marker < 0) break;
          search = marker + 2;
          if (marker > 0 && decoded.text[marker - 1] === "$") continue;
          const from = marker + 2;
          let to = decoded.text.length;
          let depth = 0;
          for (const token of jsonExpressionTokens(decoded.text.slice(from))) {
            if (token.text === "{") depth++;
            if (token.text === "}" && depth-- === 0) {
              to = from + token.from;
              break;
            }
          }
          result.push({
            text: decoded.text.slice(from, to),
            offsets: decoded.offsets.slice(from, to + 1),
            scope: bindings,
          });
          search = to + 1;
        }
      }
      return;
    }
    if (node.type === "object") {
      const props = node.children ?? [];
      const keys = props.map((p) => p.children?.[0]?.value as string);
      for (const property of props) {
        const [key, value] = property.children ?? [];
        if (!key) continue;
        visit(key, bindings, {
          expression: conditions && key.value !== "$default",
        });
        if (value)
          visit(value, localScope(node, key.value as string, bindings), {
            expression:
              key.value === "$eval" ||
              key.value === "$if" ||
              (keys.includes("$find") && key.value.startsWith("each(")) ||
              (keys.includes("$sort") && key.value.startsWith("by(")),
            conditions: key.value === "$switch" || key.value === "$match",
          });
      }
    } else for (const child of node.children ?? []) visit(child, bindings);
  }
  if (root) visit(root, scope);
  return result;
}

function jsonType(type: ContractType): string {
  const value = resolve(type);
  if (value.kind === "stringified") return "string";
  if (value.kind === "union") return value.options.map(jsonType).join(" | ");
  return describe(type);
}

function fields(type: ContractType) {
  return members(type).filter(
    (member) => resolve(member.type).kind !== "helper",
  );
}

export function jsonSuggestions(
  source: string,
  position: number,
  config: SuggestionConfig,
): SuggestionResult | null {
  const expression = jsonExpressions(source, config).find(
    (item) => position >= item.offsets[0]! && position <= item.offsets.at(-1)!,
  );
  if (!expression) return structuralSuggestions(source, position, config);
  const cursor = expression.offsets.findLastIndex(
    (offset) => offset <= position,
  );
  const token = jsonExpressionTokens(expression.text).find(
    (item) => item.from < cursor && item.to >= cursor,
  );
  const inString =
    token && (token.text.startsWith("'") || token.text.startsWith('"'));
  const bracket =
    inString && expression.text.slice(0, token.from).trimEnd().endsWith("[");
  if (inString && !bracket) return null;
  const match = regex("(?<query>[A-Za-z_0-9]*)$").exec(
    expression.text.slice(0, cursor),
  )!;
  const query = bracket
    ? expression.text.slice(token.from + 1, cursor)
    : match.groups.query;
  const before = bracket
    ? `${expression.text.slice(0, token.from).trimEnd().slice(0, -1)}.`
    : expression.text.slice(0, cursor - query.length).trimEnd();
  const pathMatch = regex(
    "(?<path>[A-Za-z_]\\w*(?:(?:\\.\\w+)|(?:\\[(?:-?[0-9]+|'[^']*'|\"[^\"]*\")\\]))*)\\.$",
  ).exec(before);
  const binding = pathMatch
    ? pathBinding(pathMatch.groups.path, expression.scope)
    : expression.scope.get("zt")!;
  const path = binding.path;
  const options: Suggestion[] = (binding.type ? fields(binding.type) : [])
    .filter((field) =>
      bracket
        ? !field.name.includes(token.text[0]!)
        : !(field.name.includes("'") && field.name.includes('"')),
    )
    .map((field) => {
      const sample = path && sampleValue(config.sample, [...path, field.name]);
      const needsBracket =
        !bracket && !regex("^[A-Za-z_]\\w*$").test(field.name);
      const quote = field.name.includes("'") ? '"' : "'";
      const inserted = needsBracket
        ? `${pathMatch ? "" : "zt"}[${quote}${field.name}${quote}]`
        : pathMatch
          ? field.name
          : `zt.${field.name}`;
      return {
        ...(needsBracket && pathMatch
          ? {
              from: expression.offsets[
                expression.text.lastIndexOf(".", cursor - query.length - 1)
              ],
            }
          : {}),
        label: field.name,
        insert: JSON.stringify(inserted).slice(1, -1),
        category: "field",
        path: path && ["zt", ...path, field.name].join("."),
        type: jsonType(field.type),
        detail: field.description ?? "",
        example:
          sample === undefined
            ? undefined
            : `Sample: ${JSON.stringify(sample)}`,
      };
    });
  if (!pathMatch) {
    if (before.endsWith(".") || before.endsWith("]")) return null;
    for (const [name, info] of Object.entries(jsonFunctions)) {
      if (!expression.scope.has(name))
        options.push({
          label: name,
          insert: name,
          category: "field",
          type: info.type,
          detail: info.description,
        });
    }
    for (const [name, local] of expression.scope)
      options.push({
        label: name,
        insert: name,
        category: "field",
        type: local.type ? jsonType(local.type) : "unknown",
        detail: "JSON-e variable in this rule.",
      });
  }
  const from = expression.offsets[cursor - query.length]!;
  const tail = bracket
    ? Math.max(
        0,
        token.to - cursor - (token.text.endsWith(token.text[0]!) ? 1 : 0),
      )
    : regex("^\\w*").exec(expression.text.slice(cursor))![0].length;
  const to = expression.offsets[cursor + tail]!;
  return {
    from,
    to,
    tagEnd: expression.offsets.at(-1)!,
    root: config.root,
    trigger: "JSON-e",
    language: "json-e",
    expression: true,
    range: {
      from: expression.offsets[0]!,
      to: expression.offsets.at(-1)!,
      kind: "output",
      name: "",
      closed: true,
    },
    options: rankSuggestions(options, query, config),
  };
}

/** Schema-shaped operator metadata supplies only structural keys, without evaluating drafts. */
function structuralSuggestions(
  source: string,
  position: number,
  config: SuggestionConfig,
): SuggestionResult | null {
  const location = getLocation(source, position);
  if (!location.isAtPropertyKey) return null;
  const root = parseTree(source);
  if (!root) return null;
  let object = findNodeAtOffset(root, position, true);
  while (object && object.type !== "object") object = object.parent;
  if (!object) return null;
  const current = object.children?.find((p) => {
    const k = p.children?.[0];
    return k && position >= k.offset && position <= k.offset + k.length;
  });
  const key = current?.children?.[0];
  const query = key
    ? stringSource(source, key).text.slice(
        0,
        Math.max(0, position - key.offset - 1),
      )
    : "";
  const keys = (object.children ?? [])
    .filter((p) => p !== current)
    .map((p) => p.children?.[0]?.value as string);
  const operator = keys.find((name) => jsonOperators[name]);
  const condition = object.parent?.children?.[0]?.value;
  const catalog = operator
    ? Object.entries(jsonOperators[operator]!.siblings ?? {}).map(
        ([name, value]) =>
          [
            name,
            { value, description: jsonOperators[operator]!.description },
          ] as const,
      )
    : condition === "$switch"
      ? [
          [
            "$default",
            { value: null, description: "Render when no condition matches." },
          ] as const,
        ]
      : condition === "$match" || condition === "$let"
        ? []
        : Object.entries(jsonOperators);
  const from = key?.offset ?? position;
  const to = key ? key.offset + key.length : position;
  const hasColon = source.slice(to).trimStart().startsWith(":");
  const options: Suggestion[] = catalog
    .filter(([name]) => !keys.includes(name) && name.startsWith(query))
    .map(([name, info]) => ({
      label: name,
      insert:
        JSON.stringify(name) +
        (hasColon ? "" : `: ${JSON.stringify(info.value)}`),
      category: "field",
      type: "JSON-e operator",
      detail: info.description,
    }));
  return {
    from,
    to,
    tagEnd: to,
    root: config.root,
    trigger: "JSON-e",
    language: "json-e",
    expression: true,
    range: { from, to, name: "", kind: "output", closed: true },
    options,
  };
}

export function jsonHover(
  source: string,
  position: number,
  config: SuggestionConfig,
): SuggestionResult | null {
  const expression = jsonExpressions(source, config).find(
    (item) => position >= item.offsets[0]! && position <= item.offsets.at(-1)!,
  );
  if (expression) {
    const cursor = expression.offsets.findLastIndex(
      (offset) => offset <= position,
    );
    const token = jsonExpressionTokens(expression.text).find(
      (part) => cursor >= part.from && cursor < part.to,
    );
    if (
      token &&
      (token.text.startsWith("'") || token.text.startsWith('"')) &&
      expression.text.slice(0, token.from).trimEnd().endsWith("[")
    ) {
      const end = token.to - 1;
      const result = jsonSuggestions(source, expression.offsets[end]!, config);
      const option = result?.options.find(
        (item) => item.label === token.text.slice(1, -1),
      );
      return result && option
        ? {
            ...result,
            from: expression.offsets[token.from + 1]!,
            to: expression.offsets[end]!,
            options: [option],
          }
        : null;
    }
  }
  const from =
    position -
    regex("[A-Za-z_0-9$]*$").exec(source.slice(0, position))![0].length;
  const to =
    position + regex("^[A-Za-z_0-9$]*").exec(source.slice(position))![0].length;
  if (from === to) return null;
  const result = jsonSuggestions(source, to, config);
  const option = result?.options.find(
    (item) => item.label === source.slice(from, to),
  );
  return result && option ? { ...result, from, to, options: [option] } : null;
}
