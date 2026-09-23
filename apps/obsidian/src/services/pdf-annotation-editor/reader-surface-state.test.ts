import { expect, it, vi } from "vitest";

import type { SelectedText } from "@zotlit/pdf-structure";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type { CommentDraft } from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";

import { annotation, annotationEdits, toolColors } from "./__fixtures__";
import type { CreationToolbarControl } from "./creation-toolbar";
import type { EditablePosition } from "./geometry-edit";
import {
  arm,
  beginAdjust,
  cancelAdjust,
  captureSelection,
  clearFloating,
  createReaderSurfaceState,
  dropRecord,
  endAdjust,
  hideCommentDraft,
  ingestAnnotations,
  ingestCapability,
  ingestCommentDraft,
  ingestMutation,
  ingestRecords,
  listenAnnotationEvents,
  moveAdjust,
  sameCapability,
  sameFlat,
  sameFlatList,
  selectAdjust,
  selectCapabilityAffordance,
  selectCreateRow,
  selectCreationToolbar,
  selectMark,
  selectSelectedRow,
  setCommenting,
  setInFlight,
  setToolColor,
  stepStack,
  tick,
} from "./reader-surface-state";

const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");
const RETRY_AFTER = NOW.add({ seconds: 45 });

/**
 * One store and a listener on each of its three slices, the way the reader's
 * surfaces subscribe to it.
 */
function observed(capability: EditingCapability = { kind: "writable" }) {
  const colors = toolColors();
  const store = createReaderSurfaceState({
    colors: colors.current(),
    capability,
    now: NOW,
  });
  const toolbar = vi.fn();
  const affordance = vi.fn();
  const capabilitySlice = vi.fn();
  store.subscribe(selectCreationToolbar, toolbar, {
    equalityFn: sameFlatList,
  });
  store.subscribe(selectCapabilityAffordance, affordance, {
    equalityFn: sameFlat,
  });
  store.subscribe((state) => state.capability, capabilitySlice, {
    equalityFn: sameCapability,
  });
  return { store, colors, toolbar, affordance, capability: capabilitySlice };
}

/** A new object that means what the given capability means. */
function sameMeaning(capability: EditingCapability): EditingCapability {
  return capability.kind === "cooldown"
    ? {
        kind: "cooldown",
        retryAfter: Temporal.Instant.from(RETRY_AFTER.toString()),
      }
    : { ...capability };
}

/** The ids of the controls whose drawn state differs between two models. */
function changedIds(
  before: readonly CreationToolbarControl[],
  after: readonly CreationToolbarControl[],
): string[] {
  return after
    .filter(
      (control, index) =>
        JSON.stringify(control) !== JSON.stringify(before[index]),
    )
    .map(({ id }) => id);
}

it.each([
  { kind: "writable" },
  { kind: "read-only", reason: "zotero-unavailable" },
  { kind: "cooldown", retryAfter: RETRY_AFTER },
] satisfies EditingCapability[])(
  "fires no subscriber when an announcement ingests the same $kind again",
  (capability) => {
    const {
      store,
      toolbar,
      affordance,
      capability: slice,
    } = observed(capability);

    // A fresh object with the same meaning, as a repeated probe answers it.
    ingestCapability(store, sameMeaning(capability), NOW);

    expect(toolbar).not.toHaveBeenCalled();
    expect(affordance).not.toHaveBeenCalled();
    expect(slice).not.toHaveBeenCalled();
  },
);

it("fires the capability slice when a cooldown's deadline moves", () => {
  const { store, capability } = observed({
    kind: "cooldown",
    retryAfter: RETRY_AFTER,
  });

  ingestCapability(
    store,
    { kind: "cooldown", retryAfter: RETRY_AFTER.add({ seconds: 30 }) },
    NOW,
  );

  expect(capability).toHaveBeenCalledOnce();
});

it("counts a cooldown down in the affordance and leaves the toolbar alone", () => {
  const { store, toolbar, affordance } = observed({
    kind: "cooldown",
    retryAfter: RETRY_AFTER,
  });

  tick(store, NOW.add({ seconds: 1 }));

  expect(affordance).toHaveBeenCalledOnce();
  expect(affordance.mock.calls[0]![0]).toMatchObject({ countdown: 44 });
  expect(toolbar).not.toHaveBeenCalled();
});

