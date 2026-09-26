import { expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { AbortError } from "@/lib/abort-error";
import * as m from "@/lib/i18n/generated/messages";
import { excerptFingerprint } from "@/services/excerpt-image/contract";
import {
  annotationItem,
  annotationPage,
  authorized,
  createAccepted,
  createRefused,
  freshnessSignal,
  keyRejected,
  localApiDisabled,
  notFound,
  rootOk,
  ROUGIER_ANNOTATIONS,
  SERVER_ID,
  serverChanged,
  staleVersion,
  staleVersionPatch,
  unreachable,
  writeAccepted,
} from "@/services/zotero-local-api/__fixtures__";
import type {
  WireAnnotation,
  ZoteroAnswers,
  ZoteroRequest,
} from "@/services/zotero-local-api/__fixtures__";
import type { WireTag } from "@/services/zotero-local-api/wire";
import {
  cardControls,
  commentEditorControls,
  editingBlockedReason,
} from "@/views/annot-view/card-controls";

import {
  afterWrite,
  FIXTURE_ROWS,
  NOW,
  nextChange,
  REMEMBERED_KEY,
  setup,
  switchToLocalApi,
  writable,
  zoteroLibrary,
} from "./__fixtures__";
import { JOIN_WINDOW_MS } from "./history";
import type { AnnotationRepository } from "./service";
import type { AnnotationList } from "./service";
import type { GeometryEdit } from "./write";

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

const DATABASE_SOURCE = {
  kind: "zotero-db",
  database: { userID: null, localUserKey: null, serverID: SERVER_ID },
  libraryID: 1,
  libraryRevision: 37,
} as const;

it("reads every type the Fixture carries on one attachment, in Zotero's reading order", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack);

  const list = await repository.read("RGRPDF24");

  expect(list?.source).toEqual(DATABASE_SOURCE);
  expect(list?.annotations.find(({ key }) => key === "PUPR5FG5")?.version).toBe(
    29,
  );
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
    sortIndex: "00000|000191|00088",
    tags: [],
    tagDetails: [],
    position: {
      kind: "pdf-text",
      pageIndex: 0,
      fontSize: 14,
      rotation: 0,
      rects: [[398.804, 685.107, 560.804, 702.107]],
    },
    version: 0,
    templateMetadata: {
      dateAdded: "2026-08-23T16:18:18Z",
      dateModified: "2026-08-23T16:19:07Z",
      authorName: null,
      isExternal: false,
      tags: [],
    },
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

it("converts raw database tag types for annotation template metadata", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, client } = await setup(stack);
  client.$client.exec(`
    insert into tags (tagID, name) values (991, 'hand-added'), (992, 'translator');
    insert into itemTags (itemID, tagID, type) values (49, 991, 0), (49, 992, 1);
  `);
  const list = await repository.read("RGRPDF24");
  expect(
    list?.annotations.find(({ key }) => key === "FDRFQ7C2")?.templateMetadata
      ?.tags,
  ).toEqual([
    { name: "hand-added", type: "manual" },
    { name: "translator", type: "auto" },
  ]);
});

it("carries each tag's type from both Annotation Sources", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, client } = await setup(stack, {
    children: () =>
      annotationPage(
        ROUGIER_ANNOTATIONS.map((entry) =>
          entry.key === "FDRFQ7C2"
            ? { ...entry, tags: ["hand-added", { tag: "translator", type: 1 }] }
            : entry,
        ),
      ),
  });
  client.$client.exec(`
    insert into tags (tagID, name) values (991, 'hand-added'), (992, 'translator');
    insert into itemTags (itemID, tagID, type) values (49, 991, 0), (49, 992, 1);
  `);
  const tagsOf = (list: AnnotationList | null) =>
    list?.annotations.find(({ key }) => key === "FDRFQ7C2");
  const expected = [
    { name: "hand-added", type: 0 },
    { name: "translator", type: 1 },
  ];

  const announced = nextChange(repository);
  const fromDatabase = await repository.read("RGRPDF24");
  await announced;
  const fromLocalApi = await repository.read("RGRPDF24");

  expect(fromDatabase?.source.kind).toBe("zotero-db");
  expect(tagsOf(fromDatabase)?.tagDetails).toEqual(expected);
  expect(fromLocalApi?.source.kind).toBe("zotero-local-api");
  expect(tagsOf(fromLocalApi)?.tagDetails).toEqual(expected);
  expect(tagsOf(fromLocalApi)?.templateMetadata?.tags).toEqual([
    { name: "hand-added", type: "manual" },
    { name: "translator", type: "auto" },
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

it("shares one refresh and publishes the canonical held result", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, acquireRead } = await setup(stack);
  const first = await repository.read("RGRPDF24");
  const gate = Promise.withResolvers<void>();
  const readSnapshot = acquireRead.getMockImplementation()!;
  acquireRead.mockImplementationOnce(async () => {
    await gate.promise;
    return await readSnapshot();
  });

  const overlay = repository.refresh("RGRPDF24");
  const view = repository.refresh("RGRPDF24");

  expect(overlay).toBe(view);
  expect(repository.peek("RGRPDF24")?.value).toBe(first);
  gate.resolve();

  const refreshed = await overlay;
  expect(acquireRead).toHaveBeenCalledTimes(2);
  expect(refreshed).toBe(first);
  expect(repository.peek("RGRPDF24")?.value).toBe(first);
});

it("keeps the published collection when a refresh fails", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, acquireRead } = await setup(stack);
  const first = await repository.read("RGRPDF24");
  acquireRead.mockRejectedValueOnce(new Error("snapshot unavailable"));

  expect(await repository.refresh("RGRPDF24")).toBe(first);
  expect(repository.peek("RGRPDF24")).toMatchObject({
    value: first,
    status: "failed",
  });
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

  expect(await repository.read("N2SUCH24")).toEqual({
    source: DATABASE_SOURCE,
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

  expect(first?.source).toEqual(DATABASE_SOURCE);
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

  // Each source carries its own committed revision, so compare the visible
  // Annotation data independently from that handoff metadata.
  expect(
    fromLocalApi?.annotations.map(
      ({ templateMetadata: _metadata, ...record }) => ({
        ...record,
        version: null,
      }),
    ),
  ).toEqual(
    fromDatabase?.annotations.map(
      ({ templateMetadata: _metadata, ...record }) => ({
        ...record,
        version: null,
      }),
    ),
  );
  expect(fromDatabase?.annotations.map(({ version }) => version)).toEqual([
    0, 0, 0, 0, 29, 0, 0,
  ]);
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
  const { repository, serverEvents } = await setup(
    stack,
    {
      root: () => (answering ? rootOk() : unreachable()),
      children: () => annotationPage(ROUGIER_ANNOTATIONS),
    },
    { key: REMEMBERED_KEY },
  );
  await switchToLocalApi(repository);
  const live = await repository.read("RGRPDF24");
  repository.editComment("PUPR5FG5", "Visible while offline");

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
  expect(fallback?.source).toEqual(DATABASE_SOURCE);
  expect(fallback?.annotations.map(({ key, type }) => [key, type])).toEqual(
    READING_ORDER,
  );
  expect(repository.commentDraftFor("PUPR5FG5")?.text).toBe(
    "Visible while offline",
  );
  repository.editComment("PUPR5FG5", "Still typing offline");
  expect(repository.commentDraftFor("PUPR5FG5")?.text).toBe(
    "Visible while offline",
  );
});

it("holds an acknowledged colour across API loss until the database revision covers it", async () => {
  await using stack = new AsyncDisposableStack();
  let answering = true;
  const { repository, client, serverEvents, dbEvents } = await writable(stack, {
    root: () => (answering ? rootOk() : unreachable()),
    write: () => writeAccepted(38),
    item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666" })),
  });

  await repository.patchColor("PUPR5FG5", "#ff6666");
  answering = false;
  const lost = nextChange(repository);
  freshnessSignal(serverEvents);
  await lost;
  const held = await repository.read("RGRPDF24");

  expect(held?.source.kind).toBe("zotero-local-api");
  expect(colorOf(held, "PUPR5FG5")).toBe("#ff6666");

  client.$client.exec(`
    update libraries set clientVersion = 38 where libraryID = 1;
    update itemAnnotations set color = '#ff6666' where itemID = 48;
    update items set clientVersion = 38 where itemID = 48;
  `);
  dbEvents.emit("changed");
  const covered = await repository.read("RGRPDF24");

  expect(covered?.source.kind).toBe("zotero-db");
  expect(colorOf(covered, "PUPR5FG5")).toBe("#ff6666");
});

it("does not write from a stale API list rejected after database coverage", async () => {
  await using stack = new AsyncDisposableStack();
  let answering = true;
  const { repository, client, serverEvents, dbEvents, requests } =
    await writable(stack, {
      root: () => (answering ? rootOk() : unreachable()),
      write: () => writeAccepted(38),
      item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666" })),
    });

  await repository.patchColor("PUPR5FG5", "#ff6666");
  answering = false;
  const lost = nextChange(repository);
  freshnessSignal(serverEvents);
  await lost;
  await repository.read("RGRPDF24");
  client.$client.exec(`
    update libraries set clientVersion = 38 where libraryID = 1;
    update itemAnnotations set color = '#ff6666' where itemID = 48;
    update items set clientVersion = 38 where itemID = 48;
  `);
  dbEvents.emit("changed");
  expect((await repository.read("RGRPDF24"))?.source.kind).toBe("zotero-db");

  answering = true;
  const restored = nextChange(repository);
  freshnessSignal(serverEvents);
  await restored;
  expect((await repository.read("RGRPDF24"))?.source.kind).toBe("zotero-db");
  const sent = requests.length;

  const outcome = await repository.patchColor("PUPR5FG5", "#2ea8e5");

  expect(outcome).toEqual({
    kind: "failed",
    failure: { kind: "unknown-annotation" },
  });
  expect(
    requests.slice(sent).filter(({ method }) => method === "PATCH"),
  ).toEqual([]);
});

it("holds an acknowledged deletion until the database tombstone revision covers it", async () => {
  await using stack = new AsyncDisposableStack();
  let answering = true;
  const { repository, client, serverEvents, dbEvents } = await writable(stack, {
    root: () => (answering ? rootOk() : unreachable()),
    write: () => writeAccepted(39),
  });

  await repository.deleteAnnotation("C94NJNYG");
  answering = false;
  const lost = nextChange(repository);
  freshnessSignal(serverEvents);
  await lost;
  const held = await repository.read("RGRPDF24");

  expect(held?.source.kind).toBe("zotero-local-api");
  expect(held?.annotations.map(({ key }) => key)).not.toContain("C94NJNYG");

  client.$client.exec(`
    update libraries set clientVersion = 39 where libraryID = 1;
    delete from itemAnnotations where itemID = 52;
    delete from items where itemID = 52;
  `);
  dbEvents.emit("changed");
  const covered = await repository.read("RGRPDF24");

  expect(covered?.source.kind).toBe("zotero-db");
  expect(covered?.annotations.map(({ key }) => key)).not.toContain("C94NJNYG");
});

it.each([null, "", "1e2"])(
  "does not invent database coverage from revision header %j",
  async (header) => {
    await using stack = new AsyncDisposableStack();
    let answering = true;
    const accepted = writeAccepted(5);
    if (header === null) accepted.headers.delete("Last-Modified-Version");
    else accepted.headers.set("Last-Modified-Version", header);
    const { repository, serverEvents } = await writable(stack, {
      root: () => (answering ? rootOk() : unreachable()),
      write: () => accepted,
      item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666" })),
    });

    await repository.patchColor("PUPR5FG5", "#ff6666");
    answering = false;
    const lost = nextChange(repository);
    freshnessSignal(serverEvents);
    await lost;

    const held = await repository.read("RGRPDF24");
    expect(held?.source.kind).toBe("zotero-local-api");
    expect(colorOf(held, "PUPR5FG5")).toBe("#ff6666");
  },
);

it("stands the source down when a list read fails, and answers from the Zotero DB", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack, { children: () => unreachable() });
  await switchToLocalApi(repository);

  const announced = nextChange(repository);
  const failed = await repository.read("EPUBBKS2");
  const fallback = await repository.read("EPUBBKS2");

  // The failed API candidate never publishes; the verified database answers.
  expect(failed?.source).toEqual(DATABASE_SOURCE);
  expect(await announced).toContain("EPUBBKS2");
  expect(fallback?.source).toEqual(DATABASE_SOURCE);
  expect(fallback?.annotations.map(({ key }) => key)).toEqual(["EPUBMRK2"]);
});

it("refuses an API from another database and keeps the configured database", async () => {
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
  expect(second?.source).toEqual(DATABASE_SOURCE);
  expect(second?.annotations).toHaveLength(7);
  expect(repository.capabilityFor("RGRPDF24")).toEqual({
    kind: "read-only",
    reason: "server-changed",
  });
});

it("names comment drafts by Zotero database as well as Annotation key", async () => {
  await using stack = new AsyncDisposableStack();
  let serverID = SERVER_ID;
  const { repository, prefEvents } = await setup(
    stack,
    {
      root: () => rootOk({ "Zotero-Server-ID": serverID }),
      children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
    },
    { key: REMEMBERED_KEY },
  );
  await switchToLocalApi(repository);
  await repository.read("RGRPDF24");
  repository.editComment("PUPR5FG5", "First database");

  serverID = "Zzzz11119999";
  prefEvents.emit("resolved-changed");
  await repository.probe();
  await repository.read("RGRPDF24");
  expect(repository.commentDraftFor("PUPR5FG5")).toBeNull();

  serverID = SERVER_ID;
  prefEvents.emit("resolved-changed");
  await repository.probe();
  await repository.read("RGRPDF24");
  expect(repository.commentDraftFor("PUPR5FG5")?.text).toBe("First database");
});

it("announces a write and a draft on one Annotation through one signal", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository } = await writable(stack, zotero.answers);
  const seen: { mutation: string; comment: string | null }[] = [];
  stack.defer(
    repository.on("annotation-changed", (key) => {
      const state = repository.annotationState(key);
      seen.push({
        mutation: state.mutation.kind,
        comment: state.commentDraft?.text ?? null,
      });
    }),
  );
  const release = zotero.holdWrites();

  const saving = repository.patchColor("PUPR5FG5", "#ff6666");
  repository.editComment("PUPR5FG5", "Worth citing");
  release();
  await saving;

  expect(seen[0]).toEqual({ mutation: "pending", comment: null });
  expect(seen).toContainEqual({ mutation: "pending", comment: "Worth citing" });
  expect(seen.at(-1)).toEqual({ mutation: "idle", comment: "Worth citing" });
});

it("announces every Annotation a complete read finds gone, with a draft or without", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository } = await writable(stack, zotero.answers);
  repository.editComment("K3JRFLFQ", "Worth citing");
  const announced: string[] = [];
  stack.defer(
    repository.on("annotation-changed", (key) => {
      if (repository.annotationState(key).gone) announced.push(key);
    }),
  );

  zotero.eraseInZotero("PUPR5FG5");
  zotero.eraseInZotero("K3JRFLFQ");
  await repository.refresh("RGRPDF24");

  // A surface re-reads the whole state on each announcement, so one may come
  // more than once.
  expect(new Set(announced)).toEqual(new Set(["K3JRFLFQ", "PUPR5FG5"]));
  expect(repository.annotationState("K3JRFLFQ")).toMatchObject({
    gone: true,
    commentDraft: null,
  });
  expect(repository.annotationState("FDRFQ7C2").gone).toBe(false);

  zotero.restoreInZotero("PUPR5FG5");
  await repository.refresh("RGRPDF24");
  expect(repository.annotationState("PUPR5FG5").gone).toBe(false);
});

