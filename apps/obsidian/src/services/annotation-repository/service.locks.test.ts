// The Annotation Repository's Locked Annotations: External Annotations and another user's Annotations in a group library.
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect, vi } from "vitest";

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
  collect,
  afterWrite,
  GROUP_ATTACHMENT,
  GROUP_ID,
  markExternal,
  NOW,
  nextChange,
  REMEMBERED_KEY,
  scopedStack,
  setup,
  writable,
  zoteroLibrary,
  READING_ORDER,
  DATABASE_SOURCE,
  colorOf,
  zoteroHolding,
  moved,
} from "./__fixtures__";
import type { GroupLibrary } from "./__fixtures__";
import type {
  AnnotationList,
  AnnotationRecord,
  AnnotationRepository,
  LockReason,
} from "./service";

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

/** The published record of one Fixture Annotation, read through the repository tag. */
function recordIn(
  service: AnnotationRepository["Service"],
  key: string,
): Effect.Effect<AnnotationRecord> {
  return service.peek("RGRPDF24").pipe(
    Effect.map((held) => {
      const record = held?.value.annotations.find(
        (annotation) => annotation.key === key,
      );
      if (!record) throw new Error(`No record ${key}`);
      return record;
    }),
  );
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

it.effect("locks an External Annotation under the Zotero DB source", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service } = yield* Effect.promise(() =>
      setup(stack, undefined, {
        external: ["PUPR5FG5"],
      }),
    );

    const list = yield* service.read("RGRPDF24");

    expect(list?.source).toEqual(DATABASE_SOURCE);
    expect(locksOf(list)).toEqual(expectedLocks({ PUPR5FG5: "external" }));
  }),
);

it.effect(
  "locks an External Annotation under the Local API source, from the Zotero database",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {}, { external: ["PUPR5FG5"] }),
      );

      const list = yield* service.read("RGRPDF24");

      expect(list?.source).toEqual({
        kind: "zotero-local-api",
        serverID: SERVER_ID,
      });
      expect(locksOf(list)).toEqual(expectedLocks({ PUPR5FG5: "external" }));
    }),
);

it.effect(
  "locks nothing the Zotero database holds no fact for, and keeps a lock it cannot read again",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      // Zotero holds an Annotation the database copy ZotLit reads does not have yet.
      const unread = {
        ...afterWrite("PUPR5FG5", {}),
        key: "UNREAD23",
        sortIndex: "00000|002050|00170",
      };
      const { service, acquireRead } = yield* Effect.promise(() =>
        writable(
          stack,
          { children: () => annotationPage([...ROUGIER_ANNOTATIONS, unread]) },
          { external: ["PUPR5FG5"] },
        ),
      );

      const read = locksOf(yield* service.read("RGRPDF24"));
      expect(read.UNREAD23).toBeNull();
      expect(read.PUPR5FG5).toEqual({ reason: "external" });

      // The database cannot be read, and the list still can. The lock the last
      // read gave stands.
      acquireRead.mockRejectedValue(new Error("database is locked"));
      const refreshed = yield* service.refresh("RGRPDF24");
      expect(refreshed?.source.kind).toBe("zotero-local-api");
      expect(locksOf(refreshed)).toEqual({
        ...expectedLocks({ PUPR5FG5: "external" }),
        UNREAD23: null,
      });
    }),
);

it.effect(
  "locks an Annotation Zotero imports from the PDF file while the Local API is the source",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const harness = yield* Effect.promise(() => writable(stack));
      expect(locksOf(yield* harness.service.read("RGRPDF24"))).toEqual(
        expectedLocks(),
      );

      yield* Effect.promise(() => importFromPdf(harness, "PUPR5FG5"));

      expect(
        locksOf((yield* harness.service.peek("RGRPDF24"))?.value ?? null),
      ).toEqual(expectedLocks({ PUPR5FG5: "external" }));
    }),
);

