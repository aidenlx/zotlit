// The Annotation Repository's drafts: comment, Quoted Text and tag drafts, their autosave, and how reads reconcile them.
import { expect, it, vi } from "vitest";

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
  nextChange,
  REMEMBERED_KEY,
  setup,
  switchToLocalApi,
  useFakeTimers,
  writable,
  zoteroLibrary,
  colorOf,
  zoteroTagging,
  TAGGED,
} from "./__fixtures__";
import type { AnnotationList } from "./service";

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
  repository.editTextField("comment", "PUPR5FG5", "First database");

  serverID = "Zzzz11119999";
  prefEvents.emit("resolved-changed");
  await repository.probe();
  await repository.read("RGRPDF24");
  expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull();

  serverID = SERVER_ID;
  prefEvents.emit("resolved-changed");
  await repository.probe();
  await repository.read("RGRPDF24");
  expect(repository.textDraftFor("comment", "PUPR5FG5")?.text).toBe(
    "First database",
  );
});

it("announces a write and a draft on one Annotation through one signal", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository } = await writable(stack, zotero.answers);
  const seen: { mutation: string; comment: string | null }[] = [];
  stack.defer(
    repository.listen("annotation-changed", (key) => {
      const state = repository.annotationState(key);
      seen.push({
        mutation: state.mutation.kind,
        comment: state.textDrafts.comment?.text ?? null,
      });
    }),
  );
  const release = zotero.holdWrites();

  const saving = repository.patchColor("PUPR5FG5", "#ff6666");
  repository.editTextField("comment", "PUPR5FG5", "Worth citing");
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
  repository.editTextField("comment", "K3JRFLFQ", "Worth citing");
  const announced: string[] = [];
  stack.defer(
    repository.listen("annotation-changed", (key) => {
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
    textDrafts: { comment: null, text: null },
  });
  expect(repository.annotationState("FDRFQ7C2").gone).toBe(false);

  zotero.restoreInZotero("PUPR5FG5");
  await repository.refresh("RGRPDF24");
  expect(repository.annotationState("PUPR5FG5").gone).toBe(false);
});

it.each(["comment", "text", "tags"] as const)(
  "starts a %s draft while the database refresh is being read",
  async (field) => {
    await using stack = new AsyncDisposableStack();
    const { repository, acquireRead, dbEvents } = await writable(stack);
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
          ? repository.editTags("PUPR5FG5")
          : repository.editTextField(field, "PUPR5FG5");
      expect(draft).not.toBeNull();
      expect(repository.capabilityFor("RGRPDF24").kind).toBe("writable");
    } finally {
      resume.resolve();
      await repository.read("RGRPDF24");
    }
  },
);

