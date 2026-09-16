import { expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { AbortError } from "@/lib/abort-error";
import type { DatabaseEvents } from "@/services/database/service";
import { QueryClientService } from "@/services/query-client/service";
import {
  annotationItem,
  annotationPage,
  authorized,
  createAccepted,
  createRefused,
  denied,
  freshnessSignal,
  localApiClient,
  localApiDisabled,
  notFound,
  rootOk,
  ROUGIER_ANNOTATIONS,
  SERVER_ID,
  staleVersion,
  unreachable,
  writeAccepted,
} from "@/services/zotero-local-api/__fixtures__";
import type {
  ClientOptions,
  WireAnnotation,
  ZoteroAnswers,
} from "@/services/zotero-local-api/__fixtures__";

import { AnnotationRepository } from "./service";
import type { AnnotationList } from "./service";

const NOW = Temporal.Instant.from("2026-09-16T15:52:21Z");

// The Fixture's own rows are the oracle: the same item ids, keys, types,
// colours, sort indexes and positions it builds on `rougier-2014.pdf`, which
// carries one Annotation of each of Zotero's six types. The two ink strokes
// keep the first three points of the Fixture's path — the repository moves a
// position through unchanged, so the rest of the stroke proves nothing. The
// EPUB attachment is not in the Fixture: it is seeded here so the content type
// the position is narrowed by is observable.
// @see packages/scripts/lib/fixture/spec.ts — `ANNOTATIONS`
const FIXTURE_ROWS = `
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
      (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24'),
      (48, 4, '2026-08-23 16:17:50', '2026-08-23 16:17:50', 1, 'PUPR5FG5'),
      (49, 4, '2026-08-23 16:18:01', '2026-08-23 16:18:01', 1, 'FDRFQ7C2'),
      (50, 4, '2026-08-23 16:18:11', '2026-08-23 16:18:11', 1, 'K3JRFLFQ'),
      (51, 4, '2026-08-23 16:18:18', '2026-08-23 16:19:07', 1, 'HRK7BG32'),
      (52, 4, '2026-08-23 16:19:19', '2026-08-23 16:19:30', 1, 'C94NJNYG'),
      (55, 4, '2026-08-23 16:20:09', '2026-08-23 16:20:21', 1, 'TYY6Z6ZF'),
      (56, 4, '2026-08-23 16:20:12', '2026-08-23 16:20:18', 1, '4PE492KU'),
      (70, 2, '2025-02-19 12:00:00', '2025-02-19 12:00:00', 1, 'EPUBBKS2'),
      (71, 4, '2025-02-19 12:00:00', '2025-02-19 12:00:00', 1, 'EPUBMRK2');

  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values
      (47, 46, 2, 'application/pdf', 'attachments/rougier-2014.pdf'),
      (70, null, 0, 'application/epub+zip', 'storage:reader.epub');

  insert into itemAnnotations
    (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex, position, isExternal)
    values
      (48, 47, 1, 'Identify Your Message', null, '#2ea8e5', '1',
        '00000|002041|00170',
        '{"pageIndex":0,"rects":[[265.833,611.202,374.503,620.019]]}', 0),
      (49, 47, 3, null, null, '#ffd400', '2',
        '00001|001860|00047',
        '{"pageIndex":1,"rects":[[48.75,395.509,570,743.723]]}', 0),
      (50, 47, 5,
        'Scientific visualization is classically defined as the process of graphically displaying scientific data.',
        null, '#ff6666', '1', '00000|000434|00180',
        '{"pageIndex":0,"rects":[[67.011,612.638,211.485,620.77],[58.054,601.98,211.489,610.112],[58.054,591.321,153.781,599.454]]}', 0),
      (51, 47, 6, null, 'Making figures is hard :(', '#a28ae5', '1',
        '00000|000191|00088',
        '{"pageIndex":0,"fontSize":14,"rotation":0,"rects":[[398.804,685.107,560.804,702.107]]}', 0),
      (52, 47, 2, null, 'some text comment', '#ffd400', '1',
        '00000|003354|00170',
        '{"pageIndex":0,"rects":[[566.901,598.393,588.901,620.393]]}', 0),
      (55, 47, 4, null, null, '#5fb236', '1', '00000|000040|00100',
        '{"pageIndex":0,"width":2,"paths":[[66.964,674.348,66.629,673.26,66.629,672.214]]}', 0),
      (56, 47, 4, null, null, '#f19837', '1', '00000|000067|00104',
        '{"pageIndex":0,"width":2,"paths":[[203.571,673.009,204.45,672.256,205.266,671.628]]}', 0),
      (71, 70, 1, 'A paragraph in a reflowable book', null, '#ffd400', null,
        '00000|000000|00000',
        '{"type":"FragmentSelector","value":"epubcfi(/6/4!/4/2)"}', 0);
`;

/** Every Annotation of `RGRPDF24`, in the reading order its sort indexes give. */
const READING_ORDER = [
  ["TYY6Z6ZF", "ink"],
  ["4PE492KU", "ink"],
  ["HRK7BG32", "text"],
  ["K3JRFLFQ", "underline"],
  ["PUPR5FG5", "highlight"],
  ["C94NJNYG", "note"],
  ["FDRFQ7C2", "image"],
];

it("reads every type the Fixture carries on one attachment, in Zotero's reading order", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack);

  const list = await repository.read("RGRPDF24");

  expect(list?.source).toEqual({ kind: "zotero-db" });
  expect(list?.annotations.map(({ key, type }) => [key, type])).toEqual(
    READING_ORDER,
  );
  expect(list?.annotations.find(({ key }) => key === "HRK7BG32")).toEqual({
    key: "HRK7BG32",
    type: "text",
    color: "#a28ae5",
    comment: "Making figures is hard :(",
    text: null,
    parentKey: "RGRPDF24",
    pageLabel: "1",
    tags: [],
    position: {
      kind: "pdf-text",
      pageIndex: 0,
      fontSize: 14,
      rotation: 0,
      rects: [[398.804, 685.107, 560.804, 702.107]],
    },
    version: null,
  });
});

