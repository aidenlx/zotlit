// The Annotation Repository's reads and holds: both Annotation Sources, the database partition, source moves, and the Editing Capability.
import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { expect, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { excerptFingerprint } from "@/services/excerpt-image/contract";
import {
  annotationItem,
  annotationPage,
  freshnessSignal,
  localApiDisabled,
  rootOk,
  ROUGIER_ANNOTATIONS,
  SERVER_ID,
  unreachable,
  writeAccepted,
} from "@/services/zotero-local-api/__fixtures__";
import type { WireAnnotation } from "@/services/zotero-local-api/__fixtures__";
import type { ZoteroReadLease } from "@/services/zotero-reads/service";

import {
  afterWrite,
  FIXTURE_ROWS,
  leaseOver,
  markExternal,
  nextChange,
  REMEMBERED_KEY,
  scopedStack,
  setup,
  switchToLocalApi,
  writable,
  batchReads,
  READING_ORDER,
  DATABASE_SOURCE,
  MADE,
  colorOf,
  annotationRows,
} from "./__fixtures__";
import type { AnnotationList } from "./service";

/** Each Annotation's lock, by key. */
function locksOf(list: AnnotationList | null) {
  return Object.fromEntries(
    list?.annotations.map(({ key, lock }) => [key, lock]) ?? [],
  );
}

it.effect(
  "reads every type the Fixture carries on one attachment, in Zotero's reading order",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service } = yield* Effect.promise(() => setup(stack));

      const list = yield* service.read("RGRPDF24");

      expect(list?.source).toEqual(DATABASE_SOURCE);
      expect(
        list?.annotations.find(({ key }) => key === "PUPR5FG5")?.version,
      ).toBe(29);
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
        lock: null,
        templateMetadata: {
          dateAdded: "2026-08-23T16:18:18Z",
          dateModified: "2026-08-23T16:19:07Z",
          authorName: null,
          isExternal: false,
          tags: [],
        },
      });
    }),
);

it.effect(
  "narrows each position by the content type of the attachment that holds it",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service } = yield* Effect.promise(() => setup(stack));

      const pdf = yield* service.read("RGRPDF24");
      const epub = yield* service.read("EPUBBKS2");

      expect(
        Object.fromEntries(
          (pdf?.annotations ?? []).map(({ key, position }) => [
            key,
            position.kind,
          ]),
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
    }),
);

it.effect(
  "converts raw database tag types for annotation template metadata",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, client } = yield* Effect.promise(() => setup(stack));
      client.$client.exec(`
    insert into tags (tagID, name) values (991, 'hand-added'), (992, 'translator');
    insert into itemTags (itemID, tagID, type) values (49, 991, 0), (49, 992, 1);
  `);
      const list = yield* service.read("RGRPDF24");
      expect(
        list?.annotations.find(({ key }) => key === "FDRFQ7C2")
          ?.templateMetadata?.tags,
      ).toEqual([
        { name: "hand-added", type: "manual" },
        { name: "translator", type: "auto" },
      ]);
    }),
);

it.effect("carries each tag's type from both Annotation Sources", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { repository, service, client } = yield* Effect.promise(() =>
      setup(stack, {
        children: () =>
          annotationPage(
            ROUGIER_ANNOTATIONS.map((entry) =>
              entry.key === "FDRFQ7C2"
                ? {
                    ...entry,
                    tags: ["hand-added", { tag: "translator", type: 1 }],
                  }
                : entry,
            ),
          ),
      }),
    );
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
    const fromDatabase = yield* service.read("RGRPDF24");
    yield* Effect.promise(() => announced);
    const fromLocalApi = yield* service.read("RGRPDF24");

    expect(fromDatabase?.source.kind).toBe("zotero-db");
    expect(tagsOf(fromDatabase)?.tagDetails).toEqual(expected);
    expect(fromLocalApi?.source.kind).toBe("zotero-local-api");
    expect(tagsOf(fromLocalApi)?.tagDetails).toEqual(expected);
    expect(tagsOf(fromLocalApi)?.templateMetadata?.tags).toEqual([
      { name: "hand-added", type: "manual" },
      { name: "translator", type: "auto" },
    ]);
  }),
);

