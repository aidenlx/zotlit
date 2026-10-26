// The Annotation Repository's Annotation History: recorded steps, undo and redo, geometry runs, and comment and tag sessions.
import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { expect, vi } from "vitest";

import {
  annotationItem,
  annotationPage,
  localApiDisabled,
  notFound,
  rootOk,
  ROUGIER_ANNOTATIONS,
  staleVersion,
  writeAccepted,
} from "@/services/zotero-local-api/__fixtures__";
import type {
  WireAnnotation,
  ZoteroAnswers,
  ZoteroRequest,
} from "@/services/zotero-local-api/__fixtures__";
import {
  capabilityBlocks,
  cardControls,
} from "@/views/annot-view/card-controls";

import {
  NOW,
  eventually,
  scopedStack,
  settledDraft,
  writable,
  zoteroLibrary,
  DRAFT,
  zoteroHolding,
  moved,
  zoteroTagging,
  TAGGED,
} from "./__fixtures__";
import { JOIN_WINDOW_MS } from "./history";
import type { AnnotationRepository } from "./service";

// #region annotation history

it.effect("puts the previous colour back when a colour pick is undone", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHolding("PUPR5FG5");
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");

    yield* service.patchColor("PUPR5FG5", "#ff6666");
    expect(zotero.held?.color).toBe("#ff6666");

    expect(yield* service.undo("RGRPDF24")).toEqual({
      kind: "stepped",
      annotationKey: "PUPR5FG5",
    });
    expect(zotero.held?.color).toBe("#2ea8e5");
    expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    expect(yield* service.canRedo("RGRPDF24")).toBe(true);
  }),
);

it.effect("builds the redo from the undo's own confirmed result", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHolding("PUPR5FG5");
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");
    yield* service.patchColor("PUPR5FG5", "#ff6666");
    yield* service.undo("RGRPDF24");

    expect(yield* service.redo("RGRPDF24")).toEqual({
      kind: "stepped",
      annotationKey: "PUPR5FG5",
    });
    expect(zotero.held?.color).toBe("#ff6666");
    // Stepping back and forth compares the two states as often as asked.
    expect(yield* service.undo("RGRPDF24")).toMatchObject({
      kind: "stepped",
    });
    expect(zotero.held?.color).toBe("#2ea8e5");
  }),
);

it.effect("discards the redo steps when a new edit is recorded", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHolding("PUPR5FG5");
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");
    yield* service.patchColor("PUPR5FG5", "#ff6666");
    yield* service.undo("RGRPDF24");

    yield* service.patchColor("PUPR5FG5", "#5fb236");

    expect(yield* service.canRedo("RGRPDF24")).toBe(false);
    expect(yield* service.redo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.held?.color).toBe("#5fb236");
  }),
);

it.effect(
  "undoes where Zotero already holds the colour the undo would write",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      yield* service.patchColor("PUPR5FG5", "#ff6666");

      // Someone put the first colour back in Zotero. The undo's write is refused
      // over the version it moved, and the re-read finds the very value the undo
      // asked for: an equal value is a match, so no false conflict appears.
      zotero.refuseNextWrite();
      zotero.changeInZotero({ color: "#2ea8e5" });

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "stepped",
        annotationKey: "PUPR5FG5",
      });
      expect(zotero.held?.color).toBe("#2ea8e5");
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
      expect(yield* service.canRedo("RGRPDF24")).toBe(true);
    }),
);

it.effect("undoes a colour pick when Zotero changed another field of it", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHolding("PUPR5FG5");
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");
    yield* service.patchColor("PUPR5FG5", "#ff6666");

    zotero.changeInZotero({ comment: "Read again in Zotero" });
    yield* service.refresh("RGRPDF24");

    expect(yield* service.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
    expect(zotero.held?.color).toBe("#2ea8e5");
    expect(zotero.held?.comment).toBe("Read again in Zotero");
  }),
);

it.effect(
  "writes nothing and drops the step where Zotero holds another colour",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      yield* service.patchColor("PUPR5FG5", "#ff6666");

      zotero.changeInZotero({ color: "#5fb236" });
      yield* service.refresh("RGRPDF24");

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "changed",
        annotationKey: "PUPR5FG5",
      });
      expect(zotero.held?.color).toBe("#5fb236");
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect("drops a step whose Annotation Zotero no longer holds", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHolding("PUPR5FG5");
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");
    yield* service.patchColor("PUPR5FG5", "#ff6666");

    zotero.eraseInZotero();
    yield* service.refresh("RGRPDF24");

    expect(yield* service.undo("RGRPDF24")).toEqual({
      kind: "changed",
      annotationKey: "PUPR5FG5",
    });
    expect(yield* service.canUndo("RGRPDF24")).toBe(false);
  }),
);

it.effect("sends the undo again after a 412 that only moved the version", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHolding("PUPR5FG5");
    const { service, requests } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");
    yield* service.patchColor("PUPR5FG5", "#ff6666");
    const sent = requests.length;

    zotero.refuseNextWrite();

    expect(yield* service.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
    expect(zotero.held?.color).toBe("#2ea8e5");
    // The refused write, and the one that landed after the re-read.
    expect(
      requests.slice(sent).filter(({ method }) => method === "PATCH"),
    ).toHaveLength(2);
  }),
);

