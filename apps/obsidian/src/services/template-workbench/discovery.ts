// Focused field definitions, live values, and expressions from the Template contract.
import type { ContractRoot } from "@zotlit/db";
import type {
  ContractIR,
  ContractMember,
  ContractType,
} from "@zotlit/db/contract/ir";
import irJson from "@zotlit/db/contract/ir.json" with { type: "json" };
import {
  formatAccessorPath,
  isAccessorIdentifier,
  serializeTemplatePath,
} from "@zotlit/workbench/explorer";
import type { TemplatePathSegment } from "@zotlit/workbench/explorer";

const ir = irJson as ContractIR;
export const DISCOVERY_LIMIT = 8;
export const DISCOVERY_HELP = `Field discovery is optional during authoring. Use query=<words> to get up to ${DISCOVERY_LIMIT} matching definitions, actual values, and Liquid/Eta expressions. Use path=zt.creators[0].family for an exact nested field. Use full for the complete zt object. Without a mode, the response lists root fields. Note, Annotation, and Citation roots describe different caller contexts; a Shared Partial reads the caller root you select. Values marked absent are unavailable on the selected object; empty strings and arrays remain present.`;

/** Parse property access only; this never evaluates a caller's expression. */
export function parseDiscoveryPath(text: string): TemplatePathSegment[] | null {
  let rest = text.startsWith("zt.")
    ? text.slice(3)
    : text.startsWith("zt[")
      ? text.slice(2)
      : text;
  const path: TemplatePathSegment[] = [];
  while (rest) {
    if (rest.startsWith("[")) {
      const end = rest.indexOf("]");
      if (end < 0) return null;
      let segment: unknown;
      try {
        segment = JSON.parse(rest.slice(1, end));
      } catch {
        return null;
      }
      if (
        !(
          typeof segment === "string" ||
          (typeof segment === "number" &&
            Number.isSafeInteger(segment) &&
            segment >= 0)
        )
      )
        return null;
      path.push(segment);
      rest = rest.slice(end + 1);
    } else {
      const stops = [rest.indexOf("."), rest.indexOf("[")].filter(
        (index) => index >= 0,
      );
      const end = stops.length ? Math.min(...stops) : -1;
      const name = end < 0 ? rest : rest.slice(0, end);
      if (!isAccessorIdentifier(name)) return null;
      path.push(name);
      rest = end < 0 ? "" : rest.slice(end);
    }
    if (rest.startsWith(".")) {
      rest = rest.slice(1);
      if (!rest || rest.startsWith("[")) return null;
    } else if (rest && !rest.startsWith("[")) return null;
  }
  return path.length ? path : null;
}

function resolve(type: ContractType): ContractType {
  return type.kind === "ref" ? ir.types[type.name]! : type;
}

function members(type: ContractType): readonly ContractMember[] {
  const resolved = resolve(type);
  if (resolved.kind === "object") {
    const additional = resolved.additional;
    if (additional?.schema !== "item-fields") return resolved.members;
    const known = new Set(resolved.members.map((member) => member.name));
    const fields = [...new Set(Object.values(ir.itemTypes).flat())];
    return [
      ...resolved.members,
      ...fields
        .filter((name) => !known.has(name))
        .map((name) => ({
          name,
          optional: true,
          description: `Zotero item field '${name}'; availability depends on the item type.`,
          type: additional.type,
        })),
    ];
  }
  if (resolved.kind === "union")
    return [
      ...Map.groupBy(
        resolved.options.flatMap(members),
        (member) => member.name,
      ).values(),
    ].map((variants) => ({
      ...variants[0]!,
      description: [
        ...new Set(
          variants.flatMap((member) =>
            member.description ? [member.description] : [],
          ),
        ),
      ].join(" / "),
      optional:
        variants.length < resolved.options.length ||
        variants.some((member) => member.optional),
      type:
        variants.length === 1
          ? variants[0]!.type
          : { kind: "union", options: variants.map((member) => member.type) },
    }));
  return [];
}

function element(type: ContractType): ContractType | undefined {
  const resolved = resolve(type);
  if (resolved.kind === "array") return resolved.items;
  if (resolved.kind === "union")
    return resolved.options.map(element).find((entry) => entry !== undefined);
}

function dictionaryValue(type: ContractType): ContractType | undefined {
  const resolved = resolve(type);
  if (resolved.kind === "record") return resolved.values;
  if (
    resolved.kind === "object" &&
    resolved.additional?.schema !== "item-fields"
  )
    return resolved.additional?.type;
  if (resolved.kind === "union")
    return resolved.options
      .map(dictionaryValue)
      .find((entry) => entry !== undefined);
}