it("narrows each position by the content type of the attachment that holds it", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack);

  const pdf = await repository.read("RGRPDF24");
  const epub = await repository.read("EPUBBKS2");

  expect(
    Object.fromEntries(
      (pdf?.annotations ?? []).map(({ key, position }) => [key, position.kind]),
    ),
  ).toEqual({
    TYY6Z6ZF: "pdf-ink",
    "4PE492KU": "pdf-ink",
    HRK7BG32: "pdf-text",
    K3JRFLFQ: "pdf-rects",
    PUPR5FG5: "pdf-rects",
    C94NJNYG: "pdf-rects",
    FDRFQ7C2: "pdf-rects",
  });
  // The Annotation row carries no content type of its own, so a repository that
  // skipped the join back to the attachment would read this as an unknown shape.
  expect(epub?.annotations.map(({ position }) => position)).toEqual([
    { kind: "epub-cfi", value: "epubcfi(/6/4!/4/2)" },
  ]);
});

it("serves one database read to every surface that asks for one attachment at once", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, acquireRead } = await setup(stack);

  const [overlay, view] = await Promise.all([
    repository.read("RGRPDF24"),
    repository.read("RGRPDF24"),
  ]);

  expect(acquireRead).toHaveBeenCalledOnce();
  expect(overlay).toBe(view);
  expect(repository.peek("RGRPDF24")?.value).toBe(overlay);
});

it("drops the whole Zotero database partition on a refresh and names every attachment it held", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, client, dbEvents } = await setup(stack);
  const changed: string[] = [];
  stack.defer(repository.on("annotations-changed", (key) => changed.push(key)));

  await repository.read("RGRPDF24");
  await repository.read("EPUBBKS2");
  client.$client.exec(
    "update itemAnnotations set color = '#5fb236' where itemID = 48;",
  );

  // A stale list stands until the database says it moved.
  const held = repository.peek("RGRPDF24");
  expect(held?.status).toBe("fresh");
  expect(colorOf(held?.value ?? null, "PUPR5FG5")).toBe("#2ea8e5");

  dbEvents.emit("changed");

  expect(changed.toSorted()).toEqual(["EPUBBKS2", "RGRPDF24"]);
  expect(colorOf(await repository.read("RGRPDF24"), "PUPR5FG5")).toBe(
    "#5fb236",
  );
});

