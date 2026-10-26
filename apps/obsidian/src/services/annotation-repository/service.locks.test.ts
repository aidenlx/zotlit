// The Annotation Repository's Locked Annotations: External Annotations and another user's Annotations in a group library.
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import {
  annotationItem,
  annotationPage,
  freshnessSignal,
  rootOk,
  ROUGIER_ANNOTATIONS,
  SERVER_ID,
  staleVersion,
  unreachable,
  writeAccepted,
} from "@/services/zotero-local-api/__fixtures__";
import {
  annotationBlocks,
  capabilityBlock,
  cardControls,
  fieldEditorControls,
  heldTagDraft,
  heldTextDraft,
} from "@/views/annot-view/card-controls";

import {
  afterWrite,
  GROUP_ATTACHMENT,
  GROUP_ID,
  markExternal,
  NOW,
  nextChange,
  REMEMBERED_KEY,
  setup,
  useFakeTimers,
  writable,
  zoteroLibrary,
  READING_ORDER,
  DATABASE_SOURCE,
  colorOf,
  zoteroHolding,
  moved,
} from "./__fixtures__";
import type { GroupLibrary } from "./__fixtures__";
import type { RepositoryClient } from "./__fixtures__";
import type { AnnotationList, AnnotationRecord, LockReason } from "./service";

// #region annotation locks

// What can go wrong with a Locked Annotation, seen from outside the repository
// (ADR 0067):
// - the Local API sends no lock facts, so a list it answers carries no lock;
// - a fact the database does not hold, or cannot give, locks an Annotation;
// - a read of the database that fails drops a lock an earlier read gave;
// - a lock Zotero adds after a Local API list was read never reaches it;
// - a refused verb still sends a request, draws a Pending Proposal, or ends a
//   Write Conflict that stands;
// - a comment, Quoted Text or tag draft open when the lock appears still saves;
// - the card offers a verb the lock refuses, or the lock's block hides the
//   Editing Capability's own reason;
// - a group verb with one Locked Annotation writes the others, or ends their
//   drafts, and leaves a partial result;
// - an undo or redo takes a step that writes a Locked Annotation, drops it, or
//   answers with no Lock Reason, so the notice gives the capability copy;
// - a refused step drops out of canUndo/canRedo, so the command disappears.

const LOCKED = {
  kind: "failed",
  failure: { kind: "locked", reason: "external" },
} as const;

/** What an undo or redo answers where a lock refuses its History Step. */
const LOCKED_STEP = { kind: "locked", reason: "external" } as const;

/** The block every verb of an External Annotation meets on its card. */
const EXTERNAL_BLOCK = {
  reason: m.annot_view_lock_external(),
  action: null,
  source: "lock",
} as const;

/** Each Annotation's lock, by key. */
function locksOf(list: AnnotationList | null) {
  return Object.fromEntries(
    list?.annotations.map(({ key, lock }) => [key, lock]) ?? [],
  );
}

/** Every Fixture Annotation unlocked, but those `locked` names, by bare key. */
function expectedLocks(locked: Readonly<Record<string, LockReason>> = {}) {
  return Object.fromEntries(
    READING_ORDER.map(([key]) => {
      const reason = locked[key!];
      return [key, reason ? { reason } : null];
    }),
  );
}

function recordOf(repository: RepositoryClient, key: string): AnnotationRecord {
  const record = repository
    .peek("RGRPDF24")
    ?.value.annotations.find((annotation) => annotation.key === key);
  if (!record) throw new Error(`No record ${key}`);
  return record;
}

/**
 * Zotero imports one Annotation from the PDF file while ZotLit reads through
 * the Local API: the database changes, and the next list is the Local API's
 * again, with the lock on it.
 */
async function importFromPdf(
  harness: Awaited<ReturnType<typeof writable>>,
  key: string,
): Promise<void> {
  markExternal(harness.client, key);
  harness.dbEvents.emit("changed");
  await vi.waitFor(async () => {
    const list = await harness.repository.read("RGRPDF24");
    expect(list?.source.kind).toBe("zotero-local-api");
    expect(locksOf(list)[key]).toEqual({ reason: "external" });
  });
}

