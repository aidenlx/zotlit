// The Annotation Repository's writes: commands, Pending Proposals, Write Conflicts, creates and Geometry Edits.
import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { expect, vi } from "vitest";

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
  scopedStack,
  setup,
  writable,
  zoteroLibrary,
  DATABASE_SOURCE,
  DRAFT,
  MADE,
  colorOf,
  annotationRows,
} from "./__fixtures__";

it.effect(
  "waits for the first API list before writing an Annotation already shown from the database",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const children = Promise.withResolvers<Response>();
      const requested = Promise.withResolvers<void>();
      const { service } = yield* Effect.promise(() =>
        setup(
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
        ),
      );
      yield* service.read("RGRPDF24");
      yield* service.probe;
      const reading = yield* Effect.forkChild(service.read("RGRPDF24"), {
        startImmediately: true,
      });
      yield* Effect.promise(() => requested.promise);
      const running = yield* Effect.forkChild(
        service.patchColor("PUPR5FG5", "#5fb236"),
        { startImmediately: true },
      );
      children.resolve(annotationPage(ROUGIER_ANNOTATIONS));
      yield* Fiber.join(reading);
      expect(yield* Fiber.join(running)).toEqual({ kind: "idle" });
    }),
);

// A PATCH needs its record readback; a DELETE is confirmed by its acknowledgement.
const settledDelete = { settled: { kind: "idle" }, record: undefined };

const settledColour = {
  settled: { kind: "failed", failure: { kind: "unreachable" } },
  record: expect.objectContaining({ color: "#2ea8e5", version: 11 }),
};

it.effect.each([
  { handoff: true, write: "delete", ...settledDelete },
  { handoff: true, write: "colour", ...settledColour },
  { handoff: false, write: "delete", ...settledDelete },
  { handoff: false, write: "colour", ...settledColour },
] as const)(
  "settles $write across API loss (first handoff: $handoff)",
  ({ handoff, write, settled, record: expected }) =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const children = Promise.withResolvers<Response>();
      const requested = Promise.withResolvers<void>();
      let unavailable = false;
      let loseRead = async () => {};
      const { repository, service, localApiService, localApiBridge } =
        yield* Effect.promise(() =>
          setup(
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
          ),
        );
      loseRead = async () => {
        unavailable = true;
        await localApiBridge.runPromise(
          localApiService.listAnnotations("RGRPDF24"),
        );
        await repository.read("RGRPDF24");
      };
      yield* service.read("RGRPDF24");
      yield* service.probe;
      const reading = yield* Effect.forkChild(service.read("RGRPDF24"), {
        startImmediately: true,
      });
      yield* Effect.promise(() => requested.promise);
      if (!handoff) {
        children.resolve(annotationPage(ROUGIER_ANNOTATIONS));
        yield* Fiber.join(reading);
      }
      const running = yield* Effect.forkChild(
        write === "delete"
          ? service.deleteAnnotation("PUPR5FG5")
          : service.patchColor("PUPR5FG5", "#5fb236"),
        { startImmediately: true },
      );
      children.resolve(annotationPage(ROUGIER_ANNOTATIONS));
      yield* Fiber.join(reading);
      expect(yield* Fiber.join(running)).toEqual(settled);
      const record = (yield* service.peek("RGRPDF24"))?.value.annotations.find(
        ({ key }) => key === "PUPR5FG5",
      );
      expect(record).toEqual(expected);
    }),
);

it.effect(
  "rejects a queued write when another Zotero database takes the same key",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let serverID = SERVER_ID;
      const first = Promise.withResolvers<Response>();
      const { service, prefEvents, requests } = yield* Effect.promise(() =>
        writable(stack, {
          root: () => rootOk({ "Zotero-Server-ID": serverID }),
          children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
          write: () => first.promise,
        }),
      );
      const sent = requests.length;

      const running = yield* Effect.forkChild(
        service.patchColor("PUPR5FG5", "#ff6666"),
        { startImmediately: true },
      );
      const queued = yield* Effect.forkChild(
        service.patchComment("PUPR5FG5", "wrong database"),
        { startImmediately: true },
      );
      serverID = "Zzzz11119999";
      prefEvents.emit("resolved-changed");
      yield* service.probe;
      first.resolve(writeAccepted());

      expect(yield* Fiber.join(running)).toEqual({
        kind: "failed",
        failure: { kind: "server-changed" },
      });
      expect(yield* Fiber.join(queued)).toEqual({
        kind: "failed",
        failure: { kind: "server-changed" },
      });
      expect(
        requests.slice(sent).filter(({ method }) => method === "PATCH"),
      ).toHaveLength(1);
    }),
);

it.effect(
  "draws a Pending Proposal only over the list of the Zotero database it was sent to",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let serverID = SERVER_ID;
      const first = Promise.withResolvers<Response>();
      const sending = Promise.withResolvers<void>();
      const { service, client, dbEvents } = yield* Effect.promise(() =>
        writable(stack, {
          root: () => rootOk({ "Zotero-Server-ID": serverID }),
          children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
          write: () => {
            sending.resolve();
            return first.promise;
          },
        }),
      );

      const running = yield* Effect.forkChild(
        service.patchColor("PUPR5FG5", "#ff6666"),
        { startImmediately: true },
      );
      expect(
        colorOf((yield* service.peek("RGRPDF24"))?.value ?? null, "PUPR5FG5"),
      ).toBe("#ff6666");
      yield* Effect.promise(() => sending.promise);
      // Zotero now runs on another database, which the Local API serves too.
      serverID = "Zzzz11119999";
      client.$client.exec(
        `update settings set value = '${serverID}' where setting = 'localAPI' and key = 'serverID'`,
      );
      dbEvents.emit("changed");
      yield* service.refresh("RGRPDF24");
      const other = yield* service.read("RGRPDF24");

      expect(other?.source).toEqual({ kind: "zotero-local-api", serverID });
      expect(colorOf(other, "PUPR5FG5")).toBe("#2ea8e5");
      first.resolve(writeAccepted());
      yield* Fiber.join(running);
    }),
);

// #region the write path