it.effect(
  "serves one database read to every surface that asks for one attachment at once",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const reads = yield* Effect.promise(() => setup(stack));
      const { service } = reads;

      const [overlay, view] = yield* Effect.all(
        [service.read("RGRPDF24"), service.read("RGRPDF24")],
        { concurrency: "unbounded" },
      );

      expect(batchReads(reads)).toBe(1);
      expect(overlay).toBe(view);
      expect((yield* service.peek("RGRPDF24"))?.value).toBe(overlay);
    }),
);

it.effect("shares one refresh and publishes the canonical held result", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const reads = yield* Effect.promise(() => setup(stack));
    const { service, acquireRead } = reads;
    const first = yield* service.read("RGRPDF24");
    const gate = Promise.withResolvers<void>();
    const readSnapshot = acquireRead.getMockImplementation()!;
    acquireRead.mockImplementationOnce(async () => {
      await gate.promise;
      return await readSnapshot();
    });

    const overlay = yield* Effect.forkChild(service.refresh("RGRPDF24"), {
      startImmediately: true,
    });
    const view = yield* Effect.forkChild(service.refresh("RGRPDF24"), {
      startImmediately: true,
    });

    expect((yield* service.peek("RGRPDF24"))?.value).toBe(first);
    gate.resolve();

    const refreshed = yield* Fiber.join(overlay);
    expect(yield* Fiber.join(view)).toBe(refreshed);
    // One revalidation for both: it refreshes the Zotero database once.
    expect(reads.db.refresh).toHaveBeenCalledTimes(1);
    expect(batchReads(reads)).toBe(2);
    expect(refreshed).toBe(first);
    expect((yield* service.peek("RGRPDF24"))?.value).toBe(first);
  }),
);

it.effect("keeps the published collection when a refresh fails", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service, acquireRead } = yield* Effect.promise(() => setup(stack));
    const first = yield* service.read("RGRPDF24");
    acquireRead.mockRejectedValueOnce(new Error("snapshot unavailable"));

    expect(yield* service.refresh("RGRPDF24")).toBe(first);
    expect(yield* service.peek("RGRPDF24")).toMatchObject({
      value: first,
      status: "failed",
    });
  }),
);

it.effect(
  "drops the whole Zotero database partition on a refresh and names every attachment it held",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service, client, dbEvents } = yield* Effect.promise(
        () => setup(stack),
      );
      const changed: string[] = [];
      stack.defer(
        repository.listen("annotations-changed", (key) => changed.push(key)),
      );

      yield* service.read("RGRPDF24");
      yield* service.read("EPUBBKS2");
      client.$client.exec(
        "update itemAnnotations set color = '#5fb236' where itemID = 48;",
      );

      // A stale list stands until the database says it moved.
      const held = yield* service.peek("RGRPDF24");
      expect(held?.status).toBe("fresh");
      expect(colorOf(held?.value ?? null, "PUPR5FG5")).toBe("#2ea8e5");

      dbEvents.emit("changed");

      expect(changed.toSorted()).toEqual(["EPUBBKS2", "RGRPDF24"]);
      expect(colorOf(yield* service.read("RGRPDF24"), "PUPR5FG5")).toBe(
        "#5fb236",
      );
    }),
);

it.effect("answers an empty list for a key the database does not hold", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service } = yield* Effect.promise(() => setup(stack));

    expect(yield* service.read("N2SUCH24")).toEqual({
      source: DATABASE_SOURCE,
      annotations: [],
    });
  }),
);

