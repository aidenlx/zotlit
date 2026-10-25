import { expect, it, vi } from "vitest";

import {
  ATTACHMENT_KEY,
  localApiClient,
} from "@/services/zotero-local-api/__fixtures__";

import { listLocalApi } from "./reads";

it("answers unknown-outcome to an interrupted list read and leaves the Local API session standing", async () => {
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
  cancel.abort();

  expect(await reading).toEqual({ failure: { kind: "unknown-outcome" } });
  expect(bridge.runSync(service.demandSource)).not.toBeNull();
});
