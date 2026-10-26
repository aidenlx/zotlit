// The Annotation Repository's drafts: comment, Quoted Text and tag drafts, their autosave, and how reads reconcile them.
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { expect, vi } from "vitest";

import { AbortError } from "@/lib/abort-error";
import * as m from "@/lib/i18n/generated/messages";
import {
  annotationItem,
  annotationPage,
  authorized,
  freshnessSignal,
  keyRejected,
  rootOk,
  ROUGIER_ANNOTATIONS,
  SERVER_ID,
  staleVersion,
  unreachable,
  writeAccepted,
} from "@/services/zotero-local-api/__fixtures__";
import {
  capabilityBlock,
  capabilityBlocks,
  cardControls,
  fieldEditorControls,
  editingBlockedReason,
} from "@/views/annot-view/card-controls";

import {
  afterWrite,
  NOW,
  nextChangeOf,
  REMEMBERED_KEY,
  setup,
  switchServiceToLocalApi,
  writable,
  zoteroLibrary,
  colorOf,
  collect,
  eventually,
  settledDraft,
  scopedStack,
  zoteroTagging,
  TAGGED,
} from "./__fixtures__";
import type { AnnotationList, AnnotationRepository } from "./service";

/** The first Annotation an announcement shows `hidden` or `gone`. */
const firstAnnotation = Effect.fnUntraced(function* (
  service: AnnotationRepository["Service"],
  flag: "hidden" | "gone",
) {
  const found = yield* Deferred.make<string>();
  yield* collect(service.annotationChanged, (key) =>
    service
      .annotationState(key)
      .pipe(
        Effect.andThen((state) =>
          state[flag] ? Deferred.succeed(found, key) : Effect.void,
        ),
      ),
  );
  return found;
});

it.effect(
  "names comment drafts by Zotero database as well as Annotation key",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let serverID = SERVER_ID;
      const { service, prefEvents } = yield* Effect.promise(() =>
        setup(
          stack,
          {
            root: () => rootOk({ "Zotero-Server-ID": serverID }),
            children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
          },
          { key: REMEMBERED_KEY },
        ),
      );
      yield* switchServiceToLocalApi(service);
      yield* service.read("RGRPDF24");
      yield* service.editTextField("comment", "PUPR5FG5", "First database");

      serverID = "Zzzz11119999";
      prefEvents.emit("resolved-changed");
      yield* service.probe;
      yield* service.read("RGRPDF24");
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toBeNull();

      serverID = SERVER_ID;
      prefEvents.emit("resolved-changed");
      yield* service.probe;
      yield* service.read("RGRPDF24");
      expect((yield* service.textDraftFor("comment", "PUPR5FG5"))?.text).toBe(
        "First database",
      );
    }),
);

it.effect(
  "announces a write and a draft on one Annotation through one signal",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      const seen: { mutation: string; comment: string | null }[] = [];
      yield* collect(service.annotationChanged, (key) =>
        service.annotationState(key).pipe(
          Effect.map((state) =>
            seen.push({
              mutation: state.mutation.kind,
              comment: state.textDrafts.comment?.text ?? null,
            }),
          ),
        ),
      );
      const release = zotero.holdWrites();

      const saving = yield* Effect.forkChild(
        service.patchColor("PUPR5FG5", "#ff6666"),
        { startImmediately: true },
      );
      yield* service.editTextField("comment", "PUPR5FG5", "Worth citing");
      release();
      yield* Fiber.join(saving);

      expect(seen[0]).toEqual({ mutation: "pending", comment: null });
      expect(seen).toContainEqual({
        mutation: "pending",
        comment: "Worth citing",
      });
      expect(seen.at(-1)).toEqual({
        mutation: "idle",
        comment: "Worth citing",
      });
    }),
);

it.effect(
  "announces every Annotation a complete read finds gone, with a draft or without",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.editTextField("comment", "K3JRFLFQ", "Worth citing");
      const announced: string[] = [];
      yield* collect(service.annotationChanged, (key) =>
        service
          .annotationState(key)
          .pipe(Effect.map(({ gone }) => gone && announced.push(key))),
      );

      zotero.eraseInZotero("PUPR5FG5");
      zotero.eraseInZotero("K3JRFLFQ");
      yield* service.refresh("RGRPDF24");

      // A surface re-reads the whole state on each announcement, so one may come
      // more than once.
      expect(new Set(announced)).toEqual(new Set(["K3JRFLFQ", "PUPR5FG5"]));
      expect(yield* service.annotationState("K3JRFLFQ")).toMatchObject({
        gone: true,
        textDrafts: { comment: null, text: null },
      });
      expect((yield* service.annotationState("FDRFQ7C2")).gone).toBe(false);

      zotero.restoreInZotero("PUPR5FG5");
      yield* service.refresh("RGRPDF24");
      expect((yield* service.annotationState("PUPR5FG5")).gone).toBe(false);
    }),
);

it.effect.each(["comment", "text", "tags"] as const)(
  "starts a %s draft while the database refresh is being read",
  (field) =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, acquireRead, dbEvents } = yield* Effect.promise(() =>
        writable(stack),
      );
      const resume = Promise.withResolvers<void>();
      const acquire = acquireRead.getMockImplementation()!;
      acquireRead.mockImplementation(async () => {
        await resume.promise;
        return acquire();
      });
      try {
        dbEvents.emit("changed");
        const draft =
          field === "tags"
            ? yield* service.editTags("PUPR5FG5")
            : yield* service.editTextField(field, "PUPR5FG5");
        expect(draft).not.toBeNull();
        expect((yield* service.capabilityFor("RGRPDF24")).kind).toBe(
          "writable",
        );
      } finally {
        resume.resolve();
        yield* service.read("RGRPDF24");
      }
    }),
);

it.effect(
  "edits and saves the published Annotation after its query cache is collected",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, queryClient } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => writeAccepted(42),
          item: () =>
            annotationItem(
              afterWrite("PUPR5FG5", { comment: "Recovered", version: 42 }),
            ),
        }),
      );
      queryClient.client.removeQueries();
      expect(
        (yield* service.peek("RGRPDF24"))?.value.annotations.map(
          ({ key }) => key,
        ),
      ).toContain("PUPR5FG5");
      expect(
        yield* service.editTextField("comment", "PUPR5FG5"),
      ).not.toBeNull();
      expect(yield* service.patchComment("PUPR5FG5", "Recovered")).toEqual({
        kind: "idle",
      });
    }),
);

it.effect("says a database switch hid an Annotation's drafts", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    let serverID = SERVER_ID;
    let answering = true;
    const { service, client, dbEvents, serverEvents } = yield* Effect.promise(
      () =>
        writable(stack, {
          root: () =>
            answering
              ? rootOk({ "Zotero-Server-ID": serverID })
              : unreachable(),
          children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
        }),
    );
    yield* service.editTextField("comment", "PUPR5FG5", "First database");
    yield* service.editTags("PUPR5FG5", ["figure"]);
    expect((yield* service.annotationState("PUPR5FG5")).hidden).toBe(false);

    answering = false;
    const lost = yield* nextChangeOf(service);
    freshnessSignal(serverEvents);
    yield* lost;
    serverID = "Zzzz11119999";
    client.$client.exec(
      `update settings set value = '${serverID}' where setting = 'localAPI' and key = 'serverID'`,
    );
    dbEvents.emit("changed");
    yield* service.read("RGRPDF24");

    expect(yield* service.annotationState("PUPR5FG5")).toMatchObject({
      textDrafts: { comment: null, text: null },
      tagDraft: null,
      hidden: true,
    });
  }),
);

it.effect("hides an old database draft and cancels its save schedule", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    let serverID = SERVER_ID;
    let answering = true;
    const {
      service,
      adjustLayerClock,
      client,
      dbEvents,
      prefEvents,
      requests,
      serverEvents,
    } = yield* Effect.promise(() =>
      writable(
        stack,
        {
          root: () =>
            answering
              ? rootOk({ "Zotero-Server-ID": serverID })
              : unreachable(),
          children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
        },
        { key: REMEMBERED_KEY },
      ),
    );
    yield* service.editTextField("comment", "PUPR5FG5", "First database");
    yield* adjustLayerClock("500 millis");
    const hidden = yield* firstAnnotation(service, "hidden");

    answering = false;
    const lost = yield* nextChangeOf(service);
    freshnessSignal(serverEvents);
    yield* lost;
    serverID = "Zzzz11119999";
    client.$client.exec(
      `update settings set value = '${serverID}' where setting = 'localAPI' and key = 'serverID'`,
    );
    dbEvents.emit("changed");
    yield* service.read("RGRPDF24");
    expect(yield* Deferred.await(hidden)).toBe("PUPR5FG5");

    answering = true;
    prefEvents.emit("resolved-changed");
    yield* service.probe;
    yield* service.read("RGRPDF24");
    yield* service.editTextField("comment", "PUPR5FG5", "Second database");
    const sent = requests.length;

    yield* adjustLayerClock("500 millis");
    yield* Effect.yieldNow;

    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toEqual([]);
  }),
);