it.effect(
  "refuses every verb on an External Annotation before any request",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, {}, { external: ["PUPR5FG5"] }),
      );
      const sent = requests.length;
      const drawn: string[] = [];
      yield* collect(service.annotationsChanged, (key) =>
        Effect.sync(() => drawn.push(key)),
      );

      const outcomes = [
        yield* service.patchColor("PUPR5FG5", "#ff6666"),
        yield* service.patchComment("PUPR5FG5", "Worth citing"),
        yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5"), "pointer"),
        yield* service.deleteAnnotation("PUPR5FG5"),
      ];

      expect(outcomes).toEqual([LOCKED, LOCKED, LOCKED, LOCKED]);
      // No draft starts, so no autosave and no Done can send one.
      expect(
        yield* service.editTextField("comment", "PUPR5FG5", "typed"),
      ).toBeNull();
      expect(yield* service.editTextField("text", "PUPR5FG5")).toBeNull();
      expect(yield* service.editTags("PUPR5FG5", ["review"])).toBeNull();
      expect(requests.slice(sent)).toEqual([]);
      // No Pending Proposal was drawn, and no outcome stands on the card.
      expect(drawn).toEqual([]);
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
    }),
);

it.effect(
  "holds the drafts open when the lock appears, and sends none of them",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const harness = yield* Effect.promise(() => writable(stack));
      const { service, requests, adjustLayerClock } = harness;
      yield* service.editTextField(
        "comment",
        "PUPR5FG5",
        "typed before the import",
      );
      yield* service.editTextField("text", "PUPR5FG5", "Identify your message");
      yield* service.editTags("PUPR5FG5", ["review"]);
      const sent = requests.length;

      yield* Effect.promise(() => importFromPdf(harness, "PUPR5FG5"));
      yield* adjustLayerClock("30 seconds");

      // Done on either text field, and Apply again, send nothing.
      expect(yield* service.submitTextField("comment", "PUPR5FG5")).toEqual(
        LOCKED,
      );
      expect(yield* service.submitTextField("text", "PUPR5FG5")).toEqual(
        LOCKED,
      );
      expect(yield* service.retryTextDraft("comment", "PUPR5FG5")).toEqual(
        LOCKED,
      );
      expect(yield* service.submitTags("PUPR5FG5")).toEqual(LOCKED);
      // A keystroke is not taken.
      yield* service.editTextField(
        "comment",
        "PUPR5FG5",
        "typed after the import",
      );
      expect(
        requests.slice(sent).filter(({ method }) => method !== "GET"),
      ).toEqual([]);

      // The editor is read-only and says why; the held text keeps Discard alone.
      const blocks = annotationBlocks({
        annotation: yield* recordIn(service, "PUPR5FG5"),
        capability: yield* service.capabilityFor("RGRPDF24"),
        now: NOW,
      });
      const comment = yield* service.textDraftFor("comment", "PUPR5FG5");
      expect(comment?.text).toBe("typed before the import");
      expect(fieldEditorControls(blocks.comment, comment, NOW)).toMatchObject({
        readOnly: true,
        hint: m.annot_view_lock_external(),
      });
      const held = heldTextDraft(
        "text",
        yield* service.textDraftFor("text", "PUPR5FG5"),
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
        yield* service.tagDraftFor("PUPR5FG5"),
        NOW,
      );
      expect(tags).toMatchObject({
        names: ["review"],
        reason: m.annot_view_lock_external(),
      });
      expect(tags?.actions.map(({ kind }) => kind)).toEqual(["discard"]);
    }),
);

it.effect(
  "keeps a Write Conflict that stands when the lock appears, and sends no Apply again",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const harness = yield* Effect.promise(() =>
        writable(stack, {
          write: () => staleVersion(),
          item: () =>
            annotationItem(afterWrite("PUPR5FG5", { color: "#5fb236" })),
        }),
      );
      const { service, requests } = harness;
      const conflict = yield* service.patchColor("PUPR5FG5", "#ff6666");
      expect(conflict.kind).toBe("conflict");

      yield* Effect.promise(() => importFromPdf(harness, "PUPR5FG5"));
      const sent = requests.length;

      expect(yield* service.retryWrite("PUPR5FG5")).toEqual(LOCKED);
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual(conflict);
      expect(
        requests.slice(sent).filter(({ method }) => method !== "GET"),
      ).toEqual([]);
    }),
);

