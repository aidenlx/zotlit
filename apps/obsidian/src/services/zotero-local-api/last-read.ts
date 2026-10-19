import { parseIndexedKey } from "@zotlit/db";

import { Effect } from "@/lib/effect";
import { getLogger } from "@/lib/log";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import type { ZoteroLocalApiClient } from "./service";

const logger = getLogger("last-read");

/** Send only this live read, against the database that resolved its Attachment. */
export async function writeReadUse(
  { reads, api }: { reads: ZoteroReadsService; api: ZoteroLocalApiClient },
  attachmentKey: string,
  instant: Temporal.Instant,
): Promise<void> {
  const parsed = parseIndexedKey(attachmentKey);
  const state = api.state;
  if (
    !parsed ||
    parsed.groupID !== null ||
    state.kind !== "available" ||
    !state.authorized
  )
    return;
  try {
    let serverID: string | null;
    {
      await using lease = await reads.acquireRead();
      const database = await Effect.runPromise(
        lease.reads.DatabaseIdentity({}),
      );
      serverID = database.serverID;
    }
    if (serverID !== state.source.serverID) return;
    await api.writeLastRead(attachmentKey, serverID, instant);
  } catch (error) {
    logger.debug("Could not write this read Use to Zotero", {
      attachmentKey,
      error,
    });
  }
}