it.effect("hides an offline draft after a different database is accepted", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    let answering = true;
    const { service, client, dbEvents, serverEvents } = yield* Effect.promise(
      () =>
        writable(stack, {
          root: () => (answering ? rootOk() : unreachable()),
        }),
    );
    yield* service.editTextField("comment", "PUPR5FG5", "First database");
    answering = false;
    const unavailable = yield* nextChangeOf(service);
    freshnessSignal(serverEvents);
    yield* unavailable;

    client.$client.exec(
      "update settings set value = 'Zzzz11119999' where setting = 'localAPI' and key = 'serverID'",
    );
    dbEvents.emit("changed");
    yield* service.read("RGRPDF24");

    expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toBeNull();
  }),
);

it.effect(
  "ignores a cancelled empty read when reconciling a shared draft",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const obsolete = Promise.withResolvers<Response>();
      const started = Promise.withResolvers<void>();
      let deferNext = false;
      const { service, queryClient } = yield* Effect.promise(() =>
        setup(
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
        ),
      );
      yield* switchServiceToLocalApi(service);
      yield* service.read("RGRPDF24");
      yield* service.editTextField("comment", "PUPR5FG5", "Keep this draft");

      deferNext = true;
      queryClient.invalidate([
        "annotations",
        "zotero-local-api",
        SERVER_ID,
        "RGRPDF24",
      ]);
      const reading = yield* Effect.forkChild(service.read("RGRPDF24"), {
        startImmediately: true,
      });
      yield* Effect.promise(() => started.promise);
      queryClient.invalidate([
        "annotations",
        "zotero-local-api",
        SERVER_ID,
        "RGRPDF24",
      ]);
      obsolete.resolve(annotationPage([]));

      expect((yield* Fiber.join(reading))?.annotations).toHaveLength(7);
      expect((yield* service.textDraftFor("comment", "PUPR5FG5"))?.text).toBe(
        "Keep this draft",
      );
    }),
);

it.effect(
  "autosaves after one idle second and caps a continuous editing burst",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let saved = "";
      let version = 20;
      const { service, requests, adjustLayerClock } = yield* Effect.promise(
        () =>
          writable(stack, {
            write: (request) => {
              saved = String(
                JSON.parse(request.body ?? "{}").annotationComment,
              );
              version += 1;
              return writeAccepted();
            },
            item: () =>
              annotationItem(
                afterWrite("PUPR5FG5", { comment: saved, version }),
              ),
          }),
      );
      const sent = requests.length;
      const patches = () =>
        requests
          .slice(sent)
          .filter(({ method }) => method === "PATCH")
          .map(({ body }) => JSON.parse(body ?? "{}").annotationComment);

      yield* service.editTextField("comment", "PUPR5FG5", "idle");
      yield* adjustLayerClock("999 millis");
      expect(patches()).toHaveLength(0);
      yield* adjustLayerClock("1 millis");
      yield* settledDraft(service, "comment");
      expect(patches()).toEqual(["idle"]);

      yield* service.editTextField("comment", "PUPR5FG5", "burst 0");
      for (let step = 1; step <= 11; step += 1) {
        yield* adjustLayerClock("900 millis");
        yield* service.editTextField("comment", "PUPR5FG5", `burst ${step}`);
      }
      expect(patches()).toHaveLength(1);
      yield* adjustLayerClock("100 millis");
      yield* settledDraft(service, "comment");
      expect(patches()).toEqual(["idle", "burst 11"]);

      yield* service.editTextField("comment", "PUPR5FG5", "next burst");
      yield* adjustLayerClock("1 second");
      yield* settledDraft(service, "comment");
      expect(patches()).toEqual(["idle", "burst 11", "next burst"]);
    }),
);

it.effect(
  "autosaves a Quoted Text draft on the idle and burst timers, with the text alone",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let saved = "";
      let version = 20;
      const { service, requests, adjustLayerClock } = yield* Effect.promise(
        () =>
          writable(stack, {
            write: (request) => {
              saved = String(JSON.parse(request.body ?? "{}").annotationText);
              version += 1;
              return writeAccepted();
            },
            item: () =>
              annotationItem(afterWrite("PUPR5FG5", { text: saved, version })),
          }),
      );
      const sent = requests.length;
      const patches = () =>
        requests
          .slice(sent)
          .filter(({ method }) => method === "PATCH")
          .map(({ body }) => JSON.parse(body ?? "{}"));

      yield* service.editTextField("text", "PUPR5FG5", "Identify your message");
      yield* adjustLayerClock("999 millis");
      expect(patches()).toHaveLength(0);
      yield* adjustLayerClock("1 millis");
      yield* settledDraft(service, "text");
      // The version precondition and the text: no position, no Sort Index.
      expect(patches()).toEqual([
        { version: 11, annotationText: "Identify your message" },
      ]);

      yield* service.editTextField("text", "PUPR5FG5", "burst 0");
      for (let step = 1; step <= 11; step += 1) {
        yield* adjustLayerClock("900 millis");
        yield* service.editTextField("text", "PUPR5FG5", `burst ${step}`);
      }
      expect(patches()).toHaveLength(1);
      yield* adjustLayerClock("100 millis");
      yield* settledDraft(service, "text");

      expect(patches().map(({ annotationText }) => annotationText)).toEqual([
        "Identify your message",
        "burst 11",
      ]);
      expect(
        patches().every(
          (body) =>
            Object.keys(body).sort().join() === "annotationText,version",
        ),
      ).toBe(true);
    }),
);

it.effect("saves an emptied Quoted Text draft as a clear", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service, requests } = yield* Effect.promise(() =>
      writable(stack, {
        item: () =>
          annotationItem(afterWrite("PUPR5FG5", { text: "", version: 12 })),
      }),
    );
    const sent = requests.length;

    yield* service.editTextField("text", "PUPR5FG5", "");
    yield* service.submitTextField("text", "PUPR5FG5");

    const [patch] = requests
      .slice(sent)
      .filter(({ method }) => method === "PATCH");
    expect(JSON.parse(patch!.body ?? "")).toEqual({
      version: 11,
      annotationText: "",
    });
    expect(yield* service.textDraftFor("text", "PUPR5FG5")).toBeNull();
  }),
);

it.effect(
  "serializes writes and saves only the latest input after a slow response",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let answerFirst!: (response: Response) => void;
      const first = new Promise<Response>((resolve) => {
        answerFirst = resolve;
      });
      const submitted: string[] = [];
      let writes = 0;
      let version = 20;
      const { service, adjustLayerClock } = yield* Effect.promise(() =>
        writable(stack, {
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
        }),
      );

      yield* service.editTextField("comment", "PUPR5FG5", "first");
      yield* adjustLayerClock("1000 millis");
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(submitted).toEqual(["first"])),
      );
      yield* service.editTextField("comment", "PUPR5FG5", "second");
      yield* service.editTextField("comment", "PUPR5FG5", "latest");
      yield* adjustLayerClock("10000 millis");
      expect(submitted).toEqual(["first"]);

      answerFirst(writeAccepted());
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(submitted).toEqual(["first", "latest"])),
      );
      yield* settledDraft(service, "comment");
    }),
);

it.effect(
  "queues a return to the old baseline while a newer value is saving",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const first = Promise.withResolvers<Response>();
      const submitted: string[] = [];
      let writes = 0;
      let version = 20;
      const { service, adjustLayerClock } = yield* Effect.promise(() =>
        writable(stack, {
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
        }),
      );

      yield* service.editTextField("comment", "PUPR5FG5", "temporary");
      yield* adjustLayerClock("1000 millis");
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(submitted).toEqual(["temporary"])),
      );
      yield* service.editTextField("comment", "PUPR5FG5", "");
      first.resolve(writeAccepted());

      yield* Effect.promise(() =>
        vi.waitFor(() => expect(submitted).toEqual(["temporary", ""])),
      );
      yield* settledDraft(service, "comment");
    }),
);

