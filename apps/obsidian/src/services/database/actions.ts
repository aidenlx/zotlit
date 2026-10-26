import { Cause, Effect, Exit, Layer } from "effect";

import { exitOver, scopedBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import type { Notifier } from "@/lib/notifier";
import { withProgress } from "@/lib/notifier";
import { PluginHost } from "@/lib/plugin-host";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";

/**
 * Register the manual `zotlit:refresh-zotero-data` command: the escape hatch for
 * silent watcher staleness (system sleep, network-mounted data dirs, etc).
 *
 * A failed refresh rejects with {@link DbUnavailable}, also when the previous
 * database state keeps serving; the toast reports it. A refresh that was
 * interrupted (the plugin unloading mid-run) ends quietly, with no notice.
 */
export const layerDatabaseActions: Layer.Layer<
  never,
  never,
  PluginHost | Notifier | ZoteroReads
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const reads = yield* ZoteroReads;
    const run = exitOver(
      yield* scopedBridge,
      yield* Effect.context<Notifier>(),
    );
    // The toast outlives the command, as `toast.promise` did, until the
    // Notifier's layer closes.
    const refresh = withProgress(reads.refresh, {
      loading: m.notice_db_refreshing(),
      success: m.notice_db_refreshed(),
      error: m.notice_db_refresh_failed(),
    });
    yield* host.addCommand({
      id: "refresh-zotero-data",
      name: m.command_refresh_db_name(),
      callback: async () => {
        const exit = await run(refresh);
        if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) return;
        const error = Cause.squash(exit.cause);
        if (error instanceof DbUnavailable) return;
        throw error;
      },
    });
  }),
);