it("answers an empty list for a key the database does not hold", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack);

  expect(await repository.read("NOSUCH24")).toEqual({
    source: { kind: "zotero-db" },
    annotations: [],
  });
});

it("leaves the Zotero database exactly as it found it", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, client, dbEvents } = await setup(stack);
  const before = annotationRows(client);

  await repository.read("RGRPDF24");
  dbEvents.emit("changed");
  await repository.read("RGRPDF24");
  await repository.read("NOSUCH24");

  expect(annotationRows(client)).toEqual(before);
});

it("switches to the Zotero Local API when it answers, and says which source did", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack, {
    children: () => annotationPage(ROUGIER_ANNOTATIONS),
  });

  const announced = nextChange(repository);
  // The first ask arms the Capability Probe and is answered meanwhile by the
  // source that is known to stand.
  const first = await repository.read("RGRPDF24");
  const switched = await announced;
  const second = await repository.read("RGRPDF24");

  expect(first?.source).toEqual({ kind: "zotero-db" });
  expect(switched).toEqual(["RGRPDF24"]);
  expect(second?.source).toEqual({
    kind: "zotero-local-api",
    serverID: SERVER_ID,
  });
  expect(second?.annotations.map(({ key, type }) => [key, type])).toEqual(
    READING_ORDER,
  );
});

it("draws the same mark from either source, the object version apart", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack, {
    children: () => annotationPage(ROUGIER_ANNOTATIONS),
  });

  const announced = nextChange(repository);
  const fromDatabase = await repository.read("RGRPDF24");
  await announced;
  const fromLocalApi = await repository.read("RGRPDF24");

  // The Zotero DB keeps no version, so the Zotero Local API's is the one
  // difference a surface can see between the two record sets.
  expect(
    fromLocalApi?.annotations.map((record) => ({ ...record, version: null })),
  ).toEqual(fromDatabase?.annotations);
  expect(fromLocalApi?.annotations.map(({ version }) => version)).toEqual([
    16, 17, 14, 13, 11, 15, 12,
  ]);
});

it("drops the server partition on the Companion's Freshness Signal", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests, serverEvents } = await setup(stack, {
    children: () => annotationPage(ROUGIER_ANNOTATIONS),
  });
  await switchToLocalApi(repository);
  await repository.read("RGRPDF24");
  const sent = requests.length;

  const announced = nextChange(repository);
  freshnessSignal(serverEvents);
  const refreshed = await announced;
  await repository.read("RGRPDF24");

  expect(refreshed).toEqual(["RGRPDF24"]);
  // One Capability Probe, then one list read: the held answer was dropped
  // rather than served again.
  expect(requests.slice(sent).map(({ url }) => url.pathname)).toEqual([
    "/api/",
    "/api/users/0/items/RGRPDF24/children",
  ]);
});

it("keeps the marks under the Zotero DB source when Zotero closes mid-session", async () => {
  await using stack = new AsyncDisposableStack();
  let answering = true;
  const { repository, serverEvents } = await setup(stack, {
    root: () => (answering ? rootOk() : unreachable()),
    children: () => annotationPage(ROUGIER_ANNOTATIONS),
  });
  await switchToLocalApi(repository);
  const live = await repository.read("RGRPDF24");

  answering = false;
  const announced = nextChange(repository);
  freshnessSignal(serverEvents);
  const gone = await announced;
  const fallback = await repository.read("RGRPDF24");

  expect(live?.source).toEqual({
    kind: "zotero-local-api",
    serverID: SERVER_ID,
  });
  expect(gone).toEqual(["RGRPDF24"]);
  // The same marks are still on screen, from the source that can still answer.
  expect(fallback?.source).toEqual({ kind: "zotero-db" });
  expect(fallback?.annotations.map(({ key, type }) => [key, type])).toEqual(
    READING_ORDER,
  );
});