it("says a database switch hid an Annotation's drafts", async () => {
  await using stack = new AsyncDisposableStack();
  let serverID = SERVER_ID;
  let answering = true;
  const { repository, client, dbEvents, serverEvents } = await writable(stack, {
    root: () =>
      answering ? rootOk({ "Zotero-Server-ID": serverID }) : unreachable(),
    children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
  });
  repository.editComment("PUPR5FG5", "First database");
  repository.editTags("PUPR5FG5", ["figure"]);
  expect(repository.annotationState("PUPR5FG5").hidden).toBe(false);

  answering = false;
  const lost = nextChange(repository);
  freshnessSignal(serverEvents);
  await lost;
  serverID = "Zzzz11119999";
  client.$client.exec(
    `update settings set value = '${serverID}' where setting = 'localAPI' and key = 'serverID'`,
  );
  dbEvents.emit("changed");
  await repository.read("RGRPDF24");

  expect(repository.annotationState("PUPR5FG5")).toMatchObject({
    commentDraft: null,
    tagDraft: null,
    hidden: true,
  });
});

it("hides an old database draft and cancels its save schedule", async () => {
  await using stack = new AsyncDisposableStack();
  let serverID = SERVER_ID;
  let answering = true;
  const { repository, client, dbEvents, prefEvents, requests, serverEvents } =
    await writable(
      stack,
      {
        root: () =>
          answering ? rootOk({ "Zotero-Server-ID": serverID }) : unreachable(),
        children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
      },
      { key: REMEMBERED_KEY },
    );
  vi.useFakeTimers();
  try {
    repository.editComment("PUPR5FG5", "First database");
    await vi.advanceTimersByTimeAsync(500);
    const hidden = new Promise<string>((resolve) => {
      stack.defer(
        repository.on("annotation-changed", (key) => {
          if (repository.annotationState(key).hidden) resolve(key);
        }),
      );
    });

    answering = false;
    const lost = nextChange(repository);
    freshnessSignal(serverEvents);
    await lost;
    serverID = "Zzzz11119999";
    client.$client.exec(
      `update settings set value = '${serverID}' where setting = 'localAPI' and key = 'serverID'`,
    );
    dbEvents.emit("changed");
    await repository.read("RGRPDF24");
    await expect(hidden).resolves.toBe("PUPR5FG5");

    answering = true;
    prefEvents.emit("resolved-changed");
    await repository.probe();
    await repository.read("RGRPDF24");
    repository.editComment("PUPR5FG5", "Second database");
    const sent = requests.length;

    await vi.advanceTimersByTimeAsync(500);

    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

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

it("refreshes an uninitialized database identity before enabling its API", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, client, db, dbEvents } = await setup(stack, {
    root: () => rootOk(),
    children: () => annotationPage(ROUGIER_ANNOTATIONS),
  });
  client.$client.exec(
    "delete from settings where setting = 'localAPI' and key = 'serverID'",
  );
  const standalone = await repository.read("RGRPDF24");
  expect(standalone?.source).toMatchObject({
    kind: "zotero-db",
    database: { serverID: null },
  });
  expect(repository.capabilityFor("RGRPDF24")).toEqual({
    kind: "read-only",
    reason: "server-changed",
  });

  client.$client.exec(
    `insert into settings (setting, key, value) values ('localAPI', 'serverID', '${SERVER_ID}')`,
  );
  db.refresh.mockImplementation(async () => dbEvents.emit("changed"));
  await repository.refresh("RGRPDF24");
  const live = await repository.read("RGRPDF24");

  expect(db.refresh).toHaveBeenCalled();
  expect(live?.source).toEqual({
    kind: "zotero-local-api",
    serverID: SERVER_ID,
  });
});

it("hides an offline draft after a different database is accepted", async () => {
  await using stack = new AsyncDisposableStack();
  let answering = true;
  const { repository, client, dbEvents, serverEvents } = await writable(stack, {
    root: () => (answering ? rootOk() : unreachable()),
  });
  repository.editComment("PUPR5FG5", "First database");
  answering = false;
  const unavailable = nextChange(repository);
  freshnessSignal(serverEvents);
  await unavailable;

  client.$client.exec(
    "update settings set value = 'Zzzz11119999' where setting = 'localAPI' and key = 'serverID'",
  );
  dbEvents.emit("changed");
  await repository.read("RGRPDF24");

  expect(repository.commentDraftFor("PUPR5FG5")).toBeNull();
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

it("rejects a late database read from the prior configured database", async () => {
  await using stack = new AsyncDisposableStack();
  let answering = false;
  const { repository, client, acquireRead, dbEvents, prefEvents } = await setup(
    stack,
    { root: () => (answering ? rootOk() : unreachable()) },
  );
  await repository.read("RGRPDF24");

  const oldClient = createClient(":memory:");
  stack.defer(() => oldClient.$client.close());
  createFixtureSchema(oldClient.$client);
  oldClient.$client.exec(
    "insert into version (schema, version) values ('userdata', 129), ('compatibility', 9)",
  );
  oldClient.$client.exec(FIXTURE_ROWS);
  oldClient.$client.exec(
    "insert into libraries (libraryID, type) values (1, 'user')",
  );
  oldClient.$client.exec(
    `insert into settings (setting, key, value) values ('localAPI', 'serverID', '${SERVER_ID}')`,
  );
  const oldLease = Promise.withResolvers<{
    client: NodeDatabaseClient;
    [Symbol.dispose](): undefined;
  }>();
  acquireRead.mockImplementationOnce(() => oldLease.promise);
  dbEvents.emit("changed");
  const late = repository.read("RGRPDF24");

  client.$client.exec(
    "update settings set value = 'Zzzz11119999' where setting = 'localAPI' and key = 'serverID'",
  );
  dbEvents.emit("changed");
  const current = await repository.read("RGRPDF24");
  oldLease.resolve({ client: oldClient, [Symbol.dispose]: () => undefined });
  await late;

  answering = true;
  prefEvents.emit("resolved-changed");
  await repository.probe();
  expect(current?.source).toMatchObject({
    kind: "zotero-db",
    database: { serverID: "Zzzz11119999" },
  });
  expect(repository.capabilityFor("RGRPDF24")).toEqual({
    kind: "read-only",
    reason: "server-changed",
  });
});

it("ignores a cancelled empty read when reconciling a shared draft", async () => {
  await using stack = new AsyncDisposableStack();
  const obsolete = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  let deferNext = false;
  const { repository, queryClient } = await setup(
    stack,
    {
      children: () => {
        if (deferNext) {
          deferNext = false;
          started.resolve();
          return obsolete.promise;
        }
        return annotationPage(ROUGIER_ANNOTATIONS);
      },
    },
    { key: REMEMBERED_KEY },
  );
  await switchToLocalApi(repository);
  await repository.read("RGRPDF24");
  repository.editComment("PUPR5FG5", "Keep this draft");

  deferNext = true;
  queryClient.invalidate([
    "annotations",
    "zotero-local-api",
    SERVER_ID,
    "RGRPDF24",
  ]);
  const reading = repository.read("RGRPDF24");
  await started.promise;
  queryClient.invalidate([
    "annotations",
    "zotero-local-api",
    SERVER_ID,
    "RGRPDF24",
  ]);
  obsolete.resolve(annotationPage([]));

  expect((await reading)?.annotations).toHaveLength(7);
  expect(repository.commentDraftFor("PUPR5FG5")?.text).toBe("Keep this draft");
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
  expect(repository.capability).toEqual({
    kind: "authorization-required",
  });
  expect(announced).toBeGreaterThan(0);
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

it("autosaves after one idle second and caps a continuous editing burst", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    let saved = "";
    let version = 20;
    const { repository, requests } = await writable(stack, {
      write: (request) => {
        saved = String(JSON.parse(request.body ?? "{}").annotationComment);
        version += 1;
        return writeAccepted();
      },
      item: () =>
        annotationItem(afterWrite("PUPR5FG5", { comment: saved, version })),
    });
    const sent = requests.length;

    repository.editComment("PUPR5FG5", "idle");
    await vi.advanceTimersByTimeAsync(999);
    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toHaveLength(1);

    repository.editComment("PUPR5FG5", "burst 0");
    for (let step = 1; step <= 11; step += 1) {
      await vi.advanceTimersByTimeAsync(900);
      repository.editComment("PUPR5FG5", `burst ${step}`);
    }
    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);

    expect(
      requests
        .slice(sent)
        .filter(({ method }) => method === "PATCH")
        .map(({ body }) => JSON.parse(body ?? "{}").annotationComment),
    ).toEqual(["idle", "burst 11"]);

    repository.editComment("PUPR5FG5", "next burst");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(
      requests
        .slice(sent)
        .filter(({ method }) => method === "PATCH")
        .map(({ body }) => JSON.parse(body ?? "{}").annotationComment),
    ).toEqual(["idle", "burst 11", "next burst"]);
  } finally {
    vi.useRealTimers();
  }
});

it("serializes writes and saves only the latest input after a slow response", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    let answerFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      answerFirst = resolve;
    });
    const submitted: string[] = [];
    let writes = 0;
    let version = 20;
    const { repository } = await writable(stack, {
      write: (request) => {
        submitted.push(JSON.parse(request.body ?? "{}").annotationComment);
        return writes++ === 0 ? first : writeAccepted();
      },
      item: () => {
        version += 1;
        return annotationItem(
          afterWrite("PUPR5FG5", {
            comment: submitted.at(-1),
            version,
          }),
        );
      },
    });

    repository.editComment("PUPR5FG5", "first");
    await vi.advanceTimersByTimeAsync(1_000);
    repository.editComment("PUPR5FG5", "second");
    repository.editComment("PUPR5FG5", "latest");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(submitted).toEqual(["first"]);

    answerFirst(writeAccepted());
    await vi.waitFor(() => expect(submitted).toEqual(["first", "latest"]));
    await vi.waitFor(() =>
      expect(repository.commentDraftFor("PUPR5FG5")).toBeNull(),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("queues a return to the old baseline while a newer value is saving", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const first = Promise.withResolvers<Response>();
    const submitted: string[] = [];
    let writes = 0;
    let version = 20;
    const { repository } = await writable(stack, {
      write: (request) => {
        submitted.push(JSON.parse(request.body ?? "{}").annotationComment);
        return writes++ === 0 ? first.promise : writeAccepted();
      },
      item: () =>
        annotationItem(
          afterWrite("PUPR5FG5", {
            comment: submitted.at(-1),
            version: version++,
          }),
        ),
    });

    repository.editComment("PUPR5FG5", "temporary");
    await vi.advanceTimersByTimeAsync(1_000);
    repository.editComment("PUPR5FG5", "");
    first.resolve(writeAccepted());

    await vi.waitFor(() => expect(submitted).toEqual(["temporary", ""]));
    await vi.waitFor(() =>
      expect(repository.commentDraftFor("PUPR5FG5")).toBeNull(),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a failed autosave for explicit editing without replaying it", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const { repository, requests } = await writable(stack, {
      write: () => unreachable(),
    });
    const sent = requests.length;

    repository.editComment("PUPR5FG5", "keep me");
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() =>
      expect(repository.commentDraftFor("PUPR5FG5")?.state.kind).toBe("failed"),
    );
    await vi.advanceTimersByTimeAsync(30_000);

    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toHaveLength(1);
    expect(repository.commentDraftFor("PUPR5FG5")?.text).toBe("keep me");
  } finally {
    vi.useRealTimers();
  }
});

