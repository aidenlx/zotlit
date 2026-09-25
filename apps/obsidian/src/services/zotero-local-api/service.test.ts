import { expect, it } from "vitest";

import {
  annotationPage,
  ATTACHMENT_KEY,
  freshnessSignal,
  incompatibleZotero,
  localApiClient,
  localApiDisabled,
  PORT,
  rateLimited,
  rootOk,
  ROUGIER_ANNOTATIONS,
  SERVER_ID,
  serverChanged,
  unreachable,
} from "./__fixtures__";
import type {
  ChildrenRequest,
  ClientOptions,
  WireAnnotation,
  ZoteroAnswers,
} from "./__fixtures__";
import type { ZoteroLocalApiClient } from "./service";

it("probes lazily on the first demand and names the server the probe answered", async () => {
  await using stack = new AsyncDisposableStack();
  const { client, requests } = await setup(stack);

  // Nothing has asked yet, so nothing has been sent.
  expect(requests).toHaveLength(0);
  const beforeProbe = client.demandSource();
  await nextChange(client);

  expect(beforeProbe).toBeNull();
  expect(client.demandSource()).toEqual({
    kind: "zotero-local-api",
    serverID: SERVER_ID,
  });
  expect(requests.map(({ url }) => url.href)).toEqual([
    `http://127.0.0.1:${PORT}/api/`,
  ]);
});

it("carries the allowed-request and API version headers, and asks no cache", async () => {
  await using stack = new AsyncDisposableStack();
  const { client, requests } = await setup(stack, {
    children: () => annotationPage(ROUGIER_ANNOTATIONS),
  });

  await client.probe();
  await client.listAnnotations(ATTACHMENT_KEY);

  expect(requests).toHaveLength(2);
  for (const { headers } of requests) {
    // Read lower case, as every transport presents them.
    expect(headers.get("zotero-allowed-request")).toBe("1");
    expect(headers.get("zotero-api-version")).toBe("3");
    expect(headers.get("cache-control")).toBe("no-cache");
  }
  // A read needs no key, and sends none.
  expect(requests[1]?.headers.get("zotero-api-key")).toBeNull();
  expect(requests[1]?.headers.get("zotero-server-id")).toBe(SERVER_ID);
  // The probe is what learns the server id, so it sends none.
  expect(requests[0]?.headers.get("zotero-server-id")).toBeNull();
});

it("reads every Annotation of one Attachment in Zotero's reading order", async () => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, {
    children: () => annotationPage(ROUGIER_ANNOTATIONS),
  });
  await client.probe();

  const result = await client.listAnnotations(ATTACHMENT_KEY);

  // The Fixture's own Sort Indexes give this order; the answer arrives in the
  // date order the list route sorts by.
  expect(read(result).map(({ key }) => key)).toEqual([
    "TYY6Z6ZF",
    "4PE492KU",
    "HRK7BG32",
    "K3JRFLFQ",
    "PUPR5FG5",
    "C94NJNYG",
    "FDRFQ7C2",
  ]);
  expect(read(result).find(({ key }) => key === "HRK7BG32")).toEqual({
    key: "HRK7BG32",
    type: "text",
    color: "#a28ae5",
    comment: "Making figures is hard :(",
    text: null,
    position: {
      kind: "pdf-text",
      pageIndex: 0,
      fontSize: 14,
      rotation: 0,
      rects: [[398.804, 685.107, 560.804, 702.107]],
    },
    version: 14,
    sortIndex: "00000|000191|00088",
    parentKey: ATTACHMENT_KEY,
    pageLabel: "1",
    // Never moves after the create, which is what makes it the window an
    // Uncertain Create is reconciled inside (aidenlx/zotlit#1151).
    dateAdded: "2026-08-23T16:18:18Z",
    dateModified: null,
    authorName: null,
    isExternal: null,
    tags: [],
    tagDetails: [],
  });
});