it("locks an External Annotation under the Zotero DB source", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack, undefined, {
    external: ["PUPR5FG5"],
  });

  const list = await repository.read("RGRPDF24");

  expect(list?.source).toEqual(DATABASE_SOURCE);
  expect(locksOf(list)).toEqual(expectedLocks({ PUPR5FG5: "external" }));
});

it("locks an External Annotation under the Local API source, from the Zotero database", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {}, { external: ["PUPR5FG5"] });

  const list = await repository.read("RGRPDF24");

  expect(list?.source).toEqual({
    kind: "zotero-local-api",
    serverID: SERVER_ID,
  });
  expect(locksOf(list)).toEqual(expectedLocks({ PUPR5FG5: "external" }));
});

it("locks nothing the Zotero database holds no fact for, and keeps a lock it cannot read again", async () => {
  await using stack = new AsyncDisposableStack();
  // Zotero holds an Annotation the database copy ZotLit reads does not have yet.
  const unread = {
    ...afterWrite("PUPR5FG5", {}),
    key: "UNREAD23",
    sortIndex: "00000|002050|00170",
  };
  const { repository, acquireRead } = await writable(
    stack,
    { children: () => annotationPage([...ROUGIER_ANNOTATIONS, unread]) },
    { external: ["PUPR5FG5"] },
  );

  const read = locksOf(await repository.read("RGRPDF24"));
  expect(read.UNREAD23).toBeNull();
  expect(read.PUPR5FG5).toEqual({ reason: "external" });

  // The database cannot be read, and the list still can. The lock the last
  // read gave stands.
  acquireRead.mockRejectedValue(new Error("database is locked"));
  const refreshed = await repository.refresh("RGRPDF24");
  expect(refreshed?.source.kind).toBe("zotero-local-api");
  expect(locksOf(refreshed)).toEqual({
    ...expectedLocks({ PUPR5FG5: "external" }),
    UNREAD23: null,
  });
});

it("locks an Annotation Zotero imports from the PDF file while the Local API is the source", async () => {
  await using stack = new AsyncDisposableStack();
  const harness = await writable(stack);
  expect(locksOf(await harness.repository.read("RGRPDF24"))).toEqual(
    expectedLocks(),
  );

  await importFromPdf(harness, "PUPR5FG5");

  expect(locksOf(harness.repository.peek("RGRPDF24")?.value ?? null)).toEqual(
    expectedLocks({ PUPR5FG5: "external" }),
  );
});

it("refuses every verb on an External Annotation before any request", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(
    stack,
    {},
    { external: ["PUPR5FG5"] },
  );
  const sent = requests.length;
  const drawn: string[] = [];
  stack.defer(
    repository.listen("annotations-changed", (key) => drawn.push(key)),
  );

  const outcomes = [
    await repository.patchColor("PUPR5FG5", "#ff6666"),
    await repository.patchComment("PUPR5FG5", "Worth citing"),
    await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5"), "pointer"),
    await repository.deleteAnnotation("PUPR5FG5"),
  ];

  expect(outcomes).toEqual([LOCKED, LOCKED, LOCKED, LOCKED]);
  // No draft starts, so no autosave and no Done can send one.
  expect(repository.editTextField("comment", "PUPR5FG5", "typed")).toBeNull();
  expect(repository.editTextField("text", "PUPR5FG5")).toBeNull();
  expect(repository.editTags("PUPR5FG5", ["review"])).toBeNull();
  expect(requests.slice(sent)).toEqual([]);
  // No Pending Proposal was drawn, and no outcome stands on the card.
  expect(drawn).toEqual([]);
  expect(repository.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
});