it("retains a paused draft until an explicit save after authorization returns", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const { repository, localApi, requests } = await writable(stack, {
      authorize: () => authorized({ remember: true }),
      item: () =>
        annotationItem(
          afterWrite("PUPR5FG5", { comment: "Keep these words", version: 20 }),
        ),
    });
    repository.editComment("PUPR5FG5", "Keep these words");
    await localApi.forgetAuthorization();
    repository.editComment("PUPR5FG5", "Blocked typing");
    expect(repository.commentDraftFor("PUPR5FG5")?.text).toBe(
      "Keep these words",
    );
    await localApi.authorize();
    const sent = requests.length;
    await vi.advanceTimersByTimeAsync(30_000);
    await repository.submitComment("PUPR5FG5", { automatic: true });
    expect(requests.slice(sent)).toEqual([]);
    const saving = repository.submitComment("PUPR5FG5");
    // The save the user pressed is the one the editor says it waits on.
    expect(
      commentEditorControls(
        repository.capabilityFor("RGRPDF24"),
        repository.commentDraftFor("PUPR5FG5"),
        NOW,
      ).hint,
    ).toBe(m.annot_view_card_saving());
    expect(await saving).toEqual({ kind: "idle" });
    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it("saves text typed during a held draft's save once that save lands", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const first = Promise.withResolvers<Response>();
    const submitted: string[] = [];
    let version = 20;
    const { repository, localApi } = await writable(stack, {
      authorize: () => authorized({ remember: true }),
      write: (request) => {
        submitted.push(JSON.parse(request.body ?? "{}").annotationComment);
        return submitted.length === 1 ? first.promise : writeAccepted();
      },
      item: () =>
        annotationItem(
          afterWrite("PUPR5FG5", {
            comment: submitted.at(-1),
            version: version++,
          }),
        ),
    });
    repository.editComment("PUPR5FG5", "Held words");
    await localApi.forgetAuthorization();
    await localApi.authorize();

    const saving = repository.submitComment("PUPR5FG5");
    await vi.waitFor(() => expect(submitted).toEqual(["Held words"]));
    repository.editComment("PUPR5FG5", "Held words, and more");
    first.resolve(writeAccepted());
    expect(await saving).toEqual({ kind: "idle" });

    await vi.waitFor(() =>
      expect(submitted).toEqual(["Held words", "Held words, and more"]),
    );
    await vi.waitFor(() =>
      expect(repository.commentDraftFor("PUPR5FG5")).toBeNull(),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("requires explicit recovery after a lost save response even when refresh reconnects", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const { repository, requests } = await writable(stack, {
      write: () => unreachable(),
    });
    repository.editComment("PUPR5FG5", "Unconfirmed comment");
    await repository.submitComment("PUPR5FG5");
    expect(repository.capabilityFor("RGRPDF24").kind).toBe("writable");
    const sent = requests.length;
    repository.editComment("PUPR5FG5", "Review before retry");
    await vi.advanceTimersByTimeAsync(30_000);
    await repository.submitComment("PUPR5FG5", { automatic: true });
    expect(requests.slice(sent)).toEqual([]);
    expect(repository.commentDraftFor("PUPR5FG5")?.text).toBe(
      "Review before retry",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("cancels a scheduled comment when deletion is confirmed", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const { repository, requests } = await writable(stack);
    const sent = requests.length;
    repository.editComment("PUPR5FG5", "never submit");

    await repository.deleteAnnotation("PUPR5FG5");
    await vi.advanceTimersByTimeAsync(20_000);

    expect(
      requests
        .slice(sent)
        .filter(({ method }) => method === "PATCH" || method === "DELETE"),
    ).toMatchObject([{ method: "DELETE" }]);
    expect(repository.commentDraftFor("PUPR5FG5")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("discards scheduled session work when the repository unloads", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const { repository, requests } = await writable(stack);
    const sent = requests.length;
    repository.editComment("PUPR5FG5", "session only");

    await repository[Symbol.asyncDispose]();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("shares one comment draft and preserves it across unrelated refresh changes", async () => {
  await using stack = new AsyncDisposableStack();
  let records = ROUGIER_ANNOTATIONS;
  const { repository } = await writable(stack, {
    children: () => annotationPage(records),
  });

  const started = repository.editComment("PUPR5FG5", "My draft");
  repository.editComment("PUPR5FG5");
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, color: "#ff6666", version: 20 }
      : record,
  );
  await repository.refresh("RGRPDF24");

  expect(started?.serverID).toBe(SERVER_ID);
  expect(repository.commentDraftFor("PUPR5FG5")).toMatchObject({
    baseline: "",
    text: "My draft",
    state: { kind: "editing" },
  });
  expect(colorOf(await repository.read("RGRPDF24"), "PUPR5FG5")).toBe(
    "#ff6666",
  );
});

it("requires a choice when Zotero changes a drafted comment", async () => {
  await using stack = new AsyncDisposableStack();
  let records = ROUGIER_ANNOTATIONS;
  const { repository, requests } = await writable(stack, {
    children: () => annotationPage(records),
  });
  repository.editComment("PUPR5FG5", "My draft");
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, comment: "Zotero draft", version: 20 }
      : record,
  );

  await repository.refresh("RGRPDF24");
  const sent = requests.length;

  await repository.submitComment("PUPR5FG5");

  expect(repository.commentDraftFor("PUPR5FG5")).toMatchObject({
    baseline: "",
    text: "My draft",
    state: { kind: "conflict", fresh: "Zotero draft" },
  });
  expect(repository.mutationFor("PUPR5FG5")).toEqual({
    kind: "conflict",
    conflict: {
      write: "comment",
      attempted: "My draft",
      fresh: "Zotero draft",
    },
  });
  expect(
    requests.slice(sent).filter(({ method }) => method === "PATCH"),
  ).toEqual([]);
});

it("requires a choice when the verified database changes a draft after API loss", async () => {
  await using stack = new AsyncDisposableStack();
  let answering = true;
  const { repository, client, dbEvents, serverEvents } = await writable(stack, {
    root: () => (answering ? rootOk() : unreachable()),
  });
  repository.editComment("PUPR5FG5", "My offline draft");

  answering = false;
  const lost = nextChange(repository);
  freshnessSignal(serverEvents);
  await lost;
  client.$client.exec(`
    update libraries set clientVersion = 38 where libraryID = 1;
    update itemAnnotations set comment = 'Changed in Zotero' where itemID = 48;
    update items set clientVersion = 38 where itemID = 48;
  `);
  dbEvents.emit("changed");

  const list = await repository.read("RGRPDF24");

  expect(list?.source).toMatchObject({
    kind: "zotero-db",
    database: { serverID: SERVER_ID },
    libraryRevision: 38,
  });
  expect(repository.commentDraftFor("PUPR5FG5")).toMatchObject({
    baseline: "",
    text: "My offline draft",
    state: { kind: "conflict", fresh: "Changed in Zotero" },
  });
  expect(repository.mutationFor("PUPR5FG5")).toEqual({
    kind: "conflict",
    conflict: {
      write: "comment",
      attempted: "My offline draft",
      fresh: "Changed in Zotero",
    },
  });
});

it("applies the chosen draft against the fresh version and comment field only", async () => {
  await using stack = new AsyncDisposableStack();
  let records = ROUGIER_ANNOTATIONS;
  const { repository, requests } = await writable(stack, {
    children: () => annotationPage(records),
    item: () =>
      annotationItem(
        afterWrite("PUPR5FG5", { comment: "My latest draft", version: 21 }),
      ),
  });
  repository.editComment("PUPR5FG5", "My draft");
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, comment: "Zotero draft", version: 20 }
      : record,
  );
  await repository.refresh("RGRPDF24");
  repository.editComment("PUPR5FG5", "My latest draft");
  const sent = requests.length;

  const outcome = await repository.retryCommentDraft("PUPR5FG5");

  expect(outcome).toEqual({ kind: "idle" });
  expect(JSON.parse(requests[sent]!.body ?? "")).toEqual({
    version: 20,
    annotationComment: "My latest draft",
  });
  expect(repository.commentDraftFor("PUPR5FG5")).toBeNull();
});

it("keeps newer typing when a reviewed comment retry succeeds", async () => {
  await using stack = new AsyncDisposableStack();
  let records = ROUGIER_ANNOTATIONS;
  const accepted = Promise.withResolvers<Response>();
  const { repository, requests } = await writable(stack, {
    children: () => annotationPage(records),
    write: () => accepted.promise,
    item: () =>
      annotationItem(
        afterWrite("PUPR5FG5", { comment: "reviewed draft", version: 21 }),
      ),
  });
  repository.editComment("PUPR5FG5", "reviewed draft");
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, comment: "Zotero draft", version: 20 }
      : record,
  );
  await repository.refresh("RGRPDF24");

  const sent = requests.length;
  const retrying = repository.retryCommentDraft("PUPR5FG5");
  // A submit of the same text joins the retry rather than sending again.
  const duplicate = repository.submitComment("PUPR5FG5");
  repository.editComment("PUPR5FG5", "typed during retry");
  accepted.resolve(writeAccepted());
  expect(await duplicate).toEqual(await retrying);

  expect(repository.commentDraftFor("PUPR5FG5")).toMatchObject({
    baseline: "reviewed draft",
    text: "typed during retry",
    state: { kind: "pending" },
  });
  await repository.submitComment("PUPR5FG5");
  const writes = requests
    .slice(sent)
    .filter(({ method }) => method === "PATCH");
  expect(writes).toHaveLength(2);
  expect(JSON.parse(writes.at(-1)!.body ?? "")).toMatchObject({
    annotationComment: "typed during retry",
  });
});

it("requires another choice when the cached comment moved after review", async () => {
  await using stack = new AsyncDisposableStack();
  let records = ROUGIER_ANNOTATIONS;
  const { repository, requests } = await writable(stack, {
    children: () => annotationPage(records),
    item: () =>
      annotationItem(
        afterWrite("PUPR5FG5", {
          color: "#ff6666",
          comment: "Newer Zotero draft",
          version: 21,
        }),
      ),
  });
  repository.editComment("PUPR5FG5", "My draft");
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, comment: "Zotero draft", version: 20 }
      : record,
  );
  await repository.refresh("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");
  const sent = requests.length;

  const outcome = await repository.retryCommentDraft("PUPR5FG5");

  expect(outcome).toEqual({
    kind: "conflict",
    conflict: {
      write: "comment",
      attempted: "My draft",
      fresh: "Newer Zotero draft",
    },
  });
  expect(
    requests.slice(sent).filter(({ method }) => method === "PATCH"),
  ).toEqual([]);
});

it("keeps the reviewed choice through an unrelated version change", async () => {
  await using stack = new AsyncDisposableStack();
  let records = ROUGIER_ANNOTATIONS;
  let writes = 0;
  const { repository, requests } = await writable(stack, {
    children: () => annotationPage(records),
    write: () => (writes++ === 0 ? staleVersion() : writeAccepted()),
    item: () =>
      annotationItem(
        afterWrite("PUPR5FG5", {
          comment: writes === 1 ? "Zotero draft" : "My draft",
          version: writes === 1 ? 21 : 22,
        }),
      ),
  });
  repository.editComment("PUPR5FG5", "My draft");
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, comment: "Zotero draft", version: 20 }
      : record,
  );
  await repository.refresh("RGRPDF24");
  const sent = requests.length;

  const outcome = await repository.retryCommentDraft("PUPR5FG5");

  expect(outcome).toEqual({ kind: "idle" });
  expect(
    requests
      .slice(sent)
      .filter(({ method }) => method === "PATCH")
      .map(({ body }) => JSON.parse(body ?? "")),
  ).toEqual([
    { version: 20, annotationComment: "My draft" },
    { version: 21, annotationComment: "My draft" },
  ]);
});

it("settles an equal remote comment without another write", async () => {
  await using stack = new AsyncDisposableStack();
  let records = ROUGIER_ANNOTATIONS;
  const { repository, requests } = await writable(stack, {
    children: () => annotationPage(records),
  });
  repository.editComment("PUPR5FG5", "Same words");
  const sent = requests.length;
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, comment: "Same words", version: 20 }
      : record,
  );

  await repository.refresh("RGRPDF24");

  expect(repository.commentDraftFor("PUPR5FG5")).toBeNull();
  expect(
    requests.slice(sent).filter(({ method }) => method === "PATCH"),
  ).toEqual([]);
});

it("discards a draft only when its own source confirms deletion", async () => {
  await using stack = new AsyncDisposableStack();
  let records = ROUGIER_ANNOTATIONS;
  const { repository } = await writable(stack, {
    children: () => annotationPage(records),
  });
  repository.editComment("PUPR5FG5", "Unsaved");
  const deleted = new Promise<string>((resolve) => {
    stack.defer(
      repository.on("annotation-changed", (key) => {
        if (repository.annotationState(key).gone) resolve(key);
      }),
    );
  });
  records = records.filter(({ key }) => key !== "PUPR5FG5");

  await repository.refresh("RGRPDF24");

  expect(await deleted).toBe("PUPR5FG5");
  expect(repository.commentDraftFor("PUPR5FG5")).toBeNull();
});