it.effect(
  "drops the step where the 412 answers a colour changed in Zotero",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      yield* service.patchColor("PUPR5FG5", "#ff6666");

      // The list ZotLit holds still says `#ff6666`; Zotero moved under the write.
      zotero.refuseNextWrite();
      zotero.changeInZotero({ color: "#5fb236" });

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "changed",
        annotationKey: "PUPR5FG5",
      });
      expect(zotero.held?.color).toBe("#5fb236");
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect(
  "drops the step and names the failure where the undo does not land",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      let deny = false;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          ...zotero.answers,
          write: (request) =>
            deny ? notFound() : zotero.answers.write(request),
        }),
      );
      yield* service.openHistory("RGRPDF24");
      yield* service.patchColor("PUPR5FG5", "#ff6666");

      deny = true;

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "failed",
        failure: { kind: "not-found" },
      });
      expect(zotero.held?.color).toBe("#ff6666");
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect("keeps the last 100 steps and drops the oldest first", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHolding("PUPR5FG5");
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");

    // 101 picks make 101 steps; the first one recorded is the one that goes.
    const picks = Array.from(
      { length: 101 },
      (_unused, index) => `#0000${index.toString(16).padStart(2, "0")}`,
    );
    for (const color of picks) yield* service.patchColor("PUPR5FG5", color);

    let stepped = 0;
    while ((yield* service.undo("RGRPDF24")).kind === "stepped") stepped += 1;

    expect(stepped).toBe(100);
    // The oldest step held `#2ea8e5`; with it gone, the walk ends on the first
    // colour this test picked.
    expect(zotero.held?.color).toBe(picks[0]);
  }),
);

it.effect(
  "does nothing while a write on the Attachment is still on its way",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const gate = Promise.withResolvers<void>();
      let holdNext = false;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          ...zotero.answers,
          write: async (request) => {
            if (holdNext) {
              holdNext = false;
              await gate.promise;
            }
            return zotero.answers.write(request);
          },
        }),
      );
      yield* service.openHistory("RGRPDF24");
      yield* service.patchColor("PUPR5FG5", "#ff6666");

      holdNext = true;
      const slow = yield* Effect.forkChild(
        service.patchColor("PUPR5FG5", "#5fb236"),
        { startImmediately: true },
      );

      expect(yield* service.undo("RGRPDF24")).toEqual({ kind: "idle" });
      gate.resolve();
      yield* Fiber.join(slow);
      // The key was not queued: nothing ran when the save landed.
      expect(zotero.held?.color).toBe("#5fb236");
      expect(yield* service.canUndo("RGRPDF24")).toBe(true);
    }),
);

it.effect("does nothing while an undo of the same Attachment is running", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHolding("PUPR5FG5");
    const gate = Promise.withResolvers<void>();
    let holdNext = false;
    const { service } = yield* Effect.promise(() =>
      writable(stack, {
        ...zotero.answers,
        write: async (request) => {
          if (holdNext) {
            holdNext = false;
            await gate.promise;
          }
          return zotero.answers.write(request);
        },
      }),
    );
    yield* service.openHistory("RGRPDF24");
    yield* service.patchColor("PUPR5FG5", "#ff6666");
    yield* service.patchColor("PUPR5FG5", "#5fb236");

    holdNext = true;
    const running = yield* Effect.forkChild(service.undo("RGRPDF24"), {
      startImmediately: true,
    });

    expect(yield* service.undo("RGRPDF24")).toEqual({ kind: "idle" });
    gate.resolve();
    expect(yield* Fiber.join(running)).toMatchObject({ kind: "stepped" });
    expect(zotero.held?.color).toBe("#ff6666");
  }),
);

it.effect(
  "answers blocked and writes nothing without the Editing Capability",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      let running = true;
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          ...zotero.answers,
          root: () => (running ? rootOk() : localApiDisabled()),
        }),
      );
      yield* service.openHistory("RGRPDF24");
      yield* service.patchColor("PUPR5FG5", "#ff6666");

      running = false;
      yield* service.probe;

      expect(yield* service.undo("RGRPDF24")).toEqual({ kind: "blocked" });
      expect(zotero.held?.color).toBe("#ff6666");
      // The step stands, so the key works again once editing is allowed.
      expect(yield* service.canUndo("RGRPDF24")).toBe(true);
    }),
);

it.effect("records nothing while no PDF view holds a history open", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHolding("PUPR5FG5");
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );

    yield* service.patchColor("PUPR5FG5", "#ff6666");
    yield* service.openHistory("RGRPDF24");

    expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    expect(yield* service.undo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.held?.color).toBe("#ff6666");
  }),
);

it.effect(
  "shares one history across two views, and ends it with the last",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      const changed: string[] = [];
      stack.defer(
        repository.listen("history-changed", (key) => changed.push(key)),
      );

      yield* service.openHistory("RGRPDF24");
      yield* service.openHistory("RGRPDF24");
      yield* service.patchColor("PUPR5FG5", "#ff6666");

      // The second view closed; the history the first one opened stands.
      yield* service.closeHistory("RGRPDF24");
      expect(yield* service.canUndo("RGRPDF24")).toBe(true);

      yield* service.closeHistory("RGRPDF24");
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
      expect(yield* service.undo("RGRPDF24")).toEqual({ kind: "idle" });
      expect(zotero.held?.color).toBe("#ff6666");
      expect(new Set(changed)).toEqual(new Set(["RGRPDF24"]));
    }),
);

it.effect(
  "keeps the history across a Refresh and a change made in Zotero",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      yield* service.patchColor("PUPR5FG5", "#ff6666");

      zotero.changeInZotero({ comment: "Noted in Zotero" });
      yield* service.refresh("RGRPDF24");

      expect(yield* service.canUndo("RGRPDF24")).toBe(true);
      expect(yield* service.undo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      expect(zotero.held?.color).toBe("#2ea8e5");
    }),
);

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

it.effect(
  "erases the Annotation a create made, and redoes it under a new key",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      const made = yield* service.createAnnotation("RGRPDF24", DRAFT);
      expect(made).toEqual({ kind: "created", annotationKey: "MADE2345" });

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "removed",
        annotationKey: "MADE2345",
        pageIndex: 0,
      });
      expect(zotero.at("MADE2345")).toBeNull();

      expect(yield* service.redo("RGRPDF24")).toEqual({
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
      expect(yield* service.canUndo("RGRPDF24")).toBe(true);
    }),
);