it.effect(
  "keeps a failed autosave for explicit editing without replaying it",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, requests, adjustLayerClock } = yield* Effect.promise(
        () =>
          writable(stack, {
            write: () => unreachable(),
          }),
      );
      const sent = requests.length;

      yield* service.editTextField("comment", "PUPR5FG5", "keep me");
      yield* adjustLayerClock("1000 millis");
      yield* eventually(
        service.textDraftFor("comment", "PUPR5FG5"),
        (draft) => draft?.state.kind === "failed",
      );
      yield* adjustLayerClock("30000 millis");
      yield* Effect.yieldNow;

      expect(
        requests.slice(sent).filter(({ method }) => method === "PATCH"),
      ).toHaveLength(1);
      expect((yield* service.textDraftFor("comment", "PUPR5FG5"))?.text).toBe(
        "keep me",
      );
    }),
);

it.effect(
  "retains a paused draft until an explicit save after authorization returns",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, localApiService, requests, adjustLayerClock } =
        yield* Effect.promise(() =>
          writable(stack, {
            authorize: () => authorized({ remember: true }),
            item: () =>
              annotationItem(
                afterWrite("PUPR5FG5", {
                  comment: "Keep these words",
                  version: 20,
                }),
              ),
          }),
        );
      yield* service.editTextField("comment", "PUPR5FG5", "Keep these words");
      yield* localApiService.forgetAuthorization;
      yield* service.editTextField("comment", "PUPR5FG5", "Blocked typing");
      expect((yield* service.textDraftFor("comment", "PUPR5FG5"))?.text).toBe(
        "Keep these words",
      );
      yield* localApiService.authorize;
      const sent = requests.length;
      yield* adjustLayerClock("30000 millis");
      yield* service.submitTextField("comment", "PUPR5FG5", {
        automatic: true,
      });
      expect(requests.slice(sent)).toEqual([]);
      const saving = yield* Effect.forkChild(
        service.submitTextField("comment", "PUPR5FG5"),
        { startImmediately: true },
      );
      // The save the user pressed is the one the editor says it waits on.
      expect(
        fieldEditorControls(
          capabilityBlock(yield* service.capabilityFor("RGRPDF24"), NOW),
          yield* service.textDraftFor("comment", "PUPR5FG5"),
          NOW,
        ).hint,
      ).toBe(m.annot_view_card_saving());
      expect(yield* Fiber.join(saving)).toEqual({ kind: "idle" });
      expect(
        requests.slice(sent).filter(({ method }) => method === "PATCH"),
      ).toHaveLength(1);
    }),
);

it.effect(
  "saves text typed during a held draft's save once that save lands",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const first = Promise.withResolvers<Response>();
      const submitted: string[] = [];
      let version = 20;
      const { service, localApiService } = yield* Effect.promise(() =>
        writable(stack, {
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
        }),
      );
      yield* service.editTextField("comment", "PUPR5FG5", "Held words");
      yield* localApiService.forgetAuthorization;
      yield* localApiService.authorize;

      const saving = yield* Effect.forkChild(
        service.submitTextField("comment", "PUPR5FG5"),
        { startImmediately: true },
      );
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(submitted).toEqual(["Held words"])),
      );
      yield* service.editTextField(
        "comment",
        "PUPR5FG5",
        "Held words, and more",
      );
      first.resolve(writeAccepted());
      expect(yield* Fiber.join(saving)).toEqual({ kind: "idle" });

      yield* Effect.promise(() =>
        vi.waitFor(() =>
          expect(submitted).toEqual(["Held words", "Held words, and more"]),
        ),
      );
      yield* settledDraft(service, "comment");
    }),
);

it.effect(
  "requires explicit recovery after a lost save response even when refresh reconnects",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, requests, adjustLayerClock } = yield* Effect.promise(
        () =>
          writable(stack, {
            write: () => unreachable(),
          }),
      );
      yield* service.editTextField(
        "comment",
        "PUPR5FG5",
        "Unconfirmed comment",
      );
      yield* service.submitTextField("comment", "PUPR5FG5");
      expect((yield* service.capabilityFor("RGRPDF24")).kind).toBe("writable");
      const sent = requests.length;
      yield* service.editTextField(
        "comment",
        "PUPR5FG5",
        "Review before retry",
      );
      yield* adjustLayerClock("30000 millis");
      yield* service.submitTextField("comment", "PUPR5FG5", {
        automatic: true,
      });
      expect(requests.slice(sent)).toEqual([]);
      expect((yield* service.textDraftFor("comment", "PUPR5FG5"))?.text).toBe(
        "Review before retry",
      );
    }),
);

it.effect("cancels a scheduled comment when deletion is confirmed", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service, requests, adjustLayerClock } = yield* Effect.promise(() =>
      writable(stack),
    );
    const sent = requests.length;
    yield* service.editTextField("comment", "PUPR5FG5", "never submit");

    yield* service.deleteAnnotation("PUPR5FG5");
    yield* adjustLayerClock("20000 millis");
    yield* Effect.yieldNow;

    expect(
      requests
        .slice(sent)
        .filter(({ method }) => method === "PATCH" || method === "DELETE"),
    ).toMatchObject([{ method: "DELETE" }]);
    expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toBeNull();
  }),
);

it.effect("discards scheduled session work when the repository unloads", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { repository, service, requests, adjustLayerClock } =
      yield* Effect.promise(() => writable(stack));
    const sent = requests.length;
    yield* service.editTextField("comment", "PUPR5FG5", "session only");

    yield* Effect.promise(() => repository[Symbol.asyncDispose]());
    yield* adjustLayerClock("20000 millis");
    yield* Effect.yieldNow;

    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toEqual([]);
  }),
);

it.effect(
  "stops an edit that comes after the repository unloads, and sends nothing",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { repository, service, requests, adjustLayerClock } =
        yield* Effect.promise(() => writable(stack));
      const sent = requests.length;
      yield* Effect.promise(() => repository[Symbol.asyncDispose]());

      const edit = yield* Effect.exit(
        service.editTextField("comment", "PUPR5FG5", "after unload"),
      );
      yield* adjustLayerClock("20000 millis");
      yield* Effect.yieldNow;

      expect(Exit.hasInterrupts(edit)).toBe(true);
      expect(
        requests.slice(sent).filter(({ method }) => method === "PATCH"),
      ).toEqual([]);
    }),
);

it.effect.each(["tags", "comment"] as const)(
  "keeps the answer of a %s save Zotero accepted before repository unload",
  (field) =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const readBack = Promise.withResolvers<Response>();
      const reading = Promise.withResolvers<void>();
      let accepted = false;
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, {
          ...zotero.answers,
          write: async (request) => {
            const answer = await zotero.answers.write(request);
            accepted = true;
            return answer;
          },
          item: () => {
            if (!accepted) return zotero.answers.item();
            reading.resolve();
            return readBack.promise;
          },
        }),
      );
      const save =
        field === "tags"
          ? service
              .editTags("PUPR5FG5")
              .pipe(
                Effect.andThen(service.editTags("PUPR5FG5", ["review", "nlp"])),
                Effect.andThen(service.submitTags("PUPR5FG5")),
              )
          : service
              .editTextField("comment", "PUPR5FG5", "Saved before unload")
              .pipe(
                Effect.andThen(service.submitTextField("comment", "PUPR5FG5")),
              );

      const saving = yield* Effect.forkChild(save, { startImmediately: true });
      yield* Effect.promise(() => reading.promise);
      yield* Effect.promise(() => repository[Symbol.asyncDispose]());
      readBack.resolve(zotero.answers.item());

      // Zotero took the save before the unload; only the read-back after it
      // stops, so the save keeps its answer.
      expect(yield* Fiber.join(saving)).toEqual({ kind: "idle" });
    }),
);

it.effect(
  "answers a comment save in flight at repository unload with an unknown outcome",
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

      const saving = yield* Effect.forkChild(
        service
          .editTextField("comment", "PUPR5FG5", "In flight at unload")
          .pipe(Effect.andThen(service.submitTextField("comment", "PUPR5FG5"))),
        { startImmediately: true },
      );
      yield* Effect.promise(() => sending.promise);
      yield* Effect.promise(() => repository[Symbol.asyncDispose]());
      reply.resolve(writeAccepted());

      // The unload interrupts the send, so ZotLit cannot say whether Zotero
      // saved it.
      expect(yield* Fiber.join(saving)).toEqual({
        kind: "failed",
        failure: { kind: "unknown-outcome" },
      });
    }),
);

it.effect(
  "shares one comment draft and preserves it across unrelated refresh changes",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let records = ROUGIER_ANNOTATIONS;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          children: () => annotationPage(records),
        }),
      );

      const started = yield* service.editTextField(
        "comment",
        "PUPR5FG5",
        "My draft",
      );
      yield* service.editTextField("comment", "PUPR5FG5");
      records = records.map((record) =>
        record.key === "PUPR5FG5"
          ? { ...record, color: "#ff6666", version: 20 }
          : record,
      );
      yield* service.refresh("RGRPDF24");

      expect(started?.serverID).toBe(SERVER_ID);
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
        baseline: "",
        text: "My draft",
        state: { kind: "editing" },
      });
      expect(colorOf(yield* service.read("RGRPDF24"), "PUPR5FG5")).toBe(
        "#ff6666",
      );
    }),
);