it.effect("leaves the Zotero database exactly as it found it", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service, client, dbEvents } = yield* Effect.promise(() =>
      setup(stack),
    );
    const before = annotationRows(client);

    yield* service.read("RGRPDF24");
    dbEvents.emit("changed");
    yield* service.read("RGRPDF24");
    yield* service.read("NOSUCH24");

    expect(annotationRows(client)).toEqual(before);
  }),
);

it.effect(
  "switches to the Zotero Local API when it answers, and says which source did",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service } = yield* Effect.promise(() =>
        setup(stack, {
          children: () => annotationPage(ROUGIER_ANNOTATIONS),
        }),
      );

      const announced = nextChange(repository);
      // The first ask arms the Capability Probe and is answered meanwhile by the
      // source that is known to stand.
      const first = yield* service.read("RGRPDF24");
      const switched = yield* Effect.promise(() => announced);
      const second = yield* service.read("RGRPDF24");

      expect(first?.source).toEqual(DATABASE_SOURCE);
      expect(switched).toEqual(["RGRPDF24"]);
      expect(second?.source).toEqual({
        kind: "zotero-local-api",
        serverID: SERVER_ID,
      });
      expect(second?.annotations.map(({ key, type }) => [key, type])).toEqual(
        READING_ORDER,
      );
    }),
);

it.effect(
  "draws the same mark from either source, the object version apart",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service } = yield* Effect.promise(() =>
        setup(stack, {
          children: () => annotationPage(ROUGIER_ANNOTATIONS),
        }),
      );

      const announced = nextChange(repository);
      const fromDatabase = yield* service.read("RGRPDF24");
      yield* Effect.promise(() => announced);
      const fromLocalApi = yield* service.read("RGRPDF24");

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
    }),
);

it.effect(
  "drops the server partition on the Companion's Freshness Signal",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service, requests, serverEvents } =
        yield* Effect.promise(() =>
          setup(stack, {
            children: () => annotationPage(ROUGIER_ANNOTATIONS),
          }),
        );
      yield* Effect.promise(() => switchToLocalApi(repository));
      yield* service.read("RGRPDF24");
      const sent = requests.length;

      const announced = nextChange(repository);
      freshnessSignal(serverEvents);
      const refreshed = yield* Effect.promise(() => announced);
      yield* service.read("RGRPDF24");

      expect(refreshed).toEqual(["RGRPDF24"]);
      // One Capability Probe, then one list read: the held answer was dropped
      // rather than served again.
      expect(requests.slice(sent).map(({ url }) => url.pathname)).toEqual([
        "/api/",
        "/api/users/0/items/RGRPDF24/children",
      ]);
    }),
);

it.effect(
  "keeps the marks under the Zotero DB source when Zotero closes mid-session",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let answering = true;
      const { repository, service, serverEvents } = yield* Effect.promise(() =>
        setup(
          stack,
          {
            root: () => (answering ? rootOk() : unreachable()),
            children: () => annotationPage(ROUGIER_ANNOTATIONS),
          },
          { key: REMEMBERED_KEY },
        ),
      );
      yield* Effect.promise(() => switchToLocalApi(repository));
      const live = yield* service.read("RGRPDF24");
      yield* service.editTextField(
        "comment",
        "PUPR5FG5",
        "Visible while offline",
      );

      answering = false;
      const announced = nextChange(repository);
      freshnessSignal(serverEvents);
      const gone = yield* Effect.promise(() => announced);
      const fallback = yield* service.read("RGRPDF24");

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
      expect((yield* service.textDraftFor("comment", "PUPR5FG5"))?.text).toBe(
        "Visible while offline",
      );
      yield* service.editTextField(
        "comment",
        "PUPR5FG5",
        "Still typing offline",
      );
      expect((yield* service.textDraftFor("comment", "PUPR5FG5"))?.text).toBe(
        "Visible while offline",
      );
    }),
);

