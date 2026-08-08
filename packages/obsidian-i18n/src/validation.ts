// Validates JSON Language Pack data against the bounded runtime contract.

import { isSupportedLanguagePackFormatter } from "./language-pack.js";
import type { LanguagePack } from "./language-pack.js";

export { isSupportedLanguagePackFormatter } from "./language-pack.js";

/** Pack schema this plugin build reads; packs declaring anything else are rejected. */
export const LANGUAGE_PACK_SCHEMA_VERSION = 1;

/**
 * A pack whose schema this build cannot read. {@link updateNeeded} tells the
 * two cases apart: a pack from a newer lineage is fixed by updating the
 * consuming plugin, while any other mismatch is a stale or corrupt artifact
 * the user cannot act on.
 */
export class LanguagePackSchemaVersionError extends Error {
  readonly updateNeeded: boolean;

  constructor(schemaVersion: unknown) {
    super(
      `Invalid Language Pack: $.schemaVersion must be ${LANGUAGE_PACK_SCHEMA_VERSION}`,
    );
    this.updateNeeded =
      typeof schemaVersion === "number" &&
      schemaVersion > LANGUAGE_PACK_SCHEMA_VERSION;
  }
}

export const LANGUAGE_PACK_LIMITS = {
  bytes: 256 * 1024,
  messages: 1_000,
  textLength: 10_000,
  depth: 16,
} as const;

type ValidateLanguagePackOptions = {
  expectedLocale: string;
};

export function validateLanguagePack(
  source: string,
  { expectedLocale }: ValidateLanguagePackOptions,
): LanguagePack {
  const byteLength = new TextEncoder().encode(source).byteLength;
  if (byteLength > LANGUAGE_PACK_LIMITS.bytes) {
    invalid(`pack exceeds ${LANGUAGE_PACK_LIMITS.bytes} bytes`);
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return invalid("pack must be valid JSON");
  }

  const pack = requireRecord(value, "$", [
    "schemaVersion",
    "locale",
    "messages",
  ]);
  requireKeys(pack, "$", ["schemaVersion", "locale", "messages"]);
  if (pack.schemaVersion !== LANGUAGE_PACK_SCHEMA_VERSION) {
    throw new LanguagePackSchemaVersionError(pack.schemaVersion);
  }
  if (pack.locale !== expectedLocale) {
    invalid(`$.locale must equal ${JSON.stringify(expectedLocale)}`);
  }

  const messages = requireRecord(pack.messages, "$.messages");
  const entries = Object.entries(messages);
  if (entries.length > LANGUAGE_PACK_LIMITS.messages) {
    invalid(`pack exceeds ${LANGUAGE_PACK_LIMITS.messages} messages`);
  }
  for (const [messageId, message] of entries) {
    validateMessage(message, `$.messages.${messageId}`, 3);
  }

  // validateMessage recursively checks every message against the exact
  // Message/Declaration/Expression/Variant/Match shapes below, so `pack`
  // matches LanguagePack in full at this point.
  return pack as LanguagePack;
}

function validateMessage(value: unknown, path: string, depth: number): void {
  requireDepth(depth);
  if (typeof value === "string") {
    validateText(value, path);
    return;
  }

  const message = requireRecord(value, path, ["declarations", "variants"]);
  requireKeys(message, path, ["declarations", "variants"]);
  const declarations = requireArray(
    message.declarations,
    `${path}.declarations`,
    depth + 1,
  );
  for (const [index, declaration] of declarations.entries()) {
    validateDeclaration(
      declaration,
      `${path}.declarations[${index}]`,
      depth + 2,
    );
  }
  const variants = requireArray(
    message.variants,
    `${path}.variants`,
    depth + 1,
  );
  if (variants.length === 0) {
    invalid(`${path}.variants must contain at least one variant`);
  }
  for (const [index, variant] of variants.entries()) {
    validateVariant(variant, `${path}.variants[${index}]`, depth + 2);
  }
}

