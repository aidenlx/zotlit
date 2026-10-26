// The Annotation Repository's writes: commands, Pending Proposals, Write Conflicts, creates and Geometry Edits.
import { expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { AbortError } from "@/lib/abort-error";
import {
  annotationItem,
  annotationPage,
  createAccepted,
  createRefused,
  freshnessSignal,
  notFound,
  rootOk,
  ROUGIER_ANNOTATIONS,
  SERVER_ID,
  serverChanged,
  staleVersion,
  unreachable,
  writeAccepted,
} from "@/services/zotero-local-api/__fixtures__";
import type { ZoteroReadLease } from "@/services/zotero-reads/service";

import {
  afterWrite,
  FIXTURE_ROWS,
  leaseOver,
  nextChange,
  REMEMBERED_KEY,
  setup,
  writable,
  zoteroLibrary,
  DATABASE_SOURCE,
  DRAFT,
  MADE,
  colorOf,
  annotationRows,
} from "./__fixtures__";

it("waits for the first API list before writing an Annotation already shown from the database", async () => {
  await using stack = new AsyncDisposableStack();
  const children = Promise.withResolvers<Response>();
  const requested = Promise.withResolvers<void>();
  const { repository } = await setup(
    stack,
    {
      children: () => {
        requested.resolve();
        return children.promise;
      },
      write: () => writeAccepted(42),
      item: () =>
        annotationItem(
          afterWrite("PUPR5FG5", { color: "#5fb236", version: 42 }),
        ),
    },
    { key: REMEMBERED_KEY },
  );
  await repository.read("RGRPDF24");
  await repository.probe();
  const reading = repository.read("RGRPDF24");
  await requested.promise;
  const running = repository.patchColor("PUPR5FG5", "#5fb236");
  children.resolve(annotationPage(ROUGIER_ANNOTATIONS));
  await reading;
  await expect(running).resolves.toEqual({ kind: "idle" });
});

// A PATCH needs its record readback; a DELETE is confirmed by its acknowledgement.
const settledDelete = { settled: { kind: "idle" }, record: undefined };

const settledColour = {
  settled: { kind: "failed", failure: { kind: "unreachable" } },
  record: expect.objectContaining({ color: "#2ea8e5", version: 11 }),
};

it.each([
  { handoff: true, write: "delete", ...settledDelete },
  { handoff: true, write: "colour", ...settledColour },
  { handoff: false, write: "delete", ...settledDelete },
  { handoff: false, write: "colour", ...settledColour },
] as const)(
  "settles $write across API loss (first handoff: $handoff)",
  async ({ handoff, write, settled, record: expected }) => {
    await using stack = new AsyncDisposableStack();
    const children = Promise.withResolvers<Response>();
    const requested = Promise.withResolvers<void>();
    let unavailable = false;
    let loseRead = async () => {};
    const { repository, localApiService, localApiBridge } = await setup(
      stack,
      {
        children: () => {
          if (unavailable) return unreachable();
          requested.resolve();
          return children.promise;
        },
        item: () =>
          annotationItem(
            afterWrite("PUPR5FG5", { color: "#5fb236", version: 42 }),
          ),
        write: async () => {
          await loseRead();
          return writeAccepted(42);
        },
      },
      { key: REMEMBERED_KEY },
    );
    loseRead = async () => {
      unavailable = true;
      await localApiBridge.runPromise(
        localApiService.listAnnotations("RGRPDF24"),
      );
      await repository.read("RGRPDF24");
    };
    await repository.read("RGRPDF24");
    await repository.probe();
    const reading = repository.read("RGRPDF24");
    await requested.promise;
    if (!handoff) {
      children.resolve(annotationPage(ROUGIER_ANNOTATIONS));
      await reading;
    }
    const running =
      write === "delete"
        ? repository.deleteAnnotation("PUPR5FG5")
        : repository.patchColor("PUPR5FG5", "#5fb236");
    children.resolve(annotationPage(ROUGIER_ANNOTATIONS));
    await reading;
    await expect(running).resolves.toEqual(settled);
    const record = repository
      .peek("RGRPDF24")
      ?.value.annotations.find(({ key }) => key === "PUPR5FG5");
    expect(record).toEqual(expected);
  },
);

it("rejects a queued write when another Zotero database takes the same key", async () => {
  await using stack = new AsyncDisposableStack();
  let serverID = SERVER_ID;
  const first = Promise.withResolvers<Response>();
  const { repository, prefEvents, requests } = await writable(stack, {
    root: () => rootOk({ "Zotero-Server-ID": serverID }),
    children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
    write: () => first.promise,
  });
  const sent = requests.length;

  const running = repository.patchColor("PUPR5FG5", "#ff6666");
  const queued = repository.patchComment("PUPR5FG5", "wrong database");
  serverID = "Zzzz11119999";
  prefEvents.emit("resolved-changed");
  await repository.probe();
  first.resolve(writeAccepted());

  await expect(running).resolves.toEqual({
    kind: "failed",
    failure: { kind: "server-changed" },
  });
  await expect(queued).resolves.toEqual({
    kind: "failed",
    failure: { kind: "server-changed" },
  });
  expect(
    requests.slice(sent).filter(({ method }) => method === "PATCH"),
  ).toHaveLength(1);
});

it("draws a Pending Proposal only over the list of the Zotero database it was sent to", async () => {
  await using stack = new AsyncDisposableStack();
  let serverID = SERVER_ID;
  const first = Promise.withResolvers<Response>();
  const sending = Promise.withResolvers<void>();
  const { repository, client, dbEvents } = await writable(stack, {
    root: () => rootOk({ "Zotero-Server-ID": serverID }),
    children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
    write: () => {
      sending.resolve();
      return first.promise;
    },
  });

  const running = repository.patchColor("PUPR5FG5", "#ff6666");
  expect(colorOf(repository.peek("RGRPDF24")?.value ?? null, "PUPR5FG5")).toBe(
    "#ff6666",
  );
  await sending.promise;
  // Zotero now runs on another database, which the Local API serves too.
  serverID = "Zzzz11119999";
  client.$client.exec(
    `update settings set value = '${serverID}' where setting = 'localAPI' and key = 'serverID'`,
  );
  dbEvents.emit("changed");
  await repository.refresh("RGRPDF24");
  const other = await repository.read("RGRPDF24");

  expect(other?.source).toEqual({ kind: "zotero-local-api", serverID });
  expect(colorOf(other, "PUPR5FG5")).toBe("#2ea8e5");
  first.resolve(writeAccepted());
  await running;
});

// #region the write path

it("patches a colour with the version the last read answered, in lower case", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack);
  const sent = requests.length;

  const outcome = await repository.patchColor("PUPR5FG5", "#FF6666");

  expect(outcome).toEqual({ kind: "idle" });
  const [patch] = requests.slice(sent);
  expect([patch?.method, patch?.url.pathname]).toEqual([
    "PATCH",
    "/api/users/0/items/PUPR5FG5",
  ]);
  expect(Object.fromEntries(patch!.headers)).toMatchObject({
    "zotero-api-key": REMEMBERED_KEY,
    "zotero-server-id": SERVER_ID,
    "zotero-api-version": "3",
    "zotero-allowed-request": "1",
    "content-type": "application/json",
  });
  // The Fixture's highlight is at version 11, and a colour edit names the
  // colour and the precondition alone — never a Sort Index.
  expect(JSON.parse(patch!.body ?? "")).toEqual({
    version: 11,
    annotationColor: "#ff6666",
  });
});