it.effect(
  "holds an acknowledged colour across API loss until the database revision covers it",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let answering = true;
      const { repository, service, client, serverEvents, dbEvents } =
        yield* Effect.promise(() =>
          writable(stack, {
            root: () => (answering ? rootOk() : unreachable()),
            write: () => writeAccepted(38),
            item: () =>
              annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666" })),
          }),
        );

      yield* service.patchColor("PUPR5FG5", "#ff6666");
      answering = false;
      const lost = nextChange(repository);
      freshnessSignal(serverEvents);
      yield* Effect.promise(() => lost);
      const held = yield* service.read("RGRPDF24");

      expect(held?.source.kind).toBe("zotero-local-api");
      expect(colorOf(held, "PUPR5FG5")).toBe("#ff6666");

      client.$client.exec(`
    update libraries set clientVersion = 38 where libraryID = 1;
    update itemAnnotations set color = '#ff6666' where itemID = 48;
    update items set clientVersion = 38 where itemID = 48;
  `);
      dbEvents.emit("changed");
      const covered = yield* service.read("RGRPDF24");

      expect(covered?.source.kind).toBe("zotero-db");
      expect(colorOf(covered, "PUPR5FG5")).toBe("#ff6666");
    }),
);

it.effect(
  "does not write from a stale API list rejected after database coverage",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let answering = true;
      const { repository, service, client, serverEvents, dbEvents, requests } =
        yield* Effect.promise(() =>
          writable(stack, {
            root: () => (answering ? rootOk() : unreachable()),
            write: () => writeAccepted(38),
            item: () =>
              annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666" })),
          }),
        );

      yield* service.patchColor("PUPR5FG5", "#ff6666");
      answering = false;
      const lost = nextChange(repository);
      freshnessSignal(serverEvents);
      yield* Effect.promise(() => lost);
      yield* service.read("RGRPDF24");
      client.$client.exec(`
    update libraries set clientVersion = 38 where libraryID = 1;
    update itemAnnotations set color = '#ff6666' where itemID = 48;
    update items set clientVersion = 38 where itemID = 48;
  `);
      dbEvents.emit("changed");
      expect((yield* service.read("RGRPDF24"))?.source.kind).toBe("zotero-db");

      answering = true;
      const restored = nextChange(repository);
      freshnessSignal(serverEvents);
      yield* Effect.promise(() => restored);
      expect((yield* service.read("RGRPDF24"))?.source.kind).toBe("zotero-db");
      const sent = requests.length;

      const outcome = yield* service.patchColor("PUPR5FG5", "#2ea8e5");

      expect(outcome).toEqual({
        kind: "failed",
        failure: { kind: "unknown-annotation" },
      });
      expect(
        requests.slice(sent).filter(({ method }) => method === "PATCH"),
      ).toEqual([]);
    }),
);

it.effect(
  "holds an acknowledged deletion until the database tombstone revision covers it",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let answering = true;
      const { repository, service, client, serverEvents, dbEvents } =
        yield* Effect.promise(() =>
          writable(stack, {
            root: () => (answering ? rootOk() : unreachable()),
            write: () => writeAccepted(39),
          }),
        );

      yield* service.deleteAnnotation("C94NJNYG");
      answering = false;
      const lost = nextChange(repository);
      freshnessSignal(serverEvents);
      yield* Effect.promise(() => lost);
      const held = yield* service.read("RGRPDF24");

      expect(held?.source.kind).toBe("zotero-local-api");
      expect(held?.annotations.map(({ key }) => key)).not.toContain("C94NJNYG");

      client.$client.exec(`
    update libraries set clientVersion = 39 where libraryID = 1;
    delete from itemAnnotations where itemID = 52;
    delete from items where itemID = 52;
  `);
      dbEvents.emit("changed");
      const covered = yield* service.read("RGRPDF24");

      expect(covered?.source.kind).toBe("zotero-db");
      expect(covered?.annotations.map(({ key }) => key)).not.toContain(
        "C94NJNYG",
      );
    }),
);