it("preserves template metadata supplied by the Local API", async () => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, {
    children: async () => {
      const response = annotationPage([ROUGIER_ANNOTATIONS[0]!]);
      const body = (await response.json()) as {
        data: Record<string, unknown>;
      }[];
      Object.assign(body[0]!.data, {
        dateModified: "2026-09-20T01:02:03Z",
        annotationAuthorName: "A. Reader",
        annotationIsExternal: true,
        tags: [{ tag: "review" }, { tag: "imported", type: 1 }],
      });
      return new Response(JSON.stringify(body), { headers: response.headers });
    },
  });
  await client.probe();
  expect(read(await client.listAnnotations(ATTACHMENT_KEY))[0]).toMatchObject({
    dateModified: "2026-09-20T01:02:03Z",
    authorName: "A. Reader",
    isExternal: true,
    tagDetails: [
      { name: "review", type: 0 },
      { name: "imported", type: 1 },
    ],
  });
});

it.each([null, "", " ", "two"])(
  "rejects an empty page whose total header is %j",
  async (total) => {
    await using stack = new AsyncDisposableStack();
    const { client } = await setup(stack, {
      children: () => {
        const response = annotationPage([]);
        if (total === null) response.headers.delete("Total-Results");
        else response.headers.set("Total-Results", total);
        return response;
      },
    });
    await client.probe();

    expect(await client.listAnnotations(ATTACHMENT_KEY)).toEqual({
      failure: {
        kind: "invalid-response",
        issue: "annotation page named no valid total",
      },
    });
  },
);

it("rejects a duplicate Annotation within one page", async () => {
  await using stack = new AsyncDisposableStack();
  const annotation = ROUGIER_ANNOTATIONS[0]!;
  const { client } = await setup(stack, {
    children: () => annotationPage([annotation, annotation]),
  });
  await client.probe();

  expect(await client.listAnnotations(ATTACHMENT_KEY)).toEqual({
    failure: {
      kind: "invalid-response",
      issue: "annotation page repeated an annotation",
    },
  });
});

it("carries a page label and tags, in the order Zotero answered them", async () => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, {
    children: () =>
      annotationPage([
        {
          ...ROUGIER_ANNOTATIONS[0]!,
          pageLabel: "xiv",
          tags: ["todo", "review"],
        },
      ]),
  });
  await client.probe();

  const result = await client.listAnnotations(ATTACHMENT_KEY);

  expect(read(result)[0]).toMatchObject({
    pageLabel: "xiv",
    tags: ["todo", "review"],
  });
});

it("answers an empty tags list for an annotation with no tags key", async () => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, {
    // ROUGIER_ANNOTATIONS[0] sets no `tags`, so the wire item carries none.
    children: () => annotationPage([ROUGIER_ANNOTATIONS[0]!]),
  });
  await client.probe();

  const result = await client.listAnnotations(ATTACHMENT_KEY);

  expect(read(result)[0]).toMatchObject({ tags: [] });
});

it("reads an empty-string page label as null, the way Zotero stores an unset one", async () => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, {
    children: () =>
      annotationPage([{ ...ROUGIER_ANNOTATIONS[0]!, pageLabel: "" }]),
  });
  await client.probe();

  const result = await client.listAnnotations(ATTACHMENT_KEY);

  expect(read(result)[0]).toMatchObject({ pageLabel: null });
});

it("names the Attachment's Indexed Key as parentKey, group suffix included", async () => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, {
    children: ({ groupID, key }: ChildrenRequest) =>
      annotationPage([{ ...ROUGIER_ANNOTATIONS[0]!, groupID: groupID ?? 0 }], {
        parentItem: key,
      }),
  });
  await client.probe();

  const result = await client.listAnnotations("SHAREPDFg42");

  expect(read(result)[0]).toMatchObject({ parentKey: "SHAREPDFg42" });
});

it("follows the list route to its end, so an Attachment past one page is whole", async () => {
  await using stack = new AsyncDisposableStack();
  const total = 130;
  const { client, requests } = await setup(stack, {
    children: ({ start }: ChildrenRequest) =>
      annotationPage(manyAnnotations(start, Math.min(100, total - start)), {
        total,
        start,
      }),
  });
  await client.probe();

  const result = await client.listAnnotations(ATTACHMENT_KEY);

  expect(read(result)).toHaveLength(total);
  expect(new Set(read(result).map(({ key }) => key)).size).toBe(total);
  expect(
    requests.slice(1).map(({ url }) => url.searchParams.get("start")),
  ).toEqual(["0", "100"]);
  // A page boundary holds still only while the order it slices does: Zotero's
  // default sort is dateModified, which an edit between the two pages reorders.
  for (const { url } of requests.slice(1)) {
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("sort")).toBe("dateAdded");
    expect(url.searchParams.get("direction")).toBe("asc");
  }
});