it.effect(
  "patches a colour with the version the last read answered, in lower case",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack),
      );
      const sent = requests.length;

      const outcome = yield* service.patchColor("PUPR5FG5", "#FF6666");

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
    }),
);

it.effect(
  "announces the pixels a saved recolour moved, off the record Zotero answered with",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, {
          item: () =>
            annotationItem(
              afterWrite("TYY6Z6ZF", { color: "#2ea8e5", version: 17 }),
            ),
        }),
      );
      const announced: Array<[string, string | null]> = [];
      stack.defer(
        repository.listen("excerpt-pixels-changed", (record) =>
          announced.push([record.key, record.color]),
        ),
      );

      yield* service.patchColor("TYY6Z6ZF", "#2EA8E5");

      expect(announced).toEqual([["TYY6Z6ZF", "#2ea8e5"]]);
    }),
);

it.effect("says nothing for a saved write that left the pixels alone", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { repository, service } = yield* Effect.promise(() =>
      writable(stack, {
        item: ({ url }) =>
          annotationItem(
            // A comment on an ink stroke, and a colour on a highlight: neither is a
            // pixel of the image ZotLit renders for this Annotation.
            url.pathname.endsWith("TYY6Z6ZF")
              ? afterWrite("TYY6Z6ZF", { comment: "Saved" })
              : afterWrite("PUPR5FG5", { color: "#5fb236" }),
          ),
      }),
    );
    const announced: string[] = [];
    stack.defer(
      repository.listen("excerpt-pixels-changed", (record) =>
        announced.push(record.key),
      ),
    );

    yield* service.patchComment("TYY6Z6ZF", "Saved");
    yield* service.patchColor("PUPR5FG5", "#5FB236");

    expect(announced).toEqual([]);
  }),
);

it.effect("announces nothing while a write is still in flight", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const reread = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const { repository, service } = yield* Effect.promise(() =>
      writable(stack, {
        item: async () => {
          reread.resolve();
          await release.promise;
          return annotationItem(afterWrite("TYY6Z6ZF", { color: "#2ea8e5" }));
        },
      }),
    );
    const announced: string[] = [];
    stack.defer(
      repository.listen("excerpt-pixels-changed", (record) =>
        announced.push(record.key),
      ),
    );

    const saved = yield* Effect.forkChild(
      service.patchColor("TYY6Z6ZF", "#2EA8E5"),
      { startImmediately: true },
    );
    // Zotero has taken the write; the record it answers with has not landed, so
    // the pixels a card paints are still the saved ones it was showing.
    yield* Effect.promise(() => reread.promise);
    expect(announced).toEqual([]);

    release.resolve();
    yield* Fiber.join(saved);
    expect(announced).toEqual(["TYY6Z6ZF"]);
  }),
);

it.effect(
  "re-reads the annotation after the 204, and writes again off that version",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, {
          item: () =>
            annotationItem(
              afterWrite("PUPR5FG5", { color: "#ff6666", version: 20 }),
            ),
        }),
      );
      const sent = requests.length;

      yield* service.patchColor("PUPR5FG5", "#ff6666");
      const list = yield* service.read("RGRPDF24");
      const reread = requests.length;
      yield* service.patchColor("PUPR5FG5", "#5fb236");

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
      expect(
        list?.annotations.find(({ key }) => key === "PUPR5FG5"),
      ).toMatchObject({ color: "#ff6666", version: 20 });
      // 5 is the library version the `204` carried; 20 is the object's, which only
      // the re-read could answer.
      expect(JSON.parse(requests[reread]!.body ?? "")).toMatchObject({
        version: 20,
      });
    }),
);

it.effect(
  "removes the card only once Zotero has answered, the version its precondition",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service, requests } = yield* Effect.promise(() =>
        writable(stack),
      );
      const sent = requests.length;

      const announced = nextChange(repository);
      const outcome = yield* service.deleteAnnotation("C94NJNYG");
      const list = yield* service.read("RGRPDF24");

      expect(outcome).toEqual({ kind: "idle" });
      expect(yield* Effect.promise(() => announced)).toEqual(["RGRPDF24"]);
      const [erase] = requests.slice(sent);
      expect([erase?.method, erase?.url.pathname]).toEqual([
        "DELETE",
        "/api/users/0/items/C94NJNYG",
      ]);
      expect(erase?.headers.get("If-Unmodified-Since-Version")).toBe("15");
      expect(erase?.body).toBeNull();
      expect(list?.annotations.map(({ key }) => key)).not.toContain("C94NJNYG");
    }),
);

it.effect("refuses a write under the Zotero DB source before any request", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service, requests, client } = yield* Effect.promise(() =>
      setup(stack),
    );
    const rows = annotationRows(client);
    const list = yield* service.read("RGRPDF24");

    const outcome = yield* service.patchColor("PUPR5FG5", "#ff6666");

    expect(list?.source).toEqual(DATABASE_SOURCE);
    expect(outcome).toEqual({ kind: "failed", failure: { kind: "db-source" } });
    expect(yield* service.mutationFor("PUPR5FG5")).toEqual(outcome);
    // Nothing but reads left ZotLit, and the database is as it was.
    expect(requests.filter(({ method }) => method !== "GET")).toEqual([]);
    expect(annotationRows(client)).toEqual(rows);
  }),
);

it.effect("refuses a write for an Annotation no list holds", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service, requests } = yield* Effect.promise(() => writable(stack));
    const sent = requests.length;

    const outcome = yield* service.patchColor("GONE2345", "#ff6666");

    expect(outcome).toEqual({
      kind: "failed",
      failure: { kind: "unknown-annotation" },
    });
    expect(requests.slice(sent)).toEqual([]);
  }),
);

it.effect("classifies each 412 body by what it says, not by its status", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service } = yield* Effect.promise(() =>
      writable(stack, {
        write: () => staleVersion(),
        item: () =>
          annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236" })),
      }),
    );

    const moved = yield* service.patchColor("PUPR5FG5", "#ff6666");
    expect(moved).toMatchObject({ kind: "conflict" });

    const swapped = yield* scopedStack;
    const other = yield* Effect.promise(() =>
      writable(swapped, { write: () => serverChanged() }),
    );
    expect(yield* other.service.patchColor("PUPR5FG5", "#ff6666")).toEqual({
      kind: "failed",
      failure: { kind: "server-changed" },
    });
    // The third body, `Write token already used`, is a create's answer alone: a
    // patch carries a version and no write token. It is replayed on the retry
    // path below.
  }),
);

