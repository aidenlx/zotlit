// Export ownership across the renderer and worker. The encoder only writes.
import { link, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getLogger } from "@/lib/log";

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

  async publish(answer: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.stagePath === undefined || this.#output === undefined) return;
    const receipt = JSON.parse(answer) as { ok: boolean; file?: object };
    if (receipt.ok && receipt.file) await link(this.stagePath, this.#output);
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

/**
 * Worker adapter: opens the staging file lazily, after CLI validation, and
 * closes it before the answer or failure crosses RPC. The renderer owns removal.
 */
export async function withQueryOutput<A>(
  stagePath: string | undefined,
  run: (
    openOutput: () => Promise<{ write(text: string): Promise<void> }>,
  ) => Promise<A>,
): Promise<A> {
  await using files = new AsyncDisposableStack();
  return await run(async () => {
    if (stagePath === undefined)
      throw new Error("Item Query export has no staging path");
    const file = files.adopt(await open(stagePath, "wx", 0o600), (file) =>
      file.close(),
    );
    return { write: (text) => file.writeFile(text, "utf8") };
  });
}
