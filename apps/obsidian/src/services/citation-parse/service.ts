// Owns the parse worker from layout-ready until the layer's Scope closes.
import workerSource from "virtual:citation-parse-worker";

import { Context, Effect, Layer } from "@/lib/effect";
import { obsidianEvents } from "@/lib/effect-obsidian-events";
import { ObsidianApp } from "@/lib/obsidian-app";

import { ParseFailed } from "./client";
import type { ParseClient, ParseRequest, ParseReply } from "./client";
import { makeRecoveringParseClient } from "./recovering-client";
import { connectParseWorker } from "./worker-host";

export class CitationParse extends Context.Service<
  CitationParse,
  {
    /** Scoped Promise client for the per-note plain adapter. */
    readonly client: ParseClient;
    parse(request: ParseRequest): Effect.Effect<ParseReply, ParseFailed>;
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
    app.workspace.onLayoutReady(events.callback("layoutReady"));
    yield* events
      .consume(() => Effect.sync(() => client.start()))
      .pipe(Effect.forkScoped({ startImmediately: true }));
    return CitationParse.of({
      client,
      parse: Effect.fn("CitationParse.parse")(function* (
        request: ParseRequest,
      ) {
        return yield* Effect.tryPromise({
          try: (signal) => client.parse(request, signal),
          catch: (error) =>
            error instanceof ParseFailed
              ? error
              : new ParseFailed(String(error)),
        });
      }),
    });
  }),
);
