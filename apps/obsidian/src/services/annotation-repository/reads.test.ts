import { expect, it, vi } from "vitest";

import {
  ATTACHMENT_KEY,
  localApiClient,
} from "@/services/zotero-local-api/__fixtures__";

import { listLocalApi } from "./reads";

it("rejects a cancelled list read with the signal's reason and leaves the Local API session standing", async () => {
  const { service, bridge, requests, disposable } = await localApiClient({
    children: () => new Promise<Response>(() => undefined),
  });
  await using _owned = disposable;
  await bridge.runPromise(service.probe);

  const cancel = new AbortController();
  const reading = listLocalApi(
    { bridge, api: service },
    ATTACHMENT_KEY,
    cancel.signal,
  );
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  const reason = new Error("query cancelled");
  cancel.abort(reason);

  await expect(reading).rejects.toBe(reason);
  expect(bridge.runSync(service.demandSource)).not.toBeNull();
});

it("answers unknown-outcome to a list read the runtime's close interrupted", async () => {
  const { service, bridge, requests, disposable } = await localApiClient({
    children: () => new Promise<Response>(() => undefined),
  });
  await bridge.runPromise(service.probe);

  const reading = listLocalApi(
    { bridge, api: service },
    ATTACHMENT_KEY,
    new AbortController().signal,
  );
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  await disposable[Symbol.asyncDispose]();

  expect(await reading).toEqual({ failure: { kind: "unknown-outcome" } });
});