it("announces the pixels a saved recolour moved, off the record Zotero answered with", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {
    item: () =>
      annotationItem(afterWrite("TYY6Z6ZF", { color: "#2ea8e5", version: 17 })),
  });
  const announced: Array<[string, string | null]> = [];
  stack.defer(
    repository.listen("excerpt-pixels-changed", (record) =>
      announced.push([record.key, record.color]),
    ),
  );

  await repository.patchColor("TYY6Z6ZF", "#2EA8E5");

  expect(announced).toEqual([["TYY6Z6ZF", "#2ea8e5"]]);
});

it("says nothing for a saved write that left the pixels alone", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {
    item: ({ url }) =>
      annotationItem(
        // A comment on an ink stroke, and a colour on a highlight: neither is a
        // pixel of the image ZotLit renders for this Annotation.
        url.pathname.endsWith("TYY6Z6ZF")
          ? afterWrite("TYY6Z6ZF", { comment: "Saved" })
          : afterWrite("PUPR5FG5", { color: "#5fb236" }),
      ),
  });
  const announced: string[] = [];
  stack.defer(
    repository.listen("excerpt-pixels-changed", (record) =>
      announced.push(record.key),
    ),
  );

  await repository.patchComment("TYY6Z6ZF", "Saved");
  await repository.patchColor("PUPR5FG5", "#5FB236");

  expect(announced).toEqual([]);
});

it("announces nothing while a write is still in flight", async () => {
  await using stack = new AsyncDisposableStack();
  const reread = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { repository } = await writable(stack, {
    item: async () => {
      reread.resolve();
      await release.promise;
      return annotationItem(afterWrite("TYY6Z6ZF", { color: "#2ea8e5" }));
    },
  });
  const announced: string[] = [];
  stack.defer(
    repository.listen("excerpt-pixels-changed", (record) =>
      announced.push(record.key),
    ),
  );

  const saved = repository.patchColor("TYY6Z6ZF", "#2EA8E5");
  // Zotero has taken the write; the record it answers with has not landed, so
  // the pixels a card paints are still the saved ones it was showing.
  await reread.promise;
  expect(announced).toEqual([]);

  release.resolve();
  await saved;
  expect(announced).toEqual(["TYY6Z6ZF"]);
});

it("re-reads the annotation after the 204, and writes again off that version", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack, {
    item: () =>
      annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666", version: 20 })),
  });
  const sent = requests.length;

  await repository.patchColor("PUPR5FG5", "#ff6666");
  const list = await repository.read("RGRPDF24");
  const reread = requests.length;
  await repository.patchColor("PUPR5FG5", "#5fb236");

  expect(
    requests
      .slice(sent, reread)
      .map(({ method, url }) => [method, url.pathname]),
  ).toEqual([
    ["PATCH", "/api/users/0/items/PUPR5FG5"],
    ["GET", "/api/users/0/items/PUPR5FG5"],
    ["GET", "/api/"],
    ["GET", "/api/users/0/items/RGRPDF24/children"],
  ]);
  expect(list?.annotations.find(({ key }) => key === "PUPR5FG5")).toMatchObject(
    { color: "#ff6666", version: 20 },
  );
  // 5 is the library version the `204` carried; 20 is the object's, which only
  // the re-read could answer.
  expect(JSON.parse(requests[reread]!.body ?? "")).toMatchObject({
    version: 20,
  });
});

it("removes the card only once Zotero has answered, the version its precondition", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack);
  const sent = requests.length;

  const announced = nextChange(repository);
  const outcome = await repository.deleteAnnotation("C94NJNYG");
  const list = await repository.read("RGRPDF24");

  expect(outcome).toEqual({ kind: "idle" });
  expect(await announced).toEqual(["RGRPDF24"]);
  const [erase] = requests.slice(sent);
  expect([erase?.method, erase?.url.pathname]).toEqual([
    "DELETE",
    "/api/users/0/items/C94NJNYG",
  ]);
  expect(erase?.headers.get("If-Unmodified-Since-Version")).toBe("15");
  expect(erase?.body).toBeNull();
  expect(list?.annotations.map(({ key }) => key)).not.toContain("C94NJNYG");
});

it("refuses a write under the Zotero DB source before any request", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests, client } = await setup(stack);
  const rows = annotationRows(client);
  const list = await repository.read("RGRPDF24");

  const outcome = await repository.patchColor("PUPR5FG5", "#ff6666");

  expect(list?.source).toEqual(DATABASE_SOURCE);
  expect(outcome).toEqual({ kind: "failed", failure: { kind: "db-source" } });
  expect(repository.mutationFor("PUPR5FG5")).toEqual(outcome);
  // Nothing but reads left ZotLit, and the database is as it was.
  expect(requests.filter(({ method }) => method !== "GET")).toEqual([]);
  expect(annotationRows(client)).toEqual(rows);
});

it("refuses a write for an Annotation no list holds", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack);
  const sent = requests.length;

  const outcome = await repository.patchColor("GONE2345", "#ff6666");

  expect(outcome).toEqual({
    kind: "failed",
    failure: { kind: "unknown-annotation" },
  });
  expect(requests.slice(sent)).toEqual([]);
});

