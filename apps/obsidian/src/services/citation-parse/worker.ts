// The stateless scanner serves the same RPC group as its in-process twin.
import * as BrowserWorkerRunner from "@effect/platform-browser/BrowserWorkerRunner";
import { RpcServer } from "effect/rpc";

import { Layer, runFork } from "@/lib/effect-worker";

import { layerParseHandlers } from "./handlers";
import { CitationParseRpc } from "./rpc";

// CitationParse.parse traces the service call; transport spans add backfill cost.
// boundary: Worker bootstrap launches the scoped server for the worker lifetime.
RpcServer.layer(CitationParseRpc, { disableTracing: true }).pipe(
  Layer.provide(layerParseHandlers),
  Layer.provide(
    RpcServer.layerProtocolWorkerRunner.pipe(
      Layer.provide(BrowserWorkerRunner.layer),
    ),
  ),
  Layer.launch,
  runFork,
);