it.effect(
  "puts a deleted Annotation back under a new key, with what it held",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      const seed = zotero.at("HRK7BG32")!;

      expect(yield* service.deleteAnnotation("HRK7BG32")).toEqual({
        kind: "idle",
      });
      expect(zotero.at("HRK7BG32")).toBeNull();

      expect(yield* service.undo("RGRPDF24")).toEqual({
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
      expect(yield* service.redo("RGRPDF24")).toEqual({
        kind: "removed",
        annotationKey: "MADE2345",
        pageIndex: 0,
      });
      expect(zotero.at("MADE2345")).toBeNull();
    }),
);

it.effect(
  "puts a deleted Annotation's tags back with it, each of its own type",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary(
        ROUGIER_ANNOTATIONS.map((entry) =>
          entry.key === "HRK7BG32"
            ? { ...entry, tags: ["figure", { tag: "from-pdf", type: 1 }] }
            : entry,
        ),
      );
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      yield* service.deleteAnnotation("HRK7BG32");
      yield* service.undo("RGRPDF24");

      expect(zotero.at("MADE2345")?.tags).toEqual([
        "figure",
        { tag: "from-pdf", type: 1 },
      ]);
    }),
);

it.effect(
  "answers for the new key in every step of both stacks after a restore",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      yield* service.patchColor("PUPR5FG5", "#ff6666");
      yield* service.deleteAnnotation("PUPR5FG5");

      // The delete comes back first, under a key Zotero picked.
      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "stepped",
        annotationKey: "MADE2345",
      });
      expect(zotero.at("MADE2345")?.color).toBe("#ff6666");

      // The colour step below it was recorded against the old key and takes the
      // new one, so the second press puts the first colour back on the restore.
      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "stepped",
        annotationKey: "MADE2345",
      });
      expect(zotero.at("MADE2345")?.color).toBe("#2ea8e5");
      expect(zotero.at("PUPR5FG5")).toBeNull();
    }),
);

it.effect("takes every Annotation of one gesture in a single step", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroLibrary();
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");

    // One stroke split at the position ceiling: two creates, one gesture.
    yield* service.createAnnotation("RGRPDF24", INK_DRAFT, { group: "ink-1" });
    yield* service.createAnnotation(
      "RGRPDF24",
      { ...INK_DRAFT, sortIndex: "00000|000040|00101" },
      { group: "ink-1" },
    );

    expect(yield* service.undo("RGRPDF24")).toEqual({
      kind: "removed",
      annotationKey: "MADE2345",
      pageIndex: 0,
    });
    expect(zotero.at("MADE2345")).toBeNull();
    expect(zotero.at("MADE2346")).toBeNull();
    // One step held both, so there is nothing left to undo.
    expect(yield* service.canUndo("RGRPDF24")).toBe(false);
  }),
);

it.effect(
  "writes nothing where one Annotation of a gesture moved in Zotero",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      yield* service.createAnnotation("RGRPDF24", INK_DRAFT, {
        group: "ink-1",
      });
      yield* service.createAnnotation(
        "RGRPDF24",
        { ...INK_DRAFT, sortIndex: "00000|000040|00101" },
        { group: "ink-1" },
      );

      zotero.changeInZotero("MADE2346", { color: "#a28ae5" });
      yield* service.refresh("RGRPDF24");
      const sent = requests.length;

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "changed",
        annotationKey: "MADE2346",
      });
      // The first part of the stroke stands: the step is taken whole or not at all.
      expect(zotero.at("MADE2345")).not.toBeNull();
      expect(zotero.at("MADE2346")).not.toBeNull();
      expect(
        requests.slice(sent).filter(({ method }) => method === "DELETE"),
      ).toHaveLength(0);
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect(
  "takes a group delete in one step, and one undo puts every Annotation back",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      const seeds = ["HRK7BG32", "C94NJNYG"].map((key) => zotero.at(key)!);
      const sent = requests.length;

      expect(
        yield* service.deleteAnnotations(["HRK7BG32", "C94NJNYG"]),
      ).toEqual([{ kind: "idle" }, { kind: "idle" }]);
      // One request per Annotation.
      expect(
        requests.slice(sent).filter(({ method }) => method === "DELETE"),
      ).toHaveLength(2);
      expect(zotero.at("HRK7BG32")).toBeNull();
      expect(zotero.at("C94NJNYG")).toBeNull();

      yield* service.undo("RGRPDF24");
      // Both come back, each under a key Zotero picked, from the one press.
      for (const [index, seed] of seeds.entries()) {
        expect(zotero.at(`MADE234${5 + index}`)).toMatchObject({
          type: seed.type,
          comment: seed.comment,
          sortIndex: seed.sortIndex,
          position: seed.position,
        });
      }
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect(
  "puts the tags of every Annotation of a group delete back with it, each of its own type",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary(
        ROUGIER_ANNOTATIONS.map((entry) =>
          entry.key === "HRK7BG32"
            ? { ...entry, tags: ["figure", { tag: "from-pdf", type: 1 }] }
            : entry.key === "C94NJNYG"
              ? { ...entry, tags: ["method"] }
              : entry,
        ),
      );
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      yield* service.deleteAnnotations(["HRK7BG32", "C94NJNYG"]);
      yield* service.undo("RGRPDF24");

      expect(zotero.at("MADE2345")?.tags).toEqual([
        "figure",
        { tag: "from-pdf", type: 1 },
      ]);
      expect(zotero.at("MADE2346")?.tags).toEqual(["method"]);
    }),
);