it("classifies each 412 body by what it says, not by its status", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {
    write: () => staleVersion(),
    item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236" })),
  });

  const moved = await repository.patchColor("PUPR5FG5", "#ff6666");
  expect(moved).toMatchObject({ kind: "conflict" });

  await using swapped = new AsyncDisposableStack();
  const other = await writable(swapped, { write: () => serverChanged() });
  expect(await other.repository.patchColor("PUPR5FG5", "#ff6666")).toEqual({
    kind: "failed",
    failure: { kind: "server-changed" },
  });
  // The third body, `Write token already used`, is a create's answer alone: a
  // patch carries a version and no write token. It is replayed on the retry
  // path below.
});

it("shows the fresh Zotero value beside the user's input, with both verbs", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {
    write: () => staleVersion(),
    item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236" })),
  });
  const conflicted: string[] = [];
  stack.defer(
    repository.listen("write-conflict", (annotationKey, attachmentKey) => {
      conflicted.push(`${annotationKey} on ${attachmentKey}`);
    }),
  );

  const outcome = await repository.patchColor("PUPR5FG5", "#ff6666");

  expect(outcome).toEqual({
    kind: "conflict",
    conflict: { write: "color", attempted: "#ff6666", fresh: "#5fb236" },
  });
  expect(repository.mutationFor("PUPR5FG5")).toEqual(outcome);
  expect(conflicted).toEqual(["PUPR5FG5 on RGRPDF24"]);
});

it("resolves silently where Zotero already holds the value the write asked for", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {
    write: () => staleVersion(),
    // The Annotation moved to the very colour this write asks for — another
    // client, or the same user in Zotero.
    item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666" })),
  });
  const conflicted: string[] = [];
  stack.defer(
    repository.listen("write-conflict", (key) => conflicted.push(key)),
  );

  const outcome = await repository.patchColor("PUPR5FG5", "#FF6666");

  expect(outcome).toEqual({ kind: "idle" });
  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(conflicted).toEqual([]);
});

it("invalidates the Attachment's list on any version 412 and says so", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {
    write: () => staleVersion(),
    item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236" })),
    // What Zotero holds now, which the drop is what makes the view read.
    children: () =>
      annotationPage([
        afterWrite("PUPR5FG5", { color: "#5fb236", version: 30 }),
      ]),
  });

  const announced = nextChange(repository);
  await repository.patchColor("PUPR5FG5", "#ff6666");

  expect(await announced).toEqual(["RGRPDF24"]);
  expect(colorOf(await repository.read("RGRPDF24"), "PUPR5FG5")).toBe(
    "#5fb236",
  );
});

it.each([false, true])(
  "sends Apply again against the fresh version (query collected: %s)",
  async (collected) => {
    await using stack = new AsyncDisposableStack();
    let refuse = true;
    const { repository, requests, queryClient } = await writable(stack, {
      write: () => (refuse ? staleVersion() : writeAccepted()),
      item: () =>
        annotationItem(
          afterWrite("PUPR5FG5", { color: "#5fb236", version: 30 }),
        ),
    });
    await repository.patchColor("PUPR5FG5", "#ff6666");
    if (collected) queryClient.client.removeQueries();
    refuse = false;
    const sent = requests.length;

    const outcome = await repository.retryWrite("PUPR5FG5");

    expect(outcome).toEqual({ kind: "idle" });
    // 11 was the version the first write sent and 30 is the one the conflict
    // read back: a retry that repeated 11 would conflict for ever.
    expect(
      JSON.parse(
        requests.slice(sent).find(({ method }) => method === "PATCH")!.body ??
          "",
      ),
    ).toEqual({
      version: 30,
      annotationColor: "#ff6666",
    });
  },
);

it("asks Delete anyway against the copy Zotero holds, and names no value", async () => {
  await using stack = new AsyncDisposableStack();
  let refuse = true;
  const { repository, requests } = await writable(stack, {
    write: () => (refuse ? staleVersion() : writeAccepted()),
    item: () =>
      annotationItem(
        afterWrite("C94NJNYG", { comment: "edited in Zotero", version: 30 }),
      ),
  });

  const conflict = await repository.deleteAnnotation("C94NJNYG");
  expect(conflict).toEqual({
    kind: "conflict",
    conflict: { write: "delete", attempted: null, fresh: null },
  });

  refuse = false;
  const sent = requests.length;
  const outcome = await repository.retryWrite("C94NJNYG");

  expect(outcome).toEqual({ kind: "idle" });
  const [erase] = requests.slice(sent);
  expect([
    erase?.method,
    erase?.headers.get("If-Unmodified-Since-Version"),
  ]).toEqual(["DELETE", "30"]);
});

it("leaves Zotero's copy standing when the conflict is discarded", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack, {
    write: () => staleVersion(),
    item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236" })),
  });
  await repository.patchColor("PUPR5FG5", "#ff6666");
  const sent = requests.length;

  repository.discardConflict("PUPR5FG5");

  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(requests.slice(sent)).toEqual([]);
});

it("reads a 404 on a write as an Annotation Zotero has deleted, and drops the list", async () => {
  await using stack = new AsyncDisposableStack();
  let deletedInZotero = false;
  const { repository } = await writable(stack, {
    write: () => notFound(),
    // Zotero stopped holding it between the read the card was drawn from and
    // the write, which is exactly what the `404` reports.
    children: () =>
      annotationPage(
        deletedInZotero
          ? ROUGIER_ANNOTATIONS.filter(({ key }) => key !== "PUPR5FG5")
          : ROUGIER_ANNOTATIONS,
      ),
  });
  deletedInZotero = true;

  const announced = nextChange(repository);
  const outcome = await repository.deleteAnnotation("PUPR5FG5");

  expect(outcome).toEqual({ kind: "failed", failure: { kind: "not-found" } });
  expect(await announced).toEqual(["RGRPDF24"]);
  const list = await repository.read("RGRPDF24");
  expect(list?.annotations.map(({ key }) => key)).not.toContain("PUPR5FG5");
});

it("reads a 404 on the conflict's own re-read as a deletion too", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {
    write: () => staleVersion(),
    item: () => notFound(),
  });

  const outcome = await repository.patchColor("PUPR5FG5", "#ff6666");

  expect(outcome).toEqual({ kind: "failed", failure: { kind: "not-found" } });
});

