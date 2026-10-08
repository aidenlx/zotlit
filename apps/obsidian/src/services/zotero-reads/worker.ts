// Web Worker entry: serves the ZoteroReads handler layer over the worker-runner protocol.
// Obsidian runs workers with Node integration, so `node:sqlite` and `node:fs`
// load here through the worker's `require`.
import * as BrowserWorkerRunner from "@effect/platform-browser/BrowserWorkerRunner";
import { configureSync, getConsoleSink } from "@logtape/logtape";
import type { LogLevel } from "@logtape/logtape";
import { Effect, Layer } from "effect";
import { RpcServer, RpcWorker } from "effect/rpc";

import { prepareRead } from "@/services/database/read-source";

import { handlersLayer } from "./handlers";
import { WorkerInitSchema, ZoteroReads } from "./rpc";
import { readSegmenterFromOpfs } from "./segmenter";
import { layerSource } from "./source";
import { WORKER_CLOSED } from "./worker-signal";

/**
 * Forward the worker's log records at `level` and above to the renderer
 * through `port`; the renderer emits them into the plugin's logger. `null`
 * forwards none. LogTape's own warnings, such as a record the port cannot
 * clone, go to the worker's console: LogTape never reports a sink's failure
 * through that same sink.
 */
const forwardLogs = (port: MessagePort, level: LogLevel | null) =>
  configureSync({
    reset: true,
    sinks: {
      renderer: (record) => port.postMessage(record),
      console: getConsoleSink(),
    },
    loggers: [
      {
        category: ["zotlit"],
        sinks: level === null ? [] : ["renderer"],
        lowestLevel: level ?? "fatal",
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
 * the spawn: the source opens them, the Item Index takes the locale. Every
 * read snapshot carries the owner tag the renderer sent, and every log record
 * goes to the port it sent.
 */
const HandlersLive = Layer.unwrap(
  RpcWorker.initialMessage(WorkerInitSchema).pipe(
    Effect.orDie,
    Effect.map(({ snapshotOwner, logs, ...initial }) => {
      forwardLogs(logs, initial.logLevel);
      return handlersLayer({
        locale: initial.locale,
        chineseSegmenter: initial.chineseSegmenter,
        readSegmenter: readSegmenterFromOpfs,
        applyLogLevel: (level) => forwardLogs(logs, level),
      }).pipe(
        Layer.provide(
          layerSource({
            initial,
            ports: {
              prepareRead: (mode, path) =>
                prepareRead(mode, path, snapshotOwner),
            },
          }),
        ),
      );
    }),
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
