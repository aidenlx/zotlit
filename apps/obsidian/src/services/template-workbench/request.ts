// Selector parsing: the request each command accepts, and the identity it asserts.

import { type CliData } from "obsidian";

import {
  parseIndexedKey,
  TEMPLATE_SLOT_ROOTS,
  type ContractRoot,
  type TemplateSlot,
} from "@zotlit/db";

import { type Diagnostic, type WorkbenchIdentity } from "./envelope";
import { CONTRACT_ROOT_NAMES, parseContractRoot } from "./schema";

/** A parsed selector, or the one parameter that made it invalid. */
export type ParsedRequest<T> =
  | { kind: "valid"; value: T }
  | { kind: "invalid"; parameter: string; message: string };

export interface DataRequest {
  key: string;
  root: ContractRoot;
  format: "json";
}

export interface RenderRequest {
  key: string;
  template: TemplateSlot;
  format: "markdown" | "json";
}

/** The accepted `template` values, in the order selector messages list them. */
export const TEMPLATE_SLOT_NAMES = Object.keys(
  TEMPLATE_SLOT_ROOTS,
) as readonly TemplateSlot[];

export function parseDataRequest(params: CliData): ParsedRequest<DataRequest> {
  const key = selectorKey(params);
  if (key === null) return invalid("key", "key must be an Indexed Key.");

  const root = parseContractRoot(params.root);
  if (root === null) return invalid("root", rootVocabulary());

  if (params.format !== "json") {
    return invalid("format", "format must be 'json'.");
  }
  return withExpectations(params, { key, root, format: "json" });
}

export function parseRenderRequest(
  params: CliData,
): ParsedRequest<RenderRequest> {
  const key = selectorKey(params);
  if (key === null) return invalid("key", "key must be an Indexed Key.");

  const template = parseTemplateSlot(params.template);
  if (template === null) {
    return invalid(
      "template",
      `template must be ${quotedList(TEMPLATE_SLOT_NAMES)}.`,
    );
  }

  const format = params.format;
  if (format !== "markdown" && format !== "json") {
    return invalid("format", "format must be 'markdown' or 'json'.");
  }
  if (params.root !== undefined) {
    return invalid(
      "root",
      "template-render infers the data root from template.",
    );
  }
  return withExpectations(params, { key, template, format });
}

/** `template-schema` selects a bundled schema and reads nothing item-backed. */
export function parseSchemaRequest(
  params: CliData,
): ParsedRequest<ContractRoot> {
  if (params.key !== undefined) {
    return invalid("key", "template-schema does not accept an item selector.");
  }
  const root = parseContractRoot(params.root);
  if (root === null) return invalid("root", rootVocabulary());
  return { kind: "valid", value: root };
}

/**
 * Report the vault or Zotero source the caller asserted when it differs from
 * the connected one, so an authoring loop stops before it reads or renders
 * against the wrong target.
 */
export function targetMismatch(
  params: CliData,
  identity: WorkbenchIdentity,
): Diagnostic | null {
  const expectedVault = params["expect-vault"];
  if (expectedVault !== undefined && expectedVault !== identity.vault.id) {
    return {
      code: "TARGET_MISMATCH",
      message: `Expected vault '${expectedVault}', connected to '${identity.vault.id}'.`,
      details: {
        target: "vault",
        expected: expectedVault,
        actual: identity.vault.id,
      },
    };
  }

  const expectedSource = params["expect-source"];
  if (expectedSource !== undefined && expectedSource !== identity.source.id) {
    return {
      code: "TARGET_MISMATCH",
      message: `Expected Zotero source '${expectedSource}', connected to '${identity.source.id ?? "unresolved"}'.`,
      details: {
        target: "source",
        expected: expectedSource,
        actual: identity.source.id,
      },
    };
  }
  return null;
}

/** `'a', 'b', or 'c'` — the phrasing every vocabulary message uses. */
function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `'${name}'`);
  const last = quoted.at(-1) ?? "";
  return quoted.length > 1
    ? `${quoted.slice(0, -1).join(", ")}, or ${last}`
    : last;
}

/**
 * The Indexed Key every item-backed command selects with, or `null` when the
 * flag is absent, bare, or not an Indexed Key.
 */
function selectorKey(params: CliData): string | null {
  const key = params.key;
  if (key === undefined || bareFlag(params, "key")) return null;
  return parseIndexedKey(key) ? key : null;
}

/** Obsidian's CLI reports a flag passed without a value as the string `"true"`. */
function bareFlag(params: CliData, parameter: string): boolean {
  return params[parameter] === "true";
}

/** Reject a bare identity assertion, which would assert nothing. */
function withExpectations<T>(params: CliData, value: T): ParsedRequest<T> {
  for (const parameter of ["expect-vault", "expect-source"] as const) {
    if (bareFlag(params, parameter)) {
      return invalid(parameter, `${parameter} requires a value.`);
    }
  }
  return { kind: "valid", value };
}

function parseTemplateSlot(value: string | undefined): TemplateSlot | null {
  return value !== undefined && Object.hasOwn(TEMPLATE_SLOT_ROOTS, value)
    ? (value as TemplateSlot)
    : null;
}

function rootVocabulary(): string {
  return `root must be ${quotedList(CONTRACT_ROOT_NAMES)}.`;
}

function invalid<T>(parameter: string, message: string): ParsedRequest<T> {
  return { kind: "invalid", parameter, message };
}