it("changes only the armed tool's toggle when a tool is armed", () => {
  const { store, toolbar } = observed();
  const before = selectCreationToolbar(store.getState());

  arm(store, "highlight");

  expect(toolbar).toHaveBeenCalledOnce();
  const after = toolbar.mock.calls[0]![0] as CreationToolbarControl[];
  expect(changedIds(before, after)).toEqual(["highlight"]);
  expect(after.find(({ id }) => id === "highlight")?.pressed).toBe(true);
});

it("changes only that tool's toggle on a colour change, and keeps the colour", () => {
  const { store, colors, toolbar } = observed();
  const before = selectCreationToolbar(store.getState());
  const chosen = ANNOTATION_COLORS[3]!;

  setToolColor(store, colors, { tool: "underline", color: chosen });

  expect(toolbar).toHaveBeenCalledOnce();
  const after = toolbar.mock.calls[0]![0] as CreationToolbarControl[];
  expect(changedIds(before, after)).toEqual(["underline"]);
  expect(after.find(({ id }) => id === "underline")?.color).toBe(chosen);
  // The colour outlives this view: the next PDF opened reads it back.
  expect(colors.current().underline).toBe(chosen);
});

const PARAGRAPH = annotation("PARA1111", "highlight", {
  pageIndex: 0,
  rects: [[100, 600, 500, 640]],
});
const WORD = annotation("WORD2222", "highlight", {
  pageIndex: 0,
  rects: [[200, 610, 240, 630]],
});

/** The selection over one line of the Fixture's own underline, as placed. */
const CAPTURED: SelectedText = {
  pageIndex: 0,
  rects: [[58.054, 601.98, 211.489, 610.112]],
  text: "this process",
};
const ANCHOR_AT = { pageIndex: 0, fx: 0.5, fy: 0.25 };

/** A store holding two marks, the second inside the first. */
function reader() {
  const store = createReaderSurfaceState({
    colors: toolColors().current(),
    capability: { kind: "writable" },
    now: NOW,
  });
  ingestRecords(store, [PARAGRAPH, WORD]);
  return store;
}

/** One Annotation's comment draft, as the repository holds it. */
function draft(
  annotationKey: string,
  state: CommentDraft["state"] = { kind: "editing" },
): CommentDraft {
  return {
    annotationKey,
    attachmentKey: "RGRPDF24",
    serverID: "test",
    baseline: "",
    text: "worth quoting",
    state,
  };
}

it("selects a mark from the stack under a point, at its place in it", () => {
  const store = reader();

  selectMark(store, "PARA1111", { stack: ["WORD2222", "PARA1111"] });

  expect(store.getState().floating).toEqual({
    kind: "selected",
    key: "PARA1111",
    stack: ["WORD2222", "PARA1111"],
    index: 1,
    quiet: false,
    commenting: false,
  });
});

it("holds a Landing's selection quiet, and the next selection loud", () => {
  const store = reader();

  selectMark(store, "WORD2222", { quiet: true });
  expect(store.getState().floating).toMatchObject({
    key: "WORD2222",
    stack: ["WORD2222"],
    quiet: true,
  });

  selectMark(store, "PARA1111");
  expect(store.getState().floating).toMatchObject({ quiet: false });
});

it("keeps the comment editor open for a repeat selection of the same mark", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  setCommenting(store, true);

  selectMark(store, "WORD2222");
  expect(store.getState().floating).toMatchObject({ commenting: true });

  selectMark(store, "PARA1111");
  expect(store.getState().floating).toMatchObject({ commenting: false });
});

it("clears a floating surface of either kind, and a null selection clears too", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  clearFloating(store);
  expect(store.getState().floating).toEqual({ kind: "none" });

  captureSelection(store, { captured: CAPTURED, anchorAt: ANCHOR_AT });
  selectMark(store, null);
  expect(store.getState().floating).toEqual({ kind: "none" });
});

it("lets a captured selection take the place of a selected mark", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  setCommenting(store, true);

  captureSelection(store, { captured: CAPTURED, anchorAt: ANCHOR_AT });

  expect(store.getState().floating).toEqual({
    kind: "create",
    captured: CAPTURED,
    anchorAt: ANCHOR_AT,
    commenting: false,
    inFlight: false,
  });
});