it("stands the source down when a list read fails, and answers from the Zotero DB", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack, { children: () => unreachable() });
  await switchToLocalApi(repository);

  const announced = nextChange(repository);
  const failed = await repository.read("EPUBBKS2");
  const fallback = await repository.read("EPUBBKS2");

  // Nothing was ever held for this Attachment on the source that failed.
  expect(failed).toBeNull();
  expect((await announced).toSorted()).toEqual(["EPUBBKS2", "RGRPDF24"]);
  expect(fallback?.source).toEqual({ kind: "zotero-db" });
  expect(fallback?.annotations.map(({ key }) => key)).toEqual(["EPUBMRK2"]);
});

it("partitions the cache by server id, so another database answers for itself", async () => {
  await using stack = new AsyncDisposableStack();
  let serverID = SERVER_ID;
  const { repository, prefEvents } = await setup(stack, {
    root: () => rootOk({ "Zotero-Server-ID": serverID }),
    children: () =>
      annotationPage(
        serverID === SERVER_ID
          ? ROUGIER_ANNOTATIONS
          : ROUGIER_ANNOTATIONS.slice(0, 1),
        { serverID },
      ),
  });
  await switchToLocalApi(repository);
  const first = await repository.read("RGRPDF24");

  serverID = "Zzzz11119999";
  const announced = nextChange(repository);
  prefEvents.emit("resolved-changed");
  await announced;
  const second = await repository.read("RGRPDF24");

  expect(first?.annotations).toHaveLength(7);
  expect(second?.source).toEqual({
    kind: "zotero-local-api",
    serverID: "Zzzz11119999",
  });
  expect(second?.annotations.map(({ key }) => key)).toEqual(["PUPR5FG5"]);
});

it("cancels the read in flight when the partition it fills is dropped", async () => {
  await using stack = new AsyncDisposableStack();
  const held = Promise.withResolvers<Response>();
  const inFlight = Promise.withResolvers<void>();
  let reads = 0;
  const { repository, serverEvents, requests } = await setup(stack, {
    children: () => {
      if (reads++ > 0) return annotationPage(ROUGIER_ANNOTATIONS);
      inFlight.resolve();
      return held.promise;
    },
  });
  await switchToLocalApi(repository);

  const reading = repository.read("RGRPDF24");
  // The read is in flight when the transport has been handed the request it
  // will not answer.
  await inFlight.promise;
  freshnessSignal(serverEvents);
  const list = await reading;

  // The superseded read never publishes: the ask that joined it is answered by
  // the read the invalidation asked for.
  expect(list?.annotations).toHaveLength(7);
  expect(
    requests.filter(({ url }) => url.pathname.endsWith("/children")),
  ).toHaveLength(2);
});

it("answers the Editing Capability the Annotation Source leaves", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, localApi } = await setup(stack, {
    root: localApiDisabled,
  });

  const beforeProbe = repository.capabilityFor("RGRPDF24");
  await localApi.probe();
  const disabled = repository.capabilityFor("RGRPDF24");

  expect(beforeProbe).toEqual({ kind: "read-only", reason: "probing" });
  // Reads need no key, so a session that stands asks for one only to write.
  expect(disabled).toEqual({
    kind: "read-only",
    reason: "local-api-disabled",
  });
});

it("asks for authorization once a session stands, and keeps reading meanwhile", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack, {
    children: () => annotationPage(ROUGIER_ANNOTATIONS),
  });

  await switchToLocalApi(repository);
  const list = await repository.read("RGRPDF24");

  expect(repository.capabilityFor("RGRPDF24")).toEqual({
    kind: "authorization-required",
  });
  expect(list?.annotations).toHaveLength(7);
});