it("holds the drafts open when the lock appears, and sends none of them", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const harness = await writable(stack);
    const { repository, requests } = harness;
    repository.editTextField("comment", "PUPR5FG5", "typed before the import");
    repository.editTextField("text", "PUPR5FG5", "Identify your message");
    repository.editTags("PUPR5FG5", ["review"]);
    const sent = requests.length;

    await importFromPdf(harness, "PUPR5FG5");
    await vi.advanceTimersByTimeAsync(30_000);

    // Done on either text field, and Apply again, send nothing.
    expect(await repository.submitTextField("comment", "PUPR5FG5")).toEqual(
      LOCKED,
    );
    expect(await repository.submitTextField("text", "PUPR5FG5")).toEqual(
      LOCKED,
    );
    expect(await repository.retryTextDraft("comment", "PUPR5FG5")).toEqual(
      LOCKED,
    );
    expect(await repository.submitTags("PUPR5FG5")).toEqual(LOCKED);
    // A keystroke is not taken.
    repository.editTextField("comment", "PUPR5FG5", "typed after the import");
    expect(
      requests.slice(sent).filter(({ method }) => method !== "GET"),
    ).toEqual([]);

    // The editor is read-only and says why; the held text keeps Discard alone.
    const blocks = annotationBlocks({
      annotation: recordOf(repository, "PUPR5FG5"),
      capability: repository.capabilityFor("RGRPDF24"),
      now: NOW,
    });
    const comment = repository.textDraftFor("comment", "PUPR5FG5");
    expect(comment?.text).toBe("typed before the import");
    expect(fieldEditorControls(blocks.comment, comment, NOW)).toMatchObject({
      readOnly: true,
      hint: m.annot_view_lock_external(),
    });
    const held = heldTextDraft(
      "text",
      repository.textDraftFor("text", "PUPR5FG5"),
      {
        block: blocks.text,
        now: NOW,
      },
    );
    expect(held).toMatchObject({
      text: "Identify your message",
      reason: m.annot_view_lock_external(),
    });
    expect(held?.actions.map(({ kind }) => kind)).toEqual(["discard"]);
    const tags = heldTagDraft(
      blocks.tags,
      repository.tagDraftFor("PUPR5FG5"),
      NOW,
    );
    expect(tags).toMatchObject({
      names: ["review"],
      reason: m.annot_view_lock_external(),
    });
    expect(tags?.actions.map(({ kind }) => kind)).toEqual(["discard"]);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a Write Conflict that stands when the lock appears, and sends no Apply again", async () => {
  await using stack = new AsyncDisposableStack();
  const harness = await writable(stack, {
    write: () => staleVersion(),
    item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236" })),
  });
  const { repository, requests } = harness;
  const conflict = await repository.patchColor("PUPR5FG5", "#ff6666");
  expect(conflict.kind).toBe("conflict");

  await importFromPdf(harness, "PUPR5FG5");
  const sent = requests.length;

  expect(await repository.retryWrite("PUPR5FG5")).toEqual(LOCKED);
  expect(repository.mutationFor("PUPR5FG5")).toEqual(conflict);
  expect(requests.slice(sent).filter(({ method }) => method !== "GET")).toEqual(
    [],
  );
});

it("draws a lock the database moved while the list it gave is not published", async () => {
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

  // The database is behind the colour Zotero confirmed, so the Local API
  // list stays published over each list the database gives.
  markExternal(client, "K3JRFLFQ");
  dbEvents.emit("changed");

  await vi.waitFor(async () => {
    const held = await repository.read("RGRPDF24");
    expect(held?.source.kind).toBe("zotero-local-api");
    expect(colorOf(held, "PUPR5FG5")).toBe("#ff6666");
    expect(locksOf(held)).toEqual(expectedLocks({ K3JRFLFQ: "external" }));
  });
});