it.effect.each([null, "", "1e2"])(
  "does not invent database coverage from revision header %j",
  (header) =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let answering = true;
      const accepted = writeAccepted(5);
      if (header === null) accepted.headers.delete("Last-Modified-Version");
      else accepted.headers.set("Last-Modified-Version", header);
      const { repository, service, serverEvents } = yield* Effect.promise(() =>
        writable(stack, {
          root: () => (answering ? rootOk() : unreachable()),
          write: () => accepted,
          item: () =>
            annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666" })),
        }),
      );

      yield* service.patchColor("PUPR5FG5", "#ff6666");
      answering = false;
      const lost = nextChange(repository);
      freshnessSignal(serverEvents);
      yield* Effect.promise(() => lost);

      const held = yield* service.read("RGRPDF24");
      expect(held?.source.kind).toBe("zotero-local-api");
      expect(colorOf(held, "PUPR5FG5")).toBe("#ff6666");
    }),
);

it.effect(
  "stands the source down when a list read fails, and answers from the Zotero DB",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service } = yield* Effect.promise(() =>
        setup(stack, { children: () => unreachable() }),
      );
      yield* Effect.promise(() => switchToLocalApi(repository));

      const announced = nextChange(repository);
      const failed = yield* service.read("EPUBBKS2");
      const fallback = yield* service.read("EPUBBKS2");

      // The failed API candidate never publishes; the verified database answers.
      expect(failed?.source).toEqual(DATABASE_SOURCE);
      expect(yield* Effect.promise(() => announced)).toContain("EPUBBKS2");
      expect(fallback?.source).toEqual(DATABASE_SOURCE);
      expect(fallback?.annotations.map(({ key }) => key)).toEqual(["EPUBMRK2"]);
    }),
);

it.effect(
  "refuses an API from another database and keeps the configured database",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let serverID = SERVER_ID;
      const { repository, service, prefEvents } = yield* Effect.promise(() =>
        setup(stack, {
          root: () => rootOk({ "Zotero-Server-ID": serverID }),
          children: () =>
            annotationPage(
              serverID === SERVER_ID
                ? ROUGIER_ANNOTATIONS
                : ROUGIER_ANNOTATIONS.slice(0, 1),
              { serverID },
            ),
        }),
      );
      yield* Effect.promise(() => switchToLocalApi(repository));
      const first = yield* service.read("RGRPDF24");

      serverID = "Zzzz11119999";
      const announced = nextChange(repository);
      prefEvents.emit("resolved-changed");
      yield* Effect.promise(() => announced);
      const second = yield* service.read("RGRPDF24");

      expect(first?.annotations).toHaveLength(7);
      expect(second?.source).toEqual(DATABASE_SOURCE);
      expect(second?.annotations).toHaveLength(7);
      expect(yield* service.capabilityFor("RGRPDF24")).toEqual({
        kind: "read-only",
        reason: "server-changed",
      });
    }),
);

it.effect(
  "keeps API-only Annotations visible across a refresh of the same database",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, dbEvents } = yield* Effect.promise(() =>
        writable(stack, {
          children: () => annotationPage([...ROUGIER_ANNOTATIONS, MADE]),
        }),
      );
      expect(
        (yield* service.peek("RGRPDF24"))?.value.annotations.map(
          ({ key }) => key,
        ),
      ).toContain(MADE.key);
      dbEvents.emit("changed");
      const list = yield* service.read("RGRPDF24");
      expect(list?.source.kind).toBe("zotero-local-api");
      expect(list?.annotations.map(({ key }) => key)).toContain(MADE.key);
    }),
);

it.effect(
  "revalidates the live API list when the database announces a change",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let records = ROUGIER_ANNOTATIONS;
      const { service, dbEvents } = yield* Effect.promise(() =>
        writable(stack, {
          children: () => annotationPage(records),
        }),
      );
      records = [...ROUGIER_ANNOTATIONS, MADE];
      dbEvents.emit("changed");
      const list = yield* service.read("RGRPDF24");
      expect(list?.annotations.map(({ key }) => key)).toContain(MADE.key);
    }),
);