it("refreshes after a lost ordinary write response without replaying it", async () => {
  await using stack = new AsyncDisposableStack();
  let reads = 0;
  const { repository, requests } = await writable(stack, {
    write: () => Promise.reject(new AbortError("reader closed")),
    children: () => {
      reads += 1;
      return annotationPage(ROUGIER_ANNOTATIONS);
    },
  });
  const sent = requests.length;
  const readsBefore = reads;

  const outcome = await repository.patchComment("PUPR5FG5", "Attempted");

  expect(outcome).toEqual({
    kind: "failed",
    failure: { kind: "unknown-outcome" },
  });
  expect(
    requests
      .slice(sent)
      .filter(
        ({ method, url }) =>
          method === "PATCH" && url.pathname.endsWith("/PUPR5FG5"),
      ),
  ).toHaveLength(1);
  expect(reads).toBeGreaterThan(readsBefore);
});

it("requires explicit authorization before any annotation mutation", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(
    stack,
    {},
    { key: undefined },
  );
  const sent = requests.length;
  const outcomes = [
    await repository.patchColor("PUPR5FG5", "#ff6666"),
    await repository.patchComment("PUPR5FG5", "Worth citing"),
    await repository.deleteAnnotation("PUPR5FG5"),
    await repository.createAnnotation("RGRPDF24", DRAFT),
  ];
  expect(outcomes).toEqual([
    { kind: "failed", failure: { kind: "unauthorized" } },
    { kind: "failed", failure: { kind: "unauthorized" } },
    { kind: "failed", failure: { kind: "unauthorized" } },
    { kind: "failed", failure: { kind: "unauthorized" } },
  ]);
  expect(requests.slice(sent)).toEqual([]);
});

it("shows a write in flight as pending, and draws its Pending Proposal at once", async () => {
  await using stack = new AsyncDisposableStack();
  let answer!: (response: Response) => void;
  const inFlight = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  const { repository } = await writable(stack, {
    write: () => inFlight,
    item: () =>
      annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236", version: 20 })),
  });
  const states: string[] = [];
  stack.defer(
    repository.listen("annotation-changed", (key) => {
      states.push(repository.mutationFor(key).kind);
    }),
  );
  // What a surface redrawing on the announcement reads, in the same task.
  const announced: (string | null)[] = [];
  stack.defer(
    repository.listen("annotations-changed", (key) => {
      announced.push(colorOf(repository.peek(key)?.value ?? null, "PUPR5FG5"));
    }),
  );

  // Zotero stores lower case, so the proposal is drawn as Zotero will answer.
  const running = repository.patchColor("PUPR5FG5", "#5FB236");

  // The write and its proposal both stand in the task that asked for it.
  expect(announced).toEqual(["#5fb236"]);
  expect(states).toEqual(["pending"]);
  expect(repository.mutationFor("PUPR5FG5")).toEqual({
    kind: "pending",
    write: "color",
  });
  expect(colorOf(repository.peek("RGRPDF24")?.value ?? null, "PUPR5FG5")).toBe(
    "#5fb236",
  );
  expect(colorOf(await repository.read("RGRPDF24"), "PUPR5FG5")).toBe(
    "#5fb236",
  );
  answer(writeAccepted());
  await running;
  expect(states).toEqual(["pending", "idle"]);
  expect(colorOf(await repository.read("RGRPDF24"), "PUPR5FG5")).toBe(
    "#5fb236",
  );
});

it("stays pending from the first write to the last of a queue on one Annotation", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository } = await writable(stack, zotero.answers);
  const states: string[] = [];
  stack.defer(
    repository.listen("annotation-changed", (key) => {
      states.push(repository.mutationFor(key).kind);
    }),
  );
  const release = zotero.holdWrites();

  const first = repository.patchColor("PUPR5FG5", "#ff6666");
  const second = repository.patchComment("PUPR5FG5", "Queued behind it");
  release();
  await Promise.all([first, second]);

  // The verbs never come back between the two writes.
  expect(states.at(-1)).toBe("idle");
  expect(states.slice(0, -1).every((kind) => kind === "pending")).toBe(true);
  expect(zotero.at("PUPR5FG5")).toMatchObject({
    color: "#ff6666",
    comment: "Queued behind it",
  });
});

it.each([
  ["conflicts", () => staleVersion()],
  ["loses its reply", () => Promise.reject(new AbortError("reader closed"))],
] as const)(
  "draws the confirmed colour again once a write that %s settles",
  async (_, write) => {
    await using stack = new AsyncDisposableStack();
    const { repository } = await writable(stack, {
      write,
      // Zotero's own copy, which a conflict re-reads.
      item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236" })),
    });
    const drawn: (string | null)[] = [];
    stack.defer(
      repository.listen("annotations-changed", (key) => {
        drawn.push(colorOf(repository.peek(key)?.value ?? null, "PUPR5FG5"));
      }),
    );

    const outcome = await repository.patchColor("PUPR5FG5", "#ff6666");

    expect(outcome.kind).not.toBe("idle");
    expect(drawn[0]).toBe("#ff6666");
    expect(drawn.at(-1)).not.toBe("#ff6666");
    // The list Zotero answers still holds the Fixture's colour.
    expect(colorOf(await repository.read("RGRPDF24"), "PUPR5FG5")).toBe(
      "#2ea8e5",
    );
  },
);

it.each([
  ["color", "#5fb236"],
  ["comment", "Confirmed words"],
] as const)(
  "retains a confirmed %s when the API is lost during the collection refresh",
  async (field, attempted) => {
    await using stack = new AsyncDisposableStack();
    let apiLost = false;
    const confirmed = afterWrite("PUPR5FG5", {
      [field]: attempted,
      version: 38,
    });
    const { repository } = await writable(stack, {
      root: () => (apiLost ? unreachable() : rootOk()),
      write: () => writeAccepted(38),
      item: () => {
        apiLost = true;
        return annotationItem(confirmed);
      },
    });

    const outcome =
      field === "color"
        ? await repository.patchColor("PUPR5FG5", attempted)
        : await repository.patchComment("PUPR5FG5", attempted);

    expect(outcome).toEqual({ kind: "idle" });
    const record = repository
      .peek("RGRPDF24")
      ?.value.annotations.find(({ key }) => key === "PUPR5FG5");
    expect(record?.[field]).toBe(attempted);
    expect(repository.peek("RGRPDF24")?.value.source.kind).toBe(
      "zotero-local-api",
    );
  },
);