it("keeps the History Steps of an Annotation the lock refuses where they stand", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const harness = await writable(stack, zotero.answers);
  const { repository, requests } = harness;
  repository.openHistory("RGRPDF24");
  await repository.patchColor("K3JRFLFQ", "#5fb236");
  await repository.patchColor("K3JRFLFQ", "#2ea8e5");
  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });

  await importFromPdf(harness, "K3JRFLFQ");
  const sent = requests.length;

  expect(await repository.undo("RGRPDF24")).toEqual(LOCKED_STEP);
  expect(await repository.redo("RGRPDF24")).toEqual(LOCKED_STEP);
  expect(repository.canUndo("RGRPDF24")).toBe(true);
  expect(repository.canRedo("RGRPDF24")).toBe(true);
  expect(zotero.at("K3JRFLFQ")?.color).toBe("#5fb236");
  expect(requests.slice(sent).filter(({ method }) => method !== "GET")).toEqual(
    [],
  );
});

it("refuses the Text Edit step of an External Annotation with the Lock Reason, and the step stays", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const harness = await writable(stack, zotero.answers);
    const { repository, requests } = harness;
    repository.openHistory("RGRPDF24");
    // A comment step below, and the Text Edit step undone onto the redo side.
    repository.editTextField("comment", "PUPR5FG5", "Worth citing");
    await repository.submitTextField("comment", "PUPR5FG5");
    const original = zotero.held?.text;
    repository.editTextField("text", "PUPR5FG5", "Identify your message");
    await repository.submitTextField("text", "PUPR5FG5");
    expect(await repository.undo("RGRPDF24")).toMatchObject({
      kind: "stepped",
    });
    expect(zotero.held?.text).toBe(original);
    // A comment draft open when the lock appears is held, and hides the step.
    repository.editTextField("comment", "PUPR5FG5", "typed before the import");

    await importFromPdf(harness, "PUPR5FG5");
    const sent = requests.length;

    expect(repository.canUndo("RGRPDF24")).toBe(false);
    expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
    repository.discardTextDraft("comment", "PUPR5FG5");
    expect(repository.canUndo("RGRPDF24")).toBe(true);
    expect(await repository.undo("RGRPDF24")).toEqual(LOCKED_STEP);
    expect(await repository.redo("RGRPDF24")).toEqual(LOCKED_STEP);
    expect(repository.canUndo("RGRPDF24")).toBe(true);
    expect(repository.canRedo("RGRPDF24")).toBe(true);
    expect(zotero.held?.comment).toBe("Worth citing");
    expect(zotero.held?.text).toBe(original);
    expect(
      requests.slice(sent).filter(({ method }) => method !== "GET"),
    ).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("refuses a group recolour with one External Annotation whole, and sends nothing", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository, requests } = await writable(stack, zotero.answers, {
    external: ["K3JRFLFQ"],
  });
  repository.openHistory("RGRPDF24");
  const keys = ["PUPR5FG5", "K3JRFLFQ", "C94NJNYG"];
  const before = keys.map((key) => zotero.at(key)?.color);
  const sent = requests.length;

  expect(await repository.patchColors(keys, "#5fb236")).toEqual([
    { kind: "idle" },
    LOCKED,
    { kind: "idle" },
  ]);
  expect(requests.slice(sent)).toEqual([]);
  expect(keys.map((key) => zotero.at(key)?.color)).toEqual(before);
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("refuses a group delete with one External Annotation whole, and keeps the drafts of the others", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroLibrary();
    const { repository, requests } = await writable(stack, zotero.answers, {
      external: ["K3JRFLFQ"],
    });
    repository.openHistory("RGRPDF24");
    repository.editTextField("comment", "HRK7BG32", "Worth citing");
    const sent = requests.length;

    expect(
      await repository.deleteAnnotations(["HRK7BG32", "K3JRFLFQ"]),
    ).toEqual([{ kind: "idle" }, LOCKED]);
    expect(requests.slice(sent)).toEqual([]);
    expect(zotero.at("HRK7BG32")).not.toBeNull();
    expect(zotero.at("K3JRFLFQ")).not.toBeNull();
    expect(repository.textDraftFor("comment", "HRK7BG32")?.text).toBe(
      "Worth citing",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("dims every verb of an External Annotation with the Lock Reason, and none of its neighbour's", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await writable(stack, {}, { external: ["PUPR5FG5"] });
  const controls = (key: string) => {
    const annotation = recordOf(repository, key);
    return cardControls({
      blocks: annotationBlocks({
        annotation,
        capability: repository.capabilityFor("RGRPDF24"),
        now: NOW,
      }),
      mutation: repository.mutationFor(key),
      hasTags: annotation.tags.length > 0,
      type: annotation.type,
    });
  };

  const locked = { disabled: false, blocked: EXTERNAL_BLOCK };
  expect(controls("PUPR5FG5")).toMatchObject({
    color: locked,
    comment: locked,
    tags: locked,
    text: locked,
    delete: locked,
  });
  const free = { disabled: false, blocked: null };
  expect(controls("K3JRFLFQ")).toMatchObject({
    color: free,
    comment: free,
    tags: free,
    text: free,
    delete: free,
  });
});

it("gives the Editing Capability's reason where it refuses an External Annotation too", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await writable(
    stack,
    {},
    { key: undefined, external: ["PUPR5FG5"] },
  );
  const sent = requests.length;
  const capability = repository.capabilityFor("RGRPDF24");

  const blocks = annotationBlocks({
    annotation: recordOf(repository, "PUPR5FG5"),
    capability,
    now: NOW,
  });

  const allow = capabilityBlock(capability, NOW);
  expect(allow?.action).toBe("allow-editing");
  expect(blocks).toEqual({
    color: allow,
    comment: allow,
    tags: allow,
    text: allow,
    delete: allow,
  });
  expect(await repository.patchColor("PUPR5FG5", "#ff6666")).toEqual({
    kind: "failed",
    failure: { kind: "unauthorized" },
  });
  expect(requests.slice(sent)).toEqual([]);
});

// #endregion

// #region another user's annotations

/** The account user ID the database identity names. */
const ME = 7;

/** Another member of the group library. */
const COLLEAGUE = 9;

/**
 * Who created each Fixture Annotation in the group library. HRK7BG32 has a
 * group item with no creator, TYY6Z6ZF one whose creator is `0`, and
 * 4PE492KU no group item at all.
 */
const CREATED_BY = {
  PUPR5FG5: COLLEAGUE,
  C94NJNYG: COLLEAGUE,
  K3JRFLFQ: ME,
  FDRFQ7C2: ME,
  HRK7BG32: null,
  TYY6Z6ZF: 0,
} as const;

/** The locks of the Annotations {@link COLLEAGUE} created. */
const BY_COLLEAGUE = {
  PUPR5FG5: "another-user",
  C94NJNYG: "another-user",
} as const;

const SYNCED: GroupLibrary = { createdBy: CREATED_BY, userID: ME };

const ANOTHER_USER_LOCKED = {
  kind: "failed",
  failure: { kind: "locked", reason: "another-user" },
} as const;

/** The block every edit of another user's Annotation meets on its card. */
const ANOTHER_USER_BLOCK = {
  reason: m.annot_view_lock_another_user(),
  action: null,
  source: "lock",
} as const;

/** One Fixture Annotation by its Indexed Key in the group library. */
function inGroup(key: string): string {
  return `${key}g${GROUP_ID}`;
}

/** Each Annotation's lock, by bare key. */
function groupLocks(list: AnnotationList | null) {
  return Object.fromEntries(
    list?.annotations.map(({ key, lock }) => [
      key.replace(`g${GROUP_ID}`, ""),
      lock,
    ]) ?? [],
  );
}

/**
 * The repository over a Zotero Local API session with a Write Authorization,
 * with the Fixture's Annotations read from a group library.
 */
async function groupWritable(
  stack: AsyncDisposableStack,
  group: GroupLibrary = SYNCED,
) {
  const harness = await setup(
    stack,
    {
      children: () =>
        annotationPage(
          ROUGIER_ANNOTATIONS.map((annotation) => ({
            ...annotation,
            groupID: GROUP_ID,
          })),
        ),
    },
    { key: REMEMBERED_KEY, group },
  );
  const announced = nextChange(harness.repository);
  await harness.repository.read(GROUP_ATTACHMENT);
  await announced;
  expect((await harness.repository.read(GROUP_ATTACHMENT))?.source.kind).toBe(
    "zotero-local-api",
  );
  return harness;
}

it("locks another user's Annotation in a group library under the Zotero DB source", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack, undefined, { group: SYNCED });

  const list = await repository.read(GROUP_ATTACHMENT);

  expect(list?.source.kind).toBe("zotero-db");
  expect(groupLocks(list)).toEqual(expectedLocks(BY_COLLEAGUE));
});

