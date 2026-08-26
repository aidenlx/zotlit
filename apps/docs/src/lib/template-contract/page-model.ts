// Turns the Template Contract IR into the page model behind the generated
// reference page: sections, tables, rows, normalized prose, and resolved links.
//
// Pure and framework-free — the emitter renders it to MDX, the table component
// renders it to React, and both restate the contract identically.

import { regex } from "arkregex";

import type {
  ContractExample,
  ContractHelper,
  ContractIR,
  ContractMember,
  ContractNamedType,
  ContractObject,
  ContractType,
} from "@zotlit/db/contract/ir";

import { SECTIONS } from "./sections";
import type { SectionSpec } from "./sections";

/** One run of a description: plain prose, inline code, or a resolved link. */
export type InlineNode =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "link"; href: string; text: string; code: boolean };

/** A normalized doc comment: paragraphs of inline runs. */
export type Doc = readonly (readonly InlineNode[])[];

export interface PageModel {
  sections: readonly PageSection[];
  /** Members and types the contract leaves undocumented. */
  warnings: readonly string[];
}

export interface PageSection {
  id: string;
  title: string;
  level: 2 | 3;
  /** Fixed page-template prose, emitted as MDX verbatim. */
  lead?: string;
  /** Hand-written partial inlined under this heading. */
  include?: string;
  /** The contract's own description of the sole type documented here. */
  description: Doc;
  tables: readonly TableModel[];
  /** Options of a section documenting a union of string literals. */
  values: readonly SectionValue[];
  /** Rows of the item-type → `zt` field map. */
  itemTypes: readonly ItemTypeRow[];
}

/** One option of a documented union of string literals. */
export interface SectionValue {
  value: string;
  description: Doc;
}

export interface TableModel {
  /** Element id the row anchors extend, e.g. `#creators-family`. */
  id: string;
  caption?: string;
  /** The contract's own description of this table's type; empty unless the section documents several. */
  description: Doc;
  /** Rendered before every row name, e.g. `zt.`. */
  prefix?: string;
  rows: readonly RowModel[];
}

export interface RowModel {
  name: string;
  optional: boolean;
  /** Compact type for the collapsed row. */
  shortType: string;
  /** Complete type for the expanded row. */
  fullType: string;
  /** Anchor of the section documenting this member's type. */
  typeHref?: string;
  description: Doc;
  examples: readonly ContractExample[];
  helper?: HelperPresentation;
}

/** How a function-valued member is written in each engine. */
export interface HelperPresentation {
  signature: string;
  /** Plain access in Liquid, e.g. `{{ zt.noteLink }}`. */
  liquid: string;
  /** The call in Eta, e.g. `<%= zt.noteLink(alias, subpath) %>`. */
  eta: string;
  /** Liquid filter overriding the arguments, e.g. `{{ zt | note_link: alias, subpath }}`. */
  filter?: string;
}

export interface ItemTypeRow {
  itemType: string;
  fields: readonly string[];
}

/** A member serialized as a path back to an object the root already emitted. */
interface ReferenceTarget {
  path: string;
  /** Anchor of the root section the path is rooted at. */
  href: string;
}

/** `specs` is the page template; tests pass a fixture one. */
export function buildPageModel(
  ir: ContractIR,
  specs: readonly SectionSpec[] = SECTIONS,
): PageModel {
  const warnings: string[] = [];
  const context: BuildContext = {
    ir,
    specs,
    references: collectReferences(ir, specs),
    warnings,
  };
  assertEveryTypeIsPlaced(ir, specs);
  return {
    sections: specs.map((spec) => buildSection(spec, context)),
    warnings,
  };
}

/** The section `id` documents; both renderers resolve a section id through here, so they fail alike. */
export function sectionOf(model: PageModel, id: string): PageSection {
  const section = model.sections.find((entry) => entry.id === id);
  if (!section) throw new Error(`No contract section ${id}`);
  return section;
}

interface BuildContext {
  ir: ContractIR;
  specs: readonly SectionSpec[];
  references: ReadonlyMap<string, ReferenceTarget>;
  warnings: string[];
}

/** The section documenting `type`, or `undefined` when the page template places none. */
function sectionForType(
  specs: readonly SectionSpec[],
  type: string,
): SectionSpec | undefined {
  return specs.find((section) => section.types?.includes(type));
}