it.effect(
  "refreshes an uninitialized database identity before enabling its API",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, client, db, dbEvents } = yield* Effect.promise(() =>
        setup(stack, {
          root: () => rootOk(),
          children: () => annotationPage(ROUGIER_ANNOTATIONS),
        }),
      );
      client.$client.exec(
        "delete from settings where setting = 'localAPI' and key = 'serverID'",
      );
      const standalone = yield* service.read("RGRPDF24");
      expect(standalone?.source).toMatchObject({
        kind: "zotero-db",
        database: { serverID: null },
      });
      expect(yield* service.capabilityFor("RGRPDF24")).toEqual({
        kind: "read-only",
        reason: "server-changed",
      });

      client.$client.exec(
        `insert into settings (setting, key, value) values ('localAPI', 'serverID', '${SERVER_ID}')`,
      );
      db.refresh.mockImplementation(async () => dbEvents.emit("changed"));
      yield* service.refresh("RGRPDF24");
      const live = yield* service.read("RGRPDF24");

      expect(db.refresh).toHaveBeenCalled();
      expect(live?.source).toEqual({
        kind: "zotero-local-api",
        serverID: SERVER_ID,
      });
    }),
);

it.effect(
  "cancels the read in flight when the partition it fills is dropped",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const held = Promise.withResolvers<Response>();
      const inFlight = Promise.withResolvers<void>();
      let reads = 0;
      const { repository, service, serverEvents, requests } =
        yield* Effect.promise(() =>
          setup(stack, {
            children: () => {
              if (reads++ > 0) return annotationPage(ROUGIER_ANNOTATIONS);
              inFlight.resolve();
              return held.promise;
            },
          }),
        );
      yield* Effect.promise(() => switchToLocalApi(repository));

      const reading = yield* Effect.forkChild(service.read("RGRPDF24"), {
        startImmediately: true,
      });
      // The read is in flight when the transport has been handed the request it
      // will not answer.
      yield* Effect.promise(() => inFlight.promise);
      freshnessSignal(serverEvents);
      const list = yield* Fiber.join(reading);

      // The superseded read never publishes: the ask that joined it is answered by
      // the read the invalidation asked for, and the cancel leaves the Local API
      // session standing.
      expect(list?.annotations).toHaveLength(7);
      expect(list?.source.kind).toBe("zotero-local-api");
      expect(
        requests.filter(({ url }) => url.pathname.endsWith("/children")),
      ).toHaveLength(2);
    }),
);

it.effect("keeps the locks a cancelled Local API read would have read", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service, client, serverEvents, acquireRead } =
      yield* Effect.promise(() => writable(stack));
    const readSnapshot = acquireRead.getMockImplementation()!;
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    // The lock read of the next Local API list waits on its lease, and
    // reads the database as it stands once the gate opens.
    acquireRead.mockImplementationOnce(async () => {
      entered.resolve();
      await gate.promise;
      const lease = await readSnapshot();
      return {
        reads: lease.reads,
        [Symbol.asyncDispose]: async () => {
          await lease[Symbol.asyncDispose]();
          released.resolve();
        },
      };
    });

    freshnessSignal(serverEvents);
    yield* Effect.promise(() => entered.promise);
    // The partition is dropped again under the read: its query is
    // cancelled, and the read asked after it finds no lock.
    freshnessSignal(serverEvents);
    const reread = yield* service.read("RGRPDF24");
    expect(locksOf(reread).PUPR5FG5).toBeNull();

    // Zotero imports the Annotation from the PDF file, and only then does
    // the cancelled read's lease open.
    markExternal(client, "PUPR5FG5");
    gate.resolve();
    yield* Effect.promise(() => released.promise);
    // A lock read that outlived its query would keep its locks now.
    for (let turn = 0; turn < 5; turn++) yield* Effect.yieldNow;

    const held = yield* service.peek("RGRPDF24");
    expect(locksOf(held?.value ?? null).PUPR5FG5).toBeNull();
  }),
);

