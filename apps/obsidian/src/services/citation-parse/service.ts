// Owns the parse worker from layout-ready until the layer's Scope closes.
import workerSource from "virtual:citation-parse-worker";

import { Context, Effect, Layer } from "@/lib/effect";
import { obsidianEvents } from "@/lib/effect-obsidian-events";
import { ObsidianApp } from "@/lib/obsidian-app";

import type {
  ParseFailed,
  ParseRequest,
  ParseReply,
  ParseWorkerDied,
} from "./client";
import { makeRecoveringParseClient } from "./recovering-client";
import { connectParseWorker } from "./worker-host";

export class CitationParse extends Context.Service<
  CitationParse,
  {
    parse(
      request: ParseRequest,
    ): Effect.Effect<ParseReply, ParseWorkerDied | ParseFailed>;
  }
>()("zotlit/citation-parse/CitationParse") {}

export const layerCitationParse = Layer.effect(
  CitationParse,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    const client = yield* makeRecoveringParseClient(
      connectParseWorker(workerSource),
    );
    const events = yield* obsidianEvents<{ layoutReady: [] }>();
    // boundary: Obsidian exposes layout readiness through a callback API.
    app.workspace.onLayoutReady(events.callback("layoutReady"));
    yield* events
      .consume(() => client.start())
      .pipe(Effect.forkScoped({ startImmediately: true }));
    return CitationParse.of({
      parse: Effect.fn("CitationParse.parse")((request) =>
        client.parse(request),
      ),
    });
  }),
);
