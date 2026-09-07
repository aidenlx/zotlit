export const VERSION_KEY = "__VERSION__";

export type DiskClassification =
  | { kind: "missing" }
  | { kind: "legacy"; raw: Record<string, unknown> }
  | { kind: "v1"; raw: Record<string, unknown> }
  | { kind: "v2"; raw: Record<string, unknown> }
  | { kind: "v3"; raw: Record<string, unknown> }
  | { kind: "v4"; raw: Record<string, unknown> }
  | { kind: "v5"; raw: Record<string, unknown> }
  | { kind: "v6"; raw: Record<string, unknown> }
  | { kind: "v7"; raw: Record<string, unknown> }
  | { kind: "v8"; raw: Record<string, unknown> }
  | { kind: "v9"; raw: Record<string, unknown> }
  | { kind: "v10"; raw: Record<string, unknown> }
  | { kind: "future"; version: number }
  | { kind: "malformed"; reason: string };

/**
 * Bucketed origin of a completed settings load, for the release service's
 * same-launch onboarding branch. `legacy` = ZotLit v1 Legacy Data was detected
 * and migrated this launch; `absent`/`malformed` both mean no usable data on
 * disk (first-install onboarding); `current` = existing versioned data loaded
 * normally.
 */
export type HydrationOrigin = "legacy" | "absent" | "malformed" | "current";

export function hydrationOriginOf(
  kind: DiskClassification["kind"],
): HydrationOrigin {
  switch (kind) {
    case "legacy":
      return "legacy";
    case "missing":
      return "absent";
    case "malformed":
      return "malformed";
    case "v1":
    case "v2":
    case "v3":
    case "v4":
    case "v5":
    case "v6":
    case "v7":
    case "v8":
    case "v9":
    case "v10":
    case "future":
      return "current";
  }
}

/**
 * Classify the raw `loadData()` result. Only `null` means "no `data.json`";
 * `undefined` and any other non-plain value fall into `malformed` so the
 * service can warn loudly instead of silently treating them as fresh state.
 */
export function classifyDiskData(raw: unknown): DiskClassification {
  if (raw === null) return { kind: "missing" };
  if (!isPlainObject(raw)) {
    return { kind: "malformed", reason: "data is not a plain object" };
  }
  if (!Object.hasOwn(raw, VERSION_KEY)) {
    return { kind: "legacy", raw };
  }
  const version = raw[VERSION_KEY];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return {
      kind: "malformed",
      reason: `__VERSION__ is not an integer (got ${describe(version)})`,
    };
  }
  if (version === 1) return { kind: "v1", raw };
  if (version === 2) return { kind: "v2", raw };
  if (version === 3) return { kind: "v3", raw };
  if (version === 4) return { kind: "v4", raw };
  if (version === 5) return { kind: "v5", raw };
  if (version === 6) return { kind: "v6", raw };
  if (version === 7) return { kind: "v7", raw };
  if (version === 8) return { kind: "v8", raw };
  if (version === 9) return { kind: "v9", raw };
  if (version === 10) return { kind: "v10", raw };
  if (version > 10) return { kind: "future", version };
  return {
    kind: "malformed",
    reason: `__VERSION__ is not a positive integer (got ${version})`,
  };
}

/**
 * Narrow `value` to a plain object literal (prototype is `Object.prototype`
 * or `null`). Arrays, class instances, and primitives are rejected so the
 * settings layer never confuses, e.g., a `Map` or a `Date` with persisted
 * key-value data.
 */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return String(value);
  return typeof value;
}
