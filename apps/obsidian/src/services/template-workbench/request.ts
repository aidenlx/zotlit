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
import { choices, quotedList, TEMPLATE_SLOT_NAMES } from "./vocabulary";

export { TEMPLATE_SLOT_NAMES };

/** A parsed selector, or the one parameter that made it invalid. */
export type ParsedRequest<T> =
  | { kind: "valid"; value: T }
  | { kind: "invalid"; parameter: string; message: string };

/**
 * Per-command accepted-parameter lists: the single source of truth `satisfies
 * Record<..., CliFlag>` in `register.ts` types each command's help metadata
 * against, so the declared flags and this allowlist cannot drift apart.
 */
export const STATUS_PARAMS = [] as const;
export const DATA_PARAMS = ["key", "root", "format", "expect-source"] as const;
export const SCHEMA_PARAMS = [] as const;
export const RENDER_PARAMS = [
  "key",
  "template",
  "format",
  "expect-source",
] as const;
export const GUIDE_PARAMS = ["topic"] as const;
export const SOURCE_PARAMS = ["template"] as const;

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
  const rejected = rejectAccepted(params, {
    command: "template-data",
    accepted: DATA_PARAMS,
    hints: { template: dataCommandTemplateHint() },
  });
  if (rejected) return invalid(rejected.parameter, rejected.message);

  const key = selectorKey(params);
  if (key === null) return invalid("key", "key must be an Indexed Key.");

  const root = parseContractRoot(params.root);
  if (root === null) return invalid("root", rootVocabulary());

  const format = params.format ?? "json";
  if (format !== "json") {
    return invalid("format", "format must be 'json'.");
  }
  return withExpectations(params, { key, root, format: "json" });
}

export function parseRenderRequest(
  params: CliData,
): ParsedRequest<RenderRequest> {
  const rejected = rejectAccepted(params, {
    command: "template-render",
    accepted: RENDER_PARAMS,
    hints: { root: "template-render infers the data root from template." },
  });
  if (rejected) return invalid(rejected.parameter, rejected.message);

  const key = selectorKey(params);
  if (key === null) return invalid("key", "key must be an Indexed Key.");

  const template = parseTemplateSlot(params.template);
  if (template === null) {
    return invalid(
      "template",
      `template must be ${quotedList(TEMPLATE_SLOT_NAMES)}.`,
    );
  }

  const format = params.format ?? "json";
  if (format !== "markdown" && format !== "json") {
    return invalid("format", "format must be 'markdown' or 'json'.");
  }
  return withExpectations(params, { key, template, format });
}

/** `template-schema` lists every published schema and reads no selector at all. */
export function parseSchemaRequest(params: CliData): ParsedRequest<null> {
  const rejected = rejectAccepted(params, {
    command: "template-schema",
    accepted: SCHEMA_PARAMS,
    hints: {
      key: "template-schema does not accept an item selector.",
      root: SCHEMA_LISTS_EVERY_ROOT_MESSAGE,
      template: SCHEMA_LISTS_EVERY_ROOT_MESSAGE,
    },
  });
  if (rejected) return invalid(rejected.parameter, rejected.message);
  return { kind: "valid", value: null };
}

/** `template-source` selects a Template name and reads nothing item-backed. */
export function parseSourceRequest(
  params: CliData,
): ParsedRequest<TemplateSlot> {
  const rejected = rejectAccepted(params, {
    command: "template-source",
    accepted: SOURCE_PARAMS,
    hints: {
      key: "template-source does not accept an item selector.",
      root: slotCommandRootHint(),
    },
  });
  if (rejected) return invalid(rejected.parameter, rejected.message);

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
  const rejected = rejectAccepted(params, {
    command: "template-guide",
    accepted: GUIDE_PARAMS,
  });
  if (rejected) return invalid(rejected.parameter, rejected.message);

  if (params.topic === undefined) return { kind: "valid", value: null };
  const topic = parseGuideTopic(params.topic);
  if (topic === null) {
    return invalid("topic", `topic must be ${quotedList(GUIDE_TOPIC_NAMES)}.`);
  }
  return { kind: "valid", value: topic };
}

/** `template-status` reads no selector at all. */
export function parseStatusRequest(params: CliData): ParsedRequest<null> {
  const rejected = rejectAccepted(params, {
    command: "template-status",
    accepted: STATUS_PARAMS,
  });
  if (rejected) return invalid(rejected.parameter, rejected.message);
  return { kind: "valid", value: null };
}

/**
 * Report the Zotero source the caller asserted when it differs from the
 * connected one, so an authoring loop stops before it reads or renders
 * against the wrong target.
 */
export function targetMismatch(
  params: CliData,
  identity: WorkbenchIdentity,
): Diagnostic | null {
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
  if (bareFlag(params, "expect-source")) {
    return invalid("expect-source", "expect-source requires a value.");
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

/**
 * Obsidian passes every caller token straight through as `CliData`, filtering
 * nothing itself, so the Workbench must reject what it did not declare. A
 * `--*` token is left for Obsidian or its CLI binary and skipped; `vault`
 * typed after the command name reached us only because Obsidian's own vault
 * selection already ran (and ran on the wrong vault, since this call named
 * one); anything else is an unrecognized parameter for the command.
 */
function rejectAccepted(
  params: CliData,
  options: {
    command: string;
    accepted: readonly string[];
    hints?: Readonly<Record<string, string>>;
  },
): { parameter: string; message: string } | null {
  const { command, accepted, hints = {} } = options;
  for (const key of Object.keys(params)) {
    if (key.startsWith("--") || accepted.includes(key)) continue;
    if (key === "vault") {
      return { parameter: "vault", message: VAULT_AFTER_COMMAND_MESSAGE };
    }
    const hint = hints[key];
    return {
      parameter: key,
      message:
        hint ??
        `Unknown parameter '${key}' for ${command}. Accepted parameters: ${accepted.join(", ")}.`,
    };
  }
  for (const key of accepted) {
    if (params[key] === "") {
      return { parameter: key, message: `${key} requires a value.` };
    }
  }
  return null;
}

const VAULT_AFTER_COMMAND_MESSAGE =
  "vault must come before the command name (obsidian-cli vault=<name> zotlit:...); placed after, Obsidian ignores it and routes the call by working directory or focused window instead.";

/** `template-source` reads a `root=` swap meant for the data-root command. */
function slotCommandRootHint(): string {
  return (
    `template-source selects a Template slot; use template=${choices(TEMPLATE_SLOT_NAMES)}. ` +
    `root=${choices(CONTRACT_ROOT_NAMES)} selects a data root, on template-data.`
  );
}

/** `template-data` reads a `template=` swap meant for a slot command. */
function dataCommandTemplateHint(): string {
  return (
    `template-data selects a data root; use root=${choices(CONTRACT_ROOT_NAMES)}. ` +
    `template=${choices(TEMPLATE_SLOT_NAMES)} selects a Template slot, on template-render or template-source.`
  );
}

/** `template-schema` reads a selector left over from its earlier per-root form. */
const SCHEMA_LISTS_EVERY_ROOT_MESSAGE =
  "template-schema takes no parameters; it answers with the schema of every data root, keyed by root under 'schemas'.";

function invalid<T>(parameter: string, message: string): ParsedRequest<T> {
  return { kind: "invalid", parameter, message };
}