it("does not report exact patch confirmation when the item reread fails", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {
    write: () => writeAccepted(20),
    item: () => unreachable(),
  });

  const outcome = await repository.patchComment("PUPR5FG5", "Attempted");

  expect(outcome).toEqual({
    kind: "failed",
    failure: { kind: "unreachable" },
  });
  expect(
    repository
      .peek("RGRPDF24")
      ?.value.annotations.find(({ key }) => key === "PUPR5FG5")?.comment,
  ).not.toBe("Attempted");
});

it("retains concurrent confirmations for two Annotations during one refresh", async () => {
  await using stack = new AsyncDisposableStack();
  const refresh = Promise.withResolvers<Response>();
  const bothConfirmed = Promise.withResolvers<void>();
  let holdRefresh = false;
  let confirmations = 0;
  const { repository } = await writable(stack, {
    children: () =>
      holdRefresh ? refresh.promise : annotationPage(ROUGIER_ANNOTATIONS),
    write: ({ url }) =>
      writeAccepted(url.pathname.endsWith("/TYY6Z6ZF") ? 39 : 38),
    item: ({ url }) => {
      const key = url.pathname.endsWith("/TYY6Z6ZF") ? "TYY6Z6ZF" : "PUPR5FG5";
      confirmations += 1;
      if (confirmations === 2) bothConfirmed.resolve();
      return annotationItem(
        afterWrite(key, {
          color: "#ff6666",
          version: key === "TYY6Z6ZF" ? 39 : 38,
        }),
      );
    },
  });
  holdRefresh = true;

  const first = repository.patchColor("PUPR5FG5", "#ff6666");
  const second = repository.patchColor("TYY6Z6ZF", "#ff6666");
  await bothConfirmed.promise;
  refresh.resolve(annotationPage(ROUGIER_ANNOTATIONS));
  await Promise.all([first, second]);

  expect(colorOf(repository.peek("RGRPDF24")?.value ?? null, "PUPR5FG5")).toBe(
    "#ff6666",
  );
  expect(colorOf(repository.peek("RGRPDF24")?.value ?? null, "TYY6Z6ZF")).toBe(
    "#ff6666",
  );
});

it("retains a confirmed deletion when the API is lost during refresh", async () => {
  await using stack = new AsyncDisposableStack();
  let apiLost = false;
  const { repository } = await writable(stack, {
    root: () => (apiLost ? unreachable() : rootOk()),
    write: () => {
      apiLost = true;
      return writeAccepted(38);
    },
  });

  const outcome = await repository.deleteAnnotation("C94NJNYG");

  expect(outcome).toEqual({ kind: "idle" });
  expect(
    repository
      .peek("RGRPDF24")
      ?.value.annotations.some(({ key }) => key === "C94NJNYG"),
  ).toBe(false);
  expect(repository.peek("RGRPDF24")?.value.source.kind).toBe(
    "zotero-local-api",
  );
});

it("runs a color and delete on one Annotation one at a time", async () => {
  await using stack = new AsyncDisposableStack();
  const colorAnswer = Promise.withResolvers<Response>();
  const deleteAnswer = Promise.withResolvers<Response>();
  let writes = 0;
  const { repository, requests } = await writable(stack, {
    write: () => (writes++ === 0 ? colorAnswer.promise : deleteAnswer.promise),
    item: () =>
      annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666", version: 20 })),
  });
  const sent = requests.length;

  const color = repository.patchColor("PUPR5FG5", "#ff6666");
  const deletion = repository.deleteAnnotation("PUPR5FG5");
  await vi.waitFor(() =>
    expect(
      requests
        .slice(sent)
        .filter(({ method }) => method === "PATCH" || method === "DELETE"),
    ).toMatchObject([{ method: "PATCH" }]),
  );

  colorAnswer.resolve(writeAccepted());
  await vi.waitFor(() =>
    expect(
      requests.slice(sent).filter(({ method }) => method === "DELETE"),
    ).toHaveLength(1),
  );
  deleteAnswer.resolve(writeAccepted());

  await expect(color).resolves.toEqual({ kind: "idle" });
  await expect(deletion).resolves.toEqual({ kind: "idle" });
});

it("does not start a queued command after repository unload", async () => {
  await using stack = new AsyncDisposableStack();
  const first = Promise.withResolvers<Response>();
  const { repository, requests } = await writable(stack, {
    write: () => first.promise,
    item: () =>
      annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666", version: 20 })),
  });
  const sent = requests.length;

  const color = repository.patchColor("PUPR5FG5", "#ff6666");
  const queued = repository.patchComment("PUPR5FG5", "do not send");
  await vi.waitFor(() =>
    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toHaveLength(1),
  );
  await repository[Symbol.asyncDispose]();
  first.resolve(writeAccepted());

  // Zotero accepted the write; the reads it waits on after the unload get
  // their released answers, so it settles as idle.
  await expect(color).resolves.toEqual({ kind: "idle" });
  await expect(queued).resolves.toEqual({
    kind: "failed",
    failure: { kind: "unknown-outcome" },
  });
  expect(
    requests.slice(sent).filter(({ method }) => method === "PATCH"),
  ).toHaveLength(1);
});

it("accepts a write completion after the same database refreshes", async () => {
  await using stack = new AsyncDisposableStack();
  const reply = Promise.withResolvers<Response>();
  const sent = Promise.withResolvers<void>();
  const { repository, dbEvents } = await writable(stack, {
    write: () => {
      sent.resolve();
      return reply.promise;
    },
    item: () =>
      annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236", version: 20 })),
  });

  const running = repository.patchColor("PUPR5FG5", "#5fb236");
  await sent.promise;
  dbEvents.emit("changed");
  reply.resolve(writeAccepted(20));

  await expect(running).resolves.toEqual({ kind: "idle" });
  expect(colorOf(await repository.read("RGRPDF24"), "PUPR5FG5")).toBe(
    "#5fb236",
  );
});