it("locks another user's Annotation under the Local API source, from the Zotero database", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await groupWritable(stack);

  const list = await repository.read(GROUP_ATTACHMENT);

  expect(groupLocks(list)).toEqual(expectedLocks(BY_COLLEAGUE));
});

it("locks nothing where the group item names no creator: no row, null, or 0", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack, undefined, { group: SYNCED });

  const locks = groupLocks(await repository.read(GROUP_ATTACHMENT));

  expect([locks["4PE492KU"], locks.HRK7BG32, locks.TYY6Z6ZF]).toEqual([
    null,
    null,
    null,
  ]);
  expect(locks.PUPR5FG5).toEqual({ reason: "another-user" });
});

it("locks nothing by creator for an Annotation the Zotero database does not hold yet", async () => {
  await using stack = new AsyncDisposableStack();
  const unread = {
    ...afterWrite("PUPR5FG5", {}),
    key: "UNREAD23",
    sortIndex: "00000|002050|00170",
  };
  const { repository } = await setup(
    stack,
    {
      children: () =>
        annotationPage(
          [...ROUGIER_ANNOTATIONS, unread].map((annotation) => ({
            ...annotation,
            groupID: GROUP_ID,
          })),
        ),
    },
    { key: REMEMBERED_KEY, group: SYNCED },
  );
  const announced = nextChange(repository);
  await repository.read(GROUP_ATTACHMENT);
  await announced;

  const list = await repository.read(GROUP_ATTACHMENT);

  expect(list?.source.kind).toBe("zotero-local-api");
  expect(groupLocks(list)).toEqual({
    ...expectedLocks(BY_COLLEAGUE),
    UNREAD23: null,
  });
});