it.effect(
  "records a group delete as one step in key order, over a write that landed between its deletes",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      // Zotero holds its answer to the first delete, so the second lands first
      // and a recolour of another Annotation lands between the two.
      const held = Promise.withResolvers<void>();
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          ...zotero.answers,
          write: async (request) => {
            if (
              request.method === "DELETE" &&
              request.url.pathname.endsWith("HRK7BG32")
            )
              await held.promise;
            return zotero.answers.write!(request);
          },
        }),
      );
      yield* service.openHistory("RGRPDF24");
      const seeds = ["HRK7BG32", "C94NJNYG"].map((key) => zotero.at(key)!);

      const group = yield* Effect.forkChild(
        service.deleteAnnotations(["HRK7BG32", "C94NJNYG"]),
        { startImmediately: true },
      );
      expect(yield* service.patchColor("PUPR5FG5", "#ff6666")).toEqual({
        kind: "idle",
      });
      held.resolve();
      expect(yield* Fiber.join(group)).toEqual([
        { kind: "idle" },
        { kind: "idle" },
      ]);

      // One press puts the whole group back, in the order the gesture named it:
      // the first restore is the first key's.
      yield* service.undo("RGRPDF24");
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
      yield* service.undo("RGRPDF24");
      expect(zotero.at("PUPR5FG5")?.color).toBe("#2ea8e5");
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect(
  "keeps each Annotation's own outcome where one delete of a group is refused",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          ...zotero.answers,
          write: (request) =>
            request.method === "DELETE" &&
            request.url.pathname.endsWith("PUPR5FG5")
              ? staleVersion()
              : zotero.answers.write!(request),
        }),
      );
      yield* service.openHistory("RGRPDF24");
      // Zotero recoloured one of them since ZotLit read it.
      zotero.changeInZotero("PUPR5FG5", { color: "#5fb236" });

      const outcomes = yield* service.deleteAnnotations([
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
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual(outcomes[1]);
      expect(zotero.at("PUPR5FG5")?.color).toBe("#5fb236");

      // The step holds the two deletes that landed and nothing of the refused one.
      yield* service.undo("RGRPDF24");
      expect(zotero.at("MADE2345")).not.toBeNull();
      expect(zotero.at("MADE2346")).not.toBeNull();
      expect(zotero.at("MADE2347")).toBeNull();
      expect(zotero.at("PUPR5FG5")?.color).toBe("#5fb236");
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect(
  "takes a group recolour in one step, and one undo puts every colour back",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      const keys = ["PUPR5FG5", "K3JRFLFQ", "C94NJNYG"];
      const before = keys.map((key) => zotero.at(key)?.color);
      const sent = requests.length;

      expect(yield* service.patchColors(keys, "#5FB236")).toEqual([
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

      expect(yield* service.undo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      expect(keys.map((key) => zotero.at(key)?.color)).toEqual(before);
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect(
  "keeps each Annotation's own outcome where one recolour of a group is refused",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service } = yield* Effect.promise(() =>
        writable(stack, {
          ...zotero.answers,
          write: (request) =>
            request.method === "PATCH" &&
            request.url.pathname.endsWith("K3JRFLFQ")
              ? staleVersion()
              : zotero.answers.write!(request),
        }),
      );
      yield* service.openHistory("RGRPDF24");
      // Zotero recoloured one of them since ZotLit read it.
      zotero.changeInZotero("K3JRFLFQ", { color: "#a28ae5" });

      const outcomes = yield* service.patchColors(
        ["PUPR5FG5", "K3JRFLFQ", "C94NJNYG"],
        "#5fb236",
      );

      expect(outcomes[0]).toEqual({ kind: "idle" });
      expect(outcomes[1]).toMatchObject({
        kind: "conflict",
        conflict: { write: "color" },
      });
      expect(outcomes[2]).toEqual({ kind: "idle" });
      expect(yield* service.mutationFor("K3JRFLFQ")).toEqual(outcomes[1]);
      expect(zotero.at("K3JRFLFQ")?.color).toBe("#a28ae5");

      // The step holds the two recolours that landed and nothing of the refused one.
      yield* service.undo("RGRPDF24");
      expect(zotero.at("PUPR5FG5")?.color).toBe("#2ea8e5");
      expect(zotero.at("C94NJNYG")?.color).toBe("#ffd400");
      expect(zotero.at("K3JRFLFQ")?.color).toBe("#a28ae5");
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect(
  "drops the step where Zotero already erased the Annotation a create made",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      yield* service.createAnnotation("RGRPDF24", DRAFT);

      zotero.eraseInZotero("MADE2345");
      yield* service.refresh("RGRPDF24");
      const sent = requests.length;

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "changed",
        annotationKey: "MADE2345",
      });
      expect(
        requests.slice(sent).filter(({ method }) => method === "DELETE"),
      ).toHaveLength(0);
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect(
  "drops the step where Zotero put the deleted Annotation back itself",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroLibrary();
      const { service, requests } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      yield* service.deleteAnnotation("C94NJNYG");

      // Zotero's own trash gave the note Annotation back while the reader stood
      // open, so there is nothing for the undo to create.
      zotero.restoreInZotero("C94NJNYG");
      yield* service.refresh("RGRPDF24");
      const sent = requests.length;

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "changed",
        annotationKey: "C94NJNYG",
      });
      expect(
        requests.slice(sent).filter(({ method }) => method === "POST"),
      ).toHaveLength(0);
    }),
);

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

/** The geometry a landed {@link moved} leaves in Zotero. */
function movedGeometry(annotationKey: string, step = 0) {
  const { position, sortIndex } = moved(annotationKey, step);
  return { position, sortIndex };
}

it.effect(
  "puts the position, Sort Index and quoted text back when a drag is undone",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHoldingMarks();
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      const seed = seeded("PUPR5FG5");

      yield* service.patchGeometry(
        "PUPR5FG5",
        { ...moved("PUPR5FG5"), text: "Identify Your" },
        "pointer",
      );
      expect(zotero.held("PUPR5FG5")).toMatchObject({
        ...movedGeometry("PUPR5FG5"),
        text: "Identify Your",
      });

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "stepped",
        annotationKey: "PUPR5FG5",
      });
      expect(zotero.held("PUPR5FG5")).toMatchObject({
        position: seed.position,
        sortIndex: seed.sortIndex,
        text: seed.text,
      });

      expect(yield* service.redo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      expect(zotero.held("PUPR5FG5")).toMatchObject({
        ...movedGeometry("PUPR5FG5"),
        text: "Identify Your",
      });
    }),
);

