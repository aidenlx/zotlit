// Web Worker entry: serves the ZoteroReads handler layer over the worker-runner protocol.
// Obsidian runs workers with Node integration, so `node:sqlite` and `node:fs`
// load here through the worker's `require`.
import * as BrowserWorkerRunner from "@effect/platform-browser/BrowserWorkerRunner";
import { configureSync, getConsoleSink } from "@logtape/logtape";
import { Effect, Layer } from "effect";
import { RpcServer, RpcWorker } from "effect/rpc";

import { handlersLayer } from "./handlers";
import { ReadsConfigSchema, ZoteroReads } from "./rpc";
import { readSegmenterFromOpfs } from "./segmenter";
import { layerSource } from "./source";
import { WORKER_CLOSED } from "./worker-signal";

// The worker has its own LogTape instance; without a sink its records vanish.
configureSync({
  sinks: { console: getConsoleSink() },
  loggers: [
    {
      category: ["zotlit"],
      sinks: ["console"],
      lowestLevel: __DEV__ ? "debug" : "info",
    },
    {
      category: ["logtape", "meta"],
      sinks: ["console"],
      lowestLevel: "warning",
    },
  ],
});

const ProtocolLive = RpcServer.layerProtocolWorkerRunner.pipe(
  Layer.provide(BrowserWorkerRunner.layer),
);

/**
 * The handlers and the source start from the settings the renderer sent with
 * the spawn: the source opens them, the Item Index takes the locale.
 */
const HandlersLive = Layer.unwrap(
  RpcWorker.initialMessage(ReadsConfigSchema).pipe(
    Effect.orDie,
    Effect.map((initial) =>
      handlersLayer({
        locale: initial.locale,
        chineseSegmenter: initial.chineseSegmenter,
        readSegmenter: readSegmenterFromOpfs,
      }).pipe(Layer.provide(layerSource({ initial }))),
    ),
  ),
);

const main = RpcServer.layer(ZoteroReads).pipe(
  Layer.provide(HandlersLive),
  Layer.provide(ProtocolLive),
  Layer.launch,
  Effect.runFork,
);
// The renderer's close message ends the launch; its finalizers have closed
// every client and removed every snapshot by the time this observer runs.
main.addObserver(() => self.postMessage(WORKER_CLOSED));