it("discards a queued draft when the verified database confirms deletion after API loss", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    let answering = true;
    const { repository, client, dbEvents, requests, serverEvents } =
      await writable(stack, {
        root: () => (answering ? rootOk() : unreachable()),
      });
    const sent = requests.length;
    repository.editComment("PUPR5FG5", "Never recreate this annotation");
    const deleted = new Promise<string>((resolve) => {
      stack.defer(
        repository.on("annotation-changed", (key) => {
          if (repository.annotationState(key).gone) resolve(key);
        }),
      );
    });

    answering = false;
    const lost = nextChange(repository);
    freshnessSignal(serverEvents);
    await lost;
    client.$client.exec(`
      update libraries set clientVersion = 38 where libraryID = 1;
      delete from itemAnnotations where itemID = 48;
      delete from items where itemID = 48;
    `);
    dbEvents.emit("changed");

    const list = await repository.read("RGRPDF24");
    await expect(deleted).resolves.toBe("PUPR5FG5");
    await vi.advanceTimersByTimeAsync(20_000);

    expect(list?.source).toMatchObject({
      kind: "zotero-db",
      database: { serverID: SERVER_ID },
      libraryRevision: 38,
    });
    expect(list?.annotations.map(({ key }) => key)).not.toContain("PUPR5FG5");
    expect(repository.commentDraftFor("PUPR5FG5")).toBeNull();
    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a draft when the replacement read fails", async () => {
  await using stack = new AsyncDisposableStack();
  let available = true;
  const { repository } = await writable(stack, {
    children: () =>
      available ? annotationPage(ROUGIER_ANNOTATIONS) : unreachable(),
  });
  repository.editComment("PUPR5FG5", "Unsaved");
  available = false;

  await repository.refresh("RGRPDF24");

  expect(repository.commentDraftFor("PUPR5FG5")?.text).toBe("Unsaved");
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

it("announces the pixels a saved recolour moved, off the record Zotero answered with", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {
    item: () =>
      annotationItem(afterWrite("TYY6Z6ZF", { color: "#2ea8e5", version: 17 })),
  });
  const announced: Array<[string, string | null]> = [];
  stack.defer(
    repository.on("excerpt-pixels-changed", (record) =>
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
    repository.on("excerpt-pixels-changed", (record) =>
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
    repository.on("excerpt-pixels-changed", (record) =>
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

it("announces the pixels a read found moved, where no write of its own said so", async () => {
  await using stack = new AsyncDisposableStack();
  let answering: readonly WireAnnotation[] = ROUGIER_ANNOTATIONS;
  const { repository, serverEvents } = await setup(stack, {
    children: () => annotationPage(answering),
  });
  const announced: Array<[string, string | null, string]> = [];
  stack.defer(
    repository.on("excerpt-pixels-changed", (record, source) =>
      announced.push([record.key, record.color, source.kind]),
    ),
  );
  await switchToLocalApi(repository);
  await repository.read("RGRPDF24");

  // The switch to the Local API answered the same pixels as the database did,
  // so the read that published them said nothing.
  expect(announced).toEqual([]);

  // Zotero saved an ink recolour and a crop resize of its own: both reach this
  // repository through the Freshness Signal and the read after it, and neither
  // is a write this repository made. A comment that moved with them is not a
  // pixel input and says nothing.
  answering = ROUGIER_ANNOTATIONS.map((record) =>
    record.key === "TYY6Z6ZF"
      ? { ...record, color: "#2ea8e5" }
      : record.key === "FDRFQ7C2"
        ? {
            ...record,
            position: { pageIndex: 1, rects: [[10, 20, 30, 40]] },
          }
        : record.key === "HRK7BG32"
          ? { ...record, comment: "Edited in Zotero" }
          : record,
  );
  const changed = nextChange(repository);
  freshnessSignal(serverEvents);
  await changed;
  const refreshed = await repository.read("RGRPDF24");

  expect(colorOf(refreshed, "TYY6Z6ZF")).toBe("#2ea8e5");
  expect(
    refreshed?.annotations.find(({ key }) => key === "FDRFQ7C2")?.position,
  ).toEqual({ kind: "pdf-rects", pageIndex: 1, rects: [[10, 20, 30, 40]] });
  // The two Annotations whose pixels moved, in the Attachment's reading order,
  // and only those: the five the read answered unchanged said nothing.
  expect(announced).toEqual([
    ["TYY6Z6ZF", "#2ea8e5", "zotero-local-api"],
    ["FDRFQ7C2", "#ffd400", "zotero-local-api"],
  ]);

  // What stands now is the baseline the next read is compared against, so a
  // surface re-reading the Attachment is not asked to replace anything again.
  await repository.read("RGRPDF24");
  expect(announced).toEqual([
    ["TYY6Z6ZF", "#2ea8e5", "zotero-local-api"],
    ["FDRFQ7C2", "#ffd400", "zotero-local-api"],
  ]);
});

it("finds a source change's moved pixels with no mounted consumer to ask", async () => {
  await using stack = new AsyncDisposableStack();
  let answering: readonly WireAnnotation[] = ROUGIER_ANNOTATIONS;
  const { repository, serverEvents } = await setup(stack, {
    children: () => annotationPage(answering),
  });
  const announced: Array<[string, string | null]> = [];
  stack.defer(
    repository.on("excerpt-pixels-changed", (record) =>
      announced.push([record.key, record.color]),
    ),
  );
  await switchToLocalApi(repository);
  await repository.read("RGRPDF24");

  // A source change that answers the same pixels says nothing: what is announced
  // is movement, not the change itself.
  const unchanged = nextChange(repository);
  freshnessSignal(serverEvents);
  await unchanged;
  await repository.read("RGRPDF24");
  expect(announced).toEqual([]);

  // Zotero saved an ink recolour while nothing showed the Attachment at all: no
  // Annotation View, reader, or binding asks again, so the read the repository
  // runs itself after the change is the one that finds the pixels that moved.
  // The consumer's stored-outcome gate is what decides which of them this device
  // actually holds an image for.
  answering = ROUGIER_ANNOTATIONS.map((record) =>
    record.key === "TYY6Z6ZF" ? { ...record, color: "#2ea8e5" } : record,
  );
  const moved = nextChange(repository);
  freshnessSignal(serverEvents);
  await moved;
  await vi.waitFor(() => expect(announced).toEqual([["TYY6Z6ZF", "#2ea8e5"]]));
});

it("compares a session's first read against the image this device persists", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, client } = await setup(stack, undefined, {
    /**
     * The pixels this device's persisted Excerpt Images were made from. The two
     * ink strokes and the text Annotation are the ones it holds an image for.
     */
    persistedExcerpt: async (annotation) => {
      switch (annotation.key) {
        // The image this device last displayed, from the colour this ink stroke
        // held before the edit Zotero saved while ZotLit was not running.
        case "TYY6Z6ZF":
          return excerptFingerprint({ ...annotation, color: "#5fb236" });
        // An image made from the pixels this read answers: nothing moved.
        case "HRK7BG32":
          return excerptFingerprint(annotation);
        // Every other Annotation this device never cached stays on demand.
        default:
          return null;
      }
    },
  });
  const announced: string[] = [];
  stack.defer(
    repository.on("excerpt-pixels-changed", (record) =>
      announced.push(record.key),
    ),
  );
  client.$client.exec(
    "update itemAnnotations set color = '#2ea8e5' where itemID = 55",
  );

  // The first read of the session: no list stood before it, so the image this
  // device persists for the Annotation is the baseline it is compared against.
  const list = await repository.read("RGRPDF24");

  expect(colorOf(list, "TYY6Z6ZF")).toBe("#2ea8e5");
  expect(announced).toEqual(["TYY6Z6ZF"]);

  // The list that read published is the baseline from here on, so a second read
  // of a record already announced says nothing again.
  await repository.read("RGRPDF24");
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
    repository.on("write-conflict", (annotationKey, attachmentKey) => {
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
  stack.defer(repository.on("write-conflict", (key) => conflicted.push(key)));

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

it("sends Apply again against the version Zotero holds now", async () => {
  await using stack = new AsyncDisposableStack();
  let refuse = true;
  const { repository, requests } = await writable(stack, {
    write: () => (refuse ? staleVersion() : writeAccepted()),
    item: () =>
      annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236", version: 30 })),
  });
  await repository.patchColor("PUPR5FG5", "#ff6666");
  refuse = false;
  const sent = requests.length;

  const outcome = await repository.retryWrite("PUPR5FG5");

  expect(outcome).toEqual({ kind: "idle" });
  // 11 was the version the first write sent and 30 is the one the conflict
  // read back: a retry that repeated 11 would conflict for ever.
  expect(JSON.parse(requests[sent]!.body ?? "")).toEqual({
    version: 30,
    annotationColor: "#ff6666",
  });
});

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
    repository.on("annotation-changed", (key) => {
      states.push(repository.mutationFor(key).kind);
    }),
  );
  // What a surface redrawing on the announcement reads, in the same task.
  const announced: (string | null)[] = [];
  stack.defer(
    repository.on("annotations-changed", (key) => {
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
    repository.on("annotation-changed", (key) => {
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

it("draws a submitted comment at once, through a refresh, until Zotero confirms it", async () => {
  await using stack = new AsyncDisposableStack();
  const answer = Promise.withResolvers<Response>();
  const { repository } = await writable(stack, {
    write: () => answer.promise,
    item: () =>
      annotationItem(afterWrite("PUPR5FG5", { comment: "Blurred words" })),
  });
  const commentOf = (list: AnnotationList | null) =>
    list?.annotations.find(({ key }) => key === "PUPR5FG5")?.comment ?? null;
  const drawn: (string | null)[] = [];
  stack.defer(
    repository.on("annotations-changed", (key) => {
      drawn.push(commentOf(repository.peek(key)?.value ?? null));
    }),
  );
  const before = commentOf(repository.peek("RGRPDF24")?.value ?? null);

  // The editor closing on blur submits what it holds.
  repository.editComment("PUPR5FG5", "Blurred words");
  const saving = repository.submitComment("PUPR5FG5", { automatic: true });

  expect(drawn).toEqual(["Blurred words"]);
  // A read that lands while the write is away answers the old comment, and
  // the proposal is still drawn over it.
  await repository.refresh("RGRPDF24");
  expect(commentOf(repository.peek("RGRPDF24")?.value ?? null)).toBe(
    "Blurred words",
  );
  expect(drawn).not.toContain(before);

  answer.resolve(writeAccepted());
  await saving;
  expect(drawn).not.toContain(before);
  expect(commentOf(await repository.read("RGRPDF24"))).toBe("Blurred words");
});

it("draws the newest comment asked for behind a save in flight, and sends only that one after it", async () => {
  await using stack = new AsyncDisposableStack();
  const first = Promise.withResolvers<Response>();
  const sent: string[] = [];
  // Zotero holds what the last accepted write sent, in its list as in its
  // item answer.
  const stored = () => afterWrite("PUPR5FG5", { comment: sent.at(-1) ?? "" });
  const { repository } = await writable(stack, {
    write: (request) => {
      sent.push(String(JSON.parse(request.body ?? "{}").annotationComment));
      return sent.length === 1 ? first.promise : writeAccepted();
    },
    children: () =>
      annotationPage(
        ROUGIER_ANNOTATIONS.map((entry) =>
          entry.key === "PUPR5FG5" && sent.length > 0 ? stored() : entry,
        ),
      ),
    item: () => annotationItem(stored()),
  });
  const drawn = () =>
    repository
      .peek("RGRPDF24")
      ?.value.annotations.find(({ key }) => key === "PUPR5FG5")?.comment;

  repository.editComment("PUPR5FG5", "first");
  const saved = repository.submitComment("PUPR5FG5");
  await vi.waitFor(() => expect(sent).toEqual(["first"]));
  // Two more submits while the first is away: the later text replaces the
  // earlier one, on screen at once and in what Zotero is sent next.
  repository.editComment("PUPR5FG5", "second");
  void repository.submitComment("PUPR5FG5");
  repository.editComment("PUPR5FG5", "third");
  void repository.submitComment("PUPR5FG5");
  expect(drawn()).toBe("third");

  first.resolve(writeAccepted());
  await saved;
  await vi.waitFor(() =>
    expect(repository.commentDraftFor("PUPR5FG5")).toBeNull(),
  );
  expect(sent).toEqual(["first", "third"]);
  expect(drawn()).toBe("third");
});

it("sends a comment asked for behind a save while the window is hidden", async () => {
  await using stack = new AsyncDisposableStack();
  // A minimised or covered window reports its document hidden.
  vi.stubGlobal("document", { visibilityState: "hidden" });
  stack.defer(() => {
    vi.unstubAllGlobals();
  });
  const first = Promise.withResolvers<Response>();
  const sent: string[] = [];
  const { repository } = await writable(stack, {
    write: (request) => {
      sent.push(String(JSON.parse(request.body ?? "{}").annotationComment));
      return sent.length === 1 ? first.promise : writeAccepted();
    },
  });

  repository.editComment("PUPR5FG5", "first");
  void repository.submitComment("PUPR5FG5");
  await vi.waitFor(() => expect(sent).toEqual(["first"]));
  repository.editComment("PUPR5FG5", "second");
  const queued = repository.submitComment("PUPR5FG5");
  first.resolve(writeAccepted());

  await expect(queued).resolves.toMatchObject({ kind: "idle" });
  expect(sent).toEqual(["first", "second"]);
});

it("holds a comment asked for behind a save that fails, for Save comment", async () => {
  await using stack = new AsyncDisposableStack();
  const first = Promise.withResolvers<Response>();
  const sent: string[] = [];
  const { repository } = await writable(stack, {
    write: (request) => {
      sent.push(String(JSON.parse(request.body ?? "{}").annotationComment));
      return first.promise;
    },
  });

  repository.editComment("PUPR5FG5", "first");
  const saved = repository.submitComment("PUPR5FG5");
  await vi.waitFor(() => expect(sent).toEqual(["first"]));
  repository.editComment("PUPR5FG5", "second");
  const queued = repository.submitComment("PUPR5FG5");

  first.reject(new AbortError("reader closed"));
  await saved;
  await queued;

  // The failure holds the draft with its newest text, and nothing more goes
  // to Zotero until the researcher saves again.
  expect(sent).toEqual(["first"]);
  expect(repository.commentDraftFor("PUPR5FG5")).toMatchObject({
    text: "second",
    manualSave: true,
    state: { kind: "failed" },
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
      repository.on("annotations-changed", (key) => {
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

  await color;
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

it("rejects verification from an old database generation", async () => {
  await using stack = new AsyncDisposableStack();
  const reply = Promise.withResolvers<Response>();
  const sent = Promise.withResolvers<void>();
  const verification = Promise.withResolvers<void>();
  const oldLease = Promise.withResolvers<{
    client: NodeDatabaseClient;
    [Symbol.dispose](): undefined;
  }>();
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
  oldLease.resolve({ client: oldClient, [Symbol.dispose]: () => undefined });

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

it("retains the created API record when the API is lost during refresh", async () => {
  await using stack = new AsyncDisposableStack();
  let apiLost = false;
  const { repository } = await writable(
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
});

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
    repository.on("excerpt-pixels-changed", (record) =>
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
    repository.on("excerpt-pixels-changed", ({ key }) => pixels.push(key)),
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
  stack.defer(repository.on("write-conflict", (key) => conflicted.push(key)));

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

function colorOf(list: AnnotationList | null, key: string): string | null {
  return list?.annotations.find((record) => record.key === key)?.color ?? null;
}

/** Every stored Annotation row, as an oracle for "nothing was written". */
function annotationRows(client: NodeDatabaseClient): unknown[] {
  return client.$client
    .prepare("select * from itemAnnotations order by itemID")
    .all();
}

it("drops a comment draft holding what Zotero already has", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack);
  const sent = requests.length;

  // Opening the editor starts a draft before any typing. Closing it asks for
  // the submit, and an untouched draft leaves nothing behind for a card to
  // announce as unsaved.
  expect(repository.editComment("PUPR5FG5")).not.toBeNull();
  await repository.submitComment("PUPR5FG5", { automatic: true });
  expect(repository.commentDraftFor("PUPR5FG5")).toBeNull();

  // Typing and undoing it back to Zotero's own text says the same thing.
  repository.editComment("PUPR5FG5", "Second thoughts");
  repository.editComment("PUPR5FG5", "");
  await repository.submitComment("PUPR5FG5", { automatic: true });
  expect(repository.commentDraftFor("PUPR5FG5")).toBeNull();

  // Neither close wrote to Zotero.
  expect(
    requests.slice(sent).filter(({ method }) => method === "PATCH"),
  ).toHaveLength(0);
});

it("draws nothing while an automatic comment save is in flight", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const answer = Promise.withResolvers<Response>();
    let saved = "";
    const { repository } = await writable(stack, {
      write: (request) => {
        saved = String(JSON.parse(request.body ?? "{}").annotationComment);
        return answer.promise;
      },
      item: () =>
        annotationItem(afterWrite("PUPR5FG5", { comment: saved, version: 21 })),
    });
    // What the card and the Mark Popup draw from this Annotation's state.
    const drawn = () => {
      const capability = repository.capabilityFor("RGRPDF24");
      const mutation = repository.mutationFor("PUPR5FG5");
      const editor = commentEditorControls(
        capability,
        repository.commentDraftFor("PUPR5FG5"),
        NOW,
      );
      return {
        verbs: cardControls({
          capability,
          mutation,
          hasComment: true,
          hasTags: false,
          now: NOW,
        }),
        blocked: editingBlockedReason(capability, mutation, NOW),
        hint: editor.hint,
        saveDisabled: editor.saveDisabled,
      };
    };
    repository.editComment("PUPR5FG5", "typed");
    const resting = drawn();
    const frames: unknown[] = [];
    stack.defer(
      repository.on("annotation-changed", () => frames.push(drawn())),
    );

    await vi.advanceTimersByTimeAsync(1_000);
    frames.push(drawn());
    answer.resolve(writeAccepted());
    await vi.waitFor(() =>
      expect(repository.commentDraftFor("PUPR5FG5")).toBeNull(),
    );

    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) expect(frame).toEqual(resting);
  } finally {
    vi.useRealTimers();
  }
});

// #region annotation history

/**
 * A Zotero that keeps what a patch sends, Annotation by Annotation, so every
 * later read answers the colour and comment the last accepted write asked for.
 * What the Local API holds is the oracle an undo is read through; nothing here
 * asks the history what it thinks.
 */
function zoteroHolding(annotationKey: string) {
  const held = new Map<string, WireAnnotation>(
    ROUGIER_ANNOTATIONS.map((entry) => [entry.key, { ...entry }]),
  );
  if (!held.has(annotationKey)) {
    throw new Error(`No fixture annotation ${annotationKey}`);
  }
  let refuseOnce = false;
  const list = () =>
    ROUGIER_ANNOTATIONS.flatMap((entry) => {
      const stored = held.get(entry.key);
      return stored ? [stored] : [];
    });
  /** The item key a route names, which is its last segment. */
  const keyOf = ({ url }: ZoteroRequest) =>
    url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  return {
    answers: {
      children: () => annotationPage(list()),
      item: (request) => {
        const stored = held.get(keyOf(request));
        return stored ? annotationItem(stored) : notFound();
      },
      write: (request) => {
        if (refuseOnce) {
          refuseOnce = false;
          return staleVersion();
        }
        const key = keyOf(request);
        const stored = held.get(key);
        const { annotationColor, annotationComment } = JSON.parse(
          request.body ?? "{}",
        ) as { annotationColor?: string; annotationComment?: string };
        const patched =
          typeof annotationColor === "string" ||
          typeof annotationComment === "string";
        if (stored && patched) {
          held.set(key, {
            ...stored,
            ...(typeof annotationColor === "string" && {
              color: annotationColor,
            }),
            ...(typeof annotationComment === "string" && {
              comment: annotationComment,
            }),
            version: stored.version + 1,
          });
        }
        return writeAccepted();
      },
    } satisfies ZoteroAnswers,
    /** What the Local API holds for the Annotation, or `null` once erased. */
    get held(): WireAnnotation | null {
      return held.get(annotationKey) ?? null;
    },
    /** What it holds for any other Annotation of the same Attachment. */
    heldOf(key: string): WireAnnotation | null {
      return held.get(key) ?? null;
    },
    /** An edit made in Zotero itself, beside ZotLit. */
    changeInZotero(patch: Partial<WireAnnotation>): void {
      const stored = held.get(annotationKey);
      if (stored) {
        held.set(annotationKey, {
          ...stored,
          ...patch,
          version: stored.version + 1,
        });
      }
    },
    /** An erase in Zotero itself. */
    eraseInZotero(): void {
      held.delete(annotationKey);
    },
    /** Refuse the next write with the `412` a moved object answers. */
    refuseNextWrite(): void {
      refuseOnce = true;
    },
  };
}

it("puts the previous colour back when a colour pick is undone", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  await repository.patchColor("PUPR5FG5", "#ff6666");
  expect(zotero.held?.color).toBe("#ff6666");

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "PUPR5FG5",
  });
  expect(zotero.held?.color).toBe("#2ea8e5");
  expect(repository.canUndo("RGRPDF24")).toBe(false);
  expect(repository.canRedo("RGRPDF24")).toBe(true);
});

it("builds the redo from the undo's own confirmed result", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");
  await repository.undo("RGRPDF24");

  expect(await repository.redo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "PUPR5FG5",
  });
  expect(zotero.held?.color).toBe("#ff6666");
  // Stepping back and forth compares the two states as often as asked.
  expect(await repository.undo("RGRPDF24")).toMatchObject({
    kind: "stepped",
  });
  expect(zotero.held?.color).toBe("#2ea8e5");
});

it("discards the redo steps when a new edit is recorded", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");
  await repository.undo("RGRPDF24");

  await repository.patchColor("PUPR5FG5", "#5fb236");

  expect(repository.canRedo("RGRPDF24")).toBe(false);
  expect(await repository.redo("RGRPDF24")).toEqual({ kind: "idle" });
  expect(zotero.held?.color).toBe("#5fb236");
});

it("undoes where Zotero already holds the colour the undo would write", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");

  // Someone put the first colour back in Zotero. The undo's write is refused
  // over the version it moved, and the re-read finds the very value the undo
  // asked for: an equal value is a match, so no false conflict appears.
  zotero.refuseNextWrite();
  zotero.changeInZotero({ color: "#2ea8e5" });

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "PUPR5FG5",
  });
  expect(zotero.held?.color).toBe("#2ea8e5");
  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(repository.canRedo("RGRPDF24")).toBe(true);
});

it("undoes a colour pick when Zotero changed another field of it", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");

  zotero.changeInZotero({ comment: "Read again in Zotero" });
  await repository.refresh("RGRPDF24");

  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held?.color).toBe("#2ea8e5");
  expect(zotero.held?.comment).toBe("Read again in Zotero");
});

it("writes nothing and drops the step where Zotero holds another colour", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");

  zotero.changeInZotero({ color: "#5fb236" });
  await repository.refresh("RGRPDF24");

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "changed",
    annotationKey: "PUPR5FG5",
  });
  expect(zotero.held?.color).toBe("#5fb236");
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("drops a step whose Annotation Zotero no longer holds", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");

  zotero.eraseInZotero();
  await repository.refresh("RGRPDF24");

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "changed",
    annotationKey: "PUPR5FG5",
  });
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("sends the undo again after a 412 that only moved the version", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository, requests } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");
  const sent = requests.length;

  zotero.refuseNextWrite();

  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held?.color).toBe("#2ea8e5");
  // The refused write, and the one that landed after the re-read.
  expect(
    requests.slice(sent).filter(({ method }) => method === "PATCH"),
  ).toHaveLength(2);
});