it.effect("undoes a run of keyboard nudges inside the window as one step", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHoldingMarks();
    const { service, adjustLayerClock } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");

    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
    yield* adjustLayerClock(200);
    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");
    expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5", 1));

    // One press goes back to where the mark stood before the first nudge.
    expect(yield* service.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
    expect(zotero.held("PUPR5FG5")).toMatchObject({
      position: seeded("PUPR5FG5").position,
      sortIndex: seeded("PUPR5FG5").sortIndex,
    });
    expect(yield* service.canUndo("RGRPDF24")).toBe(false);
  }),
);

it.effect("redoes a joined run of nudges as the one step it became", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHoldingMarks();
    const { service, adjustLayerClock } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");

    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
    yield* adjustLayerClock(200);
    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");
    yield* service.undo("RGRPDF24");

    // One press forward puts the whole run back, at the place the last nudge of
    // it left the mark.
    expect(yield* service.redo("RGRPDF24")).toMatchObject({ kind: "stepped" });
    expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5", 1));
    expect(yield* service.canRedo("RGRPDF24")).toBe(false);
  }),
);

it.effect("discards the redo steps when a nudge joins the run on top", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHoldingMarks();
    const { service, adjustLayerClock } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");

    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
    yield* service.patchGeometry("K3JRFLFQ", moved("K3JRFLFQ"), "keyboard");
    yield* service.undo("RGRPDF24");
    expect(yield* service.canRedo("RGRPDF24")).toBe(true);

    // A nudge on the Annotation the step under the undone one names joins that
    // step, and a joined edit is a new edit: what a redo would have put back is
    // discarded, as it is for a step of its own.
    yield* adjustLayerClock(200);
    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");

    expect(yield* service.canRedo("RGRPDF24")).toBe(false);
    expect(yield* service.redo("RGRPDF24")).toEqual({ kind: "idle" });
  }),
);

it.effect("keeps a keyboard nudge made after the window as its own step", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHoldingMarks();
    const { service, adjustLayerClock } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");

    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
    yield* adjustLayerClock(600);
    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");

    expect(yield* service.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
    expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5", 0));
    expect(yield* service.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
    expect(zotero.held("PUPR5FG5")).toMatchObject({
      position: seeded("PUPR5FG5").position,
      sortIndex: seeded("PUPR5FG5").sortIndex,
    });
  }),
);

it.effect(
  "keeps a keyboard nudge made at the window's own edge as its own step",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHoldingMarks();
      const { service, adjustLayerClock } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      yield* service.patchGeometry(
        "PUPR5FG5",
        moved("PUPR5FG5", 0),
        "keyboard",
      );
      // Exactly the window: the run ends at it rather than inside it.
      yield* adjustLayerClock(JOIN_WINDOW_MS);
      yield* service.patchGeometry(
        "PUPR5FG5",
        moved("PUPR5FG5", 1),
        "keyboard",
      );

      expect(yield* service.undo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      expect(zotero.held("PUPR5FG5")).toMatchObject(
        movedGeometry("PUPR5FG5", 0),
      );
      expect(yield* service.canUndo("RGRPDF24")).toBe(true);
    }),
);

it.effect("keeps a keyboard nudge on another Annotation as its own step", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHoldingMarks();
    const { service, adjustLayerClock } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");

    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5"), "keyboard");
    yield* adjustLayerClock(100);
    yield* service.patchGeometry("K3JRFLFQ", moved("K3JRFLFQ"), "keyboard");

    expect(yield* service.undo("RGRPDF24")).toEqual({
      kind: "stepped",
      annotationKey: "K3JRFLFQ",
    });
    expect(zotero.held("K3JRFLFQ")).toMatchObject({
      position: seeded("K3JRFLFQ").position,
      sortIndex: seeded("K3JRFLFQ").sortIndex,
    });
    // The other mark's nudge stands as a step of its own.
    expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5"));
    expect(yield* service.canUndo("RGRPDF24")).toBe(true);
  }),
);

it.effect("keeps a pointer Geometry Edit out of a run of keyboard nudges", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHoldingMarks();
    const { service, adjustLayerClock } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");

    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
    yield* adjustLayerClock(100);
    // A handle drag, inside the window a nudge would have joined in.
    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "pointer");

    expect(yield* service.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
    expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5", 0));
    expect(yield* service.canUndo("RGRPDF24")).toBe(true);
  }),
);

it.effect("keeps a colour pick out of a run of keyboard nudges", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHoldingMarks();
    const { service, adjustLayerClock } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");

    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
    yield* adjustLayerClock(100);
    yield* service.patchColor("PUPR5FG5", "#ff6666");
    yield* adjustLayerClock(100);
    yield* service.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");

    // Steps of different kinds never merge, so the nudge after the pick is its
    // own step and undoing it leaves the picked colour alone.
    expect(yield* service.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
    expect(zotero.held("PUPR5FG5")).toMatchObject({
      ...movedGeometry("PUPR5FG5", 0),
      color: "#ff6666",
    });
    expect(yield* service.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
    expect(zotero.held("PUPR5FG5")).toMatchObject({
      ...movedGeometry("PUPR5FG5", 0),
      color: "#2ea8e5",
    });
  }),
);

// #endregion

// #region comment editing sessions

//
// Each session's autosaves run on the repository's TestClock, which the idle
// timer is armed on; a case waits for the save a timer started to land.