it.effect(
  "answers a read in flight when the repository closes, leaves the Local API session standing, and answers null after",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const inFlight = Promise.withResolvers<void>();
      let answering = true;
      const { repository, service, serverEvents, localApiService } =
        yield* Effect.promise(() =>
          setup(stack, {
            children: () => {
              if (answering) return annotationPage(ROUGIER_ANNOTATIONS);
              inFlight.resolve();
              return new Promise<Response>(() => undefined);
            },
          }),
        );
      yield* Effect.promise(() => switchToLocalApi(repository));

      answering = false;
      freshnessSignal(serverEvents);
      const reading = yield* Effect.forkChild(service.read("RGRPDF24"), {
        startImmediately: true,
      });
      yield* Effect.promise(() => inFlight.promise);
      yield* Effect.promise(() => repository[Symbol.asyncDispose]());
      const list = yield* Fiber.join(reading);

      // The close ends the Local API read with an unknown outcome, so the
      // read answers from the Zotero DB; the session it read through stands.
      expect(list?.source).toEqual(DATABASE_SOURCE);
      expect(list?.annotations.map(({ key, type }) => [key, type])).toEqual(
        READING_ORDER,
      );
      expect(yield* localApiService.demandSource).not.toBeNull();
      // A read asked after the close finds no list to hold.
      expect(yield* service.read("EPUBBKS2")).toBeNull();
    }),
);

it.effect(
  "rejects a late database read from the prior configured database",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let answering = false;
      const { service, client, acquireRead, dbEvents, prefEvents } =
        yield* Effect.promise(() =>
          setup(stack, { root: () => (answering ? rootOk() : unreachable()) }),
        );
      yield* service.read("RGRPDF24");

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
      const oldLease = Promise.withResolvers<ZoteroReadLease>();
      acquireRead.mockImplementationOnce(() => oldLease.promise);
      dbEvents.emit("changed");
      const late = yield* Effect.forkChild(service.read("RGRPDF24"), {
        startImmediately: true,
      });

      client.$client.exec(
        "update settings set value = 'Zzzz11119999' where setting = 'localAPI' and key = 'serverID'",
      );
      dbEvents.emit("changed");
      const current = yield* service.read("RGRPDF24");
      oldLease.resolve(
        yield* Effect.promise(() => leaseOver(stack, oldClient)),
      );
      yield* Fiber.join(late);

      answering = true;
      prefEvents.emit("resolved-changed");
      yield* service.probe;
      expect(current?.source).toMatchObject({
        kind: "zotero-db",
        database: { serverID: "Zzzz11119999" },
      });
      expect(yield* service.capabilityFor("RGRPDF24")).toEqual({
        kind: "read-only",
        reason: "server-changed",
      });
    }),
);

it.effect("answers the Editing Capability the Annotation Source leaves", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service, localApiService } = yield* Effect.promise(() =>
      setup(stack, {
        root: localApiDisabled,
      }),
    );

    const beforeProbe = yield* service.capabilityFor("RGRPDF24");
    yield* localApiService.probe;
    const disabled = yield* service.capabilityFor("RGRPDF24");

    expect(beforeProbe).toEqual({ kind: "read-only", reason: "probing" });
    // Reads need no key, so a session that stands asks for one only to write.
    expect(disabled).toEqual({
      kind: "read-only",
      reason: "local-api-disabled",
    });
  }),
);

it.effect(
  "asks for authorization once a session stands, and keeps reading meanwhile",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service } = yield* Effect.promise(() =>
        setup(stack, {
          children: () => annotationPage(ROUGIER_ANNOTATIONS),
        }),
      );

      yield* Effect.promise(() => switchToLocalApi(repository));
      const list = yield* service.read("RGRPDF24");

      expect(yield* service.capabilityFor("RGRPDF24")).toEqual({
        kind: "authorization-required",
      });
      expect(list?.annotations).toHaveLength(7);
    }),
);