it("edits and saves the published Annotation after its query cache is collected", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, queryClient } = await writable(stack, {
    write: () => writeAccepted(42),
    item: () =>
      annotationItem(
        afterWrite("PUPR5FG5", { comment: "Recovered", version: 42 }),
      ),
  });
  queryClient.client.removeQueries();
  expect(
    repository.peek("RGRPDF24")?.value.annotations.map(({ key }) => key),
  ).toContain("PUPR5FG5");
  expect(repository.editTextField("comment", "PUPR5FG5")).not.toBeNull();
  await expect(
    repository.patchComment("PUPR5FG5", "Recovered"),
  ).resolves.toEqual({ kind: "idle" });
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
  repository.editTextField("comment", "PUPR5FG5", "First database");
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
    textDrafts: { comment: null, text: null },
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
  useFakeTimers();
  try {
    repository.editTextField("comment", "PUPR5FG5", "First database");
    await vi.advanceTimersByTimeAsync(500);
    const hidden = new Promise<string>((resolve) => {
      stack.defer(
        repository.listen("annotation-changed", (key) => {
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
    repository.editTextField("comment", "PUPR5FG5", "Second database");
    const sent = requests.length;

    await vi.advanceTimersByTimeAsync(500);

    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("hides an offline draft after a different database is accepted", async () => {
  await using stack = new AsyncDisposableStack();
  let answering = true;
  const { repository, client, dbEvents, serverEvents } = await writable(stack, {
    root: () => (answering ? rootOk() : unreachable()),
  });
  repository.editTextField("comment", "PUPR5FG5", "First database");
  answering = false;
  const unavailable = nextChange(repository);
  freshnessSignal(serverEvents);
  await unavailable;

  client.$client.exec(
    "update settings set value = 'Zzzz11119999' where setting = 'localAPI' and key = 'serverID'",
  );
  dbEvents.emit("changed");
  await repository.read("RGRPDF24");

  expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull();
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
  repository.editTextField("comment", "PUPR5FG5", "Keep this draft");

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
  expect(repository.textDraftFor("comment", "PUPR5FG5")?.text).toBe(
    "Keep this draft",
  );
});

it("autosaves after one idle second and caps a continuous editing burst", async () => {
  useFakeTimers();
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

    repository.editTextField("comment", "PUPR5FG5", "idle");
    await vi.advanceTimersByTimeAsync(999);
    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toHaveLength(1);

    repository.editTextField("comment", "PUPR5FG5", "burst 0");
    for (let step = 1; step <= 11; step += 1) {
      await vi.advanceTimersByTimeAsync(900);
      repository.editTextField("comment", "PUPR5FG5", `burst ${step}`);
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

    repository.editTextField("comment", "PUPR5FG5", "next burst");
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

it("autosaves a Quoted Text draft on the idle and burst timers, with the text alone", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    let saved = "";
    let version = 20;
    const { repository, requests } = await writable(stack, {
      write: (request) => {
        saved = String(JSON.parse(request.body ?? "{}").annotationText);
        version += 1;
        return writeAccepted();
      },
      item: () =>
        annotationItem(afterWrite("PUPR5FG5", { text: saved, version })),
    });
    const sent = requests.length;
    const patches = () =>
      requests
        .slice(sent)
        .filter(({ method }) => method === "PATCH")
        .map(({ body }) => JSON.parse(body ?? "{}"));

    repository.editTextField("text", "PUPR5FG5", "Identify your message");
    await vi.advanceTimersByTimeAsync(999);
    expect(patches()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    // The version precondition and the text: no position, no Sort Index.
    expect(patches()).toEqual([
      { version: 11, annotationText: "Identify your message" },
    ]);

    repository.editTextField("text", "PUPR5FG5", "burst 0");
    for (let step = 1; step <= 11; step += 1) {
      await vi.advanceTimersByTimeAsync(900);
      repository.editTextField("text", "PUPR5FG5", `burst ${step}`);
    }
    expect(patches()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);

    expect(patches().map(({ annotationText }) => annotationText)).toEqual([
      "Identify your message",
      "burst 11",
    ]);
    expect(
      patches().every(
        (body) => Object.keys(body).sort().join() === "annotationText,version",
      ),
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("saves an emptied Quoted Text draft as a clear", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack, {
    item: () =>
      annotationItem(afterWrite("PUPR5FG5", { text: "", version: 12 })),
  });
  const sent = requests.length;

  repository.editTextField("text", "PUPR5FG5", "");
  await repository.submitTextField("text", "PUPR5FG5");

  const [patch] = requests
    .slice(sent)
    .filter(({ method }) => method === "PATCH");
  expect(JSON.parse(patch!.body ?? "")).toEqual({
    version: 11,
    annotationText: "",
  });
  expect(repository.textDraftFor("text", "PUPR5FG5")).toBeNull();
});

it("serializes writes and saves only the latest input after a slow response", async () => {
  useFakeTimers();
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

    repository.editTextField("comment", "PUPR5FG5", "first");
    await vi.advanceTimersByTimeAsync(1_000);
    repository.editTextField("comment", "PUPR5FG5", "second");
    repository.editTextField("comment", "PUPR5FG5", "latest");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(submitted).toEqual(["first"]);

    answerFirst(writeAccepted());
    await vi.waitFor(() => expect(submitted).toEqual(["first", "latest"]));
    await vi.waitFor(() =>
      expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull(),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("queues a return to the old baseline while a newer value is saving", async () => {
  useFakeTimers();
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

    repository.editTextField("comment", "PUPR5FG5", "temporary");
    await vi.advanceTimersByTimeAsync(1_000);
    repository.editTextField("comment", "PUPR5FG5", "");
    first.resolve(writeAccepted());

    await vi.waitFor(() => expect(submitted).toEqual(["temporary", ""]));
    await vi.waitFor(() =>
      expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull(),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a failed autosave for explicit editing without replaying it", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const { repository, requests } = await writable(stack, {
      write: () => unreachable(),
    });
    const sent = requests.length;

    repository.editTextField("comment", "PUPR5FG5", "keep me");
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() =>
      expect(repository.textDraftFor("comment", "PUPR5FG5")?.state.kind).toBe(
        "failed",
      ),
    );
    await vi.advanceTimersByTimeAsync(30_000);

    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toHaveLength(1);
    expect(repository.textDraftFor("comment", "PUPR5FG5")?.text).toBe(
      "keep me",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("retains a paused draft until an explicit save after authorization returns", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const { repository, localApiService, bridge, requests, localApiBridge } =
      await writable(stack, {
        authorize: () => authorized({ remember: true }),
        item: () =>
          annotationItem(
            afterWrite("PUPR5FG5", {
              comment: "Keep these words",
              version: 20,
            }),
          ),
      });
    repository.editTextField("comment", "PUPR5FG5", "Keep these words");
    await bridge.runPromise(localApiService.forgetAuthorization);
    repository.editTextField("comment", "PUPR5FG5", "Blocked typing");
    expect(repository.textDraftFor("comment", "PUPR5FG5")?.text).toBe(
      "Keep these words",
    );
    await localApiBridge.runPromise(localApiService.authorize);
    const sent = requests.length;
    await vi.advanceTimersByTimeAsync(30_000);
    await repository.submitTextField("comment", "PUPR5FG5", {
      automatic: true,
    });
    expect(requests.slice(sent)).toEqual([]);
    const saving = repository.submitTextField("comment", "PUPR5FG5");
    // The save the user pressed is the one the editor says it waits on.
    expect(
      fieldEditorControls(
        capabilityBlock(repository.capabilityFor("RGRPDF24"), NOW),
        repository.textDraftFor("comment", "PUPR5FG5"),
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
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const first = Promise.withResolvers<Response>();
    const submitted: string[] = [];
    let version = 20;
    const { repository, localApiService, bridge, localApiBridge } =
      await writable(stack, {
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
    repository.editTextField("comment", "PUPR5FG5", "Held words");
    await bridge.runPromise(localApiService.forgetAuthorization);
    await localApiBridge.runPromise(localApiService.authorize);

    const saving = repository.submitTextField("comment", "PUPR5FG5");
    await vi.waitFor(() => expect(submitted).toEqual(["Held words"]));
    repository.editTextField("comment", "PUPR5FG5", "Held words, and more");
    first.resolve(writeAccepted());
    expect(await saving).toEqual({ kind: "idle" });

    await vi.waitFor(() =>
      expect(submitted).toEqual(["Held words", "Held words, and more"]),
    );
    await vi.waitFor(() =>
      expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull(),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("requires explicit recovery after a lost save response even when refresh reconnects", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const { repository, requests } = await writable(stack, {
      write: () => unreachable(),
    });
    repository.editTextField("comment", "PUPR5FG5", "Unconfirmed comment");
    await repository.submitTextField("comment", "PUPR5FG5");
    expect(repository.capabilityFor("RGRPDF24").kind).toBe("writable");
    const sent = requests.length;
    repository.editTextField("comment", "PUPR5FG5", "Review before retry");
    await vi.advanceTimersByTimeAsync(30_000);
    await repository.submitTextField("comment", "PUPR5FG5", {
      automatic: true,
    });
    expect(requests.slice(sent)).toEqual([]);
    expect(repository.textDraftFor("comment", "PUPR5FG5")?.text).toBe(
      "Review before retry",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("cancels a scheduled comment when deletion is confirmed", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const { repository, requests } = await writable(stack);
    const sent = requests.length;
    repository.editTextField("comment", "PUPR5FG5", "never submit");

    await repository.deleteAnnotation("PUPR5FG5");
    await vi.advanceTimersByTimeAsync(20_000);

    expect(
      requests
        .slice(sent)
        .filter(({ method }) => method === "PATCH" || method === "DELETE"),
    ).toMatchObject([{ method: "DELETE" }]);
    expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("discards scheduled session work when the repository unloads", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const { repository, requests } = await writable(stack);
    const sent = requests.length;
    repository.editTextField("comment", "PUPR5FG5", "session only");

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

  const started = repository.editTextField("comment", "PUPR5FG5", "My draft");
  repository.editTextField("comment", "PUPR5FG5");
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, color: "#ff6666", version: 20 }
      : record,
  );
  await repository.refresh("RGRPDF24");

  expect(started?.serverID).toBe(SERVER_ID);
  expect(repository.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
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
  repository.editTextField("comment", "PUPR5FG5", "My draft");
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, comment: "Zotero draft", version: 20 }
      : record,
  );

  await repository.refresh("RGRPDF24");
  const sent = requests.length;

  await repository.submitTextField("comment", "PUPR5FG5");

  expect(repository.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
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
  repository.editTextField("comment", "PUPR5FG5", "My offline draft");

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
  expect(repository.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
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
  repository.editTextField("comment", "PUPR5FG5", "My draft");
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, comment: "Zotero draft", version: 20 }
      : record,
  );
  await repository.refresh("RGRPDF24");
  repository.editTextField("comment", "PUPR5FG5", "My latest draft");
  const sent = requests.length;

  const outcome = await repository.retryTextDraft("comment", "PUPR5FG5");

  expect(outcome).toEqual({ kind: "idle" });
  expect(JSON.parse(requests[sent]!.body ?? "")).toEqual({
    version: 20,
    annotationComment: "My latest draft",
  });
  expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull();
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
  repository.editTextField("comment", "PUPR5FG5", "reviewed draft");
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, comment: "Zotero draft", version: 20 }
      : record,
  );
  await repository.refresh("RGRPDF24");

  const sent = requests.length;
  const retrying = repository.retryTextDraft("comment", "PUPR5FG5");
  // A submit of the same text joins the retry rather than sending again.
  const duplicate = repository.submitTextField("comment", "PUPR5FG5");
  repository.editTextField("comment", "PUPR5FG5", "typed during retry");
  accepted.resolve(writeAccepted());
  expect(await duplicate).toEqual(await retrying);

  expect(repository.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
    baseline: "reviewed draft",
    text: "typed during retry",
    state: { kind: "pending" },
  });
  await repository.submitTextField("comment", "PUPR5FG5");
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
  repository.editTextField("comment", "PUPR5FG5", "My draft");
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, comment: "Zotero draft", version: 20 }
      : record,
  );
  await repository.refresh("RGRPDF24");
  await repository.patchColor("PUPR5FG5", "#ff6666");
  const sent = requests.length;

  const outcome = await repository.retryTextDraft("comment", "PUPR5FG5");

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
  repository.editTextField("comment", "PUPR5FG5", "My draft");
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, comment: "Zotero draft", version: 20 }
      : record,
  );
  await repository.refresh("RGRPDF24");
  const sent = requests.length;

  const outcome = await repository.retryTextDraft("comment", "PUPR5FG5");

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
  repository.editTextField("comment", "PUPR5FG5", "Same words");
  const sent = requests.length;
  records = records.map((record) =>
    record.key === "PUPR5FG5"
      ? { ...record, comment: "Same words", version: 20 }
      : record,
  );

  await repository.refresh("RGRPDF24");

  expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull();
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
  repository.editTextField("comment", "PUPR5FG5", "Unsaved");
  const deleted = new Promise<string>((resolve) => {
    stack.defer(
      repository.listen("annotation-changed", (key) => {
        if (repository.annotationState(key).gone) resolve(key);
      }),
    );
  });
  records = records.filter(({ key }) => key !== "PUPR5FG5");

  await repository.refresh("RGRPDF24");

  expect(await deleted).toBe("PUPR5FG5");
  expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull();
});

it("discards a queued draft when the verified database confirms deletion after API loss", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    let answering = true;
    const { repository, client, dbEvents, requests, serverEvents } =
      await writable(stack, {
        root: () => (answering ? rootOk() : unreachable()),
      });
    const sent = requests.length;
    repository.editTextField(
      "comment",
      "PUPR5FG5",
      "Never recreate this annotation",
    );
    const deleted = new Promise<string>((resolve) => {
      stack.defer(
        repository.listen("annotation-changed", (key) => {
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
    expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull();
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
  repository.editTextField("comment", "PUPR5FG5", "Unsaved");
  available = false;

  await repository.refresh("RGRPDF24");

  expect(repository.textDraftFor("comment", "PUPR5FG5")?.text).toBe("Unsaved");
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
    repository.listen("annotations-changed", (key) => {
      drawn.push(commentOf(repository.peek(key)?.value ?? null));
    }),
  );
  const before = commentOf(repository.peek("RGRPDF24")?.value ?? null);

  // The editor closing on blur submits what it holds.
  repository.editTextField("comment", "PUPR5FG5", "Blurred words");
  const saving = repository.submitTextField("comment", "PUPR5FG5", {
    automatic: true,
  });

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

  repository.editTextField("comment", "PUPR5FG5", "first");
  const saved = repository.submitTextField("comment", "PUPR5FG5");
  await vi.waitFor(() => expect(sent).toEqual(["first"]));
  // Two more submits while the first is away: the later text replaces the
  // earlier one, on screen at once and in what Zotero is sent next.
  repository.editTextField("comment", "PUPR5FG5", "second");
  void repository.submitTextField("comment", "PUPR5FG5");
  repository.editTextField("comment", "PUPR5FG5", "third");
  void repository.submitTextField("comment", "PUPR5FG5");
  expect(drawn()).toBe("third");

  first.resolve(writeAccepted());
  await saved;
  await vi.waitFor(() =>
    expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull(),
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

  repository.editTextField("comment", "PUPR5FG5", "first");
  void repository.submitTextField("comment", "PUPR5FG5");
  await vi.waitFor(() => expect(sent).toEqual(["first"]));
  repository.editTextField("comment", "PUPR5FG5", "second");
  const queued = repository.submitTextField("comment", "PUPR5FG5");
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

  repository.editTextField("comment", "PUPR5FG5", "first");
  const saved = repository.submitTextField("comment", "PUPR5FG5");
  await vi.waitFor(() => expect(sent).toEqual(["first"]));
  repository.editTextField("comment", "PUPR5FG5", "second");
  const queued = repository.submitTextField("comment", "PUPR5FG5");

  first.reject(new AbortError("reader closed"));
  await saved;
  await queued;

  // The failure holds the draft with its newest text, and nothing more goes
  // to Zotero until the researcher saves again.
  expect(sent).toEqual(["first"]);
  expect(repository.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
    text: "second",
    manualSave: true,
    state: { kind: "failed" },
  });
});

it("drops a comment draft holding what Zotero already has", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(stack);
  const sent = requests.length;

  // Opening the editor starts a draft before any typing. Closing it asks for
  // the submit, and an untouched draft leaves nothing behind for a card to
  // announce as unsaved.
  expect(repository.editTextField("comment", "PUPR5FG5")).not.toBeNull();
  await repository.submitTextField("comment", "PUPR5FG5", { automatic: true });
  expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull();

  // Typing and undoing it back to Zotero's own text says the same thing.
  repository.editTextField("comment", "PUPR5FG5", "Second thoughts");
  repository.editTextField("comment", "PUPR5FG5", "");
  await repository.submitTextField("comment", "PUPR5FG5", { automatic: true });
  expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull();

  // Neither close wrote to Zotero.
  expect(
    requests.slice(sent).filter(({ method }) => method === "PATCH"),
  ).toHaveLength(0);
});

it("draws nothing while an automatic comment save is in flight", async () => {
  useFakeTimers();
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
    repository.editTextField("comment", "PUPR5FG5", "typed");
    const resting = drawn();
    const frames: unknown[] = [];
    stack.defer(
      repository.listen("annotation-changed", () => frames.push(drawn())),
    );

    await vi.advanceTimersByTimeAsync(1_000);
    frames.push(drawn());
    answer.resolve(writeAccepted());
    await vi.waitFor(() =>
      expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull(),
    );

    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) expect(frame).toEqual(resting);
  } finally {
    vi.useRealTimers();
  }
});

// #region tag editing sessions

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
  stack.defer(repository.listen("write-conflict", () => (conflicts += 1)));

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
    repository.listen("annotation-changed", (key) => announced.push(key)),
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
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
    const { repository } = await writable(stack, zotero.answers);
    let conflicts = 0;
    stack.defer(repository.listen("write-conflict", () => (conflicts += 1)));

    // Both editors are open on one Annotation; the tag session ends first.
    repository.editTextField("comment", "PUPR5FG5", "Worth citing");
    repository.editTags("PUPR5FG5", ["review", "figure"]);
    await repository.submitTags("PUPR5FG5");

    expect(zotero.tags).toEqual(["review", "figure"]);
    expect(zotero.comment).toBeUndefined();
    expect(repository.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
      text: "Worth citing",
      state: { kind: "editing" },
    });

    // The comment's idle save lands under an open tag session.
    repository.editTags("PUPR5FG5", ["review", "figure", "todo"]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(zotero.comment).toBe("Worth citing");
    expect(zotero.tags).toEqual(["review", "figure"]);
    expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull();
    expect(repository.tagDraftFor("PUPR5FG5")).toMatchObject({
      baseline: ["review", "figure"],
      names: ["review", "figure", "todo"],
      state: { kind: "editing" },
    });

    // Zotero moves the comment under typed text: only the comment conflicts,
    // and the tag session still saves.
    repository.editTextField("comment", "PUPR5FG5", "Worth citing twice");
    zotero.changeInZotero({ comment: "From Zotero" });
    await repository.refresh("RGRPDF24");
    expect(conflicts).toBe(1);
    await repository.submitTags("PUPR5FG5");

    expect(zotero.tags).toEqual(["review", "figure", "todo"]);
    expect(zotero.comment).toBe("From Zotero");
    expect(repository.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
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
    expect(repository.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
      text: "Worth citing twice",
    });
    repository.editTags("PUPR5FG5", ["review"]);
    repository.discardTextDraft("comment", "PUPR5FG5");
    expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull();
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

it("requires a choice when Zotero changes a drafted Quoted Text, and ends it by Apply again or Discard", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository, requests } = await writable(stack, zotero.answers);
  let conflicts = 0;
  stack.defer(repository.listen("write-conflict", () => (conflicts += 1)));
  const patches = (from: number) =>
    requests.slice(from).filter(({ method }) => method === "PATCH");

  // A Geometry Edit in Zotero's reader rewrites the text under typed text.
  repository.editTextField("text", "PUPR5FG5", "My correction");
  zotero.changeInZotero({ text: "Text of the new range" });
  let sent = requests.length;
  await repository.refresh("RGRPDF24");

  expect(conflicts).toBe(1);
  expect(repository.mutationFor("PUPR5FG5")).toEqual({
    kind: "conflict",
    conflict: {
      write: "text",
      attempted: "My correction",
      fresh: "Text of the new range",
    },
  });
  // The conflict holds the draft: a submit sends nothing.
  await repository.submitTextField("text", "PUPR5FG5");
  expect(patches(sent)).toEqual([]);

  // Apply again sends the text alone against the version Zotero holds now.
  await repository.retryTextDraft("text", "PUPR5FG5");
  expect(patches(sent).map(({ body }) => JSON.parse(body ?? ""))).toEqual([
    { version: 12, annotationText: "My correction" },
  ]);
  expect(zotero.text).toBe("My correction");
  expect(repository.textDraftFor("text", "PUPR5FG5")).toBeNull();
  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });

  // Discard keeps Zotero's text and sends nothing.
  repository.editTextField("text", "PUPR5FG5", "Another correction");
  zotero.changeInZotero({ text: "Edited in Zotero's sidebar" });
  await repository.refresh("RGRPDF24");
  expect(conflicts).toBe(2);
  sent = requests.length;
  repository.discardTextDraft("text", "PUPR5FG5");

  expect(patches(sent)).toEqual([]);
  expect(zotero.text).toBe("Edited in Zotero's sidebar");
  expect(repository.textDraftFor("text", "PUPR5FG5")).toBeNull();
  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
});

it("draws a pending Text Edit as its Pending Proposal, and the confirmed text again once Zotero refuses it", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  const drawn = () =>
    repository
      .peek("RGRPDF24")
      ?.value.annotations.find(({ key }) => key === "PUPR5FG5")?.text;
  const confirmed = drawn();

  const release = zotero.holdWrites();
  repository.editTextField("text", "PUPR5FG5", "Fixed ligature");
  const saving = repository.submitTextField("text", "PUPR5FG5");
  expect(drawn()).toBe("Fixed ligature");

  // Zotero's sidebar moves the text while the write waits, so Zotero refuses
  // it against the version it was stamped with.
  zotero.changeInZotero({ text: "Edited in Zotero" });
  release();
  expect(await saving).toMatchObject({
    kind: "conflict",
    conflict: { write: "text" },
  });
  // The refused proposal leaves the list. The API readback now supplies
  // the confirmed text to both the card and the conflict.
  expect(confirmed).toBe("Identify Your Message");
  expect(drawn()).toBe("Edited in Zotero");
});

it("settles a Quoted Text draft that Zotero already holds with no conflict", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository, requests } = await writable(stack, zotero.answers);
  let conflicts = 0;
  stack.defer(repository.listen("write-conflict", () => (conflicts += 1)));
  repository.editTextField("text", "PUPR5FG5", "Same words");
  zotero.changeInZotero({ text: "Same words" });
  const sent = requests.length;

  await repository.refresh("RGRPDF24");
  await repository.submitTextField("text", "PUPR5FG5");

  expect(conflicts).toBe(0);
  expect(repository.textDraftFor("text", "PUPR5FG5")).toBeNull();
  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
  expect(
    requests.slice(sent).filter(({ method }) => method === "PATCH"),
  ).toEqual([]);
});

it("saves and conflicts a comment draft and a Quoted Text draft on one Annotation apart", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository } = await writable(stack, zotero.answers);
  const commentConflict = {
    kind: "conflict",
    conflict: {
      write: "comment",
      attempted: "Worth citing",
      fresh: "From Zotero",
    },
  };

  // A text save leaves the comment draft unsent.
  repository.editTextField("comment", "PUPR5FG5", "Worth citing");
  repository.editTextField("text", "PUPR5FG5", "Fixed ligature");
  await repository.submitTextField("text", "PUPR5FG5");

  expect(zotero.text).toBe("Fixed ligature");
  expect(zotero.comment).toBeUndefined();
  expect(repository.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
    text: "Worth citing",
    state: { kind: "editing" },
  });

  // Zotero moves the comment: only the comment conflicts, and a text save
  // still lands beside the conflict and leaves it standing.
  zotero.changeInZotero({ comment: "From Zotero" });
  await repository.refresh("RGRPDF24");
  repository.editTextField("text", "PUPR5FG5", "Fixed ligature twice");
  await repository.submitTextField("text", "PUPR5FG5");

  expect(zotero.text).toBe("Fixed ligature twice");
  expect(repository.textDraftFor("text", "PUPR5FG5")).toBeNull();
  expect(repository.mutationFor("PUPR5FG5")).toEqual(commentConflict);

  // Zotero moves the text too: both conflicts stand, and ending the text's
  // leaves the comment's for the card to offer next.
  repository.editTextField("text", "PUPR5FG5", "Third fix");
  zotero.changeInZotero({ text: "Changed range" });
  await repository.refresh("RGRPDF24");
  expect(repository.textDraftFor("text", "PUPR5FG5")).toMatchObject({
    state: { kind: "conflict", fresh: "Changed range" },
  });
  repository.discardTextDraft("text", "PUPR5FG5");

  expect(repository.mutationFor("PUPR5FG5")).toEqual(commentConflict);
  expect(repository.textDraftFor("comment", "PUPR5FG5")).toMatchObject({
    text: "Worth citing",
    state: { kind: "conflict", fresh: "From Zotero" },
  });

  await repository.retryTextDraft("comment", "PUPR5FG5");
  expect(zotero.comment).toBe("Worth citing");
  expect(zotero.text).toBe("Changed range");
  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
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
    blocks: capabilityBlocks(repository.capabilityFor("RGRPDF24"), NOW),
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
  stack.defer(
    repository.listen("annotation-changed", () => {
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
      repository.listen("annotation-changed", (key) => {
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
  const { repository, localApiService, bridge, localApiBridge } =
    await writable(stack, zotero.answers);

  repository.editTags("PUPR5FG5", ["review", "nlp", "todo"]);
  await bridge.runPromise(localApiService.forgetAuthorization);
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
  await localApiBridge.runPromise(localApiService.authorize);
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
  const { repository, localApiService, localApiBridge } = await writable(
    stack,
    {
      ...zotero.answers,
      write: (request) =>
        refuse ? keyRejected() : zotero.answers.write(request),
    },
  );

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
  await localApiBridge.runPromise(localApiService.authorize);
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
  const { repository, localApiService, localApiBridge } = await writable(
    stack,
    {
      ...zotero.answers,
      write: (request) =>
        refuse ? keyRejected() : zotero.answers.write(request),
    },
  );
  repository.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
  await repository.submitTags("PUPR5FG5", { automatic: true });
  refuse = false;
  await localApiBridge.runPromise(localApiService.authorize);
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
    repository.listen("annotation-changed", (key) => {
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
  repository.editTextField("comment", "PUPR5FG5", "Unsaved");
  repository.editTags("PUPR5FG5", ["figure"]);

  await repository.deleteAnnotation("PUPR5FG5");

  expect(repository.textDraftFor("comment", "PUPR5FG5")).toBeNull();
  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
});

it("discards a held tag draft and keeps the tags Zotero holds", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
  const { repository, localApiService, bridge } = await writable(
    stack,
    zotero.answers,
  );
  repository.editTags("PUPR5FG5", ["figure"]);
  await bridge.runPromise(localApiService.forgetAuthorization);
  await repository.submitTags("PUPR5FG5", { automatic: true });

  repository.discardTagDraft("PUPR5FG5");

  expect(repository.tagDraftFor("PUPR5FG5")).toBeNull();
  expect(zotero.patches).toEqual([]);
});

// #endregion