it.effect(
  "makes one step of a comment session, however many times it saved",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const { service, adjustLayerClock } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      // The Mark Popup types, and an Annotation Card carries the editing on
      // through the very same verb: the hand-off between them is one session.
      yield* service.editTextField("comment", "PUPR5FG5", "Worth");
      yield* adjustLayerClock("1 second");
      yield* settledDraft(service, "comment");
      expect(zotero.held?.comment).toBe("Worth");
      yield* service.editTextField("comment", "PUPR5FG5", "Worth citing");
      yield* adjustLayerClock("1 second");
      yield* settledDraft(service, "comment");
      expect(zotero.held?.comment).toBe("Worth citing");
      yield* service.editTextField("comment", "PUPR5FG5", "Worth citing twice");
      yield* service.submitTextField("comment", "PUPR5FG5");
      expect(zotero.held?.comment).toBe("Worth citing twice");

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "stepped",
        annotationKey: "PUPR5FG5",
      });
      // The whole session went back in one press, to the text the draft was born
      // with rather than the text the last autosave left.
      expect(zotero.held?.comment).toBe("");
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);

      expect(yield* service.redo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      expect(zotero.held?.comment).toBe("Worth citing twice");
    }),
);

it.effect(
  "makes one step of a Text Edit session, and undo writes back the earlier text alone",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const original = zotero.held!.text;
      const { service, requests, adjustLayerClock } = yield* Effect.promise(
        () => writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      yield* service.editTextField("text", "PUPR5FG5", "Identify");
      yield* adjustLayerClock("1 second");
      yield* settledDraft(service, "text");
      expect(zotero.held?.text).toBe("Identify");
      yield* service.editTextField("text", "PUPR5FG5", "Identify your message");
      yield* service.submitTextField("text", "PUPR5FG5");
      expect(zotero.held?.text).toBe("Identify your message");

      const sent = requests.length;
      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "stepped",
        annotationKey: "PUPR5FG5",
      });
      // The whole session went back in one press, to the text it began with,
      // through a patch of the text alone.
      expect(zotero.held?.text).toBe(original);
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
      const [patch] = requests
        .slice(sent)
        .filter(({ method }) => method === "PATCH");
      expect(Object.keys(JSON.parse(patch!.body ?? "{}")).sort()).toEqual([
        "annotationText",
        "version",
      ]);

      expect(yield* service.redo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      expect(zotero.held?.text).toBe("Identify your message");
    }),
);

it.effect(
  "keeps a Text Edit session and a comment session after it as two steps",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const original = zotero.held!.text;
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      yield* service.editTextField("text", "PUPR5FG5", "Identify your message");
      yield* service.submitTextField("text", "PUPR5FG5");
      yield* service.editTextField("comment", "PUPR5FG5", "Worth citing");
      yield* service.submitTextField("comment", "PUPR5FG5");

      // The comment session went back alone, and the text stayed.
      expect(yield* service.undo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      expect(zotero.held?.comment).toBe("");
      expect(zotero.held?.text).toBe("Identify your message");

      expect(yield* service.undo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      expect(zotero.held?.text).toBe(original);
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect(
  "starts a new step where the comment moved in Zotero between two saves",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const { service, adjustLayerClock } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      yield* service.editTextField("comment", "PUPR5FG5", "Worth citing");
      yield* adjustLayerClock("1 second");
      yield* settledDraft(service, "comment");
      expect(zotero.held?.comment).toBe("Worth citing");

      // The same comment is changed in Zotero, so the next save is refused and
      // the card offers "Apply again" against the value Zotero holds now.
      zotero.changeInZotero({ comment: "Cited by Perez" });
      zotero.refuseNextWrite();
      yield* service.editTextField("comment", "PUPR5FG5", "Worth citing twice");
      yield* adjustLayerClock("1 second");
      yield* eventually(
        service.textDraftFor("comment", "PUPR5FG5"),
        (draft) => draft?.state.kind === "conflict",
      );
      yield* service.retryTextDraft("comment", "PUPR5FG5");
      expect(zotero.held?.comment).toBe("Worth citing twice");
      yield* service.discardTextDraft("comment", "PUPR5FG5");

      // The write that landed was stamped off the Zotero-side text, so it
      // starts a step of its own: one press puts that text back rather than
      // writing over it with the empty comment the first session began with.
      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "stepped",
        annotationKey: "PUPR5FG5",
      });
      expect(zotero.held?.comment).toBe("Cited by Perez");

      // The first session's own step stands behind it, and it is the Zotero-side
      // text that now blocks it rather than the step having written it away.
      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "changed",
        annotationKey: "PUPR5FG5",
      });
      expect(zotero.held?.comment).toBe("Cited by Perez");
    }),
);

it.effect("records no step for a comment draft discarded before it saved", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHolding("PUPR5FG5");
    const { service, adjustLayerClock } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");

    yield* service.editTextField("comment", "PUPR5FG5", "Never saved");
    yield* service.discardTextDraft("comment", "PUPR5FG5");
    yield* adjustLayerClock("10 seconds");

    expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    expect(yield* service.undo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.held?.comment).toBeUndefined();
  }),
);

it.effect(
  "records no step where a comment session settles on its starting text",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("HRK7BG32");
      const seeded = zotero.held!.comment!;
      const { service, adjustLayerClock } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      yield* service.editTextField("comment", "HRK7BG32", `${seeded} and slow`);
      yield* adjustLayerClock("1 second");
      yield* settledDraft(service, "comment", "HRK7BG32");
      expect(zotero.held?.comment).toBe(`${seeded} and slow`);

      // The researcher typed the ending away again before leaving the editor.
      yield* service.editTextField("comment", "HRK7BG32", seeded);
      yield* adjustLayerClock("1 second");
      yield* settledDraft(service, "comment", "HRK7BG32");
      expect(zotero.held?.comment).toBe(seeded);

      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
      expect(yield* service.undo("RGRPDF24")).toEqual({ kind: "idle" });
      expect(zotero.held?.comment).toBe(seeded);
    }),
);

