// Selector parsing: the request each command accepts, and the identity it asserts.

import { type CliData } from "obsidian";

import {
  parseIndexedKey,
  TEMPLATE_SLOT_ROOTS,
  type ContractRoot,
  type TemplateSlot,
} from "@zotlit/db";

import {
  diagnostic,
  type Diagnostic,
  type WorkbenchIdentity,
} from "./envelope";
import { GUIDE_TOPIC_NAMES, parseGuideTopic, type GuideTopic } from "./guide";
import { CONTRACT_ROOT_NAMES, parseContractRoot } from "./schema";
import { quotedList, TEMPLATE_SLOT_NAMES } from "./vocabulary";

export { TEMPLATE_SLOT_NAMES };

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

/** `template-source` selects a Template name and reads nothing item-backed. */
export function parseSourceRequest(
  params: CliData,
): ParsedRequest<TemplateSlot> {
  if (params.key !== undefined) {
    return invalid("key", "template-source does not accept an item selector.");
  }
  const template = parseTemplateSlot(params.template);
  if (template === null) {
    return invalid(
      "template",
      `template must be ${quotedList(TEMPLATE_SLOT_NAMES)}.`,
    );
  }
  return { kind: "valid", value: template };
}

/** `template-guide` prints the quickstart when `topic` is absent. */
export function parseGuideRequest(
  params: CliData,
): ParsedRequest<GuideTopic | null> {
  if (params.topic === undefined) return { kind: "valid", value: null };
  const topic = parseGuideTopic(params.topic);
  if (topic === null) {
    return invalid("topic", `topic must be ${quotedList(GUIDE_TOPIC_NAMES)}.`);
  }
  return { kind: "valid", value: topic };
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
    return diagnostic(
      "TARGET_MISMATCH",
      `Expected vault '${expectedVault}', connected to '${identity.vault.id}'.`,
      {
        target: "vault",
        expected: expectedVault,
        actual: identity.vault.id,
      },
    );
  }

  const expectedSource = params["expect-source"];
  if (expectedSource !== undefined && expectedSource !== identity.source.id) {
    return diagnostic(
      "TARGET_MISMATCH",
      `Expected Zotero source '${expectedSource}', connected to '${identity.source.id ?? "unresolved"}'.`,
      {
        target: "source",
        expected: expectedSource,
        actual: identity.source.id,
      },
    );
  }
  return null;
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
