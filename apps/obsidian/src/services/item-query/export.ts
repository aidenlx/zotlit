// Renderer ownership of an export: the staging path, publication, and removal.
import { link, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getLogger } from "@/lib/log";

import type { QueryReceipt } from "./worker-protocol";

/**
 * Renderer owner of one unpublished export. The worker closes its writer
 * before answering. Publication wins a concurrent cancel once the link exists.
 */
export class QueryExport implements AsyncDisposable {
  readonly stagePath: string | undefined;
  readonly #output;

  constructor(output: string | undefined, id: string) {
    this.#output = output;
    this.stagePath =
      output === undefined
        ? undefined
        : join(dirname(output), `.zotlit-query-${id}.tmp`);
  }

  async publish(receipt: QueryReceipt, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.stagePath === undefined || this.#output === undefined) return;
    if (receipt.kind === "file") await link(this.stagePath, this.#output);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.stagePath === undefined) return;
    await rm(this.stagePath, { force: true }).catch((error: unknown) => {
      getLogger(["item-query"]).warn(
        "Item Query could not remove its temporary export {path}",
        { path: this.stagePath, error },
      );
    });
  }
}