it.effect(
  "draws a lock the database moved while the list it gave is not published",
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

      // The database is behind the colour Zotero confirmed, so the Local API
      // list stays published over each list the database gives.
      markExternal(client, "K3JRFLFQ");
      dbEvents.emit("changed");

      yield* Effect.promise(() =>
        vi.waitFor(async () => {
          const held = await repository.read("RGRPDF24");
          expect(held?.source.kind).toBe("zotero-local-api");
          expect(colorOf(held, "PUPR5FG5")).toBe("#ff6666");
          expect(locksOf(held)).toEqual(
            expectedLocks({ K3JRFLFQ: "external" }),
          );
        }),
      );
    }),
);

it.effect(
  "keeps the History Steps of an Annotation the lock refuses where they stand",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const harness = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      const { service, requests } = harness;
      yield* service.openHistory("RGRPDF24");
      yield* service.patchColor("K3JRFLFQ", "#5fb236");
      yield* service.patchColor("K3JRFLFQ", "#2ea8e5");
      expect(yield* service.undo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });

      yield* Effect.promise(() => importFromPdf(harness, "K3JRFLFQ"));
      const sent = requests.length;

      expect(yield* service.undo("RGRPDF24")).toEqual(LOCKED_STEP);
      expect(yield* service.redo("RGRPDF24")).toEqual(LOCKED_STEP);
      expect(yield* service.canUndo("RGRPDF24")).toBe(true);
      expect(yield* service.canRedo("RGRPDF24")).toBe(true);
      expect(zotero.at("K3JRFLFQ")?.color).toBe("#5fb236");
      expect(
        requests.slice(sent).filter(({ method }) => method !== "GET"),
      ).toEqual([]);
    }),
);

it.effect(
  "refuses the Text Edit step of an External Annotation with the Lock Reason, and the step stays",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const harness = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      const { service, requests } = harness;
      yield* service.openHistory("RGRPDF24");
      // A comment step below, and the Text Edit step undone onto the redo side.
      yield* service.editTextField("comment", "PUPR5FG5", "Worth citing");
      yield* service.submitTextField("comment", "PUPR5FG5");
      const original = zotero.held?.text;
      yield* service.editTextField("text", "PUPR5FG5", "Identify your message");
      yield* service.submitTextField("text", "PUPR5FG5");
      expect(yield* service.undo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      expect(zotero.held?.text).toBe(original);
      // A comment draft open when the lock appears is held, and hides the step.
      yield* service.editTextField(
        "comment",
        "PUPR5FG5",
        "typed before the import",
      );

      yield* Effect.promise(() => importFromPdf(harness, "PUPR5FG5"));
      const sent = requests.length;

      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
      expect(yield* service.undo("RGRPDF24")).toEqual({ kind: "idle" });
      yield* service.discardTextDraft("comment", "PUPR5FG5");
      expect(yield* service.canUndo("RGRPDF24")).toBe(true);
      expect(yield* service.undo("RGRPDF24")).toEqual(LOCKED_STEP);
      expect(yield* service.redo("RGRPDF24")).toEqual(LOCKED_STEP);
      expect(yield* service.canUndo("RGRPDF24")).toBe(true);
      expect(yield* service.canRedo("RGRPDF24")).toBe(true);
      expect(zotero.held?.comment).toBe("Worth citing");
      expect(zotero.held?.text).toBe(original);
      expect(
        requests.slice(sent).filter(({ method }) => method !== "GET"),
      ).toEqual([]);
    }),
);