it("drops the step where the 412 answers a colour changed in Zotero", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");

  // The list ZotLit holds still says `#ff6666`; Zotero moved under the write.
  zotero.refuseNextWrite();
  zotero.changeInZotero({ color: "#5fb236" });

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "changed",
    annotationKey: "PUPR5FG5",
  });
  expect(zotero.held?.color).toBe("#5fb236");
  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("drops the step and names the failure where the undo does not land", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  let deny = false;
  const { repository } = await writable(stack, {
    ...zotero.answers,
    write: (request) => (deny ? notFound() : zotero.answers.write(request)),
  });
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");

  deny = true;

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "failed",
    failure: { kind: "not-found" },
  });
  expect(zotero.held?.color).toBe("#ff6666");
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("keeps the last 100 steps and drops the oldest first", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  // 101 picks make 101 steps; the first one recorded is the one that goes.
  const picks = Array.from(
    { length: 101 },
    (_unused, index) => `#0000${index.toString(16).padStart(2, "0")}`,
  );
  for (const color of picks) await repository.patchColor("PUPR5FG5", color);

  let stepped = 0;
  while ((await repository.undo("RGRPDF24")).kind === "stepped") stepped += 1;

  expect(stepped).toBe(100);
  // The oldest step held `#2ea8e5`; with it gone, the walk ends on the first
  // colour this test picked.
  expect(zotero.held?.color).toBe(picks[0]);
});

it("does nothing while a write on the Attachment is still on its way", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const gate = Promise.withResolvers<void>();
  let holdNext = false;
  const { repository } = await writable(stack, {
    ...zotero.answers,
    write: async (request) => {
      if (holdNext) {
        holdNext = false;
        await gate.promise;
      }
      return zotero.answers.write(request);
    },
  });
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");

  holdNext = true;
  const slow = repository.patchColor("PUPR5FG5", "#5fb236");

  expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
  gate.resolve();
  await slow;
  // The key was not queued: nothing ran when the save landed.
  expect(zotero.held?.color).toBe("#5fb236");
  expect(repository.canUndo("RGRPDF24")).toBe(true);
});

it("does nothing while an undo of the same Attachment is running", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const gate = Promise.withResolvers<void>();
  let holdNext = false;
  const { repository } = await writable(stack, {
    ...zotero.answers,
    write: async (request) => {
      if (holdNext) {
        holdNext = false;
        await gate.promise;
      }
      return zotero.answers.write(request);
    },
  });
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");
  await repository.patchColor("PUPR5FG5", "#5fb236");

  holdNext = true;
  const running = repository.undo("RGRPDF24");

  expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
  gate.resolve();
  expect(await running).toMatchObject({ kind: "stepped" });
  expect(zotero.held?.color).toBe("#ff6666");
});

it("answers blocked and writes nothing without the Editing Capability", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  let running = true;
  const { repository } = await writable(stack, {
    ...zotero.answers,
    root: () => (running ? rootOk() : localApiDisabled()),
  });
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");

  running = false;
  await repository.probe();

  expect(await repository.undo("RGRPDF24")).toEqual({ kind: "blocked" });
  expect(zotero.held?.color).toBe("#ff6666");
  // The step stands, so the key works again once editing is allowed.
  expect(repository.canUndo("RGRPDF24")).toBe(true);
});

it("records nothing while no PDF view holds a history open", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository } = await writable(stack, zotero.answers);

  await repository.patchColor("PUPR5FG5", "#ff6666");
  repository.openHistory("RGRPDF24");

  expect(repository.canUndo("RGRPDF24")).toBe(false);
  expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
  expect(zotero.held?.color).toBe("#ff6666");
});

it("shares one history across two views, and ends it with the last", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository } = await writable(stack, zotero.answers);
  const changed: string[] = [];
  stack.defer(repository.on("history-changed", (key) => changed.push(key)));

  repository.openHistory("RGRPDF24");
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");

  // The second view closed; the history the first one opened stands.
  repository.closeHistory("RGRPDF24");
  expect(repository.canUndo("RGRPDF24")).toBe(true);

  repository.closeHistory("RGRPDF24");
  expect(repository.canUndo("RGRPDF24")).toBe(false);
  expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
  expect(zotero.held?.color).toBe("#ff6666");
  expect(new Set(changed)).toEqual(new Set(["RGRPDF24"]));
});

it("keeps the history across a Refresh and a change made in Zotero", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");

  zotero.changeInZotero({ comment: "Noted in Zotero" });
  await repository.refresh("RGRPDF24");

  expect(repository.canUndo("RGRPDF24")).toBe(true);
  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held?.color).toBe("#2ea8e5");
});

/** One part of an ink stroke, as the reader hands it to the repository. */
const INK_DRAFT = {
  type: "ink",
  color: "#5fb236",
  comment: "",
  text: "",
  pageLabel: "1",
  sortIndex: "00000|000040|00100",
  position: { pageIndex: 0, width: 2, paths: [[10, 20, 11, 21, 12, 22]] },
} as const;

it("erases the Annotation a create made, and redoes it under a new key", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  const made = await repository.createAnnotation("RGRPDF24", DRAFT);
  expect(made).toEqual({ kind: "created", annotationKey: "MADE2345" });

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "removed",
    annotationKey: "MADE2345",
    pageIndex: 0,
  });
  expect(zotero.at("MADE2345")).toBeNull();

  expect(await repository.redo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "MADE2346",
  });
  // Zotero names the Annotation itself, so the redo brings it back elsewhere.
  expect(zotero.at("MADE2345")).toBeNull();
  expect(zotero.at("MADE2346")).toMatchObject({
    type: "highlight",
    color: "#ffd400",
    text: "Identify Your Message",
  });
  expect(repository.canUndo("RGRPDF24")).toBe(true);
});

it("puts a deleted Annotation back under a new key, with what it held", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  const seed = zotero.at("HRK7BG32")!;

  expect(await repository.deleteAnnotation("HRK7BG32")).toEqual({
    kind: "idle",
  });
  expect(zotero.at("HRK7BG32")).toBeNull();

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "MADE2345",
  });
  expect(zotero.at("MADE2345")).toMatchObject({
    type: seed.type,
    color: seed.color,
    comment: seed.comment,
    pageLabel: seed.pageLabel,
    sortIndex: seed.sortIndex,
    position: seed.position,
  });

  // The redo erases the Annotation the restore made, not the key that is gone.
  expect(await repository.redo("RGRPDF24")).toEqual({
    kind: "removed",
    annotationKey: "MADE2345",
    pageIndex: 0,
  });
  expect(zotero.at("MADE2345")).toBeNull();
});

it("puts a deleted Annotation's tags back with it, each of its own type", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary(
    ROUGIER_ANNOTATIONS.map((entry) =>
      entry.key === "HRK7BG32"
        ? { ...entry, tags: ["figure", { tag: "from-pdf", type: 1 }] }
        : entry,
    ),
  );
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  await repository.deleteAnnotation("HRK7BG32");
  await repository.undo("RGRPDF24");

  expect(zotero.at("MADE2345")?.tags).toEqual([
    "figure",
    { tag: "from-pdf", type: 1 },
  ]);
});

it("answers for the new key in every step of both stacks after a restore", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  await repository.patchColor("PUPR5FG5", "#ff6666");
  await repository.deleteAnnotation("PUPR5FG5");

  // The delete comes back first, under a key Zotero picked.
  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "MADE2345",
  });
  expect(zotero.at("MADE2345")?.color).toBe("#ff6666");

  // The colour step below it was recorded against the old key and takes the
  // new one, so the second press puts the first colour back on the restore.
  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "MADE2345",
  });
  expect(zotero.at("MADE2345")?.color).toBe("#2ea8e5");
  expect(zotero.at("PUPR5FG5")).toBeNull();
});

it("takes every Annotation of one gesture in a single step", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  // One stroke split at the position ceiling: two creates, one gesture.
  await repository.createAnnotation("RGRPDF24", INK_DRAFT, { group: "ink-1" });
  await repository.createAnnotation(
    "RGRPDF24",
    { ...INK_DRAFT, sortIndex: "00000|000040|00101" },
    { group: "ink-1" },
  );

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "removed",
    annotationKey: "MADE2345",
    pageIndex: 0,
  });
  expect(zotero.at("MADE2345")).toBeNull();
  expect(zotero.at("MADE2346")).toBeNull();
  // One step held both, so there is nothing left to undo.
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("writes nothing where one Annotation of a gesture moved in Zotero", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository, requests } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await repository.createAnnotation("RGRPDF24", INK_DRAFT, { group: "ink-1" });
  await repository.createAnnotation(
    "RGRPDF24",
    { ...INK_DRAFT, sortIndex: "00000|000040|00101" },
    { group: "ink-1" },
  );

  zotero.changeInZotero("MADE2346", { color: "#a28ae5" });
  await repository.refresh("RGRPDF24");
  const sent = requests.length;

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "changed",
    annotationKey: "MADE2346",
  });
  // The first part of the stroke stands: the step is taken whole or not at all.
  expect(zotero.at("MADE2345")).not.toBeNull();
  expect(zotero.at("MADE2346")).not.toBeNull();
  expect(
    requests.slice(sent).filter(({ method }) => method === "DELETE"),
  ).toHaveLength(0);
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("takes a group delete in one step, and one undo puts every Annotation back", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository, requests } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  const seeds = ["HRK7BG32", "C94NJNYG"].map((key) => zotero.at(key)!);
  const sent = requests.length;

  expect(await repository.deleteAnnotations(["HRK7BG32", "C94NJNYG"])).toEqual([
    { kind: "idle" },
    { kind: "idle" },
  ]);
  // One request per Annotation.
  expect(
    requests.slice(sent).filter(({ method }) => method === "DELETE"),
  ).toHaveLength(2);
  expect(zotero.at("HRK7BG32")).toBeNull();
  expect(zotero.at("C94NJNYG")).toBeNull();

  await repository.undo("RGRPDF24");
  // Both come back, each under a key Zotero picked, from the one press.
  for (const [index, seed] of seeds.entries()) {
    expect(zotero.at(`MADE234${5 + index}`)).toMatchObject({
      type: seed.type,
      comment: seed.comment,
      sortIndex: seed.sortIndex,
      position: seed.position,
    });
  }
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("puts the tags of every Annotation of a group delete back with it, each of its own type", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary(
    ROUGIER_ANNOTATIONS.map((entry) =>
      entry.key === "HRK7BG32"
        ? { ...entry, tags: ["figure", { tag: "from-pdf", type: 1 }] }
        : entry.key === "C94NJNYG"
          ? { ...entry, tags: ["method"] }
          : entry,
    ),
  );
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  await repository.deleteAnnotations(["HRK7BG32", "C94NJNYG"]);
  await repository.undo("RGRPDF24");

  expect(zotero.at("MADE2345")?.tags).toEqual([
    "figure",
    { tag: "from-pdf", type: 1 },
  ]);
  expect(zotero.at("MADE2346")?.tags).toEqual(["method"]);
});