it("locks nothing where the database names no account user ID", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack, undefined, {
    group: { createdBy: CREATED_BY },
  });

  expect(groupLocks(await repository.read(GROUP_ATTACHMENT))).toEqual(
    expectedLocks(),
  );
});

it("keeps the known creator locks where the database cannot be read again", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests, acquireRead } = await groupWritable(stack);

  acquireRead.mockRejectedValue(new Error("database is locked"));
  const refreshed = await repository.refresh(GROUP_ATTACHMENT);

  expect(refreshed?.source.kind).toBe("zotero-local-api");
  expect(groupLocks(refreshed)).toEqual(expectedLocks(BY_COLLEAGUE));
  const sent = requests.length;
  expect(await repository.patchColor(inGroup("PUPR5FG5"), "#ff6666")).toEqual(
    ANOTHER_USER_LOCKED,
  );
  expect(requests.slice(sent)).toEqual([]);
});

it("refuses every edit of another user's Annotation before any request, and sends its delete", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, requests } = await groupWritable(stack);
  const key = inGroup("PUPR5FG5");
  const sent = requests.length;

  const outcomes = [
    await repository.patchColor(key, "#ff6666"),
    await repository.patchComment(key, "Worth citing"),
    await repository.patchGeometry(key, moved("PUPR5FG5"), "pointer"),
  ];

  expect(outcomes).toEqual([
    ANOTHER_USER_LOCKED,
    ANOTHER_USER_LOCKED,
    ANOTHER_USER_LOCKED,
  ]);
  // No draft starts, so no autosave and no Done can send one.
  expect(repository.editTextField("comment", key, "typed")).toBeNull();
  expect(repository.editTextField("text", key)).toBeNull();
  expect(repository.editTags(key, ["review"])).toBeNull();
  expect(requests.slice(sent)).toEqual([]);

  expect(await repository.deleteAnnotation(key)).toEqual({ kind: "idle" });
  const [erase] = requests.slice(sent);
  expect([erase?.method, erase?.url.pathname]).toEqual([
    "DELETE",
    `/api/groups/${GROUP_ID}/items/PUPR5FG5`,
  ]);
});