it.effect(
  "refuses a group recolour with one External Annotation whole, and sends nothing",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, zotero.answers, {
          external: ["K3JRFLFQ"],
        }),
      );
      yield* service.openHistory("RGRPDF24");
      const keys = ["PUPR5FG5", "K3JRFLFQ", "C94NJNYG"];
      const before = keys.map((key) => zotero.at(key)?.color);
      const sent = requests.length;

      expect(yield* service.patchColors(keys, "#5fb236")).toEqual([
        { kind: "idle" },
        LOCKED,
        { kind: "idle" },
      ]);
      expect(requests.slice(sent)).toEqual([]);
      expect(keys.map((key) => zotero.at(key)?.color)).toEqual(before);
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect(
  "refuses a group delete with one External Annotation whole, and keeps the drafts of the others",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, zotero.answers, {
          external: ["K3JRFLFQ"],
        }),
      );
      yield* service.openHistory("RGRPDF24");
      yield* service.editTextField("comment", "HRK7BG32", "Worth citing");
      const sent = requests.length;

      expect(
        yield* service.deleteAnnotations(["HRK7BG32", "K3JRFLFQ"]),
      ).toEqual([{ kind: "idle" }, LOCKED]);
      expect(requests.slice(sent)).toEqual([]);
      expect(zotero.at("HRK7BG32")).not.toBeNull();
      expect(zotero.at("K3JRFLFQ")).not.toBeNull();
      expect((yield* service.textDraftFor("comment", "HRK7BG32"))?.text).toBe(
        "Worth citing",
      );
    }),
);

it.effect(
  "dims every verb of an External Annotation with the Lock Reason, and none of its neighbour's",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {}, { external: ["PUPR5FG5"] }),
      );
      const controls = (key: string) =>
        Effect.gen(function* () {
          const annotation = yield* recordIn(service, key);
          return cardControls({
            blocks: annotationBlocks({
              annotation,
              capability: yield* service.capabilityFor("RGRPDF24"),
              now: NOW,
            }),
            mutation: yield* service.mutationFor(key),
            hasTags: annotation.tags.length > 0,
            type: annotation.type,
          });
        });

      const locked = { disabled: false, blocked: EXTERNAL_BLOCK };
      expect(yield* controls("PUPR5FG5")).toMatchObject({
        color: locked,
        comment: locked,
        tags: locked,
        text: locked,
        delete: locked,
      });
      const free = { disabled: false, blocked: null };
      expect(yield* controls("K3JRFLFQ")).toMatchObject({
        color: free,
        comment: free,
        tags: free,
        text: free,
        delete: free,
      });
    }),
);

it.effect(
  "gives the Editing Capability's reason where it refuses an External Annotation too",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, {}, { key: undefined, external: ["PUPR5FG5"] }),
      );
      const sent = requests.length;
      const capability = yield* service.capabilityFor("RGRPDF24");

      const blocks = annotationBlocks({
        annotation: yield* recordIn(service, "PUPR5FG5"),
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
      expect(yield* service.patchColor("PUPR5FG5", "#ff6666")).toEqual({
        kind: "failed",
        failure: { kind: "unauthorized" },
      });
      expect(requests.slice(sent)).toEqual([]);
    }),
);

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

it.effect(
  "locks another user's Annotation in a group library under the Zotero DB source",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service } = yield* Effect.promise(() =>
        setup(stack, undefined, { group: SYNCED }),
      );

      const list = yield* service.read(GROUP_ATTACHMENT);

      expect(list?.source.kind).toBe("zotero-db");
      expect(groupLocks(list)).toEqual(expectedLocks(BY_COLLEAGUE));
    }),
);

it.effect(
  "locks another user's Annotation under the Local API source, from the Zotero database",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service } = yield* Effect.promise(() => groupWritable(stack));

      const list = yield* service.read(GROUP_ATTACHMENT);

      expect(groupLocks(list)).toEqual(expectedLocks(BY_COLLEAGUE));
    }),
);

it.effect(
  "locks nothing where the group item names no creator: no row, null, or 0",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service } = yield* Effect.promise(() =>
        setup(stack, undefined, { group: SYNCED }),
      );

      const locks = groupLocks(yield* service.read(GROUP_ATTACHMENT));

      expect([locks["4PE492KU"], locks.HRK7BG32, locks.TYY6Z6ZF]).toEqual([
        null,
        null,
        null,
      ]);
      expect(locks.PUPR5FG5).toEqual({ reason: "another-user" });
    }),
);