it("records a group delete as one step in key order, over a write that landed between its deletes", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  // Zotero holds its answer to the first delete, so the second lands first
  // and a recolour of another Annotation lands between the two.
  const held = Promise.withResolvers<void>();
  const { repository } = await writable(stack, {
    ...zotero.answers,
    write: async (request) => {
      if (
        request.method === "DELETE" &&
        request.url.pathname.endsWith("HRK7BG32")
      )
        await held.promise;
      return zotero.answers.write!(request);
    },
  });
  repository.openHistory("RGRPDF24");
  const seeds = ["HRK7BG32", "C94NJNYG"].map((key) => zotero.at(key)!);

  const group = repository.deleteAnnotations(["HRK7BG32", "C94NJNYG"]);
  expect(await repository.patchColor("PUPR5FG5", "#ff6666")).toEqual({
    kind: "idle",
  });
  held.resolve();
  expect(await group).toEqual([{ kind: "idle" }, { kind: "idle" }]);

  // One press puts the whole group back, in the order the gesture named it:
  // the first restore is the first key's.
  await repository.undo("RGRPDF24");
  expect(zotero.at("MADE2345")).toMatchObject({
    type: seeds[0]!.type,
    comment: seeds[0]!.comment,
    position: seeds[0]!.position,
  });
  expect(zotero.at("MADE2346")).toMatchObject({
    type: seeds[1]!.type,
    comment: seeds[1]!.comment,
    position: seeds[1]!.position,
  });
  // The recolour is a step of its own, below the group.
  expect(zotero.at("PUPR5FG5")?.color).toBe("#ff6666");
  await repository.undo("RGRPDF24");
  expect(zotero.at("PUPR5FG5")?.color).toBe("#2ea8e5");
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("keeps each Annotation's own outcome where one delete of a group is refused", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository } = await writable(stack, {
    ...zotero.answers,
    write: (request) =>
      request.method === "DELETE" && request.url.pathname.endsWith("PUPR5FG5")
        ? staleVersion()
        : zotero.answers.write!(request),
  });
  repository.openHistory("RGRPDF24");
  // Zotero recoloured one of them since ZotLit read it.
  zotero.changeInZotero("PUPR5FG5", { color: "#5fb236" });

  const outcomes = await repository.deleteAnnotations([
    "HRK7BG32",
    "PUPR5FG5",
    "C94NJNYG",
  ]);

  expect(outcomes[0]).toEqual({ kind: "idle" });
  expect(outcomes[1]).toMatchObject({
    kind: "conflict",
    conflict: { write: "delete" },
  });
  expect(outcomes[2]).toEqual({ kind: "idle" });
  expect(repository.mutationFor("PUPR5FG5")).toEqual(outcomes[1]);
  expect(zotero.at("PUPR5FG5")?.color).toBe("#5fb236");

  // The step holds the two deletes that landed and nothing of the refused one.
  await repository.undo("RGRPDF24");
  expect(zotero.at("MADE2345")).not.toBeNull();
  expect(zotero.at("MADE2346")).not.toBeNull();
  expect(zotero.at("MADE2347")).toBeNull();
  expect(zotero.at("PUPR5FG5")?.color).toBe("#5fb236");
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("takes a group recolour in one step, and one undo puts every colour back", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository, requests } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  const keys = ["PUPR5FG5", "K3JRFLFQ", "C94NJNYG"];
  const before = keys.map((key) => zotero.at(key)?.color);
  const sent = requests.length;

  expect(await repository.patchColors(keys, "#5FB236")).toEqual([
    { kind: "idle" },
    { kind: "idle" },
    { kind: "idle" },
  ]);
  // One request per Annotation.
  expect(
    requests.slice(sent).filter(({ method }) => method === "PATCH"),
  ).toHaveLength(3);
  expect(keys.map((key) => zotero.at(key)?.color)).toEqual([
    "#5fb236",
    "#5fb236",
    "#5fb236",
  ]);

  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(keys.map((key) => zotero.at(key)?.color)).toEqual(before);
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("keeps each Annotation's own outcome where one recolour of a group is refused", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository } = await writable(stack, {
    ...zotero.answers,
    write: (request) =>
      request.method === "PATCH" && request.url.pathname.endsWith("K3JRFLFQ")
        ? staleVersion()
        : zotero.answers.write!(request),
  });
  repository.openHistory("RGRPDF24");
  // Zotero recoloured one of them since ZotLit read it.
  zotero.changeInZotero("K3JRFLFQ", { color: "#a28ae5" });

  const outcomes = await repository.patchColors(
    ["PUPR5FG5", "K3JRFLFQ", "C94NJNYG"],
    "#5fb236",
  );

  expect(outcomes[0]).toEqual({ kind: "idle" });
  expect(outcomes[1]).toMatchObject({
    kind: "conflict",
    conflict: { write: "color" },
  });
  expect(outcomes[2]).toEqual({ kind: "idle" });
  expect(repository.mutationFor("K3JRFLFQ")).toEqual(outcomes[1]);
  expect(zotero.at("K3JRFLFQ")?.color).toBe("#a28ae5");

  // The step holds the two recolours that landed and nothing of the refused one.
  await repository.undo("RGRPDF24");
  expect(zotero.at("PUPR5FG5")?.color).toBe("#2ea8e5");
  expect(zotero.at("C94NJNYG")?.color).toBe("#ffd400");
  expect(zotero.at("K3JRFLFQ")?.color).toBe("#a28ae5");
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("drops the step where Zotero already erased the Annotation a create made", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository, requests } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await repository.createAnnotation("RGRPDF24", DRAFT);

  zotero.eraseInZotero("MADE2345");
  await repository.refresh("RGRPDF24");
  const sent = requests.length;

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "changed",
    annotationKey: "MADE2345",
  });
  expect(
    requests.slice(sent).filter(({ method }) => method === "DELETE"),
  ).toHaveLength(0);
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("drops the step where Zotero put the deleted Annotation back itself", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository, requests } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await repository.deleteAnnotation("C94NJNYG");

  // Zotero's own trash gave the note Annotation back while the reader stood
  // open, so there is nothing for the undo to create.
  zotero.restoreInZotero("C94NJNYG");
  await repository.refresh("RGRPDF24");
  const sent = requests.length;

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "changed",
    annotationKey: "C94NJNYG",
  });
  expect(
    requests.slice(sent).filter(({ method }) => method === "POST"),
  ).toHaveLength(0);
});

// #endregion

// #region geometry history

/**
 * A Zotero that keeps what every patch sends, on any Annotation of the
 * Attachment: the geometry a Geometry Edit writes and the colour a pick
 * writes. What the Local API holds is the oracle a Geometry Edit's undo is
 * read through, field by field.
 */
function zoteroHoldingMarks() {
  const held = new Map(
    ROUGIER_ANNOTATIONS.map((entry) => [entry.key, { ...entry }]),
  );
  const keyed = (request: ZoteroRequest) =>
    held.get(request.url.pathname.split("/").at(-1) ?? "") ?? null;
  return {
    answers: {
      children: () => annotationPage([...held.values()]),
      item: (request) => {
        const record = keyed(request);
        return record ? annotationItem(record) : notFound();
      },
      write: (request) => {
        const record = keyed(request);
        const body = JSON.parse(request.body ?? "{}") as {
          annotationColor?: string;
          annotationPosition?: string;
          annotationSortIndex?: string;
          annotationText?: string;
        };
        if (record) {
          held.set(record.key, {
            ...record,
            ...(body.annotationColor !== undefined && {
              color: body.annotationColor,
            }),
            ...(body.annotationPosition !== undefined && {
              position: JSON.parse(body.annotationPosition) as unknown,
            }),
            ...(body.annotationSortIndex !== undefined && {
              sortIndex: body.annotationSortIndex,
            }),
            ...(body.annotationText !== undefined && {
              text: body.annotationText,
            }),
            version: record.version + 1,
          });
        }
        return writeAccepted();
      },
    } satisfies ZoteroAnswers,
    /** What the Local API holds for one Annotation. */
    held: (annotationKey: string) => held.get(annotationKey) ?? null,
  };
}

/** One Fixture Annotation as the Fixture seeded it, the state an undo aims at. */
function seeded(annotationKey: string): WireAnnotation {
  const record = ROUGIER_ANNOTATIONS.find(({ key }) => key === annotationKey);
  if (!record) throw new Error(`No fixture annotation ${annotationKey}`);
  return record;
}

/**
 * Where a Geometry Edit puts each seeded mark, one step at a time: the whole
 * rectangle a nudge or a drag moved down the page, and the Sort Index the new
 * place gives it. Written out rather than computed, so the values a write
 * rounds are the values the Local API is read back for.
 */
const MOVES: Readonly<Record<string, readonly GeometryEdit[]>> = {
  PUPR5FG5: [
    {
      position: { pageIndex: 0, rects: [[265.833, 610.202, 374.503, 619.019]] },
      sortIndex: "00000|002042|00170",
    },
    {
      position: { pageIndex: 0, rects: [[265.833, 609.202, 374.503, 618.019]] },
      sortIndex: "00000|002043|00170",
    },
  ],
  K3JRFLFQ: [
    {
      position: {
        pageIndex: 0,
        rects: [
          [67.011, 611.638, 211.485, 619.77],
          [58.054, 600.98, 211.489, 609.112],
          [58.054, 590.321, 153.781, 598.454],
        ],
      },
      sortIndex: "00000|000435|00180",
    },
  ],
};

/** One step of {@link MOVES}, as a Geometry Edit the reader would have made. */
function moved(annotationKey: string, step = 0): GeometryEdit {
  const edit = MOVES[annotationKey]?.[step];
  if (!edit) throw new Error(`No move ${step} for ${annotationKey}`);
  return edit;
}

/** The geometry a landed {@link moved} leaves in Zotero. */
function movedGeometry(annotationKey: string, step = 0) {
  const { position, sortIndex } = moved(annotationKey, step);
  return { position, sortIndex };
}

/**
 * A clock the test moves itself, for the window a run of keyboard nudges joins
 * inside. Nothing waits on real time.
 */
function clock() {
  let at = NOW;
  return {
    now: () => at,
    /** The pause between two presses. */
    pass(milliseconds: number): void {
      at = at.add({ milliseconds });
    },
  };
}

it("puts the position, Sort Index and quoted text back when a drag is undone", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHoldingMarks();
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  const seed = seeded("PUPR5FG5");

  await repository.patchGeometry(
    "PUPR5FG5",
    { ...moved("PUPR5FG5"), text: "Identify Your" },
    "pointer",
  );
  expect(zotero.held("PUPR5FG5")).toMatchObject({
    ...movedGeometry("PUPR5FG5"),
    text: "Identify Your",
  });

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "PUPR5FG5",
  });
  expect(zotero.held("PUPR5FG5")).toMatchObject({
    position: seed.position,
    sortIndex: seed.sortIndex,
    text: seed.text,
  });

  expect(await repository.redo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held("PUPR5FG5")).toMatchObject({
    ...movedGeometry("PUPR5FG5"),
    text: "Identify Your",
  });
});

it("undoes a run of keyboard nudges inside the window as one step", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHoldingMarks();
  const time = clock();
  const { repository } = await writable(stack, zotero.answers, {
    repositoryNow: time.now,
  });
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  time.pass(200);
  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");
  expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5", 1));

  // One press goes back to where the mark stood before the first nudge.
  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held("PUPR5FG5")).toMatchObject({
    position: seeded("PUPR5FG5").position,
    sortIndex: seeded("PUPR5FG5").sortIndex,
  });
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("redoes a joined run of nudges as the one step it became", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHoldingMarks();
  const time = clock();
  const { repository } = await writable(stack, zotero.answers, {
    repositoryNow: time.now,
  });
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  time.pass(200);
  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");
  await repository.undo("RGRPDF24");

  // One press forward puts the whole run back, at the place the last nudge of
  // it left the mark.
  expect(await repository.redo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5", 1));
  expect(repository.canRedo("RGRPDF24")).toBe(false);
});

it("discards the redo steps when a nudge joins the run on top", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHoldingMarks();
  const time = clock();
  const { repository } = await writable(stack, zotero.answers, {
    repositoryNow: time.now,
  });
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  await repository.patchGeometry("K3JRFLFQ", moved("K3JRFLFQ"), "keyboard");
  await repository.undo("RGRPDF24");
  expect(repository.canRedo("RGRPDF24")).toBe(true);

  // A nudge on the Annotation the step under the undone one names joins that
  // step, and a joined edit is a new edit: what a redo would have put back is
  // discarded, as it is for a step of its own.
  time.pass(200);
  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");

  expect(repository.canRedo("RGRPDF24")).toBe(false);
  expect(await repository.redo("RGRPDF24")).toEqual({ kind: "idle" });
});

it("keeps a keyboard nudge made after the window as its own step", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHoldingMarks();
  const time = clock();
  const { repository } = await writable(stack, zotero.answers, {
    repositoryNow: time.now,
  });
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  time.pass(600);
  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");

  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5", 0));
  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held("PUPR5FG5")).toMatchObject({
    position: seeded("PUPR5FG5").position,
    sortIndex: seeded("PUPR5FG5").sortIndex,
  });
});

it("keeps a keyboard nudge made at the window's own edge as its own step", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHoldingMarks();
  const time = clock();
  const { repository } = await writable(stack, zotero.answers, {
    repositoryNow: time.now,
  });
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  // Exactly the window: the run ends at it rather than inside it.
  time.pass(JOIN_WINDOW_MS);
  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");

  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5", 0));
  expect(repository.canUndo("RGRPDF24")).toBe(true);
});

it("keeps a keyboard nudge on another Annotation as its own step", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHoldingMarks();
  const time = clock();
  const { repository } = await writable(stack, zotero.answers, {
    repositoryNow: time.now,
  });
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5"), "keyboard");
  time.pass(100);
  await repository.patchGeometry("K3JRFLFQ", moved("K3JRFLFQ"), "keyboard");

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "K3JRFLFQ",
  });
  expect(zotero.held("K3JRFLFQ")).toMatchObject({
    position: seeded("K3JRFLFQ").position,
    sortIndex: seeded("K3JRFLFQ").sortIndex,
  });
  // The other mark's nudge stands as a step of its own.
  expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5"));
  expect(repository.canUndo("RGRPDF24")).toBe(true);
});

it("keeps a pointer Geometry Edit out of a run of keyboard nudges", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHoldingMarks();
  const time = clock();
  const { repository } = await writable(stack, zotero.answers, {
    repositoryNow: time.now,
  });
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  time.pass(100);
  // A handle drag, inside the window a nudge would have joined in.
  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "pointer");

  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5", 0));
  expect(repository.canUndo("RGRPDF24")).toBe(true);
});

it("keeps a colour pick out of a run of keyboard nudges", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHoldingMarks();
  const time = clock();
  const { repository } = await writable(stack, zotero.answers, {
    repositoryNow: time.now,
  });
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  time.pass(100);
  await repository.patchColor("PUPR5FG5", "#ff6666");
  time.pass(100);
  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");

  // Steps of different kinds never merge, so the nudge after the pick is its
  // own step and undoing it leaves the picked colour alone.
  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held("PUPR5FG5")).toMatchObject({
    ...movedGeometry("PUPR5FG5", 0),
    color: "#ff6666",
  });
  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held("PUPR5FG5")).toMatchObject({
    ...movedGeometry("PUPR5FG5", 0),
    color: "#2ea8e5",
  });
});

// #endregion

// #region comment editing sessions
//
// Each session's autosaves run on the fake clock the idle timer is armed on.

it("makes one step of a comment session, however many times it saved", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    // The Mark Popup types, and an Annotation Card carries the editing on
    // through the very same verb: the hand-off between them is one session.
    repository.editComment("PUPR5FG5", "Worth");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(zotero.held?.comment).toBe("Worth");
    repository.editComment("PUPR5FG5", "Worth citing");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(zotero.held?.comment).toBe("Worth citing");
    repository.editComment("PUPR5FG5", "Worth citing twice");
    await repository.submitComment("PUPR5FG5");
    expect(zotero.held?.comment).toBe("Worth citing twice");

    expect(await repository.undo("RGRPDF24")).toEqual({
      kind: "stepped",
      annotationKey: "PUPR5FG5",
    });
    // The whole session went back in one press, to the text the draft was born
    // with rather than the text the last autosave left.
    expect(zotero.held?.comment).toBe("");
    expect(repository.canUndo("RGRPDF24")).toBe(false);

    expect(await repository.redo("RGRPDF24")).toMatchObject({
      kind: "stepped",
    });
    expect(zotero.held?.comment).toBe("Worth citing twice");
  } finally {
    vi.useRealTimers();
  }
});