it.effect(
  "shows the fresh Zotero value beside the user's input, with both verbs",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => staleVersion(),
          item: () =>
            annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236" })),
        }),
      );
      const conflicted: string[] = [];
      stack.defer(
        repository.listen("write-conflict", (annotationKey, attachmentKey) => {
          conflicted.push(`${annotationKey} on ${attachmentKey}`);
        }),
      );

      const outcome = yield* service.patchColor("PUPR5FG5", "#ff6666");

      expect(outcome).toEqual({
        kind: "conflict",
        conflict: { write: "color", attempted: "#ff6666", fresh: "#5fb236" },
      });
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual(outcome);
      expect(conflicted).toEqual(["PUPR5FG5 on RGRPDF24"]);
    }),
);

it.effect(
  "resolves silently where Zotero already holds the value the write asked for",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => staleVersion(),
          // The Annotation moved to the very colour this write asks for — another
          // client, or the same user in Zotero.
          item: () =>
            annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666" })),
        }),
      );
      const conflicted: string[] = [];
      stack.defer(
        repository.listen("write-conflict", (key) => conflicted.push(key)),
      );

      const outcome = yield* service.patchColor("PUPR5FG5", "#FF6666");

      expect(outcome).toEqual({ kind: "idle" });
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
      expect(conflicted).toEqual([]);
    }),
);

it.effect(
  "invalidates the Attachment's list on any version 412 and says so",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => staleVersion(),
          item: () =>
            annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236" })),
          // What Zotero holds now, which the drop is what makes the view read.
          children: () =>
            annotationPage([
              afterWrite("PUPR5FG5", { color: "#5fb236", version: 30 }),
            ]),
        }),
      );

      const announced = nextChange(repository);
      yield* service.patchColor("PUPR5FG5", "#ff6666");

      expect(yield* Effect.promise(() => announced)).toEqual(["RGRPDF24"]);
      expect(colorOf(yield* service.read("RGRPDF24"), "PUPR5FG5")).toBe(
        "#5fb236",
      );
    }),
);

it.effect.each([false, true])(
  "sends Apply again against the fresh version (query collected: %s)",
  (collected) =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let refuse = true;
      const { service, requests, queryClient } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => (refuse ? staleVersion() : writeAccepted()),
          item: () =>
            annotationItem(
              afterWrite("PUPR5FG5", { color: "#5fb236", version: 30 }),
            ),
        }),
      );
      yield* service.patchColor("PUPR5FG5", "#ff6666");
      if (collected) queryClient.client.removeQueries();
      refuse = false;
      const sent = requests.length;

      const outcome = yield* service.retryWrite("PUPR5FG5");

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
    }),
);

it.effect(
  "asks Delete anyway against the copy Zotero holds, and names no value",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let refuse = true;
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => (refuse ? staleVersion() : writeAccepted()),
          item: () =>
            annotationItem(
              afterWrite("C94NJNYG", {
                comment: "edited in Zotero",
                version: 30,
              }),
            ),
        }),
      );

      const conflict = yield* service.deleteAnnotation("C94NJNYG");
      expect(conflict).toEqual({
        kind: "conflict",
        conflict: { write: "delete", attempted: null, fresh: null },
      });

      refuse = false;
      const sent = requests.length;
      const outcome = yield* service.retryWrite("C94NJNYG");

      expect(outcome).toEqual({ kind: "idle" });
      const [erase] = requests.slice(sent);
      expect([
        erase?.method,
        erase?.headers.get("If-Unmodified-Since-Version"),
      ]).toEqual(["DELETE", "30"]);
    }),
);

it.effect("leaves Zotero's copy standing when the conflict is discarded", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service, requests } = yield* Effect.promise(() =>
      writable(stack, {
        write: () => staleVersion(),
        item: () =>
          annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236" })),
      }),
    );
    yield* service.patchColor("PUPR5FG5", "#ff6666");
    const sent = requests.length;

    yield* service.discardConflict("PUPR5FG5");

    expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
    expect(requests.slice(sent)).toEqual([]);
  }),
);

it.effect(
  "reads a 404 on a write as an Annotation Zotero has deleted, and drops the list",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let deletedInZotero = false;
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => notFound(),
          // Zotero stopped holding it between the read the card was drawn from and
          // the write, which is exactly what the `404` reports.
          children: () =>
            annotationPage(
              deletedInZotero
                ? ROUGIER_ANNOTATIONS.filter(({ key }) => key !== "PUPR5FG5")
                : ROUGIER_ANNOTATIONS,
            ),
        }),
      );
      deletedInZotero = true;

      const announced = nextChange(repository);
      const outcome = yield* service.deleteAnnotation("PUPR5FG5");

      expect(outcome).toEqual({
        kind: "failed",
        failure: { kind: "not-found" },
      });
      expect(yield* Effect.promise(() => announced)).toEqual(["RGRPDF24"]);
      const list = yield* service.read("RGRPDF24");
      expect(list?.annotations.map(({ key }) => key)).not.toContain("PUPR5FG5");
    }),
);

it.effect("reads a 404 on the conflict's own re-read as a deletion too", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service } = yield* Effect.promise(() =>
      writable(stack, {
        write: () => staleVersion(),
        item: () => notFound(),
      }),
    );

    const outcome = yield* service.patchColor("PUPR5FG5", "#ff6666");

    expect(outcome).toEqual({ kind: "failed", failure: { kind: "not-found" } });
  }),
);

it.effect(
  "refreshes after a lost ordinary write response without replaying it",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let reads = 0;
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => Promise.reject(new AbortError("reader closed")),
          children: () => {
            reads += 1;
            return annotationPage(ROUGIER_ANNOTATIONS);
          },
        }),
      );
      const sent = requests.length;
      const readsBefore = reads;

      const outcome = yield* service.patchComment("PUPR5FG5", "Attempted");

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
    }),
);