it.effect(
  "locks nothing by creator for an Annotation the Zotero database does not hold yet",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const unread = {
        ...afterWrite("PUPR5FG5", {}),
        key: "UNREAD23",
        sortIndex: "00000|002050|00170",
      };
      const { repository, service } = yield* Effect.promise(() =>
        setup(
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
        ),
      );
      const announced = nextChange(repository);
      yield* service.read(GROUP_ATTACHMENT);
      yield* Effect.promise(() => announced);

      const list = yield* service.read(GROUP_ATTACHMENT);

      expect(list?.source.kind).toBe("zotero-local-api");
      expect(groupLocks(list)).toEqual({
        ...expectedLocks(BY_COLLEAGUE),
        UNREAD23: null,
      });
    }),
);

it.effect("locks nothing where the database names no account user ID", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const { service } = yield* Effect.promise(() =>
      setup(stack, undefined, {
        group: { createdBy: CREATED_BY },
      }),
    );

    expect(groupLocks(yield* service.read(GROUP_ATTACHMENT))).toEqual(
      expectedLocks(),
    );
  }),
);

it.effect(
  "keeps the known creator locks where the database cannot be read again",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, requests, acquireRead } = yield* Effect.promise(() =>
        groupWritable(stack),
      );

      acquireRead.mockRejectedValue(new Error("database is locked"));
      const refreshed = yield* service.refresh(GROUP_ATTACHMENT);

      expect(refreshed?.source.kind).toBe("zotero-local-api");
      expect(groupLocks(refreshed)).toEqual(expectedLocks(BY_COLLEAGUE));
      const sent = requests.length;
      expect(yield* service.patchColor(inGroup("PUPR5FG5"), "#ff6666")).toEqual(
        ANOTHER_USER_LOCKED,
      );
      expect(requests.slice(sent)).toEqual([]);
    }),
);

it.effect(
  "refuses every edit of another user's Annotation before any request, and sends its delete",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service, requests } = yield* Effect.promise(() =>
        groupWritable(stack),
      );
      const key = inGroup("PUPR5FG5");
      const sent = requests.length;

      const outcomes = [
        yield* service.patchColor(key, "#ff6666"),
        yield* service.patchComment(key, "Worth citing"),
        yield* service.patchGeometry(key, moved("PUPR5FG5"), "pointer"),
      ];

      expect(outcomes).toEqual([
        ANOTHER_USER_LOCKED,
        ANOTHER_USER_LOCKED,
        ANOTHER_USER_LOCKED,
      ]);
      // No draft starts, so no autosave and no Done can send one.
      expect(yield* service.editTextField("comment", key, "typed")).toBeNull();
      expect(yield* service.editTextField("text", key)).toBeNull();
      expect(yield* service.editTags(key, ["review"])).toBeNull();
      expect(requests.slice(sent)).toEqual([]);

      expect(yield* service.deleteAnnotation(key)).toEqual({ kind: "idle" });
      const [erase] = requests.slice(sent);
      expect([erase?.method, erase?.url.pathname]).toEqual([
        "DELETE",
        `/api/groups/${GROUP_ID}/items/PUPR5FG5`,
      ]);
    }),
);

it.effect(
  "refuses the held drafts of an Annotation once the account's first sync names another creator",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const harness = yield* Effect.promise(() =>
        groupWritable(stack, { createdBy: CREATED_BY }),
      );
      const { repository, service, requests, client, dbEvents } = harness;
      const key = inGroup("PUPR5FG5");
      yield* service.editTextField("comment", key, "typed before the sync");
      yield* service.editTextField("text", key, "Identify your message");
      yield* service.editTags(key, ["review"]);
      const sent = requests.length;

      client.$client.exec(
        `insert into settings (setting, key, value) values ('account', 'userID', ${ME});`,
      );
      dbEvents.emit("changed");
      yield* Effect.promise(() =>
        vi.waitFor(async () => {
          const list = await repository.read(GROUP_ATTACHMENT);
          expect(groupLocks(list).PUPR5FG5).toEqual({
            reason: "another-user",
          });
        }),
      );

      expect(yield* service.submitTextField("comment", key)).toEqual(
        ANOTHER_USER_LOCKED,
      );
      expect(yield* service.submitTextField("text", key)).toEqual(
        ANOTHER_USER_LOCKED,
      );
      expect(yield* service.retryTextDraft("comment", key)).toEqual(
        ANOTHER_USER_LOCKED,
      );
      expect(yield* service.submitTags(key)).toEqual(ANOTHER_USER_LOCKED);
      expect(
        requests.slice(sent).filter(({ method }) => method !== "GET"),
      ).toEqual([]);
    }),
);