function definitionAt(
  root: ContractRoot,
  path: readonly TemplatePathSegment[],
): ContractMember | undefined {
  let type: ContractType = { kind: "ref", name: ir.roots[root]!.type };
  let member: ContractMember | undefined;
  for (const segment of path) {
    if (typeof segment === "number") {
      const item = element(type);
      if (!item) return undefined;
      type = item;
      member = {
        name: String(segment),
        optional: true,
        type,
        description: member?.description,
      };
    } else {
      const declared: ContractMember | undefined = members(type).find(
        (entry) => entry.name === segment,
      );
      const dictionary = dictionaryValue(type);
      member =
        declared ??
        (dictionary
          ? {
              name: segment,
              optional: true,
              type: dictionary,
              description: member?.description,
            }
          : undefined);
      if (!member) return undefined;
      type = member.type;
    }
  }
  return member;
}

function row(
  data: object,
  root: ContractRoot,
  field: { path: readonly TemplatePathSegment[]; definition: ContractMember },
) {
  const { path, definition } = field;
  const value = serializeTemplatePath(data, root, path);
  const accessor = formatAccessorPath(path, "zt");
  const type = resolve(definition.type);
  const helper =
    type.kind === "helper" ||
    (type.kind === "union" &&
      type.options.some((entry) => resolve(entry).kind === "helper"));
  const safeAccessor = `zt${path
    .map((segment) =>
      typeof segment === "string" && isAccessorIdentifier(segment)
        ? `?.${segment}`
        : `?.[${JSON.stringify(segment)}]`,
    )
    .join("")}`;
  return {
    path: accessor,
    definition,
    presence: value === undefined ? "absent" : "present",
    ...(value === undefined ? {} : { value }),
    examples: {
      liquid: `{{ ${accessor} }}`,
      eta: `<%= ${helper ? `${safeAccessor}?.()` : value === undefined ? safeAccessor : accessor} %>`,
    },
  };
}

export function discoverTemplateData(
  data: object,
  root: ContractRoot,
  request: { query?: string; path?: string },
) {
  const rootType: ContractType = { kind: "ref", name: ir.roots[root]!.type };
  if (request.path !== undefined) {
    const path = parseDiscoveryPath(request.path);
    const definition = path && definitionAt(root, path);
    if (!path || !definition)
      return {
        error: `Path '${request.path}' is not a field in the ${root} root. Use query=<field name> to find a supported path.`,
      };
    return { matches: [row(data, root, { path, definition })] };
  }
  if (!request.query)
    return {
      fields: members(rootType).map((field) =>
        formatAccessorPath([field.name], "zt"),
      ),
      hint: DISCOVERY_HELP,
    };
  const query = request.query.toLowerCase().trim();
  const words = query.split(" ").filter(Boolean);
  const candidates: {
    path: TemplatePathSegment[];
    definition: ContractMember;
  }[] = [];
  const visit = (
    type: ContractType,
    parent: TemplatePathSegment[],
    seen: ReadonlySet<string>,
  ) => {
    if (type.kind === "ref" && seen.has(type.name)) return;
    const next = type.kind === "ref" ? new Set([...seen, type.name]) : seen;
    for (const definition of members(type)) {
      const path = [...parent, definition.name];
      const searchable =
        `${definition.name} ${definition.description ?? ""}`.toLowerCase();
      if (words.every((word) => searchable.includes(word)))
        candidates.push({ path, definition });
      if (path.length < 6) {
        visit(definition.type, path, next);
        const item = element(definition.type);
        if (item) visit(item, [...path, 0], next);
      }
    }
  };
  visit(rootType, [], new Set());
  candidates.sort(
    (a, b) =>
      Number(b.definition.name.toLowerCase() === query) -
        Number(a.definition.name.toLowerCase() === query) ||
      a.path.length - b.path.length,
  );
  return {
    matches: candidates
      .slice(0, DISCOVERY_LIMIT)
      .map((field) => row(data, root, field)),
    truncated: candidates.length > DISCOVERY_LIMIT,
    hint: candidates.length
      ? "Use path=<returned path> for one field. Array examples use index 0; select another index with path."
      : "Try a field name such as title, creators, tags, or pageLabel, or select the appropriate caller root.",
  };
}