it("starts a new step where the comment moved in Zotero between two saves", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    repository.editComment("PUPR5FG5", "Worth citing");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(zotero.held?.comment).toBe("Worth citing");

    // The same comment is changed in Zotero, so the next save is refused and
    // the card offers "Apply again" against the value Zotero holds now.
    zotero.changeInZotero({ comment: "Cited by Perez" });
    zotero.refuseNextWrite();
    repository.editComment("PUPR5FG5", "Worth citing twice");
    await vi.advanceTimersByTimeAsync(1_000);
    await repository.retryCommentDraft("PUPR5FG5");
    expect(zotero.held?.comment).toBe("Worth citing twice");
    repository.discardCommentDraft("PUPR5FG5");

    // The write that landed was stamped off the Zotero-side text, so it
    // starts a step of its own: one press puts that text back rather than
    // writing over it with the empty comment the first session began with.
    expect(await repository.undo("RGRPDF24")).toEqual({
      kind: "stepped",
      annotationKey: "PUPR5FG5",
    });
    expect(zotero.held?.comment).toBe("Cited by Perez");

    // The first session's own step stands behind it, and it is the Zotero-side
    // text that now blocks it rather than the step having written it away.
    expect(await repository.undo("RGRPDF24")).toEqual({
      kind: "changed",
      annotationKey: "PUPR5FG5",
    });
    expect(zotero.held?.comment).toBe("Cited by Perez");
  } finally {
    vi.useRealTimers();
  }
});

it("records no step for a comment draft discarded before it saved", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    repository.editComment("PUPR5FG5", "Never saved");
    repository.discardCommentDraft("PUPR5FG5");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(repository.canUndo("RGRPDF24")).toBe(false);
    expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.held?.comment).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it("records no step where a comment session settles on its starting text", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("HRK7BG32");
    const seeded = zotero.held!.comment!;
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    repository.editComment("HRK7BG32", `${seeded} and slow`);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(zotero.held?.comment).toBe(`${seeded} and slow`);

    // The researcher typed the ending away again before leaving the editor.
    repository.editComment("HRK7BG32", seeded);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(zotero.held?.comment).toBe(seeded);

    expect(repository.canUndo("RGRPDF24")).toBe(false);
    expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.held?.comment).toBe(seeded);
  } finally {
    vi.useRealTimers();
  }
});

it("does nothing while the Annotation the top step touches is being edited", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    repository.editComment("PUPR5FG5", "Half typed");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(zotero.held?.comment).toBe("Half typed");

    // The comment editor is open again on the same Annotation, with nothing
    // typed into it yet, so the keys belong to the editor holding it.
    repository.editComment("PUPR5FG5");
    expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.held?.comment).toBe("Half typed");
    // The menu row and the palette entry read this, so neither is drawn for a
    // press that would do nothing and say nothing.
    expect(repository.canUndo("RGRPDF24")).toBe(false);

    // The editor closed, keeping what Zotero holds.
    repository.discardCommentDraft("PUPR5FG5");
    expect(repository.canUndo("RGRPDF24")).toBe(true);

    expect(await repository.undo("RGRPDF24")).toEqual({
      kind: "stepped",
      annotationKey: "PUPR5FG5",
    });
    expect(zotero.held?.comment).toBe("");
  } finally {
    vi.useRealTimers();
  }
});

it("does nothing while an autosave on the Attachment is still due", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");
    await repository.patchColor("PUPR5FG5", "#ff6666");

    // Another Annotation of the same Attachment is being typed into, and its
    // save is armed: the undo waits for it rather than stepping past it.
    repository.editComment("HRK7BG32", "Still typing");

    expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.held?.color).toBe("#ff6666");
    expect(repository.canUndo("RGRPDF24")).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("discards the redo steps when a comment session moves its own step", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    // A comment session on one Annotation, then a colour pick on another.
    repository.editComment("PUPR5FG5", "Worth citing");
    await vi.advanceTimersByTimeAsync(1_000);
    repository.discardCommentDraft("PUPR5FG5");
    await repository.patchColor("HRK7BG32", "#ff6666");
    await repository.undo("RGRPDF24");
    const seededColor = zotero.heldOf("HRK7BG32")!.color;
    expect(repository.canRedo("RGRPDF24")).toBe(true);

    // Typing in the first Annotation's comment again moves the step that
    // session left rather than pushing a new one, and a moved step is a newly
    // confirmed edit like any other: the undone colour pick is not offered
    // again.
    repository.editComment("PUPR5FG5", "Worth citing twice");
    await vi.advanceTimersByTimeAsync(1_000);
    repository.discardCommentDraft("PUPR5FG5");

    expect(repository.canRedo("RGRPDF24")).toBe(false);
    expect(await repository.redo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.heldOf("HRK7BG32")?.color).toBe(seededColor);
  } finally {
    vi.useRealTimers();
  }
});

it("records a colour pick after a comment session as a step of its own", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    repository.editComment("PUPR5FG5", "Noted");
    await vi.advanceTimersByTimeAsync(1_000);
    await repository.submitComment("PUPR5FG5");
    await repository.patchColor("PUPR5FG5", "#ff6666");

    expect(await repository.undo("RGRPDF24")).toMatchObject({
      kind: "stepped",
    });
    expect(zotero.held?.color).toBe("#2ea8e5");
    expect(zotero.held?.comment).toBe("Noted");

    expect(await repository.undo("RGRPDF24")).toMatchObject({
      kind: "stepped",
    });
    expect(zotero.held?.comment).toBe("");
    expect(zotero.held?.color).toBe("#2ea8e5");
  } finally {
    vi.useRealTimers();
  }
});

it("records an autosave that lands while a step runs beside it", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const seeded = zotero.heldOf("HRK7BG32")!.comment!;
    const gate = Promise.withResolvers<void>();
    const away = Promise.withResolvers<void>();
    let holdNext = false;
    const { repository } = await writable(stack, {
      ...zotero.answers,
      write: async (request) => {
        if (holdNext) {
          holdNext = false;
          away.resolve();
          await gate.promise;
        }
        return zotero.answers.write(request);
      },
    });
    repository.openHistory("RGRPDF24");
    await repository.patchColor("PUPR5FG5", "#ff6666");

    holdNext = true;
    const undone = repository.undo("RGRPDF24");
    // The undo's own write is away and waiting, which the write itself says.
    await away.promise;
    // Another Annotation's comment session saves while the undo's own write is
    // still away.
    repository.editComment("HRK7BG32", "Typed meanwhile");
    await vi.advanceTimersByTimeAsync(1_000);
    gate.resolve();
    expect(await undone).toMatchObject({ kind: "stepped" });
    expect(zotero.held?.color).toBe("#2ea8e5");

    // The session's own step stands beside the undo rather than being lost to
    // it, so the editor's comment can be stepped back in its turn.
    await repository.submitComment("HRK7BG32");
    expect(zotero.heldOf("HRK7BG32")?.comment).toBe("Typed meanwhile");
    expect(await repository.undo("RGRPDF24")).toEqual({
      kind: "stepped",
      annotationKey: "HRK7BG32",
    });
    expect(zotero.heldOf("HRK7BG32")?.comment).toBe(seeded);
  } finally {
    vi.useRealTimers();
  }
});

// #endregion

// #region tag editing sessions

/** A tag as a tag `PATCH` sends it: always with its type. */
type SentTag = Required<WireTag>;

/**
 * A Zotero holding one Annotation's tags and comment. It keeps the whole list a
 * tag `PATCH` names and answers `412` to a body version it does not hold, as the paired
 * probe recorded (aidenlx/zotlit#1231): what Zotero received and holds is the
 * oracle, never the draft.
 */
function zoteroTagging(
  annotationKey: string,
  tags: NonNullable<WireAnnotation["tags"]>,
) {
  let stored: WireAnnotation = { ...afterWrite(annotationKey, {}), tags };
  const patches: { version: number; tags: SentTag[] }[] = [];
  let hold: Promise<void> | null = null;
  return {
    answers: {
      children: () =>
        annotationPage(
          ROUGIER_ANNOTATIONS.map((entry) =>
            entry.key === annotationKey ? stored : entry,
          ),
        ),
      item: () => annotationItem(stored),
      write: async (request) => {
        const body = JSON.parse(request.body ?? "{}") as {
          version: number;
          tags?: SentTag[];
          annotationComment?: string;
        };
        const { tags: sent, annotationComment } = body;
        if (sent) patches.push({ version: body.version, tags: sent });
        if (hold) await hold;
        if (body.version !== stored.version) return staleVersionPatch();
        stored = {
          ...stored,
          // Zotero writes a type for an automatic tag only.
          ...(sent && {
            tags: sent.map(({ tag, type }) =>
              type === 0 ? tag : { tag, type },
            ),
          }),
          ...(annotationComment !== undefined && {
            comment: annotationComment,
          }),
          version: stored.version + 1,
        };
        return writeAccepted();
      },
    } satisfies ZoteroAnswers,
    /** Every tag `PATCH` body Zotero received. */
    patches,
    /** The tags Zotero holds, as the wire writes them. */
    get tags() {
      return stored.tags;
    },
    get comment() {
      return stored.comment;
    },
    /** An edit made in Zotero itself, beside ZotLit. */
    changeInZotero(patch: Partial<WireAnnotation>): void {
      stored = { ...stored, ...patch, version: stored.version + 1 };
    },
    /** Hold every write until `release` is called. */
    holdWrites(): () => void {
      const { promise, resolve } = Promise.withResolvers<void>();
      hold = promise;
      return () => {
        hold = null;
        resolve();
      };
    },
  };
}

/** The Fixture's highlight with a manual, an automatic, and a manual tag. */
const TAGGED = ["review", { tag: "nlp", type: 1 }, "todo"] as const;

it("draws a tag session's merged tags while it saves, and a tag undo's too", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  const drawn = () =>
    repository
      .peek("RGRPDF24")
      ?.value.annotations.find(({ key }) => key === "PUPR5FG5")?.tags;

  let release = zotero.holdWrites();
  repository.editTags("PUPR5FG5", ["review", "todo", "figure"]);
  const saving = repository.submitTags("PUPR5FG5");
  expect(drawn()).toEqual(["review", "todo", "figure"]);
  release();
  await saving;
  expect(drawn()).toEqual(["review", "todo", "figure"]);

  release = zotero.holdWrites();
  const undoing = repository.undo("RGRPDF24");
  // The undo puts the automatic tag back after the kept ones, as it merges.
  expect(drawn()).toEqual(["review", "todo", "nlp"]);
  release();
  expect(await undoing).toMatchObject({ kind: "stepped" });
  expect(zotero.tags).toEqual(["review", "todo", { tag: "nlp", type: 1 }]);
});

it("saves one tag session as one PATCH of the whole list, with the precondition", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);

  repository.editTags("PUPR5FG5");
  repository.editTags("PUPR5FG5", ["review", "nlp", "todo", "Smith, J."]);
  repository.editTags("PUPR5FG5", ["review", "nlp", "Smith, J."]);
  repository.editTags("PUPR5FG5", ["review", "nlp", "Smith, J.", "figure"]);
  expect(zotero.patches).toEqual([]);

  expect(await repository.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });

  // Kept tags keep their types and new tags are manual. The version is the
  // Fixture highlight's own.
  expect(zotero.patches).toEqual([
    {
      version: 11,
      tags: [
        { tag: "review", type: 0 },
        { tag: "nlp", type: 1 },
        { tag: "Smith, J.", type: 0 },
        { tag: "figure", type: 0 },
      ],
    },
  ]);
  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
  const record = repository
    .peek("RGRPDF24")
    ?.value.annotations.find(({ key }) => key === "PUPR5FG5");
  expect(record?.tagDetails).toEqual([
    { name: "review", type: 0 },
    { name: "nlp", type: 1 },
    { name: "Smith, J.", type: 0 },
    { name: "figure", type: 0 },
  ]);
});

it("removes an automatic tag, as Zotero lets the user do", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);

  repository.editTags("PUPR5FG5", ["review", "todo"]);
  await repository.submitTags("PUPR5FG5");

  expect(zotero.tags).toEqual(["review", "todo"]);
});

it("ends a session that changed nothing with no write", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);

  repository.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
  repository.editTags("PUPR5FG5", ["review", "nlp", "todo"]);

  expect(await repository.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(zotero.patches).toEqual([]);
  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
});

it("merges tags Zotero added and removed during the session, not overwriting them", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);

  repository.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
  zotero.changeInZotero({
    tags: ["review", { tag: "nlp", type: 1 }, "from Zotero"],
  });
  await repository.refresh("RGRPDF24");

  await repository.submitTags("PUPR5FG5");

  // `from Zotero` stays, and `todo`, which Zotero removed, does not come back.
  expect(zotero.tags).toEqual([
    "review",
    { tag: "nlp", type: 1 },
    "from Zotero",
    "figure",
  ]);
});

it("re-reads after a 412 and applies the same names again, with no Write Conflict", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  let conflicts = 0;
  stack.defer(repository.on("write-conflict", () => (conflicts += 1)));

  repository.editTags("PUPR5FG5", ["review", "nlp", "figure"]);
  // Zotero moves under the session, and ZotLit has not read it yet.
  zotero.changeInZotero({ tags: [...TAGGED, "from Zotero"] });

  expect(await repository.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });

  expect(zotero.patches.map(({ version }) => version)).toEqual([11, 12]);
  expect(zotero.tags).toEqual([
    "review",
    { tag: "nlp", type: 1 },
    "from Zotero",
    "figure",
  ]);
  expect(conflicts).toBe(0);
  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
});

it("shares one tag draft and preserves it across unrelated refresh changes", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  const announced: string[] = [];
  stack.defer(
    repository.on("annotation-changed", (key) => announced.push(key)),
  );

  // The Mark Popup starts the session; the card opens onto the same draft.
  repository.editTags("PUPR5FG5", ["review", "figure"]);
  expect(repository.editTags("PUPR5FG5")).toMatchObject({
    names: ["review", "figure"],
  });
  zotero.changeInZotero({ color: "#ff6666" });
  await repository.refresh("RGRPDF24");

  expect(repository.tagDraftFor("PUPR5FG5")).toMatchObject({
    serverID: SERVER_ID,
    baseline: ["review", "nlp", "todo"],
    names: ["review", "figure"],
    state: { kind: "editing" },
  });
  expect(announced).toContain("PUPR5FG5");
  expect(colorOf(await repository.read("RGRPDF24"), "PUPR5FG5")).toBe(
    "#ff6666",
  );
});