it("answers the session's own capability, and announces when one moves", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, localApi } = await setup(stack, {
    children: () => annotationPage(ROUGIER_ANNOTATIONS),
  });
  let announced = 0;
  stack.defer(
    repository.on("capability-changed", () => {
      announced += 1;
    }),
  );

  expect(repository.capability).toEqual({
    kind: "read-only",
    reason: "probing",
  });
  await localApi.probe();

  // The settings row reads this one: it names no Attachment, so no library
  // Zotero refused a write to is part of it.
  expect(repository.capability).toEqual({ kind: "authorization-required" });
  expect(announced).toBeGreaterThan(0);
});

// #region the write path

/** A Remembered Write Authorization, so no gesture stands between a command and Zotero. */
const REMEMBERED_KEY = "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf";

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

it("patches a comment with the precondition and nothing else", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack);
  const sent = requests.length;

  await repository.patchComment("PUPR5FG5", "Worth citing");

  const [patch] = requests.slice(sent);
  expect(JSON.parse(patch!.body ?? "")).toEqual({
    version: 11,
    annotationComment: "Worth citing",
  });
});

it("recolours an ink annotation like any other", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack, {
    item: () => annotationItem(afterWrite("TYY6Z6ZF", { color: "#2ea8e5" })),
  });
  const sent = requests.length;

  const outcome = await repository.patchColor("TYY6Z6ZF", "#2EA8E5");

  expect(outcome).toEqual({ kind: "idle" });
  expect(JSON.parse(requests[sent]!.body ?? "")).toEqual({
    version: 16,
    annotationColor: "#2ea8e5",
  });
  expect(colorOf(await repository.read("RGRPDF24"), "TYY6Z6ZF")).toBe(
    "#2ea8e5",
  );
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

  expect(list?.source).toEqual({ kind: "zotero-db" });
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

it("leaves the record standing when Zotero refuses the write", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, { write: () => staleVersion() });

  const outcome = await repository.patchColor("PUPR5FG5", "#ff6666");

  expect(outcome).toEqual({ kind: "failed", failure: { kind: "conflict" } });
  expect(colorOf(await repository.read("RGRPDF24"), "PUPR5FG5")).toBe(
    "#2ea8e5",
  );
});

it("reads a 404 on a write as an Annotation Zotero has deleted", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, { write: () => notFound() });

  const outcome = await repository.deleteAnnotation("PUPR5FG5");

  expect(outcome).toEqual({ kind: "failed", failure: { kind: "not-found" } });
  // The card leaves on the next read, not on the refusal.
  expect(colorOf(await repository.read("RGRPDF24"), "PUPR5FG5")).toBe(
    "#2ea8e5",
  );
});

it("shows a write in flight as pending, and draws no provisional value", async () => {
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
    repository.on("mutation-changed", (key) => {
      states.push(repository.mutationFor(key).kind);
    }),
  );

  const running = repository.patchColor("PUPR5FG5", "#5fb236");

  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "pending" });
  expect(colorOf(repository.peek("RGRPDF24")?.value ?? null, "PUPR5FG5")).toBe(
    "#2ea8e5",
  );
  answer(writeAccepted());
  await running;
  expect(states).toEqual(["pending", "idle"]);
  expect(colorOf(await repository.read("RGRPDF24"), "PUPR5FG5")).toBe(
    "#5fb236",
  );
});

// #endregion

// #region the create path

/** A stand-in token, so a request's own shape is what an assertion reads. */
const TOKEN = "0123456789abcdef0123456789abcdef";

/** The Annotation one create asks Zotero for, in the reader's own words. */
const DRAFT = {
  type: "highlight",
  color: "#FFD400",
  comment: "",
  text: "Identify Your Message",
  pageLabel: "1",
  sortIndex: "00000|002041|00170",
  position: {
    pageIndex: 0,
    rects: [[265.833_4, 611.202_4, 374.503_4, 620.019_4]],
  },
} as const;