it("rejects a collection whose total changes between pages", async () => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, {
    children: ({ start }: ChildrenRequest) =>
      annotationPage(manyAnnotations(start, start === 0 ? 100 : 30), {
        total: start === 0 ? 130 : 131,
        start,
      }),
  });
  await client.probe();

  expect(await client.listAnnotations(ATTACHMENT_KEY)).toEqual({
    failure: {
      kind: "invalid-response",
      issue: "annotation total changed during pagination",
    },
  });
});

it("answers an empty list for a key Zotero does not hold", async () => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack);
  await client.probe();

  expect(read(await client.listAnnotations("ABSENT24"))).toEqual([]);
});

it("reads a group library through its own route", async () => {
  await using stack = new AsyncDisposableStack();
  const { client, requests } = await setup(stack, {
    children: ({ groupID, key }: ChildrenRequest) =>
      annotationPage([{ ...ROUGIER_ANNOTATIONS[0]!, groupID: groupID ?? 0 }], {
        parentItem: key,
      }),
  });
  await client.probe();

  const result = await client.listAnnotations("SHAREPDFg42");

  expect(requests[1]?.url.pathname).toBe(
    "/api/groups/42/items/SHAREPDF/children",
  );
  expect(read(result).map(({ key }) => key)).toEqual(["PUPR5FG5g42"]);
});

it("refuses a record whose key is not a Zotero key", async () => {
  // Zotero's alphabet excludes `O`, so this key can never be a real one.
  const failure = await failedRead({ key: "POOR5FG5" });

  expect(failure).toEqual({
    kind: "invalid-response",
    issue: "annotation key POOR5FG5",
  });
});

it.each([
  ["colour", { color: "#FFD400" }, "PUPR5FG5 colour #FFD400"],
  ["sort index", { sortIndex: "1|2|3" }, "PUPR5FG5 sort index 1|2|3"],
  ["parent key", { parentItem: "OTHERPDF" }, "PUPR5FG5 belongs to OTHERPDF"],
  ["position", { position: "not-json" }, "PUPR5FG5 position"],
  ["type-to-position pairing", { type: "ink" }, "PUPR5FG5 is ink, pdf-rects"],
] as const)(
  "refuses a record whose %s is wrong",
  async (_what, patch, issue) => {
    expect(await failedRead(patch)).toEqual({
      kind: "invalid-response",
      issue,
    });
  },
);

it("names the field when an item is not the shape this client reads", async () => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, {
    children: () =>
      new Response(JSON.stringify([{ key: "PUPR5FG5", version: 11 }]), {
        status: 200,
        headers: {
          "Zotero-API-Version": "3",
          "Zotero-Server-ID": SERVER_ID,
          "Content-Type": "application/json",
        },
      }),
  });
  await client.probe();

  const result = await client.listAnnotations(ATTACHMENT_KEY);

  expect(result).toEqual({
    failure: {
      kind: "invalid-response",
      issue: expect.stringContaining("annotation list: 0.library"),
    },
  });
});

it("refuses a probe that answers no Zotero server id", async () => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, {
    root: () => rootOk({ "Zotero-Server-ID": "short" }),
  });

  await client.probe();

  expect(client.demandSource()).toBeNull();
  expect(client.state).toEqual({
    kind: "unavailable",
    failure: { kind: "invalid-response", issue: "server id short" },
  });
});

it.each([
  ["a connection nothing answers", unreachable, "unreachable"],
  ["the local API switched off", localApiDisabled, "local-api-disabled"],
  ["another API version", incompatibleZotero, "incompatible-zotero"],
] as const)("stands the source down on %s", async (_case, answer, kind) => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, { root: answer });

  await client.probe();

  expect(client.demandSource()).toBeNull();
  expect(client.state).toEqual({ kind: "unavailable", failure: { kind } });
});