it.effect("requires a choice when Zotero changes a drafted comment", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    let records = ROUGIER_ANNOTATIONS;
    const { service, requests } = yield* Effect.promise(() =>
      writable(stack, {
        children: () => annotationPage(records),
      }),
    );
    yield* service.editTextField("comment", "PUPR5FG5", "My draft");
    records = records.map((record) =>
      record.key === "PUPR5FG5"
        ? { ...record, comment: "Zotero draft", version: 20 }
        : record,
    );

    yield* service.refresh("RGRPDF24");
    const sent = requests.length;

    yield* service.submitTextField("comment", "PUPR5FG5");

    expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
      baseline: "",
      text: "My draft",
      state: { kind: "conflict", fresh: "Zotero draft" },
    });
    expect(yield* service.mutationFor("PUPR5FG5")).toEqual({
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
  }),
);

it.effect(
  "requires a choice when the verified database changes a draft after API loss",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let answering = true;
      const { service, client, dbEvents, serverEvents } = yield* Effect.promise(
        () =>
          writable(stack, {
            root: () => (answering ? rootOk() : unreachable()),
          }),
      );
      yield* service.editTextField("comment", "PUPR5FG5", "My offline draft");

      answering = false;
      const lost = yield* nextChangeOf(service);
      freshnessSignal(serverEvents);
      yield* lost;
      client.$client.exec(`
    update libraries set clientVersion = 38 where libraryID = 1;
    update itemAnnotations set comment = 'Changed in Zotero' where itemID = 48;
    update items set clientVersion = 38 where itemID = 48;
  `);
      dbEvents.emit("changed");

      const list = yield* service.read("RGRPDF24");

      expect(list?.source).toMatchObject({
        kind: "zotero-db",
        database: { serverID: SERVER_ID },
        libraryRevision: 38,
      });
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
        baseline: "",
        text: "My offline draft",
        state: { kind: "conflict", fresh: "Changed in Zotero" },
      });
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({
        kind: "conflict",
        conflict: {
          write: "comment",
          attempted: "My offline draft",
          fresh: "Changed in Zotero",
        },
      });
    }),
);

it.effect(
  "applies the chosen draft against the fresh version and comment field only",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let records = ROUGIER_ANNOTATIONS;
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, {
          children: () => annotationPage(records),
          item: () =>
            annotationItem(
              afterWrite("PUPR5FG5", {
                comment: "My latest draft",
                version: 21,
              }),
            ),
        }),
      );
      yield* service.editTextField("comment", "PUPR5FG5", "My draft");
      records = records.map((record) =>
        record.key === "PUPR5FG5"
          ? { ...record, comment: "Zotero draft", version: 20 }
          : record,
      );
      yield* service.refresh("RGRPDF24");
      yield* service.editTextField("comment", "PUPR5FG5", "My latest draft");
      const sent = requests.length;

      const outcome = yield* service.retryTextDraft("comment", "PUPR5FG5");

      expect(outcome).toEqual({ kind: "idle" });
      expect(JSON.parse(requests[sent]!.body ?? "")).toEqual({
        version: 20,
        annotationComment: "My latest draft",
      });
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toBeNull();
    }),
);

it.effect("keeps newer typing when a reviewed comment retry succeeds", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    let records = ROUGIER_ANNOTATIONS;
    const accepted = Promise.withResolvers<Response>();
    const { service, requests } = yield* Effect.promise(() =>
      writable(stack, {
        children: () => annotationPage(records),
        write: () => accepted.promise,
        item: () =>
          annotationItem(
            afterWrite("PUPR5FG5", { comment: "reviewed draft", version: 21 }),
          ),
      }),
    );
    yield* service.editTextField("comment", "PUPR5FG5", "reviewed draft");
    records = records.map((record) =>
      record.key === "PUPR5FG5"
        ? { ...record, comment: "Zotero draft", version: 20 }
        : record,
    );
    yield* service.refresh("RGRPDF24");

    const sent = requests.length;
    const retrying = yield* Effect.forkChild(
      service.retryTextDraft("comment", "PUPR5FG5"),
      { startImmediately: true },
    );
    // A submit of the same text joins the retry rather than sending again.
    const duplicate = yield* Effect.forkChild(
      service.submitTextField("comment", "PUPR5FG5"),
      { startImmediately: true },
    );
    yield* service.editTextField("comment", "PUPR5FG5", "typed during retry");
    accepted.resolve(writeAccepted());
    expect(yield* Fiber.join(duplicate)).toEqual(yield* Fiber.join(retrying));

    expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
      baseline: "reviewed draft",
      text: "typed during retry",
      state: { kind: "pending" },
    });
    yield* service.submitTextField("comment", "PUPR5FG5");
    const writes = requests
      .slice(sent)
      .filter(({ method }) => method === "PATCH");
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes.at(-1)!.body ?? "")).toMatchObject({
      annotationComment: "typed during retry",
    });
  }),
);

it.effect(
  "requires another choice when the cached comment moved after review",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let records = ROUGIER_ANNOTATIONS;
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, {
          children: () => annotationPage(records),
          item: () =>
            annotationItem(
              afterWrite("PUPR5FG5", {
                color: "#ff6666",
                comment: "Newer Zotero draft",
                version: 21,
              }),
            ),
        }),
      );
      yield* service.editTextField("comment", "PUPR5FG5", "My draft");
      records = records.map((record) =>
        record.key === "PUPR5FG5"
          ? { ...record, comment: "Zotero draft", version: 20 }
          : record,
      );
      yield* service.refresh("RGRPDF24");
      yield* service.patchColor("PUPR5FG5", "#ff6666");
      const sent = requests.length;

      const outcome = yield* service.retryTextDraft("comment", "PUPR5FG5");

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
    }),
);

it.effect("keeps the reviewed choice through an unrelated version change", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    let records = ROUGIER_ANNOTATIONS;
    let writes = 0;
    const { service, requests } = yield* Effect.promise(() =>
      writable(stack, {
        children: () => annotationPage(records),
        write: () => (writes++ === 0 ? staleVersion() : writeAccepted()),
        item: () =>
          annotationItem(
            afterWrite("PUPR5FG5", {
              comment: writes === 1 ? "Zotero draft" : "My draft",
              version: writes === 1 ? 21 : 22,
            }),
          ),
      }),
    );
    yield* service.editTextField("comment", "PUPR5FG5", "My draft");
    records = records.map((record) =>
      record.key === "PUPR5FG5"
        ? { ...record, comment: "Zotero draft", version: 20 }
        : record,
    );
    yield* service.refresh("RGRPDF24");
    const sent = requests.length;

    const outcome = yield* service.retryTextDraft("comment", "PUPR5FG5");

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
  }),
);

it.effect("settles an equal remote comment without another write", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    let records = ROUGIER_ANNOTATIONS;
    const { service, requests } = yield* Effect.promise(() =>
      writable(stack, {
        children: () => annotationPage(records),
      }),
    );
    yield* service.editTextField("comment", "PUPR5FG5", "Same words");
    const sent = requests.length;
    records = records.map((record) =>
      record.key === "PUPR5FG5"
        ? { ...record, comment: "Same words", version: 20 }
        : record,
    );

    yield* service.refresh("RGRPDF24");

    expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toBeNull();
    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toEqual([]);
  }),
);

it.effect("discards a draft only when its own source confirms deletion", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    let records = ROUGIER_ANNOTATIONS;
    const { service } = yield* Effect.promise(() =>
      writable(stack, {
        children: () => annotationPage(records),
      }),
    );
    yield* service.editTextField("comment", "PUPR5FG5", "Unsaved");
    const deleted = yield* firstAnnotation(service, "gone");
    records = records.filter(({ key }) => key !== "PUPR5FG5");

    yield* service.refresh("RGRPDF24");

    expect(yield* Deferred.await(deleted)).toBe("PUPR5FG5");
    expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toBeNull();
  }),
);