it.effect(
  "does nothing while the Annotation the top step touches is being edited",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const { service, adjustLayerClock } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      yield* service.editTextField("comment", "PUPR5FG5", "Half typed");
      yield* adjustLayerClock("1 second");
      yield* settledDraft(service, "comment");
      expect(zotero.held?.comment).toBe("Half typed");

      // The comment editor is open again on the same Annotation, with nothing
      // typed into it yet, so the keys belong to the editor holding it.
      yield* service.editTextField("comment", "PUPR5FG5");
      expect(yield* service.undo("RGRPDF24")).toEqual({ kind: "idle" });
      expect(zotero.held?.comment).toBe("Half typed");
      // The menu row and the palette entry read this, so neither is drawn for a
      // press that would do nothing and say nothing.
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);

      // The editor closed, keeping what Zotero holds.
      yield* service.discardTextDraft("comment", "PUPR5FG5");
      expect(yield* service.canUndo("RGRPDF24")).toBe(true);

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "stepped",
        annotationKey: "PUPR5FG5",
      });
      expect(zotero.held?.comment).toBe("");
    }),
);

it.effect("does nothing while an autosave on the Attachment is still due", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHolding("PUPR5FG5");
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");
    yield* service.patchColor("PUPR5FG5", "#ff6666");

    // Another Annotation of the same Attachment is being typed into, and its
    // save is armed: the undo waits for it rather than stepping past it.
    yield* service.editTextField("comment", "HRK7BG32", "Still typing");

    expect(yield* service.undo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.held?.color).toBe("#ff6666");
    expect(yield* service.canUndo("RGRPDF24")).toBe(true);
  }),
);

it.effect(
  "discards the redo steps when a comment session moves its own step",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const { service, adjustLayerClock } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      // A comment session on one Annotation, then a colour pick on another.
      yield* service.editTextField("comment", "PUPR5FG5", "Worth citing");
      yield* adjustLayerClock("1 second");
      yield* settledDraft(service, "comment");
      yield* service.discardTextDraft("comment", "PUPR5FG5");
      yield* service.patchColor("HRK7BG32", "#ff6666");
      yield* service.undo("RGRPDF24");
      const seededColor = zotero.heldOf("HRK7BG32")!.color;
      expect(yield* service.canRedo("RGRPDF24")).toBe(true);

      // Typing in the first Annotation's comment again moves the step that
      // session left rather than pushing a new one, and a moved step is a newly
      // confirmed edit like any other: the undone colour pick is not offered
      // again.
      yield* service.editTextField("comment", "PUPR5FG5", "Worth citing twice");
      yield* adjustLayerClock("1 second");
      yield* settledDraft(service, "comment");
      yield* service.discardTextDraft("comment", "PUPR5FG5");

      expect(yield* service.canRedo("RGRPDF24")).toBe(false);
      expect(yield* service.redo("RGRPDF24")).toEqual({ kind: "idle" });
      expect(zotero.heldOf("HRK7BG32")?.color).toBe(seededColor);
    }),
);

it.effect(
  "records a colour pick after a comment session as a step of its own",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroHolding("PUPR5FG5");
      const { service, adjustLayerClock } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      yield* service.editTextField("comment", "PUPR5FG5", "Noted");
      yield* adjustLayerClock("1 second");
      yield* service.submitTextField("comment", "PUPR5FG5");
      yield* service.patchColor("PUPR5FG5", "#ff6666");

      expect(yield* service.undo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      expect(zotero.held?.color).toBe("#2ea8e5");
      expect(zotero.held?.comment).toBe("Noted");

      expect(yield* service.undo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      expect(zotero.held?.comment).toBe("");
      expect(zotero.held?.color).toBe("#2ea8e5");
    }),
);

it.effect("records an autosave that lands while a step runs beside it", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroHolding("PUPR5FG5");
    const seeded = zotero.heldOf("HRK7BG32")!.comment!;
    const gate = Promise.withResolvers<void>();
    const away = Promise.withResolvers<void>();
    let holdNext = false;
    const { service, adjustLayerClock } = yield* Effect.promise(() =>
      writable(stack, {
        ...zotero.answers,
        write: async (request) => {
          if (holdNext) {
            holdNext = false;
            away.resolve();
            await gate.promise;
          }
          return zotero.answers.write(request);
        },
      }),
    );
    yield* service.openHistory("RGRPDF24");
    yield* service.patchColor("PUPR5FG5", "#ff6666");

    holdNext = true;
    const undone = yield* Effect.forkChild(service.undo("RGRPDF24"), {
      startImmediately: true,
    });
    // The undo's own write is away and waiting, which the write itself says.
    yield* Effect.promise(() => away.promise);
    // Another Annotation's comment session saves while the undo's own write is
    // still away.
    yield* service.editTextField("comment", "HRK7BG32", "Typed meanwhile");
    yield* adjustLayerClock("1 second");
    gate.resolve();
    expect(yield* Fiber.join(undone)).toMatchObject({ kind: "stepped" });
    expect(zotero.held?.color).toBe("#2ea8e5");

    // The session's own step stands beside the undo rather than being lost to
    // it, so the editor's comment can be stepped back in its turn.
    yield* service.submitTextField("comment", "HRK7BG32");
    expect(zotero.heldOf("HRK7BG32")?.comment).toBe("Typed meanwhile");
    expect(yield* service.undo("RGRPDF24")).toEqual({
      kind: "stepped",
      annotationKey: "HRK7BG32",
    });
    expect(zotero.heldOf("HRK7BG32")?.comment).toBe(seeded);
  }),
);

// #endregion

// #region tag session history

/** Save one tag session that ends on `names`, as the editor closing does. */
const saveTags = (
  service: AnnotationRepository["Service"],
  names: readonly string[],
) =>
  Effect.gen(function* () {
    yield* service.editTags("PUPR5FG5", names);
    expect(yield* service.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
  });

it.effect(
  "makes one step of a tag session and puts the previous tags back with their types",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");

      // One session adds two names and removes a manual and an automatic tag.
      yield* service.editTags("PUPR5FG5", ["review", "nlp", "todo", "figure"]);
      yield* service.editTags("PUPR5FG5", ["review", "figure"]);
      yield* saveTags(service, ["review", "figure", "Smith, J."]);
      expect(zotero.tags).toEqual(["review", "figure", "Smith, J."]);

      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "stepped",
        annotationKey: "PUPR5FG5",
      });
      expect(zotero.tags).toEqual(["review", { tag: "nlp", type: 1 }, "todo"]);
      // The whole session was one step.
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
      expect(yield* service.canRedo("RGRPDF24")).toBe(true);
    }),
);