it("steps forward through the stack and wraps, closing the editor", () => {
  const store = reader();
  selectMark(store, "WORD2222", { stack: ["WORD2222", "PARA1111"] });
  setCommenting(store, true);

  stepStack(store);
  expect(store.getState().floating).toMatchObject({
    key: "PARA1111",
    index: 1,
    commenting: false,
  });

  stepStack(store);
  expect(store.getState().floating).toMatchObject({
    key: "WORD2222",
    index: 0,
  });
});

it("opens the comment sheet and marks a create in flight on the create variant", () => {
  const store = reader();
  captureSelection(store, { captured: CAPTURED, anchorAt: ANCHOR_AT });

  setCommenting(store, true);
  setInFlight(store, true);

  expect(store.getState().floating).toMatchObject({
    kind: "create",
    commenting: true,
    inFlight: true,
  });
});

it("leaves nothing floating when commenting or in-flight is set on none", () => {
  const store = reader();

  setCommenting(store, true);
  setInFlight(store, true);

  expect(store.getState().floating).toEqual({ kind: "none" });
});

it("stands the selection down when the next read no longer holds its Annotation", () => {
  const store = reader();
  selectMark(store, "PARA1111");

  ingestRecords(store, [PARAGRAPH]);
  expect(store.getState().floating).toMatchObject({ key: "PARA1111" });

  ingestRecords(store, [WORD]);
  expect(store.getState().floating).toEqual({ kind: "none" });
  expect(store.getState().records).toEqual([WORD]);
});

it("drops a deleted Annotation, its selection, and what was held on it at once", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  ingestMutation(store, "WORD2222", { kind: "pending" });
  ingestCommentDraft(store, "WORD2222", draft("WORD2222"));
  ingestMutation(store, "PARA1111", { kind: "pending" });

  dropRecord(store, "WORD2222");

  const { records, floating, mutations, commentDrafts } = store.getState();
  expect(records).toEqual([PARAGRAPH]);
  expect(floating).toEqual({ kind: "none" });
  expect([...mutations.keys()]).toEqual(["PARA1111"]);
  expect(commentDrafts.size).toBe(0);
});

it("takes a read's records with the drafts and write states that stood before it", () => {
  const store = reader();
  const repository = annotationEdits();
  repository.editComment("WORD2222", "worth quoting");
  repository.mutationFor.mockImplementation(
    (key): MutationState => (key === "PARA1111" ? { kind: "pending" } : IDLE),
  );

  ingestAnnotations(store, [PARAGRAPH, WORD], repository);

  const { records, mutations, commentDrafts } = store.getState();
  expect(records).toEqual([PARAGRAPH, WORD]);
  expect([...mutations]).toEqual([["PARA1111", { kind: "pending" }]]);
  expect(commentDrafts.get("WORD2222")?.text).toBe("worth quoting");
});

it("takes the four per-Annotation announcements until it is disposed", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  const repository = annotationEdits();
  const listening = listenAnnotationEvents(store, repository);

  repository.mutationFor.mockReturnValue({ kind: "pending" });
  repository.emit("mutation-changed", "PARA1111");
  repository.editComment("WORD2222", "worth quoting");
  repository.emit("comment-draft-changed", "WORD2222");
  expect(store.getState().mutations.get("PARA1111")).toEqual({
    kind: "pending",
  });
  expect(store.getState().commentDrafts.get("WORD2222")?.text).toBe(
    "worth quoting",
  );

  repository.emit("comment-draft-hidden", "WORD2222");
  expect(store.getState().commentDrafts.has("WORD2222")).toBe(false);
  repository.emit("annotation-deleted", "WORD2222");
  expect(store.getState().floating).toEqual({ kind: "none" });

  listening[Symbol.dispose]();
  repository.emit("annotation-deleted", "PARA1111");
  expect(store.getState().records).toEqual([PARAGRAPH]);
});

it("holds what a write left on an Annotation, and forgets it once idle", () => {
  const store = reader();

  ingestMutation(store, "WORD2222", { kind: "pending" });
  expect(store.getState().mutations.get("WORD2222")).toEqual({
    kind: "pending",
  });

  ingestMutation(store, "WORD2222", IDLE);
  expect(store.getState().mutations.has("WORD2222")).toBe(false);
});

it("fires no row subscriber for a mutation announced again unchanged", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  ingestMutation(store, "WORD2222", { kind: "pending" });
  const row = vi.fn();
  store.subscribe(selectSelectedRow, row, { equalityFn: sameFlatList });

  ingestMutation(store, "WORD2222", { kind: "pending" });
  expect(row).not.toHaveBeenCalled();

  ingestMutation(store, "WORD2222", IDLE);
  expect(row).toHaveBeenCalledOnce();
});