function collectReferences(
  ir: ContractIR,
  specs: readonly SectionSpec[],
): Map<string, ReferenceTarget> {
  const references = new Map<string, ReferenceTarget>();
  for (const [root, rootIR] of Object.entries(ir.roots)) {
    const section = sectionForType(specs, rootIR.type);
    if (!section) {
      throw new Error(`No section documents ${rootIR.type} (the ${root} root)`);
    }
    for (const { owner, member, path } of rootIR.references) {
      references.set(`${owner}.${member}`, { path, href: `#${section.id}` });
    }
  }
  return references;
}

/** Every named type the contract reaches needs a section, so none lands undocumented. */
function assertEveryTypeIsPlaced(
  ir: ContractIR,
  specs: readonly SectionSpec[],
): void {
  const placed = new Set(specs.flatMap((section) => section.types ?? []));
  const missing = Object.keys(ir.types).filter((name) => !placed.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Contract types with no section in lib/template-contract/sections.ts: ${missing.join(", ")}`,
    );
  }
}

function buildSection(spec: SectionSpec, context: BuildContext): PageSection {
  const types = (spec.types ?? []).map(
    (name) => [name, namedType(context.ir, name)] as const,
  );
  const [firstName, firstType] = types[0] ?? [];
  const tables = sectionTables(spec, context.ir).map((slot) =>
    buildTable({ ...slot, describeHere: types.length > 1 }, spec, context),
  );
  if (spec.captions && spec.captions.length !== tables.length) {
    throw new Error(
      `Section ${spec.id} declares ${spec.captions.length} captions for ${tables.length} tables`,
    );
  }
  if (!spec.captions && tables.length > 1) {
    throw new Error(
      `Section ${spec.id} holds ${tables.length} tables and no captions`,
    );
  }
  for (const [name, type] of types) {
    if (!type.description)
      context.warnings.push(`${name} has no type description`);
  }
  return {
    id: spec.id,
    title: spec.title,
    level: spec.level,
    lead: spec.lead,
    include: spec.include,
    description:
      types.length > 1
        ? []
        : normalizeDoc(firstType?.description, firstName, context),
    tables,
    values: types.flatMap(([name, type]) =>
      literalOptionsOf(name, type, context),
    ),
    itemTypes: spec.itemTypes ? itemTypeRows(context.ir) : [],
  };
}

function namedType(ir: ContractIR, name: string): ContractNamedType {
  const type = ir.types[name];
  if (!type) throw new Error(`Contract IR carries no ${name} type`);
  return type;
}

/**
 * The tables a section holds, in order: one per object type it documents, plus
 * one per object variant of a union it documents. The emitter and the link
 * resolver both number rows off these ids, so they agree by construction.
 */
function sectionTables(spec: SectionSpec, ir: ContractIR): TableSlot[] {
  const objects = (spec.types ?? []).flatMap((name) =>
    variantsOf(name, namedType(ir, name)),
  );
  return objects.map(([owner, object], index) => ({
    owner,
    object,
    id: objects.length > 1 ? `${spec.id}-${index + 1}` : spec.id,
    index,
  }));
}

/** A union of objects documents one table per variant; every other type documents one. */
function variantsOf(
  name: string,
  type: ContractNamedType,
): Array<readonly [string, ContractObject]> {
  if (type.kind === "object") return [[name, type] as const];
  return type.options
    .filter((option) => option.kind === "object")
    .map((option) => [name, option] as const);
}

function literalOptionsOf(
  name: string,
  type: ContractNamedType,
  context: BuildContext,
): SectionValue[] {
  if (type.kind !== "union") return [];
  return type.options.flatMap((option) => {
    if (option.kind !== "literal") return [];
    if (!option.description) {
      context.warnings.push(
        `${name} option ${option.value} has no description`,
      );
    }
    return [
      {
        value: String(option.value),
        description: normalizeDoc(option.description, name, context),
      },
    ];
  });
}

function itemTypeRows(ir: ContractIR): ItemTypeRow[] {
  return Object.entries(ir.itemTypes).map(([itemType, fields]) => ({
    itemType,
    fields,
  }));
}

/** One table's place in its section: which type, which variant, under which id. */
interface TableSlot {
  owner: string;
  object: ContractObject;
  id: string;
  index: number;
}

function buildTable(
  {
    owner,
    object,
    id,
    index,
    describeHere,
  }: TableSlot & { describeHere: boolean },
  spec: SectionSpec,
  context: BuildContext,
): TableModel {
  return {
    id,
    caption: spec.captions?.[index],
    description: describeHere
      ? normalizeDoc(context.ir.types[owner]?.description, owner, context)
      : [],
    prefix: spec.prefix,
    rows: object.members.map((member) =>
      buildRow(member, { owner, spec }, context),
    ),
  };
}

function buildRow(
  member: ContractMember,
  { owner, spec }: { owner: string; spec: SectionSpec },
  context: BuildContext,
): RowModel {
  if (!member.description) {
    context.warnings.push(`${owner}.${member.name} has no description`);
  }
  const reference = context.references.get(`${owner}.${member.name}`);
  const helper = findHelper(member.type);
  const type = reference
    ? {
        shortType: reference.path,
        fullType: reference.path,
        typeHref: reference.href,
      }
    : {
        shortType: renderType(member.type, true),
        fullType: renderType(member.type, false),
        typeHref: typeHrefFor(member.type, context.specs),
      };
  return {
    name: member.name,
    optional: member.optional,
    ...type,
    description: normalizeDoc(member.description, owner, context),
    examples: retarget(member.examples ?? [], member.name, spec),
    helper:
      helper && !reference
        ? presentHelper(helper, member.name, spec)
        : undefined,
  };
}

/**
 * A doc comment writes its `@example` against the `zt` root, but the IR flattens
 * an inherited member into every shape that carries it. Point the member's own
 * accessor at this section's sample so a nested shape's example reads the
 * property the row documents; everything else in the sample stays verbatim.
 */
function retarget(
  examples: readonly ContractExample[],
  name: string,
  spec: SectionSpec,
): readonly ContractExample[] {
  const sample = spec.sample ?? "zt";
  if (sample === "zt") return examples;
  return examples.map((example) => ({
    ...example,
    code: example.code.replaceAll(`zt.${name}`, `${sample}.${name}`),
  }));
}

/** A link helper reaches the page either bare or as one option of `helper | null`. */
function findHelper(type: ContractType): ContractHelper | undefined {
  switch (type.kind) {
    case "helper":
      return type;
    case "array":
      return findHelper(type.items);
    case "union":
      return type.options.map(findHelper).find((found) => found !== undefined);
    default:
      return undefined;
  }
}

function presentHelper(
  { signature, filter }: ContractHelper,
  name: string,
  spec: SectionSpec,
): HelperPresentation {
  const sample = spec.sample ?? "zt";
  const parameters = parameterNames(signature);
  const args = parameters.join(", ");
  return {
    signature,
    liquid: `{{ ${sample}.${name} }}`,
    eta: `<%= ${sample}.${name}(${args}) %>`,
    filter: filter && `{{ ${sample} | ${filter}${args ? `: ${args}` : ""} }}`,
  };
}

/** Parameter names of a rendered signature, e.g. `alias`, `subpath`. */
function parameterNames(signature: string): string[] {
  const parameters = signature.slice(1, signature.indexOf(")"));
  return parameters
    .split(",")
    .map((parameter) => parameter.split(":")[0]!.replace("?", "").trim())
    .filter((parameter) => parameter.length > 0);
}

/** Section anchor for the type a member exposes, seen through arrays and `| null`. */
function typeHrefFor(
  type: ContractType,
  specs: readonly SectionSpec[],
): string | undefined {
  const named = unwrapRef(type);
  const section = named ? sectionForType(specs, named) : undefined;
  return section && `#${section.id}`;
}

function unwrapRef(type: ContractType): string | undefined {
  switch (type.kind) {
    case "ref":
      return type.name;
    case "array":
      return unwrapRef(type.items);
    case "helper":
      return unwrapRef(type.value);
    case "union": {
      const named = type.options
        .filter(
          (option) => option.kind !== "primitive" || option.type !== "null",
        )
        .map(unwrapRef);
      return named.length === 1 ? named[0] : undefined;
    }
    default:
      return undefined;
  }
}

/** Options past this many collapse to an ellipsis in a collapsed row. */
const SHORT_UNION_OPTIONS = 3;

function renderType(type: ContractType, short: boolean): string {
  switch (type.kind) {
    case "primitive":
      return type.type;
    case "literal":
      return JSON.stringify(type.value);
    case "unknown":
      return "unknown";
    case "array": {
      const items = renderType(type.items, short);
      return items.includes(" | ") ? `(${items})[]` : `${items}[]`;
    }
    case "record":
      return `Record<string, ${renderType(type.values, short)}>`;
    case "ref":
      return type.name;
    case "stringified":
      return type.type;
    case "helper":
      return short ? renderType(type.value, short) : type.signature;
    case "object":
      return short
        ? "object"
        : `{ ${type.members
            .map(
              (member) =>
                `${member.name}${member.optional ? "?" : ""}: ${renderType(member.type, short)}`,
            )
            .join("; ")} }`;
    case "union": {
      const options = type.options.map((option) => {
        const rendered = renderType(option, short);
        // A signature inside a union needs parentheses to keep its return type.
        return rendered.includes("=>") ? `(${rendered})` : rendered;
      });
      if (short && options.length > SHORT_UNION_OPTIONS) {
        return `${options.slice(0, SHORT_UNION_OPTIONS).join(" | ")} | …`;
      }
      return options.join(" | ");
    }
  }
}

/**
 * A doc comment writes code as a Markdown span and links as the plain
 * `{@link Target}` form.
 */
const INLINE = regex("`(?<span>[^`]+)`|\\{@link\\s+(?<target>[^}\\s]+)}", "g");

/**
 * JSDoc wraps at the source's column limit and links its own symbols. Rejoin
 * each paragraph so the description reads as prose, keep the paragraph breaks,
 * and split it into the runs both renderers need — a code span stays code in
 * Markdown and in React, and every link tag resolves against the page. `owner`
 * is the type whose doc this is, so a bare member link resolves within it.
 */
export function normalizeDoc(
  text: string | undefined,
  owner: string | undefined,
  context: Pick<BuildContext, "ir" | "specs">,
): Doc {
  if (!text) return [];
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) =>
      splitInline(paragraph.replaceAll(/\s+/g, " ").trim(), owner, context),
    );
}

