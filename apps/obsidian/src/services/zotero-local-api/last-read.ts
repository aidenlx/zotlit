import { parseIndexedKey } from "@zotlit/db";

import { Effect } from "@/lib/effect";
import type { EffectBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { acquireReadLease } from "@/services/zotero-reads/lease";
import type { ZoteroReads } from "@/services/zotero-reads/service";

import type { ZoteroLocalApi } from "./service";

/** Send only this live read, against the database that resolved its Attachment. */
export async function writeReadUse(
  {
    reads,
    bridge,
    api,
  }: {
    reads: Pick<ZoteroReads["Service"], "snapshot">;
    bridge: Pick<
      EffectBridge,
      "runSync" | "runPromise" | "runPromiseExit" | "closed"
    >;
    api: Pick<ZoteroLocalApi["Service"], "state" | "writeLastRead">;
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
  const state = bridge.runSync(api.state);
  if (
    !parsed ||
    parsed.groupID !== null ||
    state.kind !== "available" ||
    !state.authorized
  ) {
    bridge.runSync(
      Effect.logTrace("Read write-back skipped").pipe(
        Effect.annotateLogs({
          attachmentKey,
          reason: !parsed
            ? "invalid attachment"
            : parsed.groupID !== null
              ? "group attachment"
              : state.kind !== "available"
                ? "unavailable"
                : "unauthorized",
        }),
        withLogCategory("last-read"),
      ),
    );
    return;
  }
  if (resolvedServerID === null || resolvedServerID !== state.source.serverID) {
    bridge.runSync(
      Effect.logTrace("Read write-back skipped").pipe(
        Effect.annotateLogs({
          attachmentKey,
          reason: "resolved source differs",
        }),
        withLogCategory("last-read"),
      ),
    );
    return;
  }
  try {
    let serverID: string | null;
    {
      await using lease = await acquireReadLease(reads, bridge);
      const database = await bridge.runPromise(
        lease.reads.DatabaseIdentity({}),
      );
      serverID = database.serverID;
    }
    if (serverID !== resolvedServerID) {
      bridge.runSync(
        Effect.logTrace("Read write-back skipped").pipe(
          Effect.annotateLogs({
            attachmentKey,
            reason: "current database differs",
          }),
          withLogCategory("last-read"),
        ),
      );
      return;
    }
    await bridge.runPromise(
      api.writeLastRead(attachmentKey, serverID, instant),
    );
  } catch (error) {
    bridge.runSync(
      Effect.logDebug("Could not write this read Use to Zotero").pipe(
        Effect.annotateLogs({ attachmentKey, error }),
        withLogCategory("last-read"),
      ),
    );
  }
}
