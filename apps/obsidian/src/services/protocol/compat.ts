import { checkProtocolVersion, PROTOCOL_VERSION } from "@zotlit/protocol";
import type { ProtocolVersionCheck } from "@zotlit/protocol";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

const noticedVersions = new Set<string>();

interface ProtocolCompatLogger {
  warn(message: string, fields: Record<string, unknown>): void;
}

export function rejectIncompatibleProtocol(
  received: unknown,
  logger: ProtocolCompatLogger,
  context: Record<string, unknown>,
): boolean {
  const check = checkProtocolVersion(received);
  if (check.ok) return false;

  logger.warn("Rejected incompatible ZotLit protocol message", {
    ...context,
    expectedProtocolVersion: PROTOCOL_VERSION,
    receivedProtocolVersion: check.received,
    reason: check.reason,
  });
  showProtocolNotice(check);
  return true;
}

function showProtocolNotice(
  check: Exclude<ProtocolVersionCheck, { ok: true }>,
) {
  const key = check.received === null ? check.reason : String(check.received);
  if (noticedVersions.has(key)) return;
  noticedVersions.add(key);

  new BaseNotice(protocolNoticeMessage(check));
}

function protocolNoticeMessage(
  check: Exclude<ProtocolVersionCheck, { ok: true }>,
): string {
  if (check.reason === "newer") return m.notice_protocol_update_obsidian();
  return m.notice_protocol_update_zotero();
}