it.effect(
  "keeps the tags Zotero changed after the session when it is undone",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      yield* saveTags(service, ["review", "nlp", "figure", "draft"]);

      // Zotero adds a tag of its own and removes one the session added.
      zotero.changeInZotero({
        tags: ["review", { tag: "nlp", type: 1 }, "figure", "from Zotero"],
      });
      yield* service.refresh("RGRPDF24");

      expect(yield* service.undo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      // No field check stops the undo: it removes what the session added and
      // restores what it removed, and `from Zotero` stays.
      expect(zotero.tags).toEqual([
        "review",
        { tag: "nlp", type: 1 },
        "from Zotero",
        "todo",
      ]);
    }),
);

it.effect("redoes a tag session from the undo's own confirmed result", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");
    yield* saveTags(service, ["review", "figure"]);
    yield* service.undo("RGRPDF24");

    expect(yield* service.redo("RGRPDF24")).toEqual({
      kind: "stepped",
      annotationKey: "PUPR5FG5",
    });
    expect(zotero.tags).toEqual(["review", "figure"]);
    // Stepping back and forth reverses the same names as often as asked.
    expect(yield* service.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
    expect(zotero.tags).toEqual(["review", { tag: "nlp", type: 1 }, "todo"]);
  }),
);

it.effect("discards the redo steps when a new tag session is recorded", () =>
  Effect.gen(function* () {
    const stack = yield* scopedStack;
    const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
    const { service } = yield* Effect.promise(() =>
      writable(stack, zotero.answers),
    );
    yield* service.openHistory("RGRPDF24");
    yield* saveTags(service, ["review", "figure"]);
    yield* service.undo("RGRPDF24");

    yield* saveTags(service, ["review", "nlp", "todo", "method"]);

    expect(yield* service.canRedo("RGRPDF24")).toBe(false);
    expect(yield* service.redo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.tags).toEqual([
      "review",
      { tag: "nlp", type: 1 },
      "todo",
      "method",
    ]);
  }),
);

it.effect(
  "sends the tag undo again after a 412, applied to the fresh tags",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { repository, service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      let conflicts = 0;
      stack.defer(repository.listen("write-conflict", () => (conflicts += 1)));
      yield* service.openHistory("RGRPDF24");
      yield* saveTags(service, ["review", "nlp", "figure"]);
      const sent = zotero.patches.length;

      // Zotero moves under the undo, and ZotLit has not read it yet.
      zotero.changeInZotero({
        tags: ["review", { tag: "nlp", type: 1 }, "figure", "from Zotero"],
      });

      expect(yield* service.undo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
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
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
      expect(yield* service.canRedo("RGRPDF24")).toBe(true);
    }),
);

it.effect(
  "stands the verbs down while a tag undo is in flight, as a gesture's write",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      yield* saveTags(service, ["review", "figure"]);
      const release = zotero.holdWrites();

      const undone = yield* Effect.forkChild(service.undo("RGRPDF24"), {
        startImmediately: true,
      });
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(zotero.patches).toHaveLength(2)),
      );

      const mutation = yield* service.mutationFor("PUPR5FG5");
      expect(mutation).toEqual({ kind: "pending", write: "tags" });
      const verbs = cardControls({
        blocks: capabilityBlocks(yield* service.capabilityFor("RGRPDF24"), NOW),
        mutation,
        hasTags: true,
        type: "highlight",
      });
      expect([
        verbs.color,
        verbs.comment,
        verbs.tags,
        verbs.delete,
      ]).toMatchObject([
        { disabled: true },
        { disabled: true },
        { disabled: true },
        { disabled: true },
      ]);

      release();
      expect(yield* Fiber.join(undone)).toMatchObject({ kind: "stepped" });
      expect(yield* service.mutationFor("PUPR5FG5")).toEqual({ kind: "idle" });
    }),
);

it.effect(
  "takes a tag step with no write where Zotero already holds what the undo would write",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      yield* saveTags(service, ["review", "nlp", "figure"]);
      const sent = zotero.patches.length;

      zotero.changeInZotero({ tags: [...TAGGED] });
      yield* service.refresh("RGRPDF24");

      // An equal value is no conflict, so the undo is taken, not refused.
      expect(yield* service.undo("RGRPDF24")).toEqual({
        kind: "stepped",
        annotationKey: "PUPR5FG5",
      });
      expect(zotero.patches).toHaveLength(sent);
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
    }),
);

it.effect(
  "does nothing while a tag session is open on the Annotation the top step touches",
  () =>
    Effect.gen(function* () {
      const stack = yield* scopedStack;
      const zotero = zoteroTagging("PUPR5FG5", [...TAGGED]);
      const { service } = yield* Effect.promise(() =>
        writable(stack, zotero.answers),
      );
      yield* service.openHistory("RGRPDF24");
      yield* saveTags(service, ["review", "nlp", "figure"]);

      // The tag editor is open again, so the keys belong to it.
      yield* service.editTags("PUPR5FG5");
      expect(yield* service.canUndo("RGRPDF24")).toBe(false);
      expect(yield* service.undo("RGRPDF24")).toEqual({ kind: "idle" });
      expect(zotero.tags).toEqual([
        "review",
        { tag: "nlp", type: 1 },
        "figure",
      ]);

      // The editor closed with no change.
      expect(yield* service.submitTags("PUPR5FG5")).toEqual({ kind: "idle" });
      expect(yield* service.undo("RGRPDF24")).toMatchObject({
        kind: "stepped",
      });
      expect(zotero.tags).toEqual(["review", { tag: "nlp", type: 1 }, "todo"]);
    }),
);

// #endregion
