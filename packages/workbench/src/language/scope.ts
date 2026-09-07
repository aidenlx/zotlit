// Liquid locals resolve within one render scope; Managed Blocks render separately.
import { regex } from "arkregex";

import type { ContractType } from "@zotlit/db/contract/ir";
import { ANNOTATION_HEADER } from "@zotlit/templates/constants";

import { child, resolve } from "./contract";
import { liquidRanges } from "./liquid-ranges";

/** Known variable names survive even when their member type is unknown. */
export function localsAt(
  input: string,
  cursor: number,
  root: ContractType,
): Map<string, ContractType | undefined> {
  let source = input;
  let position = cursor;
  let locals = new Map<string, ContractType | undefined>([["zt", root]]);
  let loops: {
    name: string;
    previous: ContractType | undefined;
    existed: boolean;
  }[] = [];
  let captures: string[] = [];
  let branches: { before: typeof locals; writes: Set<string> }[] = [];
  let outer:
    | {
        locals: typeof locals;
        loops: typeof loops;
        branches: typeof branches;
        captures: typeof captures;
      }
    | undefined;
  let sectionStart = 0;
  for (const line of source.slice(0, position).split("\n")) {
    if (line.replace(/\r$/, "") === ANNOTATION_HEADER) {
      source = source.slice(sectionStart + line.length + 1);
      position -= sectionStart + line.length + 1;
      break;
    }
    sectionStart += line.length + 1;
  }
  for (const range of liquidRanges(source)) {
    if (range.from >= position) break;
    if (range.to > position && range.name !== "liquid") break;
    if (range.kind === "comment" || range.kind === "output") continue;
    if (range.name === "managed") {
      outer = { locals, loops, branches, captures };
      locals = new Map([["zt", root]]);
      loops = [];
      branches = [];
      captures = [];
      continue;
    }
    if (range.name === "endmanaged") {
      locals = outer?.locals ?? new Map([["zt", root]]);
      loops = outer?.loops ?? [];
      branches = outer?.branches ?? [];
      captures = outer?.captures ?? [];
      outer = undefined;
      continue;
    }
    const content = source
      .slice(
        range.from + 2,
        Math.min(position, range.closed ? range.to - 2 : range.to),
      )
      .replaceAll(/^-|-$/g, "")
      .trim();
    for (const statement of /^liquid\s/.test(content)
      ? content.slice(6).split("\n")
      : [content]) {
      if (/^\s*(?:if|unless|case)\s/.test(statement)) {
        branches.push({ before: new Map(locals), writes: new Set() });
        continue;
      }
      if (/^\s*(?:else|elsif|when)\b/.test(statement) && branches.length) {
        locals = new Map(branches.at(-1)!.before);
        continue;
      }
      if (/^\s*(?:endif|endunless|endcase)\s*$/.test(statement)) {
        const branch = branches.pop();
        if (branch)
          for (const name of branch.writes) locals.set(name, undefined);
        continue;
      }
      const capture = regex("^\\s*capture\\s+(?<name>\\w+)\\s*$").exec(
        statement,
      );
      if (capture) {
        captures.push(capture.groups.name);
        continue;
      }
      if (statement.trim() === "endcapture") {
        const name = captures.pop();
        if (name) {
          for (const branch of branches) branch.writes.add(name);
          locals.set(name, { kind: "primitive", type: "string" });
        }
        continue;
      }
      const assignment = regex(
        "^\\s*assign\\s+(?<name>\\w+)\\s*=\\s*(?<value>.+)$",
      ).exec(statement);
      if (assignment) {
        for (const branch of branches)
          branch.writes.add(assignment.groups.name);
        locals.set(
          assignment.groups.name,
          expressionType(assignment.groups.value, locals),
        );
        continue;
      }
      const loop = regex(
        "^\\s*for\\s+(?<name>\\w+)\\s+in\\s+(?<value>[^\\s]+)",
      ).exec(statement);
      if (loop) {
        const { name, value } = loop.groups;
        const type = expressionType(value, locals);
        const array = type && resolve(type);
        loops.push({
          name,
          previous: locals.get(name),
          existed: locals.has(name),
        });
        locals.set(name, array?.kind === "array" ? array.items : undefined);
        continue;
      }
      if (statement.trim() === "endfor") {
        const loop = loops.pop();
        if (loop?.existed) locals.set(loop.name, loop.previous);
        else if (loop) locals.delete(loop.name);
      }
    }
  }
  return locals;
}

function expressionType(
  value: string,
  locals: Map<string, ContractType | undefined>,
): ContractType | undefined {
  const path = regex("^(?<path>[A-Za-z_]\\w*(?:\\.\\w+)*)\\s*$").exec(value);
  if (!path) return undefined;
  const [name, ...keys] = path.groups.path.split(".");
  let type = locals.get(name!);
  for (const key of keys) type = type && child(type, key);
  return type;
}