it("reads a Zotero that speaks another API version off the root route's own header", async () => {
  await using stack = new AsyncDisposableStack();
  // The root route serves every version, so its header is the whole gate.
  const { client } = await setup(stack, {
    root: () => rootOk({ "Zotero-API-Version": "4" }),
  });

  await client.probe();

  expect(client.state).toEqual({
    kind: "unavailable",
    failure: { kind: "incompatible-zotero" },
  });
});

it("stands the source down when its own deadline ends the probe", async () => {
  await using stack = new AsyncDisposableStack();
  const { client, requests } = await setup(
    stack,
    { root: () => rootOk() },
    { probeDeadline: () => AbortSignal.abort() },
  );

  await client.probe();

  // A Zotero that has not answered inside the deadline is not answering, which
  // is what a refused connection says too.
  expect(requests).toHaveLength(1);
  expect(client.state).toEqual({
    kind: "unavailable",
    failure: { kind: "unreachable" },
  });
});

it("carries Zotero's own cooldown out of a rate-limited answer", async () => {
  await using stack = new AsyncDisposableStack();
  // 97 is not Zotero's 60-second window, so only a parsed header answers it.
  const { client } = await setup(stack, {
    children: () => rateLimited({ retryAfter: 97 }),
  });
  await client.probe();

  const result = await client.listAnnotations(ATTACHMENT_KEY);

  expect(result).toEqual({
    failure: {
      kind: "cooldown",
      retryAfter: Temporal.Duration.from({ seconds: 97 }),
    },
  });
});

it("falls back to Zotero's dialog window when a rate limit names no delay", async () => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, {
    children: () => rateLimited({ retryAfter: null }),
  });
  await client.probe();

  const result = await client.listAnnotations(ATTACHMENT_KEY);

  expect(result).toEqual({
    failure: {
      kind: "cooldown",
      retryAfter: Temporal.Duration.from({ seconds: 60 }),
    },
  });
});

it("reports whether a Remembered Write Authorization exists for the session", async () => {
  await using stack = new AsyncDisposableStack();
  const key = "zaxj2JbsV79sbQDXS7REpa3Z3kRDIory";
  const { client, credentials } = await setup(stack, {}, { key });
  const { client: unauthorized } = await setup(stack);

  await client.probe();
  await unauthorized.probe();

  expect(credentials.read).toHaveBeenCalledWith(SERVER_ID);
  expect(client.state).toMatchObject({ kind: "available", authorized: true });
  expect(unauthorized.state).toMatchObject({
    kind: "available",
    authorized: false,
  });
});

it("takes a Zotero database swapped under the port as a changed server", async () => {
  await using stack = new AsyncDisposableStack();
  let answering = SERVER_ID;
  const { client } = await setup(stack, {
    root: () => rootOk({ "Zotero-Server-ID": answering }),
    children: () => serverChanged("Zzzz11119999"),
  });
  await client.probe();

  answering = "Zzzz11119999";
  const result = await client.listAnnotations(ATTACHMENT_KEY);

  expect(result).toEqual({ failure: { kind: "server-changed" } });
  // The session is quarantined rather than swapped under the read in flight.
  expect(client.demandSource()).toBeNull();
  expect(client.state).toEqual({
    kind: "unavailable",
    failure: { kind: "server-changed" },
  });

  await client.probe();

  // The next probe adopts the database answering now: a fresh cache partition,
  // not a renamed object.
  expect(client.demandSource()).toEqual({
    kind: "zotero-local-api",
    serverID: "Zzzz11119999",
  });
});

it("leaves the session standing when a read is cancelled", async () => {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, {
    children: () => annotationPage(ROUGIER_ANNOTATIONS),
  });
  await client.probe();

  const result = await client.listAnnotations(
    ATTACHMENT_KEY,
    AbortSignal.abort(),
  );

  expect(result).toEqual({ failure: { kind: "unknown-outcome" } });
  expect(client.demandSource()).not.toBeNull();
});

it("refuses to read at all while no session stands, rather than sending a request", async () => {
  await using stack = new AsyncDisposableStack();
  const { client, requests } = await setup(stack, { root: localApiDisabled });
  await client.probe();

  const result = await client.listAnnotations(ATTACHMENT_KEY);

  expect(result).toEqual({ failure: { kind: "local-api-disabled" } });
  expect(requests).toHaveLength(1);
});