function validateDeclaration(
  value: unknown,
  path: string,
  depth: number,
): void {
  requireDepth(depth);
  const declaration = requireRecord(value, path);
  if (declaration.type === "input") {
    requireExactKeys(declaration, path, ["type", "name"]);
    requireText(declaration.name, `${path}.name`);
    return;
  }
  if (declaration.type === "local") {
    requireExactKeys(declaration, path, ["type", "name", "value"]);
    requireText(declaration.name, `${path}.name`);
    validateExpression(declaration.value, `${path}.value`, depth + 1);
    return;
  }
  invalid(`${path}.type must be "input" or "local"`);
}

function validateVariant(value: unknown, path: string, depth: number): void {
  requireDepth(depth);
  const variant = requireRecord(value, path, ["matches", "pattern"]);
  requireKeys(variant, path, ["matches", "pattern"]);
  const matches = requireArray(variant.matches, `${path}.matches`, depth + 1);
  for (const [index, match] of matches.entries()) {
    validateMatch(match, `${path}.matches[${index}]`, depth + 2);
  }
  const pattern = requireArray(variant.pattern, `${path}.pattern`, depth + 1);
  for (const [index, expression] of pattern.entries()) {
    validateExpression(expression, `${path}.pattern[${index}]`, depth + 2);
  }
}

function validateMatch(value: unknown, path: string, depth: number): void {
  requireDepth(depth);
  const match = requireRecord(value, path);
  if (match.type === "literal") {
    requireExactKeys(match, path, ["type", "key", "value"]);
    requireText(match.key, `${path}.key`);
    requireText(match.value, `${path}.value`);
    return;
  }
  if (match.type === "catchall") {
    requireExactKeys(match, path, ["type", "key"]);
    requireText(match.key, `${path}.key`);
    return;
  }
  invalid(`${path}.type must be "literal" or "catchall"`);
}

function validateExpression(value: unknown, path: string, depth: number): void {
  requireDepth(depth);
  const expression = requireRecord(value, path);
  switch (expression.type) {
    case "text":
    case "literal":
      requireExactKeys(expression, path, ["type", "value"]);
      requireText(expression.value, `${path}.value`);
      return;
    case "variable":
      requireExactKeys(expression, path, ["type", "name"]);
      requireText(expression.name, `${path}.name`);
      return;
    case "formatter": {
      requireExactKeys(expression, path, [
        "type",
        "name",
        "argument",
        "options",
      ]);
      const name = requireText(expression.name, `${path}.name`);
      if (!isSupportedLanguagePackFormatter(name)) {
        invalid(`${path} has unsupported formatter ${JSON.stringify(name)}`);
      }
      validateExpression(expression.argument, `${path}.argument`, depth + 1);
      requireDepth(depth + 1);
      const options = requireRecord(expression.options, `${path}.options`);
      for (const [optionName, option] of Object.entries(options)) {
        validateExpression(option, `${path}.options.${optionName}`, depth + 2);
      }
      return;
    }
    default:
      invalid(`${path}.type is unsupported`);
  }
}

function requireArray(value: unknown, path: string, depth: number): unknown[] {
  requireDepth(depth);
  if (!Array.isArray(value)) invalid(`${path} must be an array`);
  return value;
}

function requireRecord(
  value: unknown,
  path: string,
  allowedKeys?: string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${path} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (allowedKeys !== undefined) {
    for (const key of Object.keys(record)) {
      if (!allowedKeys.includes(key)) invalid(`${path}.${key} is unsupported`);
    }
  }
  return record;
}

function requireKeys(
  value: Record<string, unknown>,
  path: string,
  keys: string[],
): void {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) invalid(`${path}.${key} is required`);
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  path: string,
  keys: string[],
): void {
  requireKeys(value, path, keys);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) invalid(`${path}.${key} is unsupported`);
  }
}

function requireText(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(`${path} must be a string`);
  validateText(value, path);
  return value;
}

function validateText(value: string, path: string): void {
  if (value.length > LANGUAGE_PACK_LIMITS.textLength) {
    invalid(`${path} exceeds ${LANGUAGE_PACK_LIMITS.textLength} characters`);
  }
}

function requireDepth(depth: number): void {
  if (depth > LANGUAGE_PACK_LIMITS.depth) {
    invalid(`pack exceeds nesting depth ${LANGUAGE_PACK_LIMITS.depth}`);
  }
}

function invalid(message: string): never {
  throw new Error(`Invalid Language Pack: ${message}`);
}