it("refuses the held drafts of an Annotation once the account's first sync names another creator", async () => {
  await using stack = new AsyncDisposableStack();
  const harness = await groupWritable(stack, { createdBy: CREATED_BY });
  const { repository, requests, client, dbEvents } = harness;
  const key = inGroup("PUPR5FG5");
  repository.editTextField("comment", key, "typed before the sync");
  repository.editTextField("text", key, "Identify your message");
  repository.editTags(key, ["review"]);
  const sent = requests.length;

  client.$client.exec(
    `insert into settings (setting, key, value) values ('account', 'userID', ${ME});`,
  );
  dbEvents.emit("changed");
  await vi.waitFor(async () => {
    const list = await repository.read(GROUP_ATTACHMENT);
    expect(groupLocks(list).PUPR5FG5).toEqual({ reason: "another-user" });
  });

  expect(await repository.submitTextField("comment", key)).toEqual(
    ANOTHER_USER_LOCKED,
  );
  expect(await repository.submitTextField("text", key)).toEqual(
    ANOTHER_USER_LOCKED,
  );
  expect(await repository.retryTextDraft("comment", key)).toEqual(
    ANOTHER_USER_LOCKED,
  );
  expect(await repository.submitTags(key)).toEqual(ANOTHER_USER_LOCKED);
  expect(requests.slice(sent).filter(({ method }) => method !== "GET")).toEqual(
    [],
  );
});

it("sends a group delete over another user's Annotations, and one undo puts them back unlocked", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary(
    ROUGIER_ANNOTATIONS.map((annotation) => ({
      ...annotation,
      groupID: GROUP_ID,
    })),
  );
  const { repository, requests, client, dbEvents } = await setup(
    stack,
    zotero.answers,
    { key: REMEMBERED_KEY, group: SYNCED },
  );
  await repository.read(GROUP_ATTACHMENT);
  await vi.waitFor(async () =>
    expect((await repository.read(GROUP_ATTACHMENT))?.source.kind).toBe(
      "zotero-local-api",
    ),
  );
  repository.openHistory(GROUP_ATTACHMENT);
  const sent = requests.length;

  expect(
    await repository.deleteAnnotations([
      inGroup("PUPR5FG5"),
      inGroup("C94NJNYG"),
    ]),
  ).toEqual([{ kind: "idle" }, { kind: "idle" }]);
  expect(
    requests
      .slice(sent)
      .filter(({ method }) => method === "DELETE")
      .map(({ url }) => url.pathname),
  ).toEqual([
    `/api/groups/${GROUP_ID}/items/PUPR5FG5`,
    `/api/groups/${GROUP_ID}/items/C94NJNYG`,
  ]);

  // Zotero restores each under a new key, with the current user as creator,
  // and the database copy ZotLit reads holds them so. The undo says so.
  expect(await repository.undo(GROUP_ATTACHMENT)).toMatchObject({
    kind: "stepped",
    restoredAsCreator: { count: 2 },
  });
  client.$client.exec(
    `insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
       values (80, 4, '2026-09-26 12:00:00', '2026-09-26 12:00:00', 2, 'MADE2345'),
              (81, 4, '2026-09-26 12:00:00', '2026-09-26 12:00:00', 2, 'MADE2346');
     insert into itemAnnotations
       (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex, position, isExternal)
       select 80, parentItemID, type, text, comment, color, pageLabel, sortIndex, position, 0
         from itemAnnotations where itemID = 48;
     insert into itemAnnotations
       (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex, position, isExternal)
       select 81, parentItemID, type, text, comment, color, pageLabel, sortIndex, position, 0
         from itemAnnotations where itemID = 52;
     insert into groupItems (itemID, createdByUserID) values (80, ${ME}), (81, ${ME});`,
  );
  dbEvents.emit("changed");
  const restored = groupLocks(await repository.refresh(GROUP_ATTACHMENT));
  expect([restored.MADE2345, restored.MADE2346]).toEqual([null, null]);
});