it.effect(
  "requires explicit authorization before any annotation mutation",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, {}, { key: undefined }),
      );
      const sent = requests.length;
      const outcomes = [
        yield* service.patchColor("PUPR5FG5", "#ff6666"),
        yield* service.patchComment("PUPR5FG5", "Worth citing"),
        yield* service.deleteAnnotation("PUPR5FG5"),
        yield* service.createAnnotation("RGRPDF24", DRAFT),
      ];
      expect(outcomes).toEqual([
        { kind: "failed", failure: { kind: "unauthorized" } },
        { kind: "failed", failure: { kind: "unauthorized" } },
        { kind: "failed", failure: { kind: "unauthorized" } },
        { kind: "failed", failure: { kind: "unauthorized" } },
      ]);
      expect(requests.slice(sent)).toEqual([]);
    }),
);

it.effect(
  "shows a write in flight as pending, and draws its Pending Proposal at once",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let answer!: (response: Response) => void;
      const inFlight = new Promise<Response>((resolve) => {
        answer = resolve;
      });
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => inFlight,
          item: () =>
            annotationItem(
              afterWrite("PUPR5FG5", { color: "#5fb236", version: 20 }),
            ),
        }),
      );
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
          announced.push(
            colorOf(repository.peek(key)?.value ?? null, "PUPR5FG5"),
          );
        }),
      );

      // Zotero stores lower case, so the proposal is drawn as Zotero will answer.
      const running = yield* Effect.forkChild(
        service.patchColor("PUPR5FG5", "#5FB236"),
        { startImmediately: true },
      );

      // The write and its proposal both stand in the task that asked for it.
      expect(announced).toEqual(["#5fb236"]);
      expect(states).toEqual(["pending"]);
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({
        kind: "pending",
        write: "color",
      });
      expect(
        colorOf((yield* service.peek("RGRPDF24"))?.value ?? null, "PUPR5FG5"),
      ).toBe("#5fb236");
      expect(colorOf(yield* service.read("RGRPDF24"), "PUPR5FG5")).toBe(
        "#5fb236",
      );
      answer(writeAccepted());
      yield* Fiber.join(running);
      expect(states).toEqual(["pending", "idle"]);
      expect(colorOf(yield* service.read("RGRPDF24"), "PUPR5FG5")).toBe(
        "#5fb236",
      );
    }),
);

it.effect(
  "stays pending from the first write to the last of a queue on one Annotation",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      const states: string[] = [];
      stack.defer(
        repository.listen("annotation-changed", (key) => {
          states.push(repository.mutationFor(key).kind);
        }),
      );
      const release = zotero.holdWrites();

      const first = yield* Effect.forkChild(
        service.patchColor("PUPR5FG5", "#ff6666"),
        { startImmediately: true },
      );
      const second = yield* Effect.forkChild(
        service.patchComment("PUPR5FG5", "Queued behind it"),
        { startImmediately: true },
      );
      release();
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      // The verbs never come back between the two writes.
      expect(states.at(-1)).toBe("idle");
      expect(states.slice(0, -1).every((kind) => kind === "pending")).toBe(
        true,
      );
      expect(zotero.at("PUPR5FG5")).toMatchObject({
        color: "#ff6666",
        comment: "Queued behind it",
      });
    }),
);

it.effect.each([
  ["conflicts", () => staleVersion()],
  ["loses its reply", () => Promise.reject(new AbortError("reader closed"))],
] as const)(
  "draws the confirmed colour again once a write that %s settles",
  ([, write]) =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, {
          write,
          // Zotero's own copy, which a conflict re-reads.
          item: () =>
            annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236" })),
        }),
      );
      const drawn: (string | null)[] = [];
      stack.defer(
        repository.listen("annotations-changed", (key) => {
          drawn.push(colorOf(repository.peek(key)?.value ?? null, "PUPR5FG5"));
        }),
      );

      const outcome = yield* service.patchColor("PUPR5FG5", "#ff6666");

      expect(outcome.kind).not.toBe("idle");
      expect(drawn[0]).toBe("#ff6666");
      expect(drawn.at(-1)).not.toBe("#ff6666");
      // The list Zotero answers still holds the Fixture's colour.
      expect(colorOf(yield* service.read("RGRPDF24"), "PUPR5FG5")).toBe(
        "#2ea8e5",
      );
    }),
);

it.effect.each([
  ["color", "#5fb236"],
  ["comment", "Confirmed words"],
] as const)(
  "retains a confirmed %s when the API is lost during the collection refresh",
  ([field, attempted]) =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let apiLost = false;
      const confirmed = afterWrite("PUPR5FG5", {
        [field]: attempted,
        version: 38,
      });
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          root: () => (apiLost ? unreachable() : rootOk()),
          write: () => writeAccepted(38),
          item: () => {
            apiLost = true;
            return annotationItem(confirmed);
          },
        }),
      );

      const outcome =
        field === "color"
          ? yield* service.patchColor("PUPR5FG5", attempted)
          : yield* service.patchComment("PUPR5FG5", attempted);

      expect(outcome).toEqual({ kind: "idle" });
      const record = (yield* service.peek("RGRPDF24"))?.value.annotations.find(
        ({ key }) => key === "PUPR5FG5",
      );
      expect(record?.[field]).toBe(attempted);
      expect((yield* service.peek("RGRPDF24"))?.value.source.kind).toBe(
        "zotero-local-api",
      );
    }),
);

it.effect(
  "does not report exact patch confirmation when the item reread fails",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => writeAccepted(20),
          item: () => unreachable(),
        }),
      );

      const outcome = yield* service.patchComment("PUPR5FG5", "Attempted");

      expect(outcome).toEqual({
        kind: "failed",
        failure: { kind: "unreachable" },
      });
      expect(
        (yield* service.peek("RGRPDF24"))?.value.annotations.find(
          ({ key }) => key === "PUPR5FG5",
        )?.comment,
      ).not.toBe("Attempted");
    }),
);

