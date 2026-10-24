import { Cause, Effect, Exit, Layer } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import { PluginHost } from "@/lib/plugin-host";
import * as toast from "@/lib/toast";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";

/**
 * Register the manual `zotlit:refresh-zotero-data` command: the escape hatch for
 * silent watcher staleness (system sleep, network-mounted data dirs, etc).
 *
 * A failed refresh rejects with {@link DbUnavailable}, also when the previous
 * database state keeps serving; the toast reports it. A refresh that was
 * interrupted (the plugin unloading mid-run) ends quietly and counts as done.
 */
export const layerDatabaseActions: Layer.Layer<
  never,
  never,
  PluginHost | ZoteroReads
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const reads = yield* ZoteroReads;
    const run = Effect.runPromiseExitWith(yield* Effect.context<never>());
    const refresh = async () => {
      const exit = await run(reads.refresh());
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
        throw Cause.squash(exit.cause);
    };
    host.addCommand({
      id: "refresh-zotero-data",
      name: m.command_refresh_db_name(),
      callback: async () => {
        try {
          await toast.promise(refresh(), {
            loading: m.notice_db_refreshing(),
            success: m.notice_db_refreshed(),
            error: m.notice_db_refresh_failed(),
            swallowError: false,
          });
        } catch (err) {
          if (err instanceof DbUnavailable) return;
          throw err;
        }
      },
    });
  }),
);
