export const PROTOCOL_VERSION_HEADER = "X-Zotlit-Protocol-Version";
export const PROTOCOL_VERSION_PARAM = "v";

// Bump on any change to the wire shapes in notify.ts or url.ts.
export const PROTOCOL_VERSION = 2;

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