it.each(["patch", "create"] as const)(
  "accepts a %s when the same database refreshes during verification",
  async (operation) => {
    await using stack = new AsyncDisposableStack();
    const reply = Promise.withResolvers<Response>();
    const sent = Promise.withResolvers<void>();
    const verifying = Promise.withResolvers<void>();
    const lease = Promise.withResolvers<ZoteroReadLease>();
    const { repository, client, acquireRead, dbEvents } = await writable(
      stack,
      {
        write: () => {
          sent.resolve();
          return reply.promise;
        },
        item: () =>
          annotationItem(
            afterWrite("PUPR5FG5", { color: "#5fb236", version: 20 }),
          ),
      },
    );

    const running =
      operation === "patch"
        ? repository.patchColor("PUPR5FG5", "#5fb236")
        : repository.createAnnotation("RGRPDF24", DRAFT);
    await sent.promise;
    dbEvents.emit("changed");
    acquireRead.mockImplementationOnce(() => {
      verifying.resolve();
      return lease.promise;
    });
    reply.resolve(
      operation === "patch" ? writeAccepted(20) : createAccepted(MADE),
    );
    await verifying.promise;
    dbEvents.emit("changed");
    await repository.read("RGRPDF24");
    lease.resolve(await leaseOver(stack, client));

    await expect(running).resolves.toEqual(
      operation === "patch"
        ? { kind: "idle" }
        : { kind: "created", annotationKey: "MADE2345" },
    );
  },
);

it.each([
  { operation: "patch", switched: false },
  { operation: "create", switched: false },
  { operation: "patch", switched: true },
  { operation: "create", switched: true },
])(
  "verifies the refreshed database before $operation (switched: $switched)",
  async ({ operation, switched }) => {
    await using stack = new AsyncDisposableStack();
    const write = vi.fn(() =>
      operation === "patch" ? writeAccepted(42) : createAccepted(MADE),
    );
    const { repository, client, acquireRead, dbEvents } = await writable(
      stack,
      {
        write,
        item: () =>
          annotationItem(
            operation === "patch"
              ? afterWrite("PUPR5FG5", { color: "#5fb236", version: 42 })
              : MADE,
          ),
      },
    );
    const resume = Promise.withResolvers<void>();
    const verifying = Promise.withResolvers<void>();
    const acquire = acquireRead.getMockImplementation()!;
    acquireRead.mockImplementation(async () => {
      verifying.resolve();
      await resume.promise;
      return acquire();
    });
    if (switched) {
      client.$client.exec(
        "update settings set value = 'Zzzz11119999' where setting = 'localAPI' and key = 'serverID'",
      );
    }
    dbEvents.emit("changed");
    const running =
      operation === "patch"
        ? repository.patchColor("PUPR5FG5", "#5fb236")
        : repository.createAnnotation("RGRPDF24", DRAFT);
    try {
      await verifying.promise;
      expect(write).not.toHaveBeenCalled();
    } finally {
      resume.resolve();
    }
    await expect(running).resolves.toEqual(
      switched
        ? { kind: "failed", failure: { kind: "server-changed" } }
        : operation === "patch"
          ? { kind: "idle" }
          : { kind: "created", annotationKey: "MADE2345" },
    );
    expect(write).toHaveBeenCalledTimes(switched ? 0 : 1);
  },
);

it("rejects verification from an old database generation", async () => {
  await using stack = new AsyncDisposableStack();
  const reply = Promise.withResolvers<Response>();
  const sent = Promise.withResolvers<void>();
  const verification = Promise.withResolvers<void>();
  const oldLease = Promise.withResolvers<ZoteroReadLease>();
  const { repository, client, acquireRead, dbEvents } = await writable(stack, {
    write: () => {
      sent.resolve();
      return reply.promise;
    },
  });
  const oldClient = createClient(":memory:");
  stack.defer(() => oldClient.$client.close());
  createFixtureSchema(oldClient.$client);
  oldClient.$client.exec(FIXTURE_ROWS);
  oldClient.$client.exec(`
    insert into version (schema, version) values ('userdata', 129), ('compatibility', 9);
    insert into libraries (libraryID, type, clientVersion) values (1, 'user', 37);
    insert into settings (setting, key, value) values ('localAPI', 'serverID', '${SERVER_ID}');
  `);

  const running = repository.patchColor("PUPR5FG5", "#5fb236");
  await sent.promise;
  dbEvents.emit("changed");
  acquireRead.mockImplementationOnce(() => {
    verification.resolve();
    return oldLease.promise;
  });
  reply.resolve(writeAccepted(38));
  await verification.promise;

  client.$client.exec(
    "update settings set value = 'Zzzz11119999' where setting = 'localAPI' and key = 'serverID'",
  );
  dbEvents.emit("changed");
  const current = await repository.read("RGRPDF24");
  oldLease.resolve(await leaseOver(stack, oldClient));

  await expect(running).resolves.toEqual({
    kind: "failed",
    failure: { kind: "server-changed" },
  });
  expect(current?.source).toMatchObject({
    kind: "zotero-db",
    database: { serverID: "Zzzz11119999" },
  });
  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
});

it("discards a late write completion after the API database changes", async () => {
  await using stack = new AsyncDisposableStack();
  let serverID = SERVER_ID;
  const reply = Promise.withResolvers<Response>();
  const sent = Promise.withResolvers<void>();
  const { repository, prefEvents } = await writable(stack, {
    root: () => rootOk({ "Zotero-Server-ID": serverID }),
    children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
    write: () => {
      sent.resolve();
      return reply.promise;
    },
  });

  const running = repository.patchColor("PUPR5FG5", "#5fb236");
  await sent.promise;
  serverID = "Zzzz11119999";
  prefEvents.emit("resolved-changed");
  await repository.probe();
  reply.resolve(writeAccepted(20));

  await expect(running).resolves.toEqual({
    kind: "failed",
    failure: { kind: "server-changed" },
  });
  expect(repository.mutationFor("PUPR5FG5")).toEqual({
    kind: "failed",
    failure: { kind: "server-changed" },
  });
});

// #endregion

// #region the create path

/** A stand-in token, so a request's own shape is what an assertion reads. */
const TOKEN = "0123456789abcdef0123456789abcdef";

it("retains an acknowledged create when a concurrent read loses API availability", async () => {
  await using stack = new AsyncDisposableStack();
  let loseRead = async () => {};
  let unavailable = false;
  const { repository, localApiService, localApiBridge } = await writable(
    stack,
    {
      children: () =>
        unavailable ? unreachable() : annotationPage(ROUGIER_ANNOTATIONS),
      write: async () => {
        await loseRead();
        return createAccepted(MADE);
      },
    },
  );
  loseRead = async () => {
    unavailable = true;
    await localApiBridge.runPromise(
      localApiService.listAnnotations("RGRPDF24"),
    );
    await repository.read("RGRPDF24");
  };
  expect(await repository.createAnnotation("RGRPDF24", DRAFT)).toEqual({
    kind: "created",
    annotationKey: MADE.key,
  });
  expect(
    repository.peek("RGRPDF24")?.value.annotations.map((record) => record.key),
  ).toContain(MADE.key);
});