it.effect(
  "retains concurrent confirmations for two Annotations during one refresh",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const refresh = Promise.withResolvers<Response>();
      const bothConfirmed = Promise.withResolvers<void>();
      let holdRefresh = false;
      let confirmations = 0;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          children: () =>
            holdRefresh ? refresh.promise : annotationPage(ROUGIER_ANNOTATIONS),
          write: ({ url }) =>
            writeAccepted(url.pathname.endsWith("/TYY6Z6ZF") ? 39 : 38),
          item: ({ url }) => {
            const key = url.pathname.endsWith("/TYY6Z6ZF")
              ? "TYY6Z6ZF"
              : "PUPR5FG5";
            confirmations += 1;
            if (confirmations === 2) bothConfirmed.resolve();
            return annotationItem(
              afterWrite(key, {
                color: "#ff6666",
                version: key === "TYY6Z6ZF" ? 39 : 38,
              }),
            );
          },
        }),
      );
      holdRefresh = true;

      const first = yield* Effect.forkChild(
        service.patchColor("PUPR5FG5", "#ff6666"),
        { startImmediately: true },
      );
      const second = yield* Effect.forkChild(
        service.patchColor("TYY6Z6ZF", "#ff6666"),
        { startImmediately: true },
      );
      yield* Effect.promise(() => bothConfirmed.promise);
      refresh.resolve(annotationPage(ROUGIER_ANNOTATIONS));
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      expect(
        colorOf((yield* service.peek("RGRPDF24"))?.value ?? null, "PUPR5FG5"),
      ).toBe("#ff6666");
      expect(
        colorOf((yield* service.peek("RGRPDF24"))?.value ?? null, "TYY6Z6ZF"),
      ).toBe("#ff6666");
    }),
);

it.effect(
  "retains a confirmed deletion when the API is lost during refresh",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let apiLost = false;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          root: () => (apiLost ? unreachable() : rootOk()),
          write: () => {
            apiLost = true;
            return writeAccepted(38);
          },
        }),
      );

      const outcome = yield* service.deleteAnnotation("C94NJNYG");

      expect(outcome).toEqual({ kind: "idle" });
      expect(
        (yield* service.peek("RGRPDF24"))?.value.annotations.some(
          ({ key }) => key === "C94NJNYG",
        ),
      ).toBe(false);
      expect((yield* service.peek("RGRPDF24"))?.value.source.kind).toBe(
        "zotero-local-api",
      );
    }),
);

it.effect("runs a color and delete on one Annotation one at a time", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const colorAnswer = Promise.withResolvers<Response>();
    const deleteAnswer = Promise.withResolvers<Response>();
    let writes = 0;
    const { service, requests } = yield* Effect.promise(() =>
      writable(stack, {
        write: () =>
          writes++ === 0 ? colorAnswer.promise : deleteAnswer.promise,
        item: () =>
          annotationItem(
            afterWrite("PUPR5FG5", { color: "#ff6666", version: 20 }),
          ),
      }),
    );
    const sent = requests.length;

    const color = yield* Effect.forkChild(
      service.patchColor("PUPR5FG5", "#ff6666"),
      { startImmediately: true },
    );
    const deletion = yield* Effect.forkChild(
      service.deleteAnnotation("PUPR5FG5"),
      { startImmediately: true },
    );
    yield* Effect.promise(() =>
      vi.waitFor(() =>
        expect(
          requests
            .slice(sent)
            .filter(({ method }) => method === "PATCH" || method === "DELETE"),
        ).toMatchObject([{ method: "PATCH" }]),
      ),
    );

    colorAnswer.resolve(writeAccepted());
    yield* Effect.promise(() =>
      vi.waitFor(() =>
        expect(
          requests.slice(sent).filter(({ method }) => method === "DELETE"),
        ).toHaveLength(1),
      ),
    );
    deleteAnswer.resolve(writeAccepted());

    expect(yield* Fiber.join(color)).toEqual({ kind: "idle" });
    expect(yield* Fiber.join(deletion)).toEqual({ kind: "idle" });
  }),
);

it.effect("does not start a queued command after repository unload", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const first = Promise.withResolvers<Response>();
    const { repository, service, requests } = yield* Effect.promise(() =>
      writable(stack, {
        write: () => first.promise,
        item: () =>
          annotationItem(
            afterWrite("PUPR5FG5", { color: "#ff6666", version: 20 }),
          ),
      }),
    );
    const sent = requests.length;

    const color = yield* Effect.forkChild(
      service.patchColor("PUPR5FG5", "#ff6666"),
      { startImmediately: true },
    );
    const queued = yield* Effect.forkChild(
      service.patchComment("PUPR5FG5", "do not send"),
      { startImmediately: true },
    );
    yield* Effect.promise(() =>
      vi.waitFor(() =>
        expect(
          requests.slice(sent).filter(({ method }) => method === "PATCH"),
        ).toHaveLength(1),
      ),
    );
    yield* Effect.promise(() => repository[Symbol.asyncDispose]());
    first.resolve(writeAccepted());

    yield* Fiber.join(color);
    expect(yield* Fiber.join(queued)).toEqual({
      kind: "failed",
      failure: { kind: "unknown-outcome" },
    });
    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toHaveLength(1);
  }),
);

it.effect("accepts a write completion after the same database refreshes", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const reply = Promise.withResolvers<Response>();
    const sent = Promise.withResolvers<void>();
    const { service, dbEvents } = yield* Effect.promise(() =>
      writable(stack, {
        write: () => {
          sent.resolve();
          return reply.promise;
        },
        item: () =>
          annotationItem(
            afterWrite("PUPR5FG5", { color: "#5fb236", version: 20 }),
          ),
      }),
    );

    const running = yield* Effect.forkChild(
      service.patchColor("PUPR5FG5", "#5fb236"),
      { startImmediately: true },
    );
    yield* Effect.promise(() => sent.promise);
    dbEvents.emit("changed");
    reply.resolve(writeAccepted(20));

    expect(yield* Fiber.join(running)).toEqual({ kind: "idle" });
    expect(colorOf(yield* service.read("RGRPDF24"), "PUPR5FG5")).toBe(
      "#5fb236",
    );
  }),
);