it("fires no row subscriber for a mutation on an Annotation not selected", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  const row = vi.fn();
  store.subscribe(selectSelectedRow, row, { equalityFn: sameFlatList });

  ingestMutation(store, "PARA1111", { kind: "pending" });

  expect(row).not.toHaveBeenCalled();
});

it("holds a comment draft, and forgets one the repository dropped", () => {
  const store = reader();
  const held = draft("WORD2222");

  ingestCommentDraft(store, "WORD2222", held);
  expect(store.getState().commentDrafts.get("WORD2222")).toBe(held);

  ingestCommentDraft(store, "WORD2222", null);
  expect(store.getState().commentDrafts.has("WORD2222")).toBe(false);
});

it("keeps the editor open when an ordinary draft settles and is dropped", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  setCommenting(store, true);
  ingestCommentDraft(store, "WORD2222", draft("WORD2222"));

  ingestCommentDraft(store, "WORD2222", null);

  expect(store.getState().floating).toMatchObject({ commenting: true });
});

it("closes the editor when the selected draft turns into a Write Conflict", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  setCommenting(store, true);

  ingestCommentDraft(
    store,
    "WORD2222",
    draft("WORD2222", { kind: "conflict", fresh: "theirs" }),
  );

  expect(store.getState().floating).toMatchObject({
    key: "WORD2222",
    commenting: false,
  });
});

it("closes the editor when a database switch hides the selected draft", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  setCommenting(store, true);
  ingestCommentDraft(store, "WORD2222", draft("WORD2222"));

  hideCommentDraft(store, "WORD2222");

  expect(store.getState().commentDrafts.has("WORD2222")).toBe(false);
  expect(store.getState().floating).toMatchObject({ commenting: false });
});

it("leaves another Annotation's editor alone when a draft is hidden", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  setCommenting(store, true);

  hideCommentDraft(store, "PARA1111");
  ingestCommentDraft(
    store,
    "PARA1111",
    draft("PARA1111", { kind: "conflict", fresh: "theirs" }),
  );

  expect(store.getState().floating).toMatchObject({ commenting: true });
});

it("draws the selected row from the record, its mutation, and its stack", () => {
  const store = reader();
  selectMark(store, "PARA1111", { stack: ["WORD2222", "PARA1111"] });
  ingestMutation(store, "PARA1111", { kind: "pending" });

  const row = selectSelectedRow(store.getState());

  expect(
    row.flatMap((part) =>
      "disabled" in part ? [[part.id, part.disabled]] : [],
    ),
  ).toEqual([
    ["color", true],
    ["comment", true],
    ["copy", true],
    ["delete", true],
    ["reveal", false],
  ]);
  expect(row.at(-1)).toMatchObject({
    key: "PARA1111",
    color: "#2ea8e5",
    stackIndex: 1,
    stackTotal: 2,
  });
  expect(selectSelectedRow(reader().getState())).toEqual([]);
});

it("draws the create row only while a selection waits, pressing the comment toggle", () => {
  const store = reader();
  expect(selectCreateRow(store.getState())).toEqual([]);

  captureSelection(store, { captured: CAPTURED, anchorAt: ANCHOR_AT });
  setCommenting(store, true);

  const row = selectCreateRow(store.getState());
  expect(row.find(({ id }) => id === "comment")).toMatchObject({
    pressed: true,
  });
  expect(sameFlatList(row, selectCreateRow(store.getState()))).toBe(true);
});

it("stands the create row down while its create is in flight", () => {
  const store = reader();
  captureSelection(store, { captured: CAPTURED, anchorAt: ANCHOR_AT });

  setInFlight(store, true);

  const row = selectCreateRow(store.getState());
  expect(row.find(({ id }) => id === "highlight")).toMatchObject({
    disabled: true,
  });
  expect(row.find(({ id }) => id === "copy")).toMatchObject({
    disabled: false,
  });
});

/** The Fixture's image region on page two, as the repository answers it. */
const FIGURE = annotation("FDRFQ7C2", "image", {
  pageIndex: 1,
  rects: [[48.75, 395.509, 570, 743.723]],
});