it.effect(
  "discards a queued draft when the verified database confirms deletion after API loss",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      let answering = true;
      const {
        service,
        client,
        dbEvents,
        requests,
        serverEvents,
        adjustLayerClock,
      } = yield* Effect.promise(() =>
        writable(stack, {
          root: () => (answering ? rootOk() : unreachable()),
        }),
      );
      const sent = requests.length;
      yield* service.editTextField(
        "comment",
        "PUPR5FG5",
        "Never recreate this annotation",
      );
      const deleted = yield* firstAnnotation(service, "gone");

      answering = false;
      const lost = yield* nextChangeOf(service);
      freshnessSignal(serverEvents);
      yield* lost;
      client.$client.exec(`
      update libraries set clientVersion = 38 where libraryID = 1;
      delete from itemAnnotations where itemID = 48;
      delete from items where itemID = 48;
    `);
      dbEvents.emit("changed");

      const list = yield* service.read("RGRPDF24");
      expect(yield* Deferred.await(deleted)).toBe("PUPR5FG5");
      yield* adjustLayerClock("20 seconds");

      expect(list?.source).toMatchObject({
        kind: "zotero-db",
        database: { serverID: SERVER_ID },
        libraryRevision: 38,
      });
      expect(list?.annotations.map(({ key }) => key)).not.toContain("PUPR5FG5");
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toBeNull();
      expect(
        requests.slice(sent).filter(({ method }) => method === "PATCH"),
      ).toEqual([]);
    }),
);

it.effect("keeps a draft when the replacement read fails", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    let available = true;
    const { service } = yield* Effect.promise(() =>
      writable(stack, {
        children: () =>
          available ? annotationPage(ROUGIER_ANNOTATIONS) : unreachable(),
      }),
    );
    yield* service.editTextField("comment", "PUPR5FG5", "Unsaved");
    available = false;

    yield* service.refresh("RGRPDF24");

    expect((yield* service.textDraftFor("comment", "PUPR5FG5"))?.text).toBe(
      "Unsaved",
    );
  }),
);

it.effect(
  "draws a submitted comment at once, through a refresh, until Zotero confirms it",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const answer = Promise.withResolvers<Response>();
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          write: () => answer.promise,
          item: () =>
            annotationItem(
              afterWrite("PUPR5FG5", { comment: "Blurred words" }),
            ),
        }),
      );
      const commentOf = (list: AnnotationList | null) =>
        list?.annotations.find(({ key }) => key === "PUPR5FG5")?.comment ??
        null;
      const drawn: (string | null)[] = [];
      yield* collect(service.annotationsChanged, (key) =>
        service
          .peek(key)
          .pipe(
            Effect.map((list) => drawn.push(commentOf(list?.value ?? null))),
          ),
      );
      const before = commentOf(
        (yield* service.peek("RGRPDF24"))?.value ?? null,
      );

      // The editor closing on blur submits what it holds.
      yield* service.editTextField("comment", "PUPR5FG5", "Blurred words");
      const saving = yield* Effect.forkChild(
        service.submitTextField("comment", "PUPR5FG5", {
          automatic: true,
        }),
        { startImmediately: true },
      );

      expect(drawn).toEqual(["Blurred words"]);
      // A read that lands while the write is away answers the old comment, and
      // the proposal is still drawn over it.
      yield* service.refresh("RGRPDF24");
      expect(commentOf((yield* service.peek("RGRPDF24"))?.value ?? null)).toBe(
        "Blurred words",
      );
      expect(drawn).not.toContain(before);

      answer.resolve(writeAccepted());
      yield* Fiber.join(saving);
      expect(drawn).not.toContain(before);
      expect(commentOf(yield* service.read("RGRPDF24"))).toBe("Blurred words");
    }),
);

it.effect(
  "draws the newest comment asked for behind a save in flight, and sends only that one after it",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const first = Promise.withResolvers<Response>();
      const sent: string[] = [];
      // Zotero holds what the last accepted write sent, in its list as in its
      // item answer.
      const stored = () =>
        afterWrite("PUPR5FG5", { comment: sent.at(-1) ?? "" });
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          write: (request) => {
            sent.push(
              String(JSON.parse(request.body ?? "{}").annotationComment),
            );
            return sent.length === 1 ? first.promise : writeAccepted();
          },
          children: () =>
            annotationPage(
              ROUGIER_ANNOTATIONS.map((entry) =>
                entry.key === "PUPR5FG5" && sent.length > 0 ? stored() : entry,
              ),
            ),
          item: () => annotationItem(stored()),
        }),
      );
      const drawn = service
        .peek("RGRPDF24")
        .pipe(
          Effect.map(
            (held) =>
              held?.value.annotations.find(({ key }) => key === "PUPR5FG5")
                ?.comment,
          ),
        );

      yield* service.editTextField("comment", "PUPR5FG5", "first");
      const saved = yield* Effect.forkChild(
        service.submitTextField("comment", "PUPR5FG5"),
        { startImmediately: true },
      );
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(sent).toEqual(["first"])),
      );
      // Two more submits while the first is away: the later text replaces the
      // earlier one, on screen at once and in what Zotero is sent next.
      yield* service.editTextField("comment", "PUPR5FG5", "second");
      yield* Effect.forkChild(service.submitTextField("comment", "PUPR5FG5"), {
        startImmediately: true,
      });
      yield* service.editTextField("comment", "PUPR5FG5", "third");
      yield* Effect.forkChild(service.submitTextField("comment", "PUPR5FG5"), {
        startImmediately: true,
      });
      expect(yield* drawn).toBe("third");

      first.resolve(writeAccepted());
      yield* Fiber.join(saved);
      yield* settledDraft(service, "comment");
      expect(sent).toEqual(["first", "third"]);
      expect(yield* drawn).toBe("third");
    }),
);

it.effect(
  "sends a comment asked for behind a save while the window is hidden",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      // A minimised or covered window reports its document hidden.
      vi.stubGlobal("document", { visibilityState: "hidden" });
      stack.defer(() => {
        vi.unstubAllGlobals();
      });
      const first = Promise.withResolvers<Response>();
      const sent: string[] = [];
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          write: (request) => {
            sent.push(
              String(JSON.parse(request.body ?? "{}").annotationComment),
            );
            return sent.length === 1 ? first.promise : writeAccepted();
          },
        }),
      );

      yield* service.editTextField("comment", "PUPR5FG5", "first");
      yield* Effect.forkChild(service.submitTextField("comment", "PUPR5FG5"), {
        startImmediately: true,
      });
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(sent).toEqual(["first"])),
      );
      yield* service.editTextField("comment", "PUPR5FG5", "second");
      const queued = yield* Effect.forkChild(
        service.submitTextField("comment", "PUPR5FG5"),
        { startImmediately: true },
      );
      first.resolve(writeAccepted());

      expect(yield* Fiber.join(queued)).toMatchObject({ kind: "idle" });
      expect(sent).toEqual(["first", "second"]);
    }),
);

it.effect(
  "holds a comment asked for behind a save that fails, for Save comment",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const first = Promise.withResolvers<Response>();
      const sent: string[] = [];
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          write: (request) => {
            sent.push(
              String(JSON.parse(request.body ?? "{}").annotationComment),
            );
            return first.promise;
          },
        }),
      );

      yield* service.editTextField("comment", "PUPR5FG5", "first");
      const saved = yield* Effect.forkChild(
        service.submitTextField("comment", "PUPR5FG5"),
        { startImmediately: true },
      );
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(sent).toEqual(["first"])),
      );
      yield* service.editTextField("comment", "PUPR5FG5", "second");
      const queued = yield* Effect.forkChild(
        service.submitTextField("comment", "PUPR5FG5"),
        { startImmediately: true },
      );

      first.reject(new AbortError("reader closed"));
      yield* Fiber.join(saved);
      yield* Fiber.join(queued);

      // The failure holds the draft with its newest text, and nothing more goes
      // to Zotero until the researcher saves again.
      expect(sent).toEqual(["first"]);
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
        text: "second",
        manualSave: true,
        state: { kind: "failed" },
      });
    }),
);

it.effect("drops a comment draft holding what Zotero already has", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service, requests } = yield* Effect.promise(() => writable(stack));
    const sent = requests.length;

    // Opening the editor starts a draft before any typing. Closing it asks for
    // the submit, and an untouched draft leaves nothing behind for a card to
    // announce as unsaved.
    expect(yield* service.editTextField("comment", "PUPR5FG5")).not.toBeNull();
    yield* service.submitTextField("comment", "PUPR5FG5", { automatic: true });
    expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toBeNull();

    // Typing and undoing it back to Zotero's own text says the same thing.
    yield* service.editTextField("comment", "PUPR5FG5", "Second thoughts");
    yield* service.editTextField("comment", "PUPR5FG5", "");
    yield* service.submitTextField("comment", "PUPR5FG5", { automatic: true });
    expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toBeNull();

    // Neither close wrote to Zotero.
    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toHaveLength(0);
  }),
);