it("probes again on the Freshness Signal and on a resolved-paths change", async () => {
  await using stack = new AsyncDisposableStack();
  const { client, requests, prefEvents, serverEvents } = await setup(stack);
  await client.probe();

  const freshness = nextChange(client);
  freshnessSignal(serverEvents);
  await freshness;
  const moved = nextChange(client);
  prefEvents.emit("resolved-changed");
  await moved;

  expect(requests.map(({ url }) => url.pathname)).toEqual([
    "/api/",
    "/api/",
    "/api/",
  ]);
});

it("announces a Freshness Signal that arrived while a probe was running", async () => {
  await using stack = new AsyncDisposableStack();
  const held = Promise.withResolvers<Response>();
  const reached = Promise.withResolvers<void>();
  let probes = 0;
  const { client, serverEvents } = await setup(stack, {
    root: () => {
      probes += 1;
      if (probes > 1) return rootOk();
      reached.resolve();
      return held.promise;
    },
  });

  const announced = nextChange(client);
  const probing = client.probe();
  await reached.promise;
  // The signal lands mid-probe: coalesced into the probe in flight, never
  // dropped, because it is what invalidates the partition.
  freshnessSignal(serverEvents);
  held.resolve(rootOk());
  await probing;

  await expect(announced).resolves.toBeUndefined();
});

it("holds the source it has while a second probe runs, and joins one in flight", async () => {
  await using stack = new AsyncDisposableStack();
  const { client, requests } = await setup(stack);
  await client.probe();

  await Promise.all([client.probe(), client.probe()]);

  expect(client.demandSource()).not.toBeNull();
  expect(requests).toHaveLength(2);
});

// A focus inside the PDF reader probes again, and the reader's toolbar redraws
// on every announcement — so an announcement that changed nothing replaced the
// button under a press and the press never clicked.
it("announces a capability change only when a probe changes what it learned", async () => {
  await using stack = new AsyncDisposableStack();
  let enabled = true;
  const { client } = await setup(stack, {
    root: () => (enabled ? rootOk() : localApiDisabled()),
  });
  await client.probe();
  let announced = 0;
  stack.defer(client.on("capability-changed", () => (announced += 1)));

  await client.probe();
  expect(announced).toBe(0);

  enabled = false;
  await client.probe();
  expect(announced).toBe(1);
});

function read(
  result: Awaited<ReturnType<ZoteroLocalApiClient["listAnnotations"]>>,
) {
  if ("failure" in result) {
    throw new Error(`Expected a list, got ${result.failure.kind}`);
  }
  return result.value;
}

/** The failure one broken record makes of the whole read. */
async function failedRead(patch: Partial<WireAnnotation>) {
  await using stack = new AsyncDisposableStack();
  const { client } = await setup(stack, {
    children: () => annotationPage([{ ...ROUGIER_ANNOTATIONS[0]!, ...patch }]),
  });
  await client.probe();
  const result = await client.listAnnotations(ATTACHMENT_KEY);
  return "failure" in result ? result.failure : null;
}

function manyAnnotations(start: number, count: number): WireAnnotation[] {
  return Array.from({ length: count }, (_, index) => ({
    ...ROUGIER_ANNOTATIONS[0]!,
    key: pageKey(start + index),
    version: 100 + start + index,
    sortIndex: `00000|${String(start + index).padStart(6, "0")}|00000`,
  }));
}

/** Eight characters of Zotero's own alphabet, which carries no `0`, `1` or `O`. */
function pageKey(index: number): string {
  const alphabet = "23456789";
  const tail = [0, 1, 2, 3]
    .map((shift) => alphabet[(index >> (shift * 3)) & 7])
    .join("");
  return `PAGE${tail}`;
}

function nextChange(client: ZoteroLocalApiClient): Promise<void> {
  return new Promise<void>((resolve) => {
    const off = client.on("changed", () => {
      off();
      resolve();
    });
  });
}

async function setup(
  stack: AsyncDisposableStack,
  answers: ZoteroAnswers = {},
  options: ClientOptions = {},
) {
  const harness = localApiClient(answers, options);
  stack.use(harness.client);
  await harness.client.ready;
  return harness;
}
