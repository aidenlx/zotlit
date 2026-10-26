// The Annotation Repository's Annotation History: recorded steps, undo and redo, geometry runs, and comment and tag sessions.
import { TestClock } from "effect/testing";
import { expect, it, vi } from "vitest";

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
  useFakeTimers,
  writable,
  zoteroLibrary,
  DRAFT,
  zoteroHolding,
  moved,
  zoteroTagging,
  TAGGED,
} from "./__fixtures__";
import type { RepositoryClient } from "./__fixtures__";
import { JOIN_WINDOW_MS } from "./history";

// #region annotation history

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
  stack.defer(repository.listen("history-changed", (key) => changed.push(key)));

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

/** The geometry a landed {@link moved} leaves in Zotero. */
function movedGeometry(annotationKey: string, step = 0) {
  const { position, sortIndex } = moved(annotationKey, step);
  return { position, sortIndex };
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
  const { repository, runtime } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  await runtime.runPromise(TestClock.adjust(200));
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
  const { repository, runtime } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  await runtime.runPromise(TestClock.adjust(200));
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
  const { repository, runtime } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  await repository.patchGeometry("K3JRFLFQ", moved("K3JRFLFQ"), "keyboard");
  await repository.undo("RGRPDF24");
  expect(repository.canRedo("RGRPDF24")).toBe(true);

  // A nudge on the Annotation the step under the undone one names joins that
  // step, and a joined edit is a new edit: what a redo would have put back is
  // discarded, as it is for a step of its own.
  await runtime.runPromise(TestClock.adjust(200));
  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");

  expect(repository.canRedo("RGRPDF24")).toBe(false);
  expect(await repository.redo("RGRPDF24")).toEqual({ kind: "idle" });
});

it("keeps a keyboard nudge made after the window as its own step", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHoldingMarks();
  const { repository, runtime } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  await runtime.runPromise(TestClock.adjust(600));
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
  const { repository, runtime } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  // Exactly the window: the run ends at it rather than inside it.
  await runtime.runPromise(TestClock.adjust(JOIN_WINDOW_MS));
  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "keyboard");

  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5", 0));
  expect(repository.canUndo("RGRPDF24")).toBe(true);
});

it("keeps a keyboard nudge on another Annotation as its own step", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHoldingMarks();
  const { repository, runtime } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5"), "keyboard");
  await runtime.runPromise(TestClock.adjust(100));
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
  const { repository, runtime } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  await runtime.runPromise(TestClock.adjust(100));
  // A handle drag, inside the window a nudge would have joined in.
  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 1), "pointer");

  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held("PUPR5FG5")).toMatchObject(movedGeometry("PUPR5FG5", 0));
  expect(repository.canUndo("RGRPDF24")).toBe(true);
});

it("keeps a colour pick out of a run of keyboard nudges", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHoldingMarks();
  const { repository, runtime } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  await repository.patchGeometry("PUPR5FG5", moved("PUPR5FG5", 0), "keyboard");
  await runtime.runPromise(TestClock.adjust(100));
  await repository.patchColor("PUPR5FG5", "#ff6666");
  await runtime.runPromise(TestClock.adjust(100));
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
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    // The Mark Popup types, and an Annotation Card carries the editing on
    // through the very same verb: the hand-off between them is one session.
    repository.editTextField("comment", "PUPR5FG5", "Worth");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(zotero.held?.comment).toBe("Worth");
    repository.editTextField("comment", "PUPR5FG5", "Worth citing");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(zotero.held?.comment).toBe("Worth citing");
    repository.editTextField("comment", "PUPR5FG5", "Worth citing twice");
    await repository.submitTextField("comment", "PUPR5FG5");
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

it("makes one step of a Text Edit session, and undo writes back the earlier text alone", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const original = zotero.held!.text;
    const { repository, requests } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    repository.editTextField("text", "PUPR5FG5", "Identify");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(zotero.held?.text).toBe("Identify");
    repository.editTextField("text", "PUPR5FG5", "Identify your message");
    await repository.submitTextField("text", "PUPR5FG5");
    expect(zotero.held?.text).toBe("Identify your message");

    const sent = requests.length;
    expect(await repository.undo("RGRPDF24")).toEqual({
      kind: "stepped",
      annotationKey: "PUPR5FG5",
    });
    // The whole session went back in one press, to the text it began with,
    // through a patch of the text alone.
    expect(zotero.held?.text).toBe(original);
    expect(repository.canUndo("RGRPDF24")).toBe(false);
    const [patch] = requests
      .slice(sent)
      .filter(({ method }) => method === "PATCH");
    expect(Object.keys(JSON.parse(patch!.body ?? "{}")).sort()).toEqual([
      "annotationText",
      "version",
    ]);

    expect(await repository.redo("RGRPDF24")).toMatchObject({
      kind: "stepped",
    });
    expect(zotero.held?.text).toBe("Identify your message");
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a Text Edit session and a comment session after it as two steps", async () => {
  await using stack = new AsyncDisposableStack();
  const zotero = zoteroHolding("PUPR5FG5");
  const original = zotero.held!.text;
  const { repository } = await writable(stack, zotero.answers);
  repository.openHistory("RGRPDF24");

  repository.editTextField("text", "PUPR5FG5", "Identify your message");
  await repository.submitTextField("text", "PUPR5FG5");
  repository.editTextField("comment", "PUPR5FG5", "Worth citing");
  await repository.submitTextField("comment", "PUPR5FG5");

  // The comment session went back alone, and the text stayed.
  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held?.comment).toBe("");
  expect(zotero.held?.text).toBe("Identify your message");

  expect(await repository.undo("RGRPDF24")).toMatchObject({ kind: "stepped" });
  expect(zotero.held?.text).toBe(original);
  expect(repository.canUndo("RGRPDF24")).toBe(false);
});

