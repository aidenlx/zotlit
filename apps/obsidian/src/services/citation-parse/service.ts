// Owns the parse worker from layout-ready until plugin disposal.
import type { Workspace } from "obsidian";
import workerSource from "virtual:citation-parse-worker";

import { Service } from "@/services/service-base";

import type { ParseClient, ParseRequest, ParseReply } from "./client";
import { RecoveringParseClient } from "./recovering-client";
import { connectParseWorker } from "./worker-host";

interface CitationParseDeps {
  workspace: Workspace;
}

export class CitationParse
  extends Service<RecoveringParseClient>
  implements ParseClient
{
  readonly #workspace;
  ready: Promise<RecoveringParseClient>;

  constructor({ workspace }: CitationParseDeps) {
    super();
    this.#workspace = workspace;
    this.ready = this.#load();
  }

  async #load(): Promise<RecoveringParseClient> {
    await using stack = new AsyncDisposableStack();
    const client = stack.use(
      new RecoveringParseClient(() => connectParseWorker(workerSource)),
    );
    this.#workspace.onLayoutReady(() => client.start());
    this.commit(stack.move());
    return client;
  }

  async parse(request: ParseRequest, signal: AbortSignal): Promise<ParseReply> {
    return (await this.ready).parse(request, signal);
  }
}
