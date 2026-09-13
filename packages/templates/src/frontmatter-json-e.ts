import jsonE from "json-e";

import { basename } from "./basename";
import { RESERVED_FRONTMATTER_KEYS } from "./constants";
import { FRONTMATTER_ABSENT } from "./frontmatter-merge";

const ENVELOPE_KEY = "value";
const MAX_OUTPUT_DEPTH = 32;
const renderJsonE = jsonE as unknown as (
  template: unknown,
  context: Record<string, unknown>,
) => unknown;

export type FrontmatterJsonValue =
  | null
  | boolean
  | number
  | string
  | FrontmatterJsonValue[]
  | { [key: string]: FrontmatterJsonValue };

type FrontmatterTarget =
  | { readonly key: string; readonly position?: number }
  | { readonly key?: undefined; readonly position: number };

export type RenderJsonEFrontmatterValueOptions = FrontmatterTarget & {
  readonly zt: object;
  readonly operationTimestamp: Temporal.Instant;
};

export class ManagedFrontmatterError extends Error {
  readonly key: string | undefined;
  readonly recovery: string;

  constructor(
    { key, position }: FrontmatterTarget,
    message: string,
    options: ErrorOptions = {},
  ) {
    const target =
      key === undefined
        ? `entry #${position}`
        : `field '${key}'${position === undefined ? "" : ` (entry #${position})`}`;
    super(`Managed Frontmatter ${target} ${message}`, options);
    this.name = "ManagedFrontmatterError";
    this.key = key;
    this.recovery = `Correct the value for Managed Frontmatter ${target}.`;
  }
}

export { ManagedFrontmatterError as FrontmatterJsonEError };

class FrontmatterOutputDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterOutputDomainError";
  }
}

/** Render one JSON-e value and distinguish generated null from field absence. */
export function renderJsonEFrontmatterValue(
  template: unknown,
  options: RenderJsonEFrontmatterValueOptions & { key?: undefined },
): Record<string, FrontmatterJsonValue> | typeof FRONTMATTER_ABSENT;
export function renderJsonEFrontmatterValue(
  template: unknown,
  options: RenderJsonEFrontmatterValueOptions,
): FrontmatterJsonValue | typeof FRONTMATTER_ABSENT;
export function renderJsonEFrontmatterValue(
  template: unknown,
  options: RenderJsonEFrontmatterValueOptions,
): FrontmatterJsonValue | typeof FRONTMATTER_ABSENT {
  const { zt, operationTimestamp } = options;
  let envelope: unknown;
  try {
    envelope = renderJsonE(
      { [ENVELOPE_KEY]: template },
      {
        zt: projectJsonEData(zt),
        now: operationTimestamp.toString(),
        has: jsonEHas,
        uniq: jsonEUniq,
        basename: jsonEBasename,
      },
    );
  } catch (cause) {
    throw new ManagedFrontmatterError(
      options,
      `failed JSON-e evaluation: ${errorMessage(cause)}`,
      { cause },
    );
  }

  if (!isPlainMapping(envelope) || !Object.hasOwn(envelope, ENVELOPE_KEY)) {
    return FRONTMATTER_ABSENT;
  }

  const value = envelope[ENVELOPE_KEY];
  if (options.key === undefined) {
    assertFrontmatterSpreadOutput(value, options.position);
    return value;
  }
  try {
    assertFrontmatterOutputDomain(value);
  } catch (cause) {
    throw new ManagedFrontmatterError(
      options,
      `produced an invalid frontmatter value: ${errorMessage(cause)}`,
      { cause },
    );
  }
  return value;
}

export function assertFrontmatterSpreadOutput(
  value: unknown,
  position: number,
): asserts value is Record<string, FrontmatterJsonValue> {
  if (!isPlainMapping(value)) {
    throw new ManagedFrontmatterError({ position }, "must produce a mapping");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new ManagedFrontmatterError(
        { position },
        "mapping keys must be strings",
      );
    }
    if (key === "" || RESERVED_FRONTMATTER_KEYS.has(key)) {
      throw new ManagedFrontmatterError(
        { key, position },
        key === "" ? "must be non-empty" : "is reserved",
      );
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("mapping entries must be enumerable values");
      }
      assertFrontmatterOutputDomain(descriptor.value);
    } catch (cause) {
      throw new ManagedFrontmatterError(
        { key, position },
        `produced an invalid frontmatter value: ${errorMessage(cause)}`,
        { cause },
      );
    }
  }
}

