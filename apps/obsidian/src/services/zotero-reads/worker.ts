// Web Worker entry: serves the ZoteroReads handler layer over the worker-runner protocol.
// Obsidian runs workers with Node integration, so `node:sqlite` and `node:fs`
// load here through the worker's `require`.
import { RpcServer, RpcWorker } from "effect/rpc";

import { Effect, Layer, Ref } from "@/lib/effect";
import { layerLibraryLogPort, layerPortLogger } from "@/lib/effect-log-port";
import { prepareRead } from "@/services/database/read-source";

import { handlersLayer } from "./handlers";
import { WorkerInitSchema, ZoteroReads } from "./rpc";
import { readSegmenterFromOpfs } from "./segmenter";
import { layerSource } from "./source";
import { launchWorker } from "./worker-launch";

/**
 * The handlers and the source start from the settings the renderer sent with
 * the spawn: the source opens them, the Item Index takes the locale. Every
 * read snapshot carries the owner tag the renderer sent, and every log record
 * goes to the port it sent.
 */
const HandlersLive = Layer.unwrap(
  RpcWorker.initialMessage(WorkerInitSchema).pipe(
    Effect.orDie,
    Effect.map(({ snapshotOwner, logs, ...config }) => {
      const level = Ref.makeUnsafe(config.logLevel);
      return handlersLayer({
        locale: config.locale,
        chineseSegmenter: config.chineseSegmenter,
        readSegmenter: readSegmenterFromOpfs,
        applyLogLevel: (next) => Ref.set(level, next),
      }).pipe(
        Layer.provide(
          layerSource({
            initial: config,
            ports: {
              prepareRead: (mode, path) =>
                prepareRead(mode, path, snapshotOwner),
            },
          }),
        ),
        Layer.provide(layerPortLogger(logs, level)),
        Layer.provide(layerLibraryLogPort),
      );
    }),
  ),
);

launchWorker(
  self,
  RpcServer.layer(ZoteroReads).pipe(Layer.provide(HandlersLive)),
);