it.effect.each(["patch", "create"] as const)(
  "accepts a %s when the same database refreshes during verification",
  (operation) =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const reply = Promise.withResolvers<Response>();
      const sent = Promise.withResolvers<void>();
      const verifying = Promise.withResolvers<void>();
      const lease = Promise.withResolvers<ZoteroReadLease>();
      const { service, client, acquireRead, dbEvents } = yield* Effect.promise(
        () =>
          writable(stack, {
            write: () => {
              sent.resolve();
              return reply.promise;
            },
            item: () =>
              annotationItem(
                afterWrite("PUPR5FG5", { color: "#5fb236", version: 20 }),
              ),
          }),
      );

      const running = yield* Effect.forkChild(
        operation === "patch"
          ? service.patchColor("PUPR5FG5", "#5fb236")
          : service.createAnnotation("RGRPDF24", DRAFT),
        { startImmediately: true },
      );
      yield* Effect.promise(() => sent.promise);
      dbEvents.emit("changed");
      acquireRead.mockImplementationOnce(() => {
        verifying.resolve();
        return lease.promise;
      });
      reply.resolve(
        operation === "patch" ? writeAccepted(20) : createAccepted(MADE),
      );
      yield* Effect.promise(() => verifying.promise);
      dbEvents.emit("changed");
      yield* service.read("RGRPDF24");
      lease.resolve(yield* Effect.promise(() => leaseOver(stack, client)));

      expect(yield* Fiber.join(running)).toEqual(
        operation === "patch"
          ? { kind: "idle" }
          : { kind: "created", annotationKey: "MADE2345" },
      );
    }),
);

it.effect.each([
  { operation: "patch", switched: false },
  { operation: "create", switched: false },
  { operation: "patch", switched: true },
  { operation: "create", switched: true },
])(
  "verifies the refreshed database before $operation (switched: $switched)",
  ({ operation, switched }) =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const write = vi.fn(() =>
        operation === "patch" ? writeAccepted(42) : createAccepted(MADE),
      );
      const { service, client, acquireRead, dbEvents } = yield* Effect.promise(
        () =>
          writable(stack, {
            write,
            item: () =>
              annotationItem(
                operation === "patch"
                  ? afterWrite("PUPR5FG5", { color: "#5fb236", version: 42 })
                  : MADE,
              ),
          }),
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
      const running = yield* Effect.forkChild(
        operation === "patch"
          ? service.patchColor("PUPR5FG5", "#5fb236")
          : service.createAnnotation("RGRPDF24", DRAFT),
        { startImmediately: true },
      );
      try {
        yield* Effect.promise(() => verifying.promise);
        expect(write).not.toHaveBeenCalled();
      } finally {
        resume.resolve();
      }
      expect(yield* Fiber.join(running)).toEqual(
        switched
          ? { kind: "failed", failure: { kind: "server-changed" } }
          : operation === "patch"
            ? { kind: "idle" }
            : { kind: "created", annotationKey: "MADE2345" },
      );
      expect(write).toHaveBeenCalledTimes(switched ? 0 : 1);
    }),
);

it.effect("rejects verification from an old database generation", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const reply = Promise.withResolvers<Response>();
    const sent = Promise.withResolvers<void>();
    const verification = Promise.withResolvers<void>();
    const oldLease = Promise.withResolvers<ZoteroReadLease>();
    const { service, client, acquireRead, dbEvents } = yield* Effect.promise(
      () =>
        writable(stack, {
          write: () => {
            sent.resolve();
            return reply.promise;
          },
        }),
    );
    const oldClient = createClient(":memory:");
    stack.defer(() => oldClient.$client.close());
    createFixtureSchema(oldClient.$client);
    oldClient.$client.exec(FIXTURE_ROWS);
    oldClient.$client.exec(`
    insert into version (schema, version) values ('userdata', 129), ('compatibility', 9);
    insert into libraries (libraryID, type, clientVersion) values (1, 'user', 37);
    insert into settings (setting, key, value) values ('localAPI', 'serverID', '${SERVER_ID}');
  `);

    const running = yield* Effect.forkChild(
      service.patchColor("PUPR5FG5", "#5fb236"),
      { startImmediately: true },
    );
    yield* Effect.promise(() => sent.promise);
    dbEvents.emit("changed");
    acquireRead.mockImplementationOnce(() => {
      verification.resolve();
      return oldLease.promise;
    });
    reply.resolve(writeAccepted(38));
    yield* Effect.promise(() => verification.promise);

    client.$client.exec(
      "update settings set value = 'Zzzz11119999' where setting = 'localAPI' and key = 'serverID'",
    );
    dbEvents.emit("changed");
    const current = yield* service.read("RGRPDF24");
    oldLease.resolve(yield* Effect.promise(() => leaseOver(stack, oldClient)));

    expect(yield* Fiber.join(running)).toEqual({
      kind: "failed",
      failure: { kind: "server-changed" },
    });
    expect(current?.source).toMatchObject({
      kind: "zotero-db",
      database: { serverID: "Zzzz11119999" },
    });
    expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
  }),
);

it.effect(
  "discards a late write completion after the API database changes",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let serverID = SERVER_ID;
      const reply = Promise.withResolvers<Response>();
      const sent = Promise.withResolvers<void>();
      const { service, prefEvents } = yield* Effect.promise(() =>
        writable(stack, {
          root: () => rootOk({ "Zotero-Server-ID": serverID }),
          children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
          write: () => {
            sent.resolve();
            return reply.promise;
          },
        }),
      );

      const running = yield* Effect.forkChild(
        service.patchColor("PUPR5FG5", "#5fb236"),
        { startImmediately: true },
      );
      yield* Effect.promise(() => sent.promise);
      serverID = "Zzzz11119999";
      prefEvents.emit("resolved-changed");
      yield* service.probe;
      reply.resolve(writeAccepted(20));

      expect(yield* Fiber.join(running)).toEqual({
        kind: "failed",
        failure: { kind: "server-changed" },
      });
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({
        kind: "failed",
        failure: { kind: "server-changed" },
      });
    }),
);

it.effect(
  "answers a write in flight when the repository closes with an unknown outcome",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const reply = Promise.withResolvers<Response>();
      const sending = Promise.withResolvers<void>();
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => {
            sending.resolve();
            return reply.promise;
          },
        }),
      );

      const running = yield* Effect.forkChild(
        service.patchColor("PUPR5FG5", "#ff6666"),
        { startImmediately: true },
      );
      yield* Effect.promise(() => sending.promise);
      yield* Effect.promise(() => repository[Symbol.asyncDispose]());
      reply.resolve(writeAccepted());

      // The close interrupts the write, so ZotLit cannot say whether Zotero
      // saved it.
      expect(yield* Fiber.join(running)).toEqual({
        kind: "failed",
        failure: { kind: "unknown-outcome" },
      });
    }),
);