/** The Annotation Zotero answers a create with, and reads back afterwards. */
const MADE: WireAnnotation = {
  key: "MADE2345",
  version: 42,
  type: "highlight",
  text: "Identify Your Message",
  color: "#ffd400",
  pageLabel: "1",
  sortIndex: "00000|002041|00170",
  position: { pageIndex: 0, rects: [[265.833, 611.202, 374.503, 620.019]] },
};

it("creates through a one-element multi-object POST carrying a write token", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(
    stack,
    { write: () => createAccepted(MADE), item: () => annotationItem(MADE) },
    { writeToken: () => TOKEN },
  );
  const sent = requests.length;

  const outcome = await repository.createAnnotation("RGRPDF24", DRAFT);

  expect(outcome).toEqual({ kind: "created", annotationKey: "MADE2345" });
  const [create] = requests.slice(sent);
  expect([create?.method, create?.url.pathname]).toEqual([
    "POST",
    "/api/users/0/items",
  ]);
  expect(Object.fromEntries(create!.headers)).toMatchObject({
    "zotero-api-key": REMEMBERED_KEY,
    "zotero-server-id": SERVER_ID,
    "zotero-api-version": "3",
    "zotero-allowed-request": "1",
    "zotero-write-token": TOKEN,
    "content-type": "application/json",
  });
  expect(JSON.parse(create!.body ?? "")).toEqual([
    {
      annotationType: "highlight",
      itemType: "annotation",
      parentItem: "RGRPDF24",
      annotationText: "Identify Your Message",
      annotationComment: "",
      annotationColor: "#ffd400",
      annotationPageLabel: "1",
      annotationSortIndex: "00000|002041|00170",
      annotationPosition:
        '{"pageIndex":0,"rects":[[265.833,611.202,374.503,620.019]]}',
    },
  ]);
});

it("reads the created Annotation back and drops the Attachment's list", async () => {
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
  ).toEqual(["POST /api/users/0/items", "GET /api/users/0/items/MADE2345"]);
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
  expect(repository.pendingCreates.size).toBe(0);
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

it("keeps the write token and the request start instant while an answer is lost", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(
    stack,
    { write: () => Promise.reject(new AbortError("reader closed")) },
    { writeToken: () => TOKEN },
  );

  const outcome = await repository.createAnnotation("RGRPDF24", DRAFT);

  expect(outcome).toEqual({ kind: "uncertain" });
  const pending = repository.pendingCreates.get(TOKEN);
  expect(pending?.attachmentKey).toBe("RGRPDF24");
  expect(pending?.startedAt).toEqual(NOW);
  expect(pending?.request.writeToken).toBe(TOKEN);
  expect(pending?.draft.parentKey).toBe("RGRPDF24");
});

it("opens Zotero's dialog when the gesture needs one, then goes on", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(
    stack,
    {
      authorize: () => authorized({ remember: false }),
      write: () => createAccepted(MADE),
      item: () => annotationItem(MADE),
    },
    { key: undefined, writeToken: () => TOKEN },
  );
  expect(repository.capabilityFor("RGRPDF24")).toEqual({
    kind: "authorization-required",
  });
  const sent = requests.length;

  const outcome = await repository.createAnnotation("RGRPDF24", DRAFT);

  expect(
    requests.slice(sent).map(({ method, url }) => `${method} ${url.pathname}`),
  ).toEqual([
    // The gesture probes before it asks, because the probe is the sole
    // authority on whether the local API is on at all.
    "GET /api/",
    "POST /api/local/authorize",
    "POST /api/users/0/items",
    "GET /api/users/0/items/MADE2345",
  ]);
  expect(outcome).toEqual({ kind: "created", annotationKey: "MADE2345" });
});

it("stops a create Zotero's dialog refused, and opens no second one", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(
    stack,
    { authorize: () => denied() },
    { key: undefined },
  );
  const sent = requests.length;

  const outcome = await repository.createAnnotation("RGRPDF24", DRAFT);

  expect(outcome).toEqual({ kind: "failed", failure: { kind: "denied" } });
  expect(requests.slice(sent).map(({ url }) => url.pathname)).toEqual([
    "/api/",
    "/api/local/authorize",
  ]);
});

