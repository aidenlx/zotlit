export const PROTOCOL_VERSION_HEADER = "X-Zotlit-Protocol-Version";

// HTTP wire version. Bump only on an HTTP body/header schema change
// (notify.ts, batchUpdateRequestSchema, importNotesRequestSchema,
// noteStatusResponseSchema). URL actions are unversioned and permanent, so a
// URL-only change never bumps this.
export const PROTOCOL_VERSION = 6;

export type ProtocolVersionCheck =
  | { ok: true; received: number }
  | { ok: false; reason: "missing" | "invalid"; received: null }
  | { ok: false; reason: "older" | "newer"; received: number };

export function parseProtocolVersion(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function checkProtocolVersion(value: unknown): ProtocolVersionCheck {
  const received = parseProtocolVersion(value);
  if (received === null) {
    return {
      ok: false,
      reason: value == null || value === "" ? "missing" : "invalid",
      received: null,
    };
  }
  if (received === PROTOCOL_VERSION) return { ok: true, received };
  return {
    ok: false,
    reason: received < PROTOCOL_VERSION ? "older" : "newer",
    received,
  };
}