// #endregion

// #region the create path

/** A stand-in token, so a request's own shape is what an assertion reads. */
const TOKEN = "0123456789abcdef0123456789abcdef";

it.effect(
  "retains an acknowledged create when a concurrent read loses API availability",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let loseRead = async () => {};
      let unavailable = false;
      const { repository, service, localApiService, localApiBridge } =
        yield* Effect.promise(() =>
          writable(stack, {
            children: () =>
              unavailable ? unreachable() : annotationPage(ROUGIER_ANNOTATIONS),
            write: async () => {
              await loseRead();
              return createAccepted(MADE);
            },
          }),
        );
      loseRead = async () => {
        unavailable = true;
        await localApiBridge.runPromise(
          localApiService.listAnnotations("RGRPDF24"),
        );
        await repository.read("RGRPDF24");
      };
      expect(yield* service.createAnnotation("RGRPDF24", DRAFT)).toEqual({
        kind: "created",
        annotationKey: MADE.key,
      });
      expect(
        (yield* service.peek("RGRPDF24"))?.value.annotations.map(
          (record) => record.key,
        ),
      ).toContain(MADE.key);
    }),
);

it.effect.each([false, true])(
  "retains a confirmed create across API loss (query collected: %s)",
  (collected) =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let apiLost = false;
      const { service, queryClient } = yield* Effect.promise(() =>
        writable(
          stack,
          {
            root: () => (apiLost ? unreachable() : rootOk()),
            write: () => {
              apiLost = true;
              return createAccepted(MADE);
            },
          },
          { writeToken: () => TOKEN },
        ),
      );

      if (collected) queryClient.client.removeQueries();
      const outcome = yield* service.createAnnotation("RGRPDF24", DRAFT);

      expect(outcome).toEqual({ kind: "created", annotationKey: "MADE2345" });
      expect(
        (yield* service.peek("RGRPDF24"))?.value.annotations.find(
          ({ key }) => key === "MADE2345",
        ),
      ).toMatchObject({ color: "#ffd400", text: "Identify Your Message" });
      expect((yield* service.peek("RGRPDF24"))?.value.source.kind).toBe(
        "zotero-local-api",
      );
    }),
);

it.effect.each([false, true])(
  "accepts a live list after a newer database snapshot covers an externally deleted create (API lost: %s)",
  (lost) =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let apiLost = false;
      const { repository, service, client, dbEvents, serverEvents } =
        yield* Effect.promise(() =>
          writable(stack, {
            root: () => (apiLost ? unreachable() : rootOk()),
            write: () => {
              apiLost = lost;
              return createAccepted(MADE);
            },
          }),
        );
      expect(yield* service.createAnnotation("RGRPDF24", DRAFT)).toEqual({
        kind: "created",
        annotationKey: MADE.key,
      });
      client.$client.exec(
        "update libraries set clientVersion = 43 where libraryID = 1",
      );
      dbEvents.emit("changed");
      expect((yield* service.read("RGRPDF24"))?.source.kind).toBe(
        lost ? "zotero-db" : "zotero-local-api",
      );
      apiLost = false;
      const restored = nextChange(repository);
      freshnessSignal(serverEvents);
      yield* Effect.promise(() => restored);
      expect((yield* service.read("RGRPDF24"))?.source.kind).toBe(
        "zotero-local-api",
      );
    }),
);

it.effect("publishes the created record without rereading the collection", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service, requests } = yield* Effect.promise(() =>
      writable(
        stack,
        {
          write: () => createAccepted(MADE),
          item: () => annotationItem(MADE),
          children: () => annotationPage([...ROUGIER_ANNOTATIONS, MADE]),
        },
        { writeToken: () => TOKEN },
      ),
    );
    const sent = requests.length;

    yield* service.createAnnotation("RGRPDF24", DRAFT);

    expect(
      requests
        .slice(sent)
        .map(({ method, url }) => `${method} ${url.pathname}`),
    ).toEqual([
      "POST /api/users/0/items",
      "GET /api/",
      "GET /api/users/0/items/RGRPDF24/children",
    ]);
    const list = yield* service.read("RGRPDF24");
    expect(list?.annotations.map(({ key }) => key)).toContain("MADE2345");
  }),
);

it.effect(
  "fails the create on an object Zotero refused under its own 200",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => createRefused(400, "Invalid annotationSortIndex"),
        }),
      );

      const outcome = yield* service.createAnnotation("RGRPDF24", DRAFT);

      expect(outcome).toMatchObject({
        kind: "failed",
        failure: { kind: "invalid-response" },
      });
    }),
);

it.effect(
  "refuses a create under the Zotero DB source before any request",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, requests } = yield* Effect.promise(() => setup(stack));
      // The Capability Probe runs on the first ask, so it is behind us before the
      // create is measured against "nothing was sent".
      yield* service.read("RGRPDF24");
      const sent = requests.length;

      const outcome = yield* service.createAnnotation("RGRPDF24", DRAFT);

      expect(outcome).toEqual({
        kind: "failed",
        failure: { kind: "db-source" },
      });
      expect(requests).toHaveLength(sent);
    }),
);

/**
 * The Fixture's image, 40 points wider on the right, and the Sort Index its
 * new top-left gives. The seed rect is `[48.75, 395.509, 570, 743.723]`.
 */
const WIDER_IMAGE = {
  position: { pageIndex: 1, rects: [[48.75, 395.509, 610, 743.723]] },
  sortIndex: "00001|001860|00048",
};

