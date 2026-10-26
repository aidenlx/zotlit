import { Effect } from "effect";
import type { DateTime } from "effect";

import { parseIndexedKey } from "@zotlit/db";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { ZoteroLocalApi } from "./service";

const skipped = (attachmentKey: string, reason: string) =>
  Effect.logTrace("Read write-back skipped").pipe(
    Effect.annotateLogs({ attachmentKey, reason }),
  );

/**
 * Send only this live read, against the database that resolved its
 * Attachment. A failed write-back is logged and leaves no failure.
 */
export const writeReadUse = Effect.fn("writeReadUse")(function* ({
  attachmentKey,
  instant,
  serverID: resolvedServerID,
}: {
  attachmentKey: string;
  instant: DateTime.Utc;
  serverID: string | null;
}) {
  const api = yield* ZoteroLocalApi;
  const reads = yield* ZoteroReads;
  const parsed = parseIndexedKey(attachmentKey);
  const state = yield* api.state;
  if (
    !parsed ||
    parsed.groupID !== null ||
    state.kind !== "available" ||
    !state.authorized
  ) {
    return yield* skipped(
      attachmentKey,
      !parsed
        ? "invalid attachment"
        : parsed.groupID !== null
          ? "group attachment"
          : state.kind !== "available"
            ? "unavailable"
            : "unauthorized",
    );
  }
  if (resolvedServerID === null || resolvedServerID !== state.source.serverID) {
    return yield* skipped(attachmentKey, "resolved source differs");
  }
  yield* Effect.gen(function* () {
    const { serverID } = yield* Effect.scoped(
      Effect.flatMap(reads.snapshot, (snapshot) =>
        snapshot.DatabaseIdentity({}),
      ),
    );
    if (serverID !== resolvedServerID) {
      return yield* skipped(attachmentKey, "current database differs");
    }
    yield* api.writeLastRead(attachmentKey, serverID, instant);
  }).pipe(
    recover(
      (cause) =>
        Effect.logDebug("Could not write this read Use to Zotero", cause).pipe(
          Effect.annotateLogs({ attachmentKey }),
        ),
      Effect.void,
    ),
  );
}, withLogCategory("last-read"));