/** Snapshot enumerable data without exposing methods or helper functions. */
function projectJsonEData(
  value: unknown,
  projectedBySource = new WeakMap<object, object>(),
): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    value === undefined
  ) {
    return value;
  }
  if (typeof value !== "object") return undefined;
  if (
    value instanceof Temporal.Instant ||
    value instanceof Temporal.PlainDate ||
    value instanceof Temporal.PlainYearMonth
  ) {
    return value.toString();
  }
  const existing = projectedBySource.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    const projected: unknown[] = [];
    projectedBySource.set(value, projected);
    for (const item of value) {
      projected.push(projectJsonEData(item, projectedBySource));
    }
    return projected;
  }
  if (!isPlainMapping(value)) {
    throw new TypeError("zt data must contain plain objects only");
  }

  const projected: Record<string, unknown> = {};
  projectedBySource.set(value, projected);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable) continue;
    const source =
      "value" in descriptor ? descriptor.value : descriptor.get?.call(value);
    const item = projectJsonEData(source, projectedBySource);
    if (item === undefined) continue;
    Object.defineProperty(projected, key, {
      value: item,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return projected;
}

function jsonEHas(...args: unknown[]): boolean {
  assertArgumentCount("has", args, 3);
  const [items, key, value] = args;
  if (!Array.isArray(items)) throw new TypeError("has items must be an array");
  if (typeof key !== "string") throw new TypeError("has key must be a string");
  assertFrontmatterOutputDomain(items);
  assertFrontmatterOutputDomain(value);
  if (!items.every(isPlainMapping)) {
    throw new TypeError("has items must contain mappings");
  }
  return items.some(
    (item) =>
      isPlainMapping(item) &&
      Object.hasOwn(item, key) &&
      Object.is(item[key], value),
  );
}

function jsonEUniq(...args: unknown[]): FrontmatterJsonValue[] {
  assertArgumentCount("uniq", args, 1);
  const [items] = args;
  if (!Array.isArray(items)) throw new TypeError("uniq items must be an array");
  assertFrontmatterOutputDomain(items);
  return [...new Set(items)];
}

function jsonEBasename(...args: unknown[]): string {
  if (args.length < 1 || args.length > 2) {
    throw new TypeError("basename expects one or two arguments");
  }
  const [path, ext] = args;
  if (typeof path !== "string") {
    throw new TypeError("basename path must be a string");
  }
  if (ext !== undefined && typeof ext !== "string") {
    throw new TypeError("basename extension must be a string");
  }
  return basename(path, ext);
}

function assertArgumentCount(
  name: string,
  args: readonly unknown[],
  expected: number,
): void {
  if (args.length !== expected) {
    throw new TypeError(`${name} expects ${expected} arguments`);
  }
}

export function assertFrontmatterOutputDomain(
  value: unknown,
): asserts value is FrontmatterJsonValue {
  assertOutputDomain(value, 0, new Set());
}

function assertOutputDomain(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
): asserts value is FrontmatterJsonValue {
  if (depth > MAX_OUTPUT_DEPTH) {
    throw new FrontmatterOutputDomainError(
      `value exceeds maximum depth ${MAX_OUTPUT_DEPTH}`,
    );
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new FrontmatterOutputDomainError("number must be finite");
    }
    return;
  }
  if (typeof value !== "object") {
    throw new FrontmatterOutputDomainError(`unsupported ${typeof value} value`);
  }
  if (ancestors.has(value)) {
    throw new FrontmatterOutputDomainError("value contains a cycle");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      assertArrayOutput(value, depth, ancestors);
      return;
    }
    if (!isPlainMapping(value)) {
      throw new FrontmatterOutputDomainError("mapping must be a plain object");
    }
    assertMappingOutput(value, depth, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function assertArrayOutput(
  value: unknown[],
  depth: number,
  ancestors: Set<object>,
): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new FrontmatterOutputDomainError("array must be a plain array");
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new FrontmatterOutputDomainError("array must contain every item");
    }
    assertOutputDomain(value[index], depth + 1, ancestors);
  }
  if (Object.keys(value).some((key) => !isArrayIndex(key, value.length))) {
    throw new FrontmatterOutputDomainError(
      "array must contain indexed items only",
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new FrontmatterOutputDomainError("array keys must be strings");
  }
}

function assertMappingOutput(
  value: Record<string, unknown>,
  depth: number,
  ancestors: Set<object>,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new FrontmatterOutputDomainError("mapping keys must be strings");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw new FrontmatterOutputDomainError(
        "mapping entries must be enumerable values",
      );
    }
    assertOutputDomain(descriptor.value, depth + 1, ancestors);
  }
}

function isArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < length &&
    `${index}` === key
  );
}

function isPlainMapping(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
