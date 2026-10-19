// Web Worker entry: serves the ZoteroReads handler layer over the worker-runner protocol.
// Obsidian runs workers with Node integration, so `node:sqlite` and `node:fs`
// load here through the worker's `require`.
import { configureSync, getConsoleSink } from "@logtape/logtape";
import type { LogLevel } from "@logtape/logtape";
import { RpcServer, RpcWorker } from "effect/rpc";

import { Effect, Layer } from "@/lib/effect";
import { prepareRead } from "@/services/database/read-source";

import { handlersLayer } from "./handlers";
import { WorkerInitSchema, ZoteroReads } from "./rpc";
import { readSegmenterFromOpfs } from "./segmenter";
import { layerSource } from "./source";
import { launchWorker } from "./worker-launch";

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
      forwardLogs(logs, config.logLevel);
      return handlersLayer({
        locale: config.locale,
        chineseSegmenter: config.chineseSegmenter,
        readSegmenter: readSegmenterFromOpfs,
        applyLogLevel: (level) => forwardLogs(logs, level),
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
      );
    }),
  ),
);

launchWorker(
  self,
  RpcServer.layer(ZoteroReads).pipe(Layer.provide(HandlersLive)),
);
