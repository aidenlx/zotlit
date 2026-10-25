// A write the Local API session sent runs to its answer, whatever interrupts its caller.
import { Fiber } from "effect";
import { expect, it } from "vitest";

import { localApiClient, rootOk, writeAccepted } from "./__fixtures__";

it("lets an interrupt wait for a write that was sent, and the write completes", async () => {
  await using stack = new AsyncDisposableStack();
  const reached = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<void>();
  let answered = false;
  const { client, service, runtime } = await localApiClient(
    {
      root: () => rootOk(),
      write: async () => {
        reached.resolve();
        await answer.promise;
        answered = true;
        return writeAccepted();
      },
    },
    { key: "a-remembered-key" },
  );
  stack.use(client);
  await client.probe();

  const send = runtime.runFork(
    service.authorizedSend("/api/users/0/items/PUPR5FG5", {
      library: "users/0",
      method: "PATCH",
      body: '{"annotationColor":"#ff6666"}',
    }),
  );
  await reached.promise;

  let interrupted = false;
  const interruption = runtime.runPromise(Fiber.interrupt(send)).then(() => {
    interrupted = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  // The write is on the wire: the fiber does not end before Zotero answers.
  expect(interrupted).toBe(false);
  expect(answered).toBe(false);

  answer.resolve();
  await interruption;
  expect(answered).toBe(true);
});