it("saves, conflicts, and discards a comment draft and a tag draft on one Annotation apart", async () => {
  vi.useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
    const { repository } = await writable(stack, zotero.answers);
    let conflicts = 0;
    stack.defer(repository.on("write-conflict", () => (conflicts += 1)));

    // Both editors are open on one Annotation; the tag session ends first.
    repository.editComment("PUPR5FG5", "Worth citing");
    repository.editTags("PUPR5FG5", ["review", "figure"]);
    await repository.submitTags("PUPR5FG5");

    expect(zotero.tags).toEqual(["review", "figure"]);
    expect(zotero.comment).toBeUndefined();
    expect(repository.commentDraftFor("PUPR5FG5")).toMatchObject({
      text: "Worth citing",
      state: { kind: "editing" },
    });

    // The comment's idle save lands under an open tag session.
    repository.editTags("PUPR5FG5", ["review", "figure", "todo"]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(zotero.comment).toBe("Worth citing");
    expect(zotero.tags).toEqual(["review", "figure"]);
    expect(repository.commentDraftFor("PUPR5FG5")).toBeNull();
    expect(repository.tagDraftFor("PUPR5FG5")).toMatchObject({
      baseline: ["review", "figure"],
      names: ["review", "figure", "todo"],
      state: { kind: "editing" },
    });

    // Zotero moves the comment under typed text: only the comment conflicts,
    // and the tag session still saves.
    repository.editComment("PUPR5FG5", "Worth citing twice");
    zotero.changeInZotero({ comment: "From Zotero" });
    await repository.refresh("RGRPDF24");
    expect(conflicts).toBe(1);
    await repository.submitTags("PUPR5FG5");

    expect(zotero.tags).toEqual(["review", "figure", "todo"]);
    expect(zotero.comment).toBe("From Zotero");
    expect(repository.commentDraftFor("PUPR5FG5")).toMatchObject({
      text: "Worth citing twice",
      state: { kind: "conflict", fresh: "From Zotero" },
    });
    // The card still offers Apply again and Discard for the comment.
    expect(repository.annotationState("PUPR5FG5").mutation).toEqual({
      kind: "conflict",
      conflict: {
        write: "comment",
        attempted: "Worth citing twice",
        fresh: "From Zotero",
      },
    });

    // Discarding one field's draft leaves the other's.
    repository.editTags("PUPR5FG5", ["review"]);
    repository.discardTagDraft("PUPR5FG5");
    expect(repository.commentDraftFor("PUPR5FG5")).toMatchObject({
      text: "Worth citing twice",
    });
    repository.editTags("PUPR5FG5", ["review"]);
    repository.discardCommentDraft("PUPR5FG5");
    expect(repository.commentDraftFor("PUPR5FG5")).toBeNull();
    expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
    expect(repository.tagDraftFor("PUPR5FG5")).toMatchObject({
      names: ["review"],
    });
    expect(zotero.comment).toBe("From Zotero");
    expect(zotero.tags).toEqual(["review", "figure", "todo"]);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps the verbs live and the draft saving until the read-back lands", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  const release = zotero.holdWrites();

  repository.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
  const saved = repository.submitTags("PUPR5FG5");
  await vi.waitFor(() => expect(zotero.patches).toHaveLength(1));

  expect(repository.tagDraftFor("PUPR5FG5")?.state).toEqual({
    kind: "pending",
  });
  // The draft is saving, so a change meanwhile is not taken.
  repository.editTags("PUPR5FG5", ["review"]);
  expect(repository.tagDraftFor("PUPR5FG5")?.names).toEqual([
    "review",
    "nlp",
    "todo",
    "figure",
  ]);
  const mutation = repository.mutationFor("PUPR5FG5");
  expect(mutation).toEqual({ kind: "pending", write: "tags", session: true });
  const verbs = cardControls({
    capability: repository.capabilityFor("RGRPDF24"),
    mutation,
    hasComment: false,
    hasTags: true,
    now: NOW,
  });
  expect([verbs.color, verbs.comment, verbs.delete]).toMatchObject([
    { disabled: false },
    { disabled: false },
    { disabled: false },
  ]);

  // The draft leaves only once the confirmed record stands, so the editor
  // closes onto the new chips rather than the old ones.
  let tagsWhenClosed: readonly string[] | undefined;
  stack.defer(
    repository.on("annotation-changed", () => {
      if (repository.tagDraftFor("PUPR5FG5")) return;
      tagsWhenClosed = repository
        .peek("RGRPDF24")
        ?.value.annotations.find(({ key }) => key === "PUPR5FG5")?.tags;
    }),
  );
  release();
  await saved;
  expect(tagsWhenClosed).toEqual(["review", "nlp", "todo", "figure"]);
});

it("hides an old database's tag draft when the database switches", async () => {
  await using stack = new AsyncDisposableStack();
  let serverID = SERVER_ID;
  let answering = true;
  const { repository, client, dbEvents, serverEvents } = await writable(
    stack,
    {
      root: () =>
        answering ? rootOk({ "Zotero-Server-ID": serverID }) : unreachable(),
      children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
    },
    { key: REMEMBERED_KEY },
  );
  repository.editTags("PUPR5FG5", ["figure"]);
  const hidden = new Promise<string>((resolve) => {
    stack.defer(
      repository.on("annotation-changed", (key) => {
        if (repository.annotationState(key).hidden) resolve(key);
      }),
    );
  });

  // With the Local API gone, the draft is found by the database it was made
  // in, so the switch itself must hide it.
  answering = false;
  const lost = nextChange(repository);
  freshnessSignal(serverEvents);
  await lost;
  serverID = "Zzzz11119999";
  client.$client.exec(
    `update settings set value = '${serverID}' where setting = 'localAPI' and key = 'serverID'`,
  );
  dbEvents.emit("changed");
  await repository.read("RGRPDF24");

  await expect(hidden).resolves.toBe("PUPR5FG5");
  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
});

it("holds a tag draft when editing becomes unavailable, until Save tags after it returns", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository, localApi } = await writable(stack, zotero.answers);

  repository.editTags("PUPR5FG5", ["review", "nlp", "todo"]);
  await localApi.forgetAuthorization();
  expect(repository.tagDraftFor("PUPR5FG5")?.manualSave).toBe(true);
  // The editor closes as editing goes, and adds the text still typed first.
  repository.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
  expect(await repository.submitTags("PUPR5FG5", { automatic: true })).toEqual({
    kind: "idle",
  });
  expect(repository.tagDraftFor("PUPR5FG5")).toMatchObject({
    names: ["review", "nlp", "todo", "figure"],
    held: true,
    state: { kind: "editing" },
  });
  // No new session starts while editing is unavailable.
  expect(repository.editTags("FDRFQ7C2")).toBeNull();

  // Approval alone saves nothing, and neither does another close.
  await localApi.authorize();
  await repository.submitTags("PUPR5FG5", { automatic: true });
  expect(zotero.patches).toEqual([]);

  expect(await repository.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(zotero.patches).toHaveLength(1);
  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
});

it("holds a refused tag save with its reason until Save tags", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  let refuse = true;
  const { repository, localApi } = await writable(stack, {
    ...zotero.answers,
    write: (request) =>
      refuse ? keyRejected() : zotero.answers.write(request),
  });

  repository.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
  expect(await repository.submitTags("PUPR5FG5")).toEqual({
    kind: "failed",
    failure: { kind: "unauthorized" },
  });
  expect(repository.tagDraftFor("PUPR5FG5")).toMatchObject({
    names: ["review", "nlp", "todo", "figure"],
    manualSave: true,
    held: true,
    state: { kind: "failed", failure: { kind: "unauthorized" } },
  });

  refuse = false;
  await localApi.authorize();
  await repository.submitTags("PUPR5FG5", { automatic: true });
  expect(zotero.patches).toEqual([]);
  expect(await repository.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(zotero.tags).toEqual([
    "review",
    { tag: "nlp", type: 1 },
    "todo",
    "figure",
  ]);
  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
});

it("holds a tag save whose response was lost as unconfirmed until Save tags", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  let lose = true;
  const { repository } = await writable(stack, {
    ...zotero.answers,
    write: async (request) => {
      const answer = await zotero.answers.write(request);
      // Zotero took the write; its answer never arrives.
      if (lose) unreachable();
      return answer;
    },
  });

  repository.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
  // A lost answer is the Local API gone mid-write: which it did, nobody knows.
  expect(await repository.submitTags("PUPR5FG5")).toMatchObject({
    kind: "failed",
    failure: { kind: "unreachable" },
  });
  expect(repository.tagDraftFor("PUPR5FG5")).toMatchObject({
    manualSave: true,
    held: true,
    state: { kind: "failed", failure: { kind: "unreachable" } },
  });

  lose = false;
  await repository.submitTags("PUPR5FG5", { automatic: true });
  expect(zotero.patches).toHaveLength(1);
  // Save tags applies the same names to what Zotero holds, which already has
  // them, so the list comes out the same.
  expect(await repository.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(zotero.patches).toHaveLength(2);
  expect(zotero.tags).toEqual([
    "review",
    { tag: "nlp", type: 1 },
    "todo",
    "figure",
  ]);
  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
});

it("saves the next session on close again once Save tags has saved a held draft", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  let refuse = true;
  const { repository, localApi } = await writable(stack, {
    ...zotero.answers,
    write: (request) =>
      refuse ? keyRejected() : zotero.answers.write(request),
  });
  repository.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
  await repository.submitTags("PUPR5FG5", { automatic: true });
  refuse = false;
  await localApi.authorize();
  expect(await repository.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(zotero.patches).toHaveLength(1);

  // The hold ended with that save, so a new session saves as its editor
  // closes.
  repository.editTags("PUPR5FG5", ["review", "nlp", "figure"]);
  expect(await repository.submitTags("PUPR5FG5", { automatic: true })).toEqual({
    kind: "idle",
  });
  expect(zotero.patches).toHaveLength(2);
  expect(zotero.tags).toEqual(["review", { tag: "nlp", type: 1 }, "figure"]);
  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
});

it("discards a tag draft when deletion is confirmed in Zotero", async () => {
  await using stack = new AsyncDisposableStack();
  let records = ROUGIER_ANNOTATIONS;
  const { repository } = await writable(stack, {
    children: () => annotationPage(records),
  });
  repository.editTags("PUPR5FG5", ["figure"]);
  const deleted: string[] = [];
  stack.defer(
    repository.on("annotation-changed", (key) => {
      if (repository.annotationState(key).gone) deleted.push(key);
    }),
  );
  records = records.filter(({ key }) => key !== "PUPR5FG5");

  await repository.refresh("RGRPDF24");

  expect(new Set(deleted)).toEqual(new Set(["PUPR5FG5"]));
  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
  // The editor unmounting on the deleted card sends nothing.
  expect(await repository.submitTags("PUPR5FG5", { automatic: true })).toEqual({
    kind: "idle",
  });
});

it("discards the tag draft with the comment draft when the Annotation is deleted", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack);
  repository.editComment("PUPR5FG5", "Unsaved");
  repository.editTags("PUPR5FG5", ["figure"]);

  await repository.deleteAnnotation("PUPR5FG5");

  expect(repository.commentDraftFor("PUPR5FG5")).toBeNull();
  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
});

it("discards a held tag draft and keeps the tags Zotero holds", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository, localApi } = await writable(stack, zotero.answers);
  repository.editTags("PUPR5FG5", ["figure"]);
  await localApi.forgetAuthorization();
  await repository.submitTags("PUPR5FG5", { automatic: true });

  repository.discardTagDraft("PUPR5FG5");

  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
  expect(zotero.patches).toEqual([]);
});

// #endregion

// #region tag session history

/** Save one tag session that ends on `names`, as the editor closing does. */
async function saveTags(
  repository: AnnotationRepository,
  names: readonly string[],
): Promise<void> {
  repository.editTags("PUPR5FG5", names);
  expect(await repository.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
}

it("makes one step of a tag session and puts the previous tags back with their types", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  // One session adds two names and removes a manual and an automatic tag.
  repository.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
  repository.editTags("PUPR5FG5", ["review", "figure"]);
  await saveTags(repository, ["review", "figure", "Smith, J."]);
  expect(zotero.tags).toEqual(["review", "figure", "Smith, J."]);

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "PUPR5FG5",
  });
  expect(zotero.tags).toEqual(["review", { tag: "nlp", type: 1 }, "todo"]);
  // The whole session was one step.
  expect(repository.canUndo("RGRPDF24")).toBe(false);
  expect(repository.canRedo("RGRPDF24")).toBe(true);
});

it("keeps the tags Zotero changed after the session when it is undone", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await saveTags(repository, ["review", "nlp", "figure", "draft"]);

  // Zotero adds a tag of its own and removes one the session added.
  zotero.changeInZotero({
    tags: ["review", { tag: "nlp", type: 1 }, "figure", "from Zotero"],
  });
  await repository.refresh("RGRPDF24");

  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  // No field check stops the undo: it removes what the session added and
  // restores what it removed, and `from Zotero` stays.
  expect(zotero.tags).toEqual([
    "review",
    { tag: "nlp", type: 1 },
    "from Zotero",
    "todo",
  ]);
});

it("redoes a tag session from the undo's own confirmed result", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await saveTags(repository, ["review", "figure"]);
  await repository.undo("RGRPDF24");

  expect(await repository.redo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "PUPR5FG5",
  });
  expect(zotero.tags).toEqual(["review", "figure"]);
  // Stepping back and forth reverses the same names as often as asked.
  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.tags).toEqual(["review", { tag: "nlp", type: 1 }, "todo"]);
});

it("discards the redo steps when a new tag session is recorded", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await saveTags(repository, ["review", "figure"]);
  await repository.undo("RGRPDF24");

  await saveTags(repository, ["review", "nlp", "todo", "method"]);

  expect(repository.canRedo("RGRPDF24")).toBe(false);
  expect(await repository.redo("RGRPDF24")).toEqual({ kind: "idle" });
  expect(zotero.tags).toEqual([
    "review",
    { tag: "nlp", type: 1 },
    "todo",
    "method",
  ]);
});

it("sends the tag undo again after a 412, applied to the fresh tags", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  let conflicts = 0;
  stack.defer(repository.on("write-conflict", () => (conflicts += 1)));
  repository.openHistory("RGRPDF24");
  await saveTags(repository, ["review", "nlp", "figure"]);
  const sent = zotero.patches.length;

  // Zotero moves under the undo, and ZotLit has not read it yet.
  zotero.changeInZotero({
    tags: ["review", { tag: "nlp", type: 1 }, "figure", "from Zotero"],
  });

  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  // The refused write, and the one built on the re-read tags.
  expect(zotero.patches.slice(sent).map(({ version }) => version)).toEqual([
    12, 13,
  ]);
  expect(zotero.tags).toEqual([
    "review",
    { tag: "nlp", type: 1 },
    "from Zotero",
    "todo",
  ]);
  expect(conflicts).toBe(0);
  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(repository.canRedo("RGRPDF24")).toBe(true);
});

it("stands the verbs down while a tag undo is in flight, as a gesture's write", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await saveTags(repository, ["review", "figure"]);
  const release = zotero.holdWrites();

  const undone = repository.undo("RGRPDF24");
  await vi.waitFor(() => expect(zotero.patches).toHaveLength(2));

  const mutation = repository.mutationFor("PUPR5FG5");
  expect(mutation).toEqual({ kind: "pending", write: "tags" });
  const verbs = cardControls({
    capability: repository.capabilityFor("RGRPDF24"),
    mutation,
    hasComment: false,
    hasTags: true,
    now: NOW,
  });
  expect([verbs.color, verbs.comment, verbs.tags, verbs.delete]).toMatchObject([
    { disabled: true },
    { disabled: true },
    { disabled: true },
    { disabled: true },
  ]);

  release();
  expect(await undone).toMatchObject({ kind: "stepped" });
  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
});

it("takes a tag step with no write where Zotero already holds what the undo would write", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await saveTags(repository, ["review", "nlp", "figure"]);
  const sent = zotero.patches.length;

  zotero.changeInZotero({ tags: [...TAGGED] });
  await repository.refresh("RGRPDF24");

  // An equal value is no conflict, so the undo is taken, not refused.
  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "PUPR5FG5",
  });
  expect(zotero.patches).toHaveLength(sent);
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("does nothing while a tag session is open on the Annotation the top step touches", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");
  await saveTags(repository, ["review", "nlp", "figure"]);

  // The tag editor is open again, so the keys belong to it.
  repository.editTags("PUPR5FG5");
  expect(repository.canUndo("RGRPDF24")).toBe(false);
  expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
  expect(zotero.tags).toEqual(["review", { tag: "nlp", type: 1 }, "figure"]);

  // The editor closed with no change.
  expect(await repository.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.tags).toEqual(["review", { tag: "nlp", type: 1 }, "todo"]);
});

// #endregion