it.effect(
  "sends a group delete over another user's Annotations, and one undo puts them back unlocked",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary(
        ROUGIER_ANNOTATIONS.map((annotation) => ({
          ...annotation,
          groupID: GROUP_ID,
        })),
      );
      const { repository, service, requests, client, dbEvents } =
        yield* Effect.promise(() =>
          setup(stack, zotero.answers, {
            key: REMEMBERED_KEY,
            group: SYNCED,
          }),
        );
      yield* service.read(GROUP_ATTACHMENT);
      yield* Effect.promise(() =>
        vi.waitFor(async () =>
          expect((await repository.read(GROUP_ATTACHMENT))?.source.kind).toBe(
            "zotero-local-api",
          ),
        ),
      );
      yield* service.openHistory(GROUP_ATTACHMENT);
      const sent = requests.length;

      expect(
        yield* service.deleteAnnotations([
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
      expect(yield* service.undo(GROUP_ATTACHMENT)).toMatchObject({
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
      const restored = groupLocks(yield* service.refresh(GROUP_ATTACHMENT));
      expect([restored.MADE2345, restored.MADE2346]).toEqual([null, null]);
    }),
);

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
  const { repository, service } = await setup(stack, zotero.answers, {
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
  return service;
}

it.effect(
  "counts only another user's Annotations as restored with the user as creator",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const service = yield* Effect.promise(() => groupHistory(stack));

      expect(
        yield* service.deleteAnnotations([
          inGroup("PUPR5FG5"),
          inGroup("K3JRFLFQ"),
          inGroup("FDRFQ7C2"),
        ]),
      ).toEqual([{ kind: "idle" }, { kind: "idle" }, { kind: "idle" }]);

      expect(yield* service.undo(GROUP_ATTACHMENT)).toMatchObject({
        kind: "stepped",
        restoredAsCreator: { count: 1 },
      });
    }),
);

it.effect(
  "says nothing of the creator on the undo of a delete of the user's own group Annotation",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const service = yield* Effect.promise(() => groupHistory(stack));

      expect(yield* service.deleteAnnotation(inGroup("K3JRFLFQ"))).toEqual({
        kind: "idle",
      });

      expect(yield* service.undo(GROUP_ATTACHMENT)).toEqual({
        kind: "stepped",
        annotationKey: inGroup("MADE2345"),
      });
    }),
);

it.effect(
  "says nothing of the creator on the undo of a delete in the Personal Library",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      expect(yield* service.deleteAnnotation("HRK7BG32")).toEqual({
        kind: "idle",
      });

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "stepped",
        annotationKey: "MADE2345",
      });
    }),
);

it.effect(
  "dims the edits of another user's Annotation and leaves its delete, and none of the user's own",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const { service } = yield* Effect.promise(() => groupWritable(stack));
      const controls = (key: string) =>
        Effect.gen(function* () {
          const annotation = (yield* service.peek(
            GROUP_ATTACHMENT,
          ))?.value.annotations.find((record) => record.key === inGroup(key));
          if (!annotation) throw new Error(`No record ${key}`);
          return cardControls({
            blocks: annotationBlocks({
              annotation,
              capability: yield* service.capabilityFor(GROUP_ATTACHMENT),
              now: NOW,
            }),
            mutation: yield* service.mutationFor(annotation.key),
            hasTags: annotation.tags.length > 0,
            type: annotation.type,
          });
        });

      const locked = { disabled: false, blocked: ANOTHER_USER_BLOCK };
      const free = { disabled: false, blocked: null };
      expect(yield* controls("PUPR5FG5")).toMatchObject({
        color: locked,
        comment: locked,
        tags: locked,
        text: locked,
        delete: free,
      });
      expect(yield* controls("K3JRFLFQ")).toMatchObject({
        color: free,
        comment: free,
        tags: free,
        text: free,
        delete: free,
      });
    }),
);

// #endregion