it.effect("draws nothing while an automatic comment save is in flight", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const answer = Promise.withResolvers<Response>();
    let saved = "";
    const { service, repository, adjustLayerClock } = yield* Effect.promise(
      () =>
        writable(stack, {
          write: (request) => {
            saved = String(JSON.parse(request.body ?? "{}").annotationComment);
            return answer.promise;
          },
          item: () =>
            annotationItem(
              afterWrite("PUPR5FG5", { comment: saved, version: 21 }),
            ),
        }),
    );
    // What the card and the Mark Popup draw from this Annotation's state.
    const drawn = () => {
      const capability = repository.capabilityFor("RGRPDF24");
      const mutation = repository.mutationFor("PUPR5FG5");
      const editor = fieldEditorControls(
        capabilityBlock(capability, NOW),
        repository.textDraftFor("comment", "PUPR5FG5"),
        NOW,
      );
      return {
        verbs: cardControls({
          blocks: capabilityBlocks(capability, NOW),
          mutation,
          hasTags: false,
          type: "highlight",
        }),
        blocked: editingBlockedReason(capability, mutation, NOW),
        hint: editor.hint,
        saveDisabled: editor.saveDisabled,
      };
    };
    yield* service.editTextField("comment", "PUPR5FG5", "typed");
    const resting = drawn();
    const frames: unknown[] = [];
    yield* collect(service.annotationChanged, () =>
      Effect.sync(() => frames.push(drawn())),
    );

    yield* adjustLayerClock("1 second");
    // The idle timer's save runs on to the fake Zotero: wait until it is away.
    yield* Effect.promise(() => vi.waitFor(() => expect(saved).toBe("typed")));
    frames.push(drawn());
    answer.resolve(writeAccepted());
    yield* settledDraft(service, "comment");

    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) expect(frame).toEqual(resting);
  }),
);

// #region tag editing sessions

it.effect(
  "draws a tag session's merged tags while it saves, and a tag undo's too",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      const drawn = service
        .peek("RGRPDF24")
        .pipe(
          Effect.map(
            (list) =>
              list?.value.annotations.find(({ key }) => key === "PUPR5FG5")
                ?.tags,
          ),
        );

      let release = zotero.holdWrites();
      yield* service.editTags("PUPR5FG5", ["review", "todo", "figure"]);
      const saving = yield* Effect.forkChild(service.submitTags("PUPR5FG5"), {
        startImmediately: true,
      });
      expect(yield* drawn).toEqual(["review", "todo", "figure"]);
      release();
      yield* Fiber.join(saving);
      expect(yield* drawn).toEqual(["review", "todo", "figure"]);

      release = zotero.holdWrites();
      const undoing = yield* Effect.forkChild(service.undo("RGRPDF24"), {
        startImmediately: true,
      });
      // The undo puts the automatic tag back after the kept ones, as it merges.
      expect(yield* drawn).toEqual(["review", "todo", "nlp"]);
      release();
      expect(yield* Fiber.join(undoing)).toMatchObject({ kind: "stepped" });
      expect(zotero.tags).toEqual(["review", "todo", { tag: "nlp", type: 1 }]);
    }),
);

it.effect(
  "saves one tag session as one PATCH of the whole list, with the precondition",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );

      yield* service.editTags("PUPR5FG5");
      yield* service.editTags("PUPR5FG5", [
        "review",
        "nlp",
        "todo",
        "Smith, J.",
      ]);
      yield* service.editTags("PUPR5FG5", ["review", "nlp", "Smith, J."]);
      yield* service.editTags("PUPR5FG5", [
        "review",
        "nlp",
        "Smith, J.",
        "figure",
      ]);
      expect(zotero.patches).toEqual([]);

      expect(yield* service.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });

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
      expect(yield* service.tagDraftFor("PUPR5FG5")).toBeNull();
      const record = (yield* service.peek("RGRPDF24"))?.value.annotations.find(
        ({ key }) => key === "PUPR5FG5",
      );
      expect(record?.tagDetails).toEqual([
        { name: "review", type: 0 },
        { name: "nlp", type: 1 },
        { name: "Smith, J.", type: 0 },
        { name: "figure", type: 0 },
      ]);
    }),
);

it.effect("removes an automatic tag, as Zotero lets the user do", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );

    yield* service.editTags("PUPR5FG5", ["review", "todo"]);
    yield* service.submitTags("PUPR5FG5");

    expect(zotero.tags).toEqual(["review", "todo"]);
  }),
);

it.effect("ends a session that changed nothing with no write", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );

    yield* service.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
    yield* service.editTags("PUPR5FG5", ["review", "nlp", "todo"]);

    expect(yield* service.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
    expect(zotero.patches).toEqual([]);
    expect(yield* service.tagDraftFor("PUPR5FG5")).toBeNull();
  }),
);

it.effect(
  "merges tags Zotero added and removed during the session, not overwriting them",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );

      yield* service.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
      zotero.changeInZotero({
        tags: ["review", { tag: "nlp", type: 1 }, "from Zotero"],
      });
      yield* service.refresh("RGRPDF24");

      yield* service.submitTags("PUPR5FG5");

      // `from Zotero` stays, and `todo`, which Zotero removed, does not come back.
      expect(zotero.tags).toEqual([
        "review",
        { tag: "nlp", type: 1 },
        "from Zotero",
        "figure",
      ]);
    }),
);

it.effect(
  "re-reads after a 412 and applies the same names again, with no Write Conflict",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      let conflicts = 0;
      yield* collect(service.writeConflicts, () =>
        Effect.sync(() => (conflicts += 1)),
      );

      yield* service.editTags("PUPR5FG5", ["review", "nlp", "figure"]);
      // Zotero moves under the session, and ZotLit has not read it yet.
      zotero.changeInZotero({ tags: [...TAGGED, "from Zotero"] });

      expect(yield* service.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });

      expect(zotero.patches.map(({ version }) => version)).toEqual([11, 12]);
      expect(zotero.tags).toEqual([
        "review",
        { tag: "nlp", type: 1 },
        "from Zotero",
        "figure",
      ]);
      expect(conflicts).toBe(0);
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
      expect(yield* service.tagDraftFor("PUPR5FG5")).toBeNull();
    }),
);

it.effect(
  "shares one tag draft and preserves it across unrelated refresh changes",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      const announced: string[] = [];
      yield* collect(service.annotationChanged, (key) =>
        Effect.sync(() => announced.push(key)),
      );

      // The Mark Popup starts the session; the card opens onto the same draft.
      yield* service.editTags("PUPR5FG5", ["review", "figure"]);
      expect(yield* service.editTags("PUPR5FG5")).toMatchObject({
        names: ["review", "figure"],
      });
      zotero.changeInZotero({ color: "#ff6666" });
      yield* service.refresh("RGRPDF24");

      expect(yield* service.tagDraftFor("PUPR5FG5")).toMatchObject({
        serverID: SERVER_ID,
        baseline: ["review", "nlp", "todo"],
        names: ["review", "figure"],
        state: { kind: "editing" },
      });
      expect(announced).toContain("PUPR5FG5");
      expect(colorOf(yield* service.read("RGRPDF24"), "PUPR5FG5")).toBe(
        "#ff6666",
      );
    }),
);

it.effect(
  "saves, conflicts, and discards a comment draft and a tag draft on one Annotation apart",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service, adjustLayerClock } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      let conflicts = 0;
      yield* collect(service.writeConflicts, () =>
        Effect.sync(() => (conflicts += 1)),
      );

      // Both editors are open on one Annotation; the tag session ends first.
      yield* service.editTextField("comment", "PUPR5FG5", "Worth citing");
      yield* service.editTags("PUPR5FG5", ["review", "figure"]);
      yield* service.submitTags("PUPR5FG5");

      expect(zotero.tags).toEqual(["review", "figure"]);
      expect(zotero.comment).toBeUndefined();
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
        text: "Worth citing",
        state: { kind: "editing" },
      });

      // The comment's idle save lands under an open tag session.
      yield* service.editTags("PUPR5FG5", ["review", "figure", "todo"]);
      yield* adjustLayerClock("1 second");
      yield* settledDraft(service, "comment");

      expect(zotero.comment).toBe("Worth citing");
      expect(zotero.tags).toEqual(["review", "figure"]);
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toBeNull();
      expect(yield* service.tagDraftFor("PUPR5FG5")).toMatchObject({
        baseline: ["review", "figure"],
        names: ["review", "figure", "todo"],
        state: { kind: "editing" },
      });

      // Zotero moves the comment under typed text: only the comment conflicts,
      // and the tag session still saves.
      yield* service.editTextField("comment", "PUPR5FG5", "Worth citing twice");
      zotero.changeInZotero({ comment: "From Zotero" });
      yield* service.refresh("RGRPDF24");
      expect(conflicts).toBe(1);
      yield* service.submitTags("PUPR5FG5");

      expect(zotero.tags).toEqual(["review", "figure", "todo"]);
      expect(zotero.comment).toBe("From Zotero");
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
        text: "Worth citing twice",
        state: { kind: "conflict", fresh: "From Zotero" },
      });
      // The card still offers Apply again and Discard for the comment.
      expect((yield* service.annotationState("PUPR5FG5")).mutation).toEqual({
        kind: "conflict",
        conflict: {
          write: "comment",
          attempted: "Worth citing twice",
          fresh: "From Zotero",
        },
      });

      // Discarding one field's draft leaves the other's.
      yield* service.editTags("PUPR5FG5", ["review"]);
      yield* service.discardTagDraft("PUPR5FG5");
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
        text: "Worth citing twice",
      });
      yield* service.editTags("PUPR5FG5", ["review"]);
      yield* service.discardTextDraft("comment", "PUPR5FG5");
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toBeNull();
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
      expect(yield* service.tagDraftFor("PUPR5FG5")).toMatchObject({
        names: ["review"],
      });
      expect(zotero.comment).toBe("From Zotero");
      expect(zotero.tags).toEqual(["review", "figure", "todo"]);
    }),
);