it("starts a new step where the comment moved in Zotero between two saves", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    repository.editTextField("comment", "PUPR5FG5", "Worth citing");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(zotero.held?.comment).toBe("Worth citing");

    // The same comment is changed in Zotero, so the next save is refused and
    // the card offers "Apply again" against the value Zotero holds now.
    zotero.changeInZotero({ comment: "Cited by Perez" });
    zotero.refuseNextWrite();
    repository.editTextField("comment", "PUPR5FG5", "Worth citing twice");
    await vi.advanceTimersByTimeAsync(1_000);
    await repository.retryTextDraft("comment", "PUPR5FG5");
    expect(zotero.held?.comment).toBe("Worth citing twice");
    repository.discardTextDraft("comment", "PUPR5FG5");

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
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    repository.editTextField("comment", "PUPR5FG5", "Never saved");
    repository.discardTextDraft("comment", "PUPR5FG5");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(repository.canUndo("RGRPDF24")).toBe(false);
    expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.held?.comment).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it("records no step where a comment session settles on its starting text", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("HRK7BG32");
    const seeded = zotero.held!.comment!;
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    repository.editTextField("comment", "HRK7BG32", `${seeded} and slow`);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(zotero.held?.comment).toBe(`${seeded} and slow`);

    // The researcher typed the ending away again before leaving the editor.
    repository.editTextField("comment", "HRK7BG32", seeded);
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
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    repository.editTextField("comment", "PUPR5FG5", "Half typed");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(zotero.held?.comment).toBe("Half typed");

    // The comment editor is open again on the same Annotation, with nothing
    // typed into it yet, so the keys belong to the editor holding it.
    repository.editTextField("comment", "PUPR5FG5");
    expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.held?.comment).toBe("Half typed");
    // The menu row and the palette entry read this, so neither is drawn for a
    // press that would do nothing and say nothing.
    expect(repository.canUndo("RGRPDF24")).toBe(false);

    // The editor closed, keeping what Zotero holds.
    repository.discardTextDraft("comment", "PUPR5FG5");
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
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");
    await repository.patchColor("PUPR5FG5", "#ff6666");

    // Another Annotation of the same Attachment is being typed into, and its
    // save is armed: the undo waits for it rather than stepping past it.
    repository.editTextField("comment", "HRK7BG32", "Still typing");

    expect(await repository.undo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.held?.color).toBe("#ff6666");
    expect(repository.canUndo("RGRPDF24")).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("discards the redo steps when a comment session moves its own step", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    // A comment session on one Annotation, then a colour pick on another.
    repository.editTextField("comment", "PUPR5FG5", "Worth citing");
    await vi.advanceTimersByTimeAsync(1_000);
    repository.discardTextDraft("comment", "PUPR5FG5");
    await repository.patchColor("HRK7BG32", "#ff6666");
    await repository.undo("RGRPDF24");
    const seededColor = zotero.heldOf("HRK7BG32")!.color;
    expect(repository.canRedo("RGRPDF24")).toBe(true);

    // Typing in the first Annotation's comment again moves the step that
    // session left rather than pushing a new one, and a moved step is a newly
    // confirmed edit like any other: the undone colour pick is not offered
    // again.
    repository.editTextField("comment", "PUPR5FG5", "Worth citing twice");
    await vi.advanceTimersByTimeAsync(1_000);
    repository.discardTextDraft("comment", "PUPR5FG5");

    expect(repository.canRedo("RGRPDF24")).toBe(false);
    expect(await repository.redo("RGRPDF24")).toEqual({ kind: "idle" });
    expect(zotero.heldOf("HRK7BG32")?.color).toBe(seededColor);
  } finally {
    vi.useRealTimers();
  }
});

it("records a colour pick after a comment session as a step of its own", async () => {
  useFakeTimers();
  try {
    await using stack = new AsyncDisposableStack();
    const zotero = zoteroHolding("PUPR5FG5");
    const { repository } = await writable(stack, zotero.answers);
    repository.openHistory("RGRPDF24");

    repository.editTextField("comment", "PUPR5FG5", "Noted");
    await vi.advanceTimersByTimeAsync(1_000);
    await repository.submitTextField("comment", "PUPR5FG5");
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
  useFakeTimers();
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
    repository.editTextField("comment", "HRK7BG32", "Typed meanwhile");
    await vi.advanceTimersByTimeAsync(1_000);
    gate.resolve();
    expect(await undone).toMatchObject({ kind: "stepped" });
    expect(zotero.held?.color).toBe("#2ea8e5");

    // The session's own step stands beside the undo rather than being lost to
    // it, so the editor's comment can be stepped back in its turn.
    await repository.submitTextField("comment", "HRK7BG32");
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

// #region tag session history

/** Save one tag session that ends on `names`, as the editor closing does. */
async function saveTags(
  repository: RepositoryClient,
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
  stack.defer(repository.listen("write-conflict", () => (conflicts += 1)));
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
    blocks: capabilityBlocks(repository.capabilityFor("RGRPDF24"), NOW),
    mutation,
    hasTags: true,
    type: "highlight",
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