// #endregion

/**
 * The repository over a Zotero Local API session that already holds a Write
 * Authorization, with the Fixture's Annotations read into its partition — the
 * state a card is in when the user reaches for a verb.
 */
async function writable(
  stack: AsyncDisposableStack,
  answers: ZoteroAnswers = {},
  options: { key?: string; writeToken?: () => string } = {},
) {
  const { writeToken } = options;
  // Named as `undefined` means "no Remembered Authorization", which is not the
  // same as leaving it out.
  const key = "key" in options ? options.key : REMEMBERED_KEY;
  const harness = await setup(
    stack,
    {
      children: () => annotationPage(ROUGIER_ANNOTATIONS),
      item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666" })),
      ...answers,
    },
    { key, writeToken },
  );
  await switchToLocalApi(harness.repository);
  await harness.repository.read("RGRPDF24");
  return harness;
}

/** One Fixture Annotation as Zotero answers it once a write has landed. */
function afterWrite(
  key: string,
  patch: Partial<WireAnnotation>,
): WireAnnotation {
  const record = ROUGIER_ANNOTATIONS.find((entry) => entry.key === key);
  if (!record) throw new Error(`No fixture annotation ${key}`);
  return { ...record, ...patch };
}

// #endregion

/** Read once so the Capability Probe runs, and wait for the source it finds. */
async function switchToLocalApi(
  repository: AnnotationRepository,
): Promise<void> {
  const announced = nextChange(repository);
  await repository.read("RGRPDF24");
  await announced;
}

function colorOf(list: AnnotationList | null, key: string): string | null {
  return list?.annotations.find((record) => record.key === key)?.color ?? null;
}

/** Every stored Annotation row, as an oracle for "nothing was written". */
function annotationRows(client: NodeDatabaseClient): unknown[] {
  return client.$client
    .prepare("select * from itemAnnotations order by itemID")
    .all();
}

/**
 * The repository over a real query client and a real Zotero Local API client,
 * with a fake transport under it: the seam a surface reads through, driven by
 * the answers a Paired Run recorded.
 *
 * @param answers what Zotero answers. The default is a Zotero that is not
 *   running, so the Zotero DB is the source.
 */
async function setup(
  stack: AsyncDisposableStack,
  answers: ZoteroAnswers = { root: unreachable },
  options: ClientOptions & { writeToken?: () => string } = {},
) {
  const { writeToken, ...clientOptions } = options;
  const client = createClient(":memory:");
  stack.defer(() => client.$client.close());
  createFixtureSchema(client.$client);
  client.$client.exec(FIXTURE_ROWS);

  const dbEvents = createNanoEvents<DatabaseEvents>();
  const acquireRead = vi.fn(() =>
    Promise.resolve({ client, [Symbol.dispose]: () => undefined }),
  );
  const db = {
    acquireRead,
    on: <K extends keyof DatabaseEvents>(event: K, cb: DatabaseEvents[K]) =>
      dbEvents.on(event, cb),
  };

  const {
    client: localApi,
    requests,
    serverEvents,
    prefEvents,
  } = localApiClient(answers, clientOptions);
  stack.use(localApi);
  await localApi.ready;

  const queryClient = new QueryClientService();
  stack.use(queryClient);
  const repository = new AnnotationRepository({
    db,
    queryClient,
    localApi,
    now: () => NOW,
    writeToken,
  });
  stack.use(repository);
  await repository.ready;
  return {
    repository,
    client,
    db,
    dbEvents,
    acquireRead,
    queryClient,
    localApi,
    requests,
    serverEvents,
    prefEvents,
  };
}

/** The next `annotations-changed` the repository emits, as a completion signal. */
function nextChange(
  repository: AnnotationRepository,
): Promise<readonly string[]> {
  return new Promise((resolve) => {
    const announced: string[] = [];
    const off = repository.on("annotations-changed", (key) => {
      announced.push(key);
      queueMicrotask(() => {
        off();
        resolve(announced);
      });
    });
  });
}