it.effect(
  "answers the session's own capability, and announces when one moves",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service, localApiService } = yield* Effect.promise(
        () =>
          setup(stack, {
            children: () => annotationPage(ROUGIER_ANNOTATIONS),
          }),
      );
      let announced = 0;
      stack.defer(
        repository.listen("capability-changed", () => {
          announced += 1;
        }),
      );

      expect(yield* service.capability).toEqual({
        kind: "read-only",
        reason: "probing",
      });
      yield* localApiService.probe;

      // The settings row reads this one: it names no Attachment, so no library
      // Zotero refused a write to is part of it.
      expect(yield* service.capability).toEqual({
        kind: "authorization-required",
      });
      expect(announced).toBeGreaterThan(0);
    }),
);

it.effect(
  "announces the pixels a read found moved, where no write of its own said so",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let answering: readonly WireAnnotation[] = ROUGIER_ANNOTATIONS;
      const { repository, service, serverEvents } = yield* Effect.promise(() =>
        setup(stack, {
          children: () => annotationPage(answering),
        }),
      );
      const announced: Array<[string, string | null, string]> = [];
      stack.defer(
        repository.listen("excerpt-pixels-changed", (record, source) =>
          announced.push([record.key, record.color, source.kind]),
        ),
      );
      yield* Effect.promise(() => switchToLocalApi(repository));
      yield* service.read("RGRPDF24");

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
      yield* Effect.promise(() => changed);
      const refreshed = yield* service.read("RGRPDF24");

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
      yield* service.read("RGRPDF24");
      expect(announced).toEqual([
        ["TYY6Z6ZF", "#2ea8e5", "zotero-local-api"],
        ["FDRFQ7C2", "#ffd400", "zotero-local-api"],
      ]);
    }),
);

it.effect(
  "finds a source change's moved pixels with no mounted consumer to ask",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let answering: readonly WireAnnotation[] = ROUGIER_ANNOTATIONS;
      const { repository, service, serverEvents } = yield* Effect.promise(() =>
        setup(stack, {
          children: () => annotationPage(answering),
        }),
      );
      const announced: Array<[string, string | null]> = [];
      stack.defer(
        repository.listen("excerpt-pixels-changed", (record) =>
          announced.push([record.key, record.color]),
        ),
      );
      yield* Effect.promise(() => switchToLocalApi(repository));
      yield* service.read("RGRPDF24");

      // A source change that answers the same pixels says nothing: what is announced
      // is movement, not the change itself.
      const unchanged = nextChange(repository);
      freshnessSignal(serverEvents);
      yield* Effect.promise(() => unchanged);
      yield* service.read("RGRPDF24");
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
      yield* Effect.promise(() => moved);
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(announced).toEqual([["TYY6Z6ZF", "#2ea8e5"]])),
      );
    }),
);

it.effect(
  "compares a session's first read against the image this device persists",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service, client } = yield* Effect.promise(() =>
        setup(stack, undefined, {
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
        }),
      );
      const announced: string[] = [];
      stack.defer(
        repository.listen("excerpt-pixels-changed", (record) =>
          announced.push(record.key),
        ),
      );
      client.$client.exec(
        "update itemAnnotations set color = '#2ea8e5' where itemID = 55",
      );

      // The first read of the session: no list stood before it, so the image this
      // device persists for the Annotation is the baseline it is compared against.
      const list = yield* service.read("RGRPDF24");

      expect(colorOf(list, "TYY6Z6ZF")).toBe("#2ea8e5");
      expect(announced).toEqual(["TYY6Z6ZF"]);

      // The list that read published is the baseline from here on, so a second read
      // of a record already announced says nothing again.
      yield* service.read("RGRPDF24");
      expect(announced).toEqual(["TYY6Z6ZF"]);
    }),
);