/** The figure with its right edge dragged out to `x2`. */
function widened(x2: number): EditablePosition {
  return {
    kind: "pdf-rects",
    pageIndex: 1,
    rects: [[48.75, 395.509, x2, 743.723]],
  };
}

/** A store with the figure selected, and a listener on the adjustment. */
function adjusting() {
  const store = reader();
  ingestRecords(store, [PARAGRAPH, WORD, FIGURE]);
  selectMark(store, "FDRFQ7C2");
  const heard = vi.fn();
  store.subscribe(selectAdjust, heard);
  return { store, heard };
}

it("begins no adjustment while no mark is selected", () => {
  const store = reader();

  beginAdjust(store, { grip: "br", from: [570, 395.509] });

  expect(selectAdjust(store.getState())).toBeNull();
});

it("begins an adjustment that proposes the confirmed position", () => {
  const { store } = adjusting();

  beginAdjust(store, { grip: "br", from: [570, 395.509] });

  expect(selectAdjust(store.getState())).toEqual({
    grip: "br",
    from: [570, 395.509],
    proposal: FIGURE.position,
    phase: "pressed",
  });
});

it("moves the proposal, and notifies no one for a move that changes nothing", () => {
  const { store, heard } = adjusting();
  beginAdjust(store, { grip: "r", from: [570, 569] });
  heard.mockClear();

  moveAdjust(store, widened(600));
  moveAdjust(store, widened(600.0001));

  expect(heard).toHaveBeenCalledTimes(1);
  expect(selectAdjust(store.getState())).toMatchObject({
    proposal: widened(600),
    phase: "dragging",
  });
});

it("cancels an adjustment and keeps the mark selected", () => {
  const { store } = adjusting();
  beginAdjust(store, { grip: "r", from: [570, 569] });
  moveAdjust(store, widened(600));

  cancelAdjust(store);

  expect(selectAdjust(store.getState())).toBeNull();
  expect(store.getState().floating).toMatchObject({ key: "FDRFQ7C2" });
});

it("ends a release that moved nothing with nothing to save", () => {
  const { store } = adjusting();
  beginAdjust(store, { grip: "r", from: [570, 569] });

  expect(endAdjust(store)).toBeNull();
  expect(selectAdjust(store.getState())).toBeNull();
});

it("ends a drag back to the confirmed geometry with nothing to save", () => {
  const { store } = adjusting();
  beginAdjust(store, { grip: "r", from: [570, 569] });
  moveAdjust(store, widened(600));
  moveAdjust(store, widened(570.0002));

  expect(endAdjust(store)).toBeNull();
  expect(selectAdjust(store.getState())).toBeNull();
});

it("holds a changed release's proposal while it saves, and takes no more moves", () => {
  const { store } = adjusting();
  beginAdjust(store, { grip: "r", from: [570, 569] });
  moveAdjust(store, widened(600));

  expect(endAdjust(store)).toEqual(widened(600));

  moveAdjust(store, widened(610));
  expect(selectAdjust(store.getState())).toMatchObject({
    proposal: widened(600),
    phase: "saving",
  });
});

it("drops the adjustment with the selection it stood on", () => {
  const { store } = adjusting();
  beginAdjust(store, { grip: "r", from: [570, 569] });

  selectMark(store, "WORD2222");

  expect(selectAdjust(store.getState())).toBeNull();
});

it("adjusts selected ink, and no free-text mark", () => {
  const stroke = annotation("4PE492KU", "ink", {
    pageIndex: 0,
    width: 2,
    paths: [[203.571, 673.009, 238.518, 686.737]],
  });
  const moved: EditablePosition = {
    kind: "pdf-ink",
    pageIndex: 0,
    width: 2,
    paths: [[213.571, 663.009, 248.518, 676.737]],
  };
  const typed = annotation("TEXT1111", "text", {
    pageIndex: 0,
    rects: [[100, 100, 200, 120]],
    fontSize: 12,
    rotation: 0,
  });
  const store = reader();
  ingestRecords(store, [stroke, typed]);

  selectMark(store, "TEXT1111");
  beginAdjust(store, { grip: "body", from: [150, 110] });
  expect(selectAdjust(store.getState())).toBeNull();

  selectMark(store, "4PE492KU");
  beginAdjust(store, { grip: "body", from: [220, 680] });
  moveAdjust(store, moved);
  expect(endAdjust(store)).toEqual(moved);
});