it.each([false, true])(
  "retains a confirmed create across API loss (query collected: %s)",
  async (collected) => {
    await using stack = new AsyncDisposableStack();
    let apiLost = false;
    const { repository, queryClient } = await writable(
      stack,
      {
        root: () => (apiLost ? unreachable() : rootOk()),
        write: () => {
          apiLost = true;
          return createAccepted(MADE);
        },
      },
      { writeToken: () => TOKEN },
    );

    if (collected) queryClient.client.removeQueries();
    const outcome = await repository.createAnnotation("RGRPDF24", DRAFT);

    expect(outcome).toEqual({ kind: "created", annotationKey: "MADE2345" });
    expect(
      repository
        .peek("RGRPDF24")
        ?.value.annotations.find(({ key }) => key === "MADE2345"),
    ).toMatchObject({ color: "#ffd400", text: "Identify Your Message" });
    expect(repository.peek("RGRPDF24")?.value.source.kind).toBe(
      "zotero-local-api",
    );
  },
);

it.each([false, true])(
  "accepts a live list after a newer database snapshot covers an externally deleted create (API lost: %s)",
  async (lost) => {
    await using stack = new AsyncDisposableStack();
    let apiLost = false;
    const { repository, client, dbEvents, serverEvents } = await writable(
      stack,
      {
        root: () => (apiLost ? unreachable() : rootOk()),
        write: () => {
          apiLost = lost;
          return createAccepted(MADE);
        },
      },
    );
    expect(await repository.createAnnotation("RGRPDF24", DRAFT)).toEqual({
      kind: "created",
      annotationKey: MADE.key,
    });
    client.$client.exec(
      "update libraries set clientVersion = 43 where libraryID = 1",
    );
    dbEvents.emit("changed");
    expect((await repository.read("RGRPDF24"))?.source.kind).toBe(
      lost ? "zotero-db" : "zotero-local-api",
    );
    apiLost = false;
    const restored = nextChange(repository);
    freshnessSignal(serverEvents);
    await restored;
    expect((await repository.read("RGRPDF24"))?.source.kind).toBe(
      "zotero-local-api",
    );
  },
);

it("publishes the created record without rereading the collection", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(
    stack,
    {
      write: () => createAccepted(MADE),
      item: () => annotationItem(MADE),
      children: () => annotationPage([...ROUGIER_ANNOTATIONS, MADE]),
    },
    { writeToken: () => TOKEN },
  );
  const sent = requests.length;

  await repository.createAnnotation("RGRPDF24", DRAFT);

  expect(
    requests.slice(sent).map(({ method, url }) => `${method} ${url.pathname}`),
  ).toEqual([
    "POST /api/users/0/items",
    "GET /api/",
    "GET /api/users/0/items/RGRPDF24/children",
  ]);
  const list = await repository.read("RGRPDF24");
  expect(list?.annotations.map(({ key }) => key)).toContain("MADE2345");
});

it("fails the create on an object Zotero refused under its own 200", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {
    write: () => createRefused(400, "Invalid annotationSortIndex"),
  });

  const outcome = await repository.createAnnotation("RGRPDF24", DRAFT);

  expect(outcome).toMatchObject({
    kind: "failed",
    failure: { kind: "invalid-response" },
  });
});

it("refuses a create under the Zotero DB source before any request", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await setup(stack);
  // The Capability Probe runs on the first ask, so it is behind us before the
  // create is measured against "nothing was sent".
  await repository.read("RGRPDF24");
  const sent = requests.length;

  const outcome = await repository.createAnnotation("RGRPDF24", DRAFT);

  expect(outcome).toEqual({ kind: "failed", failure: { kind: "db-source" } });
  expect(requests).toHaveLength(sent);
});

/**
 * The Fixture's image, 40 points wider on the right, and the Sort Index its
 * new top-left gives. The seed rect is `[48.75, 395.509, 570, 743.723]`.
 */
const WIDER_IMAGE = {
  position: { pageIndex: 1, rects: [[48.75, 395.509, 610, 743.723]] },
  sortIndex: "00001|001860|00048",
};

it("saves a Geometry Edit in one patch and publishes the record Zotero answers", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack, {
    item: () =>
      annotationItem(afterWrite("FDRFQ7C2", { ...WIDER_IMAGE, version: 21 })),
  });
  const announced: unknown[] = [];
  stack.defer(
    repository.listen("excerpt-pixels-changed", (record) =>
      announced.push([record.key, record.position]),
    ),
  );
  const sent = requests.length;

  const outcome = await repository.patchGeometry(
    "FDRFQ7C2",
    WIDER_IMAGE,
    "pointer",
  );

  expect(outcome).toEqual({ kind: "idle" });
  const [write] = requests.slice(sent);
  expect([write?.method, write?.url.pathname]).toEqual([
    "PATCH",
    "/api/users/0/items/FDRFQ7C2",
  ]);
  expect(JSON.parse(write?.body ?? "")).toEqual({
    version: 12,
    annotationPosition: '{"pageIndex":1,"rects":[[48.75,395.509,610,743.723]]}',
    annotationSortIndex: "00001|001860|00048",
  });
  const moved = { kind: "pdf-rects", ...WIDER_IMAGE.position };
  expect(
    (await repository.read("RGRPDF24"))?.annotations.find(
      ({ key }) => key === "FDRFQ7C2",
    )?.position,
  ).toEqual(moved);
  expect(announced).toEqual([["FDRFQ7C2", moved]]);
});