it.effect(
  "requires a choice when Zotero changes a drafted Quoted Text, and ends it by Apply again or Discard",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      let conflicts = 0;
      yield* collect(service.writeConflicts, () =>
        Effect.sync(() => (conflicts += 1)),
      );
      const patches = (from: number) =>
        requests.slice(from).filter(({ method }) => method === "PATCH");

      // A Geometry Edit in Zotero's reader rewrites the text under typed text.
      yield* service.editTextField("text", "PUPR5FG5", "My correction");
      zotero.changeInZotero({ text: "Text of the new range" });
      let sent = requests.length;
      yield* service.refresh("RGRPDF24");

      expect(conflicts).toBe(1);
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({
        kind: "conflict",
        conflict: {
          write: "text",
          attempted: "My correction",
          fresh: "Text of the new range",
        },
      });
      // The conflict holds the draft: a submit sends nothing.
      yield* service.submitTextField("text", "PUPR5FG5");
      expect(patches(sent)).toEqual([]);

      // Apply again sends the text alone against the version Zotero holds now.
      yield* service.retryTextDraft("text", "PUPR5FG5");
      expect(patches(sent).map(({ body }) => JSON.parse(body ?? ""))).toEqual([
        { version: 12, annotationText: "My correction" },
      ]);
      expect(zotero.text).toBe("My correction");
      expect(yield* service.textDraftFor("text", "PUPR5FG5")).toBeNull();
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });

      // Discard keeps Zotero's text and sends nothing.
      yield* service.editTextField("text", "PUPR5FG5", "Another correction");
      zotero.changeInZotero({ text: "Edited in Zotero's sidebar" });
      yield* service.refresh("RGRPDF24");
      expect(conflicts).toBe(2);
      sent = requests.length;
      yield* service.discardTextDraft("text", "PUPR5FG5");

      expect(patches(sent)).toEqual([]);
      expect(zotero.text).toBe("Edited in Zotero's sidebar");
      expect(yield* service.textDraftFor("text", "PUPR5FG5")).toBeNull();
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
    }),
);

it.effect(
  "draws a pending Text Edit as its Pending Proposal, and the confirmed text again once Zotero refuses it",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      const drawn = service
        .peek("RGRPDF24")
        .pipe(
          Effect.map(
            (list) =>
              list?.value.annotations.find(({ key }) => key === "PUPR5FG5")
                ?.text,
          ),
        );
      const confirmed = yield* drawn;

      const release = zotero.holdWrites();
      yield* service.editTextField("text", "PUPR5FG5", "Fixed ligature");
      const saving = yield* Effect.forkChild(
        service.submitTextField("text", "PUPR5FG5"),
        { startImmediately: true },
      );
      expect(yield* drawn).toBe("Fixed ligature");

      // Zotero's sidebar moves the text while the write waits, so Zotero refuses
      // it against the version it was stamped with.
      zotero.changeInZotero({ text: "Edited in Zotero" });
      release();
      expect(yield* Fiber.join(saving)).toMatchObject({
        kind: "conflict",
        conflict: { write: "text" },
      });
      // The refused proposal leaves the list. The API readback now supplies
      // the confirmed text to both the card and the conflict.
      expect(confirmed).toBe("Identify Your Message");
      expect(yield* drawn).toBe("Edited in Zotero");
    }),
);

it.effect(
  "settles a Quoted Text draft that Zotero already holds with no conflict",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      let conflicts = 0;
      yield* collect(service.writeConflicts, () =>
        Effect.sync(() => (conflicts += 1)),
      );
      yield* service.editTextField("text", "PUPR5FG5", "Same words");
      zotero.changeInZotero({ text: "Same words" });
      const sent = requests.length;

      yield* service.refresh("RGRPDF24");
      yield* service.submitTextField("text", "PUPR5FG5");

      expect(conflicts).toBe(0);
      expect(yield* service.textDraftFor("text", "PUPR5FG5")).toBeNull();
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
      expect(
        requests.slice(sent).filter(({ method }) => method === "PATCH"),
      ).toEqual([]);
    }),
);

it.effect(
  "saves and conflicts a comment draft and a Quoted Text draft on one Annotation apart",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      const commentConflict = {
        kind: "conflict",
        conflict: {
          write: "comment",
          attempted: "Worth citing",
          fresh: "From Zotero",
        },
      };

      // A text save leaves the comment draft unsent.
      yield* service.editTextField("comment", "PUPR5FG5", "Worth citing");
      yield* service.editTextField("text", "PUPR5FG5", "Fixed ligature");
      yield* service.submitTextField("text", "PUPR5FG5");

      expect(zotero.text).toBe("Fixed ligature");
      expect(zotero.comment).toBeUndefined();
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
        text: "Worth citing",
        state: { kind: "editing" },
      });

      // Zotero moves the comment: only the comment conflicts, and a text save
      // still lands beside the conflict and leaves it standing.
      zotero.changeInZotero({ comment: "From Zotero" });
      yield* service.refresh("RGRPDF24");
      yield* service.editTextField("text", "PUPR5FG5", "Fixed ligature twice");
      yield* service.submitTextField("text", "PUPR5FG5");

      expect(zotero.text).toBe("Fixed ligature twice");
      expect(yield* service.textDraftFor("text", "PUPR5FG5")).toBeNull();
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual(commentConflict);

      // Zotero moves the text too: both conflicts stand, and ending the text's
      // leaves the comment's for the card to offer next.
      yield* service.editTextField("text", "PUPR5FG5", "Third fix");
      zotero.changeInZotero({ text: "Changed range" });
      yield* service.refresh("RGRPDF24");
      expect(yield* service.textDraftFor("text", "PUPR5FG5")).toMatchObject({
        state: { kind: "conflict", fresh: "Changed range" },
      });
      yield* service.discardTextDraft("text", "PUPR5FG5");

      expect(yield* service.mutationFor("PUPR5FG5")).toEqual(commentConflict);
      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
        text: "Worth citing",
        state: { kind: "conflict", fresh: "From Zotero" },
      });

      yield* service.retryTextDraft("comment", "PUPR5FG5");
      expect(zotero.comment).toBe("Worth citing");
      expect(zotero.text).toBe("Changed range");
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
    }),
);

it.effect(
  "keeps the verbs live and the draft saving until the read-back lands",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      const release = zotero.holdWrites();

      yield* service.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
      const saved = yield* Effect.forkChild(service.submitTags("PUPR5FG5"), {
        startImmediately: true,
      });
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(zotero.patches).toHaveLength(1)),
      );

      expect((yield* service.tagDraftFor("PUPR5FG5"))?.state).toEqual({
        kind: "pending",
      });
      // The draft is saving, so a change meanwhile is not taken.
      yield* service.editTags("PUPR5FG5", ["review"]);
      expect((yield* service.tagDraftFor("PUPR5FG5"))?.names).toEqual([
        "review",
        "nlp",
        "todo",
        "figure",
      ]);
      const mutation = yield* service.mutationFor("PUPR5FG5");
      expect(mutation).toEqual({
        kind: "pending",
        write: "tags",
        session: true,
      });
      const verbs = cardControls({
        blocks: capabilityBlocks(yield* service.capabilityFor("RGRPDF24"), NOW),
        mutation,
        hasTags: true,
        type: "highlight",
      });
      expect([verbs.color, verbs.comment, verbs.delete]).toMatchObject([
        { disabled: false },
        { disabled: false },
        { disabled: false },
      ]);

      // The draft leaves only once the confirmed record stands, so the editor
      // closes onto the new chips rather than the old ones.
      let tagsWhenClosed: readonly string[] | undefined;
      yield* collect(service.annotationChanged, () =>
        Effect.gen(function* () {
          if (yield* service.tagDraftFor("PUPR5FG5")) return;
          tagsWhenClosed = (yield* service.peek(
            "RGRPDF24",
          ))?.value.annotations.find(({ key }) => key === "PUPR5FG5")?.tags;
        }),
      );
      release();
      yield* Fiber.join(saved);
      expect(tagsWhenClosed).toEqual(["review", "nlp", "todo", "figure"]);
    }),
);