/**
 * The repository over a group library that Zotero answers writes for, with
 * the Annotation History of its Attachment open.
 */
async function groupHistory(stack: AsyncDisposableStack) {
  const zotero = zoteroLibrary(
    ROUGIER_ANNOTATIONS.map((annotation) => ({
      ...annotation,
      groupID: GROUP_ID,
    })),
  );
  const { repository } = await setup(stack, zotero.answers, {
    key: REMEMBERED_KEY,
    group: SYNCED,
  });
  await repository.read(GROUP_ATTACHMENT);
  await vi.waitFor(async () =>
    expect((await repository.read(GROUP_ATTACHMENT))?.source.kind).toBe(
      "zotero-local-api",
    ),
  );
  repository.openHistory(GROUP_ATTACHMENT);
  return repository;
}

it("counts only another user's Annotations as restored with the user as creator", async () => {
  await using stack = new AsyncDisposableStack();
  const repository = await groupHistory(stack);

  expect(
    await repository.deleteAnnotations([
      inGroup("PUPR5FG5"),
      inGroup("K3JRFLFQ"),
      inGroup("FDRFQ7C2"),
    ]),
  ).toEqual([{ kind: "idle" }, { kind: "idle" }, { kind: "idle" }]);

  expect(await repository.undo(GROUP_ATTACHMENT)).toMatchObject({
    kind: "stepped",
    restoredAsCreator: { count: 1 },
  });
});

it("says nothing of the creator on the undo of a delete of the user's own group Annotation", async () => {
  await using stack = new AsyncDisposableStack();
  const repository = await groupHistory(stack);

  expect(await repository.deleteAnnotation(inGroup("K3JRFLFQ"))).toEqual({
    kind: "idle",
  });

  expect(await repository.undo(GROUP_ATTACHMENT)).toEqual({
    kind: "stepped",
    annotationKey: inGroup("MADE2345"),
  });
});

it("says nothing of the creator on the undo of a delete in the Personal Library", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroLibrary();
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  expect(await repository.deleteAnnotation("HRK7BG32")).toEqual({
    kind: "idle",
  });

  expect(await repository.undo("RGRPDF24")).toEqual({
    kind: "stepped",
    annotationKey: "MADE2345",
  });
});

it("dims the edits of another user's Annotation and leaves its delete, and none of the user's own", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await groupWritable(stack);
  const controls = (key: string) => {
    const annotation = repository
      .peek(GROUP_ATTACHMENT)
      ?.value.annotations.find((record) => record.key === inGroup(key));
    if (!annotation) throw new Error(`No record ${key}`);
    return cardControls({
      blocks: annotationBlocks({
        annotation,
        capability: repository.capabilityFor(GROUP_ATTACHMENT),
        now: NOW,
      }),
      mutation: repository.mutationFor(annotation.key),
      hasTags: annotation.tags.length > 0,
      type: annotation.type,
    });
  };

  const locked = { disabled: false, blocked: ANOTHER_USER_BLOCK };
  const free = { disabled: false, blocked: null };
  expect(controls("PUPR5FG5")).toMatchObject({
    color: locked,
    comment: locked,
    tags: locked,
    text: locked,
    delete: free,
  });
  expect(controls("K3JRFLFQ")).toMatchObject({
    color: free,
    comment: free,
    tags: free,
    text: free,
    delete: free,
  });
});

// #endregion
