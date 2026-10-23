// The scanner's public entry runs in the same guarded bundle as production workers.
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";

import { scanWorkerBundle } from "./scan-worker-bundle.ts";

it("runs the production parse worker without Obsidian (#1691)", async () => {
  const source = await scanWorkerBundle();
  await using worker = new Worker(
    `
    const { parentPort } = require("node:worker_threads");
    globalThis.self = {
      addEventListener: (_, listener) => parentPort.on("message", data => listener({ data })),
      postMessage: data => parentPort.postMessage(data),
    };
    ${source}
  `,
    { eval: true },
  );
  const failure = once(worker, "message");
  worker.postMessage({
    id: 6,
    request: { path: "throwing.md", generation: 11, text: null },
  });
  expect(await failure).toEqual([{ id: 6, error: expect.any(String) }]);
  const response = once(worker, "message");
  worker.postMessage({
    id: 7,
    request: {
      path: "draft.md",
      generation: 12,
      text: "[](zotero://open/groups/42/items/ABCD2345?annotation=EFGH6789)",
    },
  });
  expect(await response).toEqual([
    {
      id: 7,
      reply: {
        path: "draft.md",
        generation: 12,
        record: {
          ranges: [{ kind: "link-destination", from: 3, to: 61 }],
          links: [],
          citations: [],
          citekeys: [],
          wikilinks: [],
          malformedWikilinks: [],
          malformedAnnotationCitations: [],
          annotations: [
            {
              form: "citation",
              text: "",
              indexedKey: "EFGH6789g42",
              attachmentKey: "ABCD2345",
              pageLabel: null,
              position: {
                start: { line: 0, col: 0, offset: 0 },
                end: { line: 0, col: 62, offset: 62 },
              },
            },
          ],
        },
      },
    },
  ]);
});