function splitInline(
  paragraph: string,
  owner: string | undefined,
  context: Pick<BuildContext, "ir" | "specs">,
): InlineNode[] {
  const nodes: InlineNode[] = [];
  let cursor = 0;
  for (const match of paragraph.matchAll(INLINE)) {
    const start = match.index;
    if (start > cursor) {
      nodes.push({ kind: "text", value: paragraph.slice(cursor, start) });
    }
    const { span, target } = match.groups ?? {};
    nodes.push(span ? code(span) : resolveLink(target!, owner, context));
    cursor = start + match[0].length;
  }
  if (cursor < paragraph.length) {
    nodes.push({ kind: "text", value: paragraph.slice(cursor) });
  }
  return nodes;
}

/**
 * A type target links to the section documenting it, a qualified or bare member
 * target to the member's row. Both keep the contract's own name as the link
 * text. A target the IR does not carry degrades to plain code text.
 */
function resolveLink(
  target: string,
  owner: string | undefined,
  context: Pick<BuildContext, "ir" | "specs">,
): InlineNode {
  const [head, member] = target.split(".");
  if (member) return memberLink(head!, member, context) ?? code(target);
  const section = sectionForType(context.specs, head!);
  if (section) {
    return { kind: "link", href: `#${section.id}`, text: head!, code: true };
  }
  const own = owner ? memberLink(owner, head!, context) : undefined;
  return own ?? code(head!);
}

function memberLink(
  owner: string,
  member: string,
  { ir, specs }: Pick<BuildContext, "ir" | "specs">,
): InlineNode | undefined {
  const section = sectionForType(specs, owner);
  if (!section || !ir.types[owner]) return undefined;
  const slot = sectionTables(section, ir).find(
    (entry) =>
      entry.owner === owner &&
      entry.object.members.some((candidate) => candidate.name === member),
  );
  if (!slot) return undefined;
  return {
    kind: "link",
    href: `#${slot.id}-${member}`,
    text: member,
    code: true,
  };
}

function code(value: string): InlineNode {
  return { kind: "code", value };
}
