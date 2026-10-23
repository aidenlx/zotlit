import { parseIndexedKey } from "@zotlit/db";

import { Effect } from "@/lib/effect";
import { getLogger } from "@/lib/log";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";

import type { ZoteroLocalApiClient } from "./service";

const logger = getLogger("last-read");

/** Send only this live read, against the database that resolved its Attachment. */
export async function writeReadUse(
  {
    reads,
    api,
  }: {
    reads: Pick<PlainZoteroReads, "acquireRead">;
    api: ZoteroLocalApiClient;
  },
  {
    attachmentKey,
    instant,
    serverID: resolvedServerID,
  }: {
    attachmentKey: string;
    instant: Temporal.Instant;
    serverID: string | null;
  },
): Promise<void> {
  const parsed = parseIndexedKey(attachmentKey);
  const state = api.state;
  if (
    !parsed ||
    parsed.groupID !== null ||
    state.kind !== "available" ||
    !state.authorized
  ) {
    logger.trace("Read write-back skipped", {
      attachmentKey,
      reason: !parsed
        ? "invalid attachment"
        : parsed.groupID !== null
          ? "group attachment"
          : state.kind !== "available"
            ? "unavailable"
            : "unauthorized",
    });
    return;
  }
  if (resolvedServerID === null || resolvedServerID !== state.source.serverID) {
    logger.trace("Read write-back skipped", {
      attachmentKey,
      reason: "resolved source differs",
    });
    return;
  }
  try {
    let serverID: string | null;
    {
      await using lease = await reads.acquireRead();
      const database = await Effect.runPromise(
        lease.reads.DatabaseIdentity({}),
      );
      serverID = database.serverID;
    }
    if (serverID !== resolvedServerID) {
      logger.trace("Read write-back skipped", {
        attachmentKey,
        reason: "current database differs",
      });
      return;
    }
    await api.writeLastRead(attachmentKey, serverID, instant);
  } catch (error) {
    logger.debug("Could not write this read Use to Zotero", {
      attachmentKey,
      error,
    });
  }
}