it.effect("hides an old database's tag draft when the database switches", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    let serverID = SERVER_ID;
    let answering = true;
    const { service, client, dbEvents, serverEvents } = yield* Effect.promise(
      () =>
        writable(
          stack,
          {
            root: () =>
              answering
                ? rootOk({ "Zotero-Server-ID": serverID })
                : unreachable(),
            children: () => annotationPage(ROUGIER_ANNOTATIONS, { serverID }),
          },
          { key: REMEMBERED_KEY },
        ),
    );
    yield* service.editTags("PUPR5FG5", ["figure"]);
    const hidden = yield* firstAnnotation(service, "hidden");

    // With the Local API gone, the draft is found by the database it was made
    // in, so the switch itself must hide it.
    answering = false;
    const lost = yield* nextChangeOf(service);
    freshnessSignal(serverEvents);
    yield* lost;
    serverID = "Zzzz11119999";
    client.$client.exec(
      `update settings set value = '${serverID}' where setting = 'localAPI' and key = 'serverID'`,
    );
    dbEvents.emit("changed");
    yield* service.read("RGRPDF24");

    expect(yield* Deferred.await(hidden)).toBe("PUPR5FG5");
    expect(yield* service.tagDraftFor("PUPR5FG5")).toBeNull();
  }),
);

it.effect(
  "holds a tag draft when editing becomes unavailable, until Save tags after it returns",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service, localApiService } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );

      yield* service.editTags("PUPR5FG5", ["review", "nlp", "todo"]);
      yield* localApiService.forgetAuthorization;
      expect((yield* service.tagDraftFor("PUPR5FG5"))?.manualSave).toBe(true);
      // The editor closes as editing goes, and adds the text still typed first.
      yield* service.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
      expect(
        yield* service.submitTags("PUPR5FG5", { automatic: true }),
      ).toEqual({
        kind: "idle",
      });
      expect(yield* service.tagDraftFor("PUPR5FG5")).toMatchObject({
        names: ["review", "nlp", "todo", "figure"],
        held: true,
        state: { kind: "editing" },
      });
      // No new session starts while editing is unavailable.
      expect(yield* service.editTags("FDRFQ7C2")).toBeNull();

      // Approval alone saves nothing, and neither does another close.
      yield* localApiService.authorize;
      yield* service.submitTags("PUPR5FG5", { automatic: true });
      expect(zotero.patches).toEqual([]);

      expect(yield* service.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
      expect(zotero.patches).toHaveLength(1);
      expect(yield* service.tagDraftFor("PUPR5FG5")).toBeNull();
    }),
);

it.effect("holds a refused tag save with its reason until Save tags", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
    let refuse = true;
    const { service, localApiService } = yield* Effect.promise(() =>
      writable(stack, {
        ...zotero.answers,
        write: (request) =>
          refuse ? keyRejected() : zotero.answers.write(request),
      }),
    );

    yield* service.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
    expect(yield* service.submitTags("PUPR5FG5")).toEqual({
      kind: "failed",
      failure: { kind: "unauthorized" },
    });
    expect(yield* service.tagDraftFor("PUPR5FG5")).toMatchObject({
      names: ["review", "nlp", "todo", "figure"],
      manualSave: true,
      held: true,
      state: { kind: "failed", failure: { kind: "unauthorized" } },
    });

    refuse = false;
    yield* localApiService.authorize;
    yield* service.submitTags("PUPR5FG5", { automatic: true });
    expect(zotero.patches).toEqual([]);
    expect(yield* service.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
    expect(zotero.tags).toEqual([
      "review",
      { tag: "nlp", type: 1 },
      "todo",
      "figure",
    ]);
    expect(yield* service.tagDraftFor("PUPR5FG5")).toBeNull();
  }),
);

it.effect(
  "holds a tag save whose response was lost as unconfirmed until Save tags",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      let lose = true;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          ...zotero.answers,
          write: async (request) => {
            const answer = await zotero.answers.write(request);
            // Zotero took the write; its answer never arrives.
            if (lose) unreachable();
            return answer;
          },
        }),
      );

      yield* service.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
      // A lost answer is the Local API gone mid-write: which it did, nobody knows.
      expect(yield* service.submitTags("PUPR5FG5")).toMatchObject({
        kind: "failed",
        failure: { kind: "unreachable" },
      });
      expect(yield* service.tagDraftFor("PUPR5FG5")).toMatchObject({
        manualSave: true,
        held: true,
        state: { kind: "failed", failure: { kind: "unreachable" } },
      });

      lose = false;
      yield* service.submitTags("PUPR5FG5", { automatic: true });
      expect(zotero.patches).toHaveLength(1);
      // Save tags applies the same names to what Zotero holds, which already has
      // them, so the list comes out the same.
      expect(yield* service.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
      expect(zotero.patches).toHaveLength(2);
      expect(zotero.tags).toEqual([
        "review",
        { tag: "nlp", type: 1 },
        "todo",
        "figure",
      ]);
      expect(yield* service.tagDraftFor("PUPR5FG5")).toBeNull();
    }),
);

it.effect(
  "saves the next session on close again once Save tags has saved a held draft",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      let refuse = true;
      const { service, localApiService } = yield* Effect.promise(() =>
        writable(stack, {
          ...zotero.answers,
          write: (request) =>
            refuse ? keyRejected() : zotero.answers.write(request),
        }),
      );
      yield* service.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
      yield* service.submitTags("PUPR5FG5", { automatic: true });
      refuse = false;
      yield* localApiService.authorize;
      expect(yield* service.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
      expect(zotero.patches).toHaveLength(1);

      // The hold ended with that save, so a new session saves as its editor
      // closes.
      yield* service.editTags("PUPR5FG5", ["review", "nlp", "figure"]);
      expect(
        yield* service.submitTags("PUPR5FG5", { automatic: true }),
      ).toEqual({
        kind: "idle",
      });
      expect(zotero.patches).toHaveLength(2);
      expect(zotero.tags).toEqual([
        "review",
        { tag: "nlp", type: 1 },
        "figure",
      ]);
      expect(yield* service.tagDraftFor("PUPR5FG5")).toBeNull();
    }),
);

it.effect("discards a tag draft when deletion is confirmed in Zotero", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    let records = ROUGIER_ANNOTATIONS;
    const { service } = yield* Effect.promise(() =>
      writable(stack, {
        children: () => annotationPage(records),
      }),
    );
    yield* service.editTags("PUPR5FG5", ["figure"]);
    const deleted: string[] = [];
    yield* collect(service.annotationChanged, (key) =>
      service
        .annotationState(key)
        .pipe(Effect.map(({ gone }) => gone && deleted.push(key))),
    );
    records = records.filter(({ key }) => key !== "PUPR5FG5");

    yield* service.refresh("RGRPDF24");

    expect(new Set(deleted)).toEqual(new Set(["PUPR5FG5"]));
    expect(yield* service.tagDraftFor("PUPR5FG5")).toBeNull();
    // The editor unmounting on the deleted card sends nothing.
    expect(yield* service.submitTags("PUPR5FG5", { automatic: true })).toEqual({
      kind: "idle",
    });
  }),
);

it.effect(
  "discards the tag draft with the comment draft when the Annotation is deleted",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service } = yield* Effect.promise(() => writable(stack));
      yield* service.editTextField("comment", "PUPR5FG5", "Unsaved");
      yield* service.editTags("PUPR5FG5", ["figure"]);

      yield* service.deleteAnnotation("PUPR5FG5");

      expect(yield* service.textDraftFor("comment", "PUPR5FG5")).toBeNull();
      expect(yield* service.tagDraftFor("PUPR5FG5")).toBeNull();
    }),
);

it.effect("discards a held tag draft and keeps the tags Zotero holds", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
    const { service, localApiService } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.editTags("PUPR5FG5", ["figure"]);
    yield* localApiService.forgetAuthorization;
    yield* service.submitTags("PUPR5FG5", { automatic: true });

    yield* service.discardTagDraft("PUPR5FG5");

    expect(yield* service.tagDraftFor("PUPR5FG5")).toBeNull();
    expect(zotero.patches).toEqual([]);
  }),
);

// #endregion