it.effect(
  "saves a Geometry Edit in one patch and publishes the record Zotero answers",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service, requests } = yield* Effect.promise(() =>
        writable(stack, {
          item: () =>
            annotationItem(
              afterWrite("FDRFQ7C2", { ...WIDER_IMAGE, version: 21 }),
            ),
        }),
      );
      const announced: unknown[] = [];
      stack.defer(
        repository.listen("excerpt-pixels-changed", (record) =>
          announced.push([record.key, record.position]),
        ),
      );
      const sent = requests.length;

      const outcome = yield* service.patchGeometry(
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
        annotationPosition:
          '{"pageIndex":1,"rects":[[48.75,395.509,610,743.723]]}',
        annotationSortIndex: "00001|001860|00048",
      });
      const moved = { kind: "pdf-rects", ...WIDER_IMAGE.position };
      expect(
        (yield* service.read("RGRPDF24"))?.annotations.find(
          ({ key }) => key === "FDRFQ7C2",
        )?.position,
      ).toEqual(moved);
      expect(announced).toEqual([["FDRFQ7C2", moved]]);
    }),
);

it.effect(
  "draws a Geometry Edit while it saves as Zotero will store it, and announces pixels only once it lands",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const answer = Promise.withResolvers<Response>();
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => answer.promise,
          item: () =>
            annotationItem(
              afterWrite("FDRFQ7C2", { ...WIDER_IMAGE, version: 21 }),
            ),
        }),
      );
      const drawn = service
        .peek("RGRPDF24")
        .pipe(
          Effect.map((list) =>
            list?.value.annotations.find(({ key }) => key === "FDRFQ7C2"),
          ),
        );
      const pixels: string[] = [];
      stack.defer(
        repository.listen("excerpt-pixels-changed", ({ key }) =>
          pixels.push(key),
        ),
      );

      // The reader's own edge, before Zotero's three decimals.
      const saving = yield* Effect.forkChild(
        service.patchGeometry(
          "FDRFQ7C2",
          {
            ...WIDER_IMAGE,
            position: {
              pageIndex: 1,
              rects: [[48.75, 395.509, 610.0004, 743.723]],
            },
          },
          "pointer",
        ),
        { startImmediately: true },
      );

      expect(yield* drawn).toMatchObject({
        position: { kind: "pdf-rects", ...WIDER_IMAGE.position },
        sortIndex: WIDER_IMAGE.sortIndex,
      });
      expect(pixels).toEqual([]);
      answer.resolve(writeAccepted());
      expect(yield* Fiber.join(saving)).toEqual({ kind: "idle" });
      expect(pixels).toEqual(["FDRFQ7C2"]);
    }),
);

it.effect(
  "refuses a Geometry Edit longer than Zotero accepts before the write",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack),
      );
      const sent = requests.length;

      const outcome = yield* service.patchGeometry(
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
    }),
);

it.effect(
  "puts Zotero's geometry beside the attempted Geometry Edit on a 412",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const moved = { pageIndex: 1, rects: [[60, 400, 570, 743.723]] };
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => staleVersion(),
          item: () =>
            annotationItem(
              afterWrite("FDRFQ7C2", { position: moved, version: 30 }),
            ),
        }),
      );
      const conflicted: string[] = [];
      stack.defer(
        repository.listen("write-conflict", (key) => conflicted.push(key)),
      );

      const outcome = yield* service.patchGeometry(
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
    }),
);

it.effect(
  "resolves a Geometry Edit silently where Zotero already holds that geometry",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => staleVersion(),
          item: () =>
            annotationItem(
              afterWrite("FDRFQ7C2", { ...WIDER_IMAGE, version: 30 }),
            ),
        }),
      );

      const outcome = yield* service.patchGeometry(
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
    }),
);

it.effect(
  "sends a conflicted Geometry Edit again against the version Zotero holds now",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let refuse = true;
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => (refuse ? staleVersion() : writeAccepted()),
          item: () =>
            annotationItem(
              afterWrite("FDRFQ7C2", {
                position: { pageIndex: 1, rects: [[60, 400, 570, 743.723]] },
                version: 30,
              }),
            ),
        }),
      );
      yield* service.patchGeometry("FDRFQ7C2", WIDER_IMAGE, "pointer");
      refuse = false;
      const sent = requests.length;

      yield* service.retryWrite("FDRFQ7C2");

      expect(JSON.parse(requests[sent]!.body ?? "")).toEqual({
        version: 30,
        annotationPosition:
          '{"pageIndex":1,"rects":[[48.75,395.509,610,743.723]]}',
        annotationSortIndex: "00001|001860|00048",
      });
    }),
);

it.effect(
  "refuses a position longer than Zotero accepts before the write",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack),
      );
      const sent = requests.length;

      const outcome = yield* service.createAnnotation("RGRPDF24", {
        ...DRAFT,
        position: {
          pageIndex: 0,
          rects: Array.from({ length: 4000 }, () => [
            1.111, 2.222, 3.333, 4.444,
          ]),
        },
      });

      expect(outcome).toEqual({
        kind: "failed",
        failure: { kind: "position-too-large" },
      });
      expect(requests).toHaveLength(sent);
    }),
);

/**
 * A clock the test moves itself, so the `dateAdded` window a reconciliation
 * matches inside is a value rather than the wall clock.
 *
 * @see policies/test-timing.md
 */
it.effect(
  "reports a lost create response and refreshes without replaying it",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let reads = 0;
      const { service, requests } = yield* Effect.promise(() =>
        writable(
          stack,
          {
            write: () => Promise.reject(new AbortError("reader closed")),
            children: () => {
              reads += 1;
              return annotationPage(ROUGIER_ANNOTATIONS);
            },
          },
          { writeToken: () => TOKEN },
        ),
      );
      const sent = requests.length;
      const readsBefore = reads;

      const outcome = yield* service.createAnnotation("RGRPDF24", DRAFT);

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
    }),
);

it.effect(
  "refreshes the collection after Zotero definitely rejects a create",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let reads = 0;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => new Response("no", { status: 400 }),
          children: () => {
            reads += 1;
            return annotationPage(ROUGIER_ANNOTATIONS);
          },
        }),
      );
      const readsBefore = reads;

      const outcome = yield* service.createAnnotation("RGRPDF24", DRAFT);

      expect(outcome).toEqual({
        kind: "failed",
        failure: { kind: "invalid-response", issue: "400 no" },
      });
      expect(reads).toBeGreaterThan(readsBefore);
    }),
);

// #endregion

// #endregion