it("draws a Geometry Edit while it saves as Zotero will store it, and announces pixels only once it lands", async () => {
  await using stack = new AsyncDisposableStack();
  const answer = Promise.withResolvers<Response>();
  const { repository } = await writable(stack, {
    write: () => answer.promise,
    item: () =>
      annotationItem(afterWrite("FDRFQ7C2", { ...WIDER_IMAGE, version: 21 })),
  });
  const drawn = () =>
    repository
      .peek("RGRPDF24")
      ?.value.annotations.find(({ key }) => key === "FDRFQ7C2");
  const pixels: string[] = [];
  stack.defer(
    repository.listen("excerpt-pixels-changed", ({ key }) => pixels.push(key)),
  );

  // The reader's own edge, before Zotero's three decimals.
  const saving = repository.patchGeometry(
    "FDRFQ7C2",
    {
      ...WIDER_IMAGE,
      position: { pageIndex: 1, rects: [[48.75, 395.509, 610.0004, 743.723]] },
    },
    "pointer",
  );

  expect(drawn()).toMatchObject({
    position: { kind: "pdf-rects", ...WIDER_IMAGE.position },
    sortIndex: WIDER_IMAGE.sortIndex,
  });
  expect(pixels).toEqual([]);
  answer.resolve(writeAccepted());
  expect(await saving).toEqual({ kind: "idle" });
  expect(pixels).toEqual(["FDRFQ7C2"]);
});

it("refuses a Geometry Edit longer than Zotero accepts before the write", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack);
  const sent = requests.length;

  const outcome = await repository.patchGeometry(
    "FDRFQ7C2",
    {
      position: {
        pageIndex: 1,
        width: 2,
        paths: [Array.from({ length: 12_000 }, () => 123.456)],
      },
      sortIndex: "00001|000000|00047",
    },
    "pointer",
  );

  expect(outcome).toEqual({
    kind: "failed",
    failure: { kind: "position-too-large" },
  });
  expect(requests).toHaveLength(sent);
});

it("puts Zotero's geometry beside the attempted Geometry Edit on a 412", async () => {
  await using stack = new AsyncDisposableStack();
  const moved = { pageIndex: 1, rects: [[60, 400, 570, 743.723]] };
  const { repository } = await writable(stack, {
    write: () => staleVersion(),
    item: () =>
      annotationItem(afterWrite("FDRFQ7C2", { position: moved, version: 30 })),
  });
  const conflicted: string[] = [];
  stack.defer(
    repository.listen("write-conflict", (key) => conflicted.push(key)),
  );

  const outcome = await repository.patchGeometry(
    "FDRFQ7C2",
    WIDER_IMAGE,
    "pointer",
  );

  expect(outcome).toEqual({
    kind: "conflict",
    conflict: {
      write: "geometry",
      attempted: WIDER_IMAGE,
      input: "pointer",
      fresh: { position: { kind: "pdf-rects", ...moved }, text: null },
    },
  });
  expect(conflicted).toEqual(["FDRFQ7C2"]);
});

it("resolves a Geometry Edit silently where Zotero already holds that geometry", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {
    write: () => staleVersion(),
    item: () =>
      annotationItem(afterWrite("FDRFQ7C2", { ...WIDER_IMAGE, version: 30 })),
  });

  const outcome = await repository.patchGeometry(
    "FDRFQ7C2",
    {
      ...WIDER_IMAGE,
      // Unrounded, as the reader computes it; Zotero stores three decimals.
      position: {
        pageIndex: 1,
        rects: [[48.750_2, 395.509, 610.000_4, 743.723]],
      },
    },
    "pointer",
  );

  expect(outcome).toEqual({ kind: "idle" });
});

it("sends a conflicted Geometry Edit again against the version Zotero holds now", async () => {
  await using stack = new AsyncDisposableStack();
  let refuse = true;
  const { repository, requests } = await writable(stack, {
    write: () => (refuse ? staleVersion() : writeAccepted()),
    item: () =>
      annotationItem(
        afterWrite("FDRFQ7C2", {
          position: { pageIndex: 1, rects: [[60, 400, 570, 743.723]] },
          version: 30,
        }),
      ),
  });
  await repository.patchGeometry("FDRFQ7C2", WIDER_IMAGE, "pointer");
  refuse = false;
  const sent = requests.length;

  await repository.retryWrite("FDRFQ7C2");

  expect(JSON.parse(requests[sent]!.body ?? "")).toEqual({
    version: 30,
    annotationPosition: '{"pageIndex":1,"rects":[[48.75,395.509,610,743.723]]}',
    annotationSortIndex: "00001|001860|00048",
  });
});

it("refuses a position longer than Zotero accepts before the write", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack);
  const sent = requests.length;

  const outcome = await repository.createAnnotation("RGRPDF24", {
    ...DRAFT,
    position: {
      pageIndex: 0,
      rects: Array.from({ length: 4000 }, () => [1.111, 2.222, 3.333, 4.444]),
    },
  });

  expect(outcome).toEqual({
    kind: "failed",
    failure: { kind: "position-too-large" },
  });
  expect(requests).toHaveLength(sent);
});

/**
 * A clock the test moves itself, so the `dateAdded` window a reconciliation
 * matches inside is a value rather than the wall clock.
 *
 * @see policies/test-timing.md
 */
it("reports a lost create response and refreshes without replaying it", async () => {
  await using stack = new AsyncDisposableStack();
  let reads = 0;
  const { repository, requests } = await writable(
    stack,
    {
      write: () => Promise.reject(new AbortError("reader closed")),
      children: () => {
        reads += 1;
        return annotationPage(ROUGIER_ANNOTATIONS);
      },
    },
    { writeToken: () => TOKEN },
  );
  const sent = requests.length;
  const readsBefore = reads;

  const outcome = await repository.createAnnotation("RGRPDF24", DRAFT);

  expect(outcome).toEqual({
    kind: "failed",
    failure: { kind: "unknown-outcome" },
  });
  expect(
    requests
      .slice(sent)
      .filter(
        ({ method, url }) =>
          method === "POST" && url.pathname === "/api/users/0/items",
      ),
  ).toHaveLength(1);
  expect(reads).toBeGreaterThan(readsBefore);
});

it("refreshes the collection after Zotero definitely rejects a create", async () => {
  await using stack = new AsyncDisposableStack();
  let reads = 0;
  const { repository } = await writable(stack, {
    write: () => new Response("no", { status: 400 }),
    children: () => {
      reads += 1;
      return annotationPage(ROUGIER_ANNOTATIONS);
    },
  });
  const readsBefore = reads;

  const outcome = await repository.createAnnotation("RGRPDF24", DRAFT);

  expect(outcome).toEqual({
    kind: "failed",
    failure: { kind: "invalid-response", issue: "400 no" },
  });
  expect(reads).toBeGreaterThan(readsBefore);
});

// #endregion

// #endregion
