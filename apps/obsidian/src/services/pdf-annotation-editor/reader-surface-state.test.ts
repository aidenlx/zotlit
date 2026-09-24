import { expect, it, vi } from "vitest";

import type { SelectedText } from "@zotlit/pdf-structure";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationRecord,
  CommentDraft,
} from "@/services/annotation-repository/service";
import { IDLE, writePosition } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";

import { annotation, annotationEdits, toolColors } from "./__fixtures__";
import type { CreationToolbarControl } from "./creation-toolbar";
import { freeTextLines } from "./free-text-layout";
import type { EditablePosition } from "./geometry-edit";
import {
  appendPendingStroke,
  arm,
  beginAdjust,
  beginCapture,
  cancelAdjust,
  cancelCapture,
  captureSelection,
  clearFloating,
  clearLiveStroke,
  createReaderSurfaceState,
  dropPendingStroke,
  dropRecord,
  dropTextDraft,
  endAdjust,
  endCapture,
  finishTextDraft,
  hideCommentDraft,
  ingestAnnotations,
  ingestCapability,
  ingestCommentDraft,
  ingestMutation,
  ingestRecords,
  listenAnnotationEvents,
  moveAdjust,
  moveCapture,
  openTextDraft,
  publishLiveStroke,
  refitTextDraft,
  sameCapability,
  sameFlat,
  sameFlatList,
  selectAdjust,
  selectCapabilityAffordance,
  selectCapture,
  selectCreateRow,
  selectCreationToolbar,
  selectFloatingHead,
  selectMark,
  selectSelectedRow,
  selectTextDraft,
  setCommenting,
  setInFlight,
  setToolColor,
  settlePendingStroke,
  settleTextDraft,
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

it("selects a mark with its comment editor open when asked to", () => {
  const store = reader();
  selectMark(store, "WORD2222");

  selectMark(store, "PARA1111", { commenting: true });
  expect(store.getState().floating).toMatchObject({
    key: "PARA1111",
    quiet: false,
    commenting: true,
  });
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

it("carries a text range's quoted text with its proposal", () => {
  const store = reader();
  ingestRecords(store, [PARAGRAPH]);
  selectMark(store, PARAGRAPH.key);
  beginAdjust(store, { grip: "end", from: [300, 700] });
  const longer: EditablePosition = {
    kind: "pdf-rects",
    pageIndex: 0,
    rects: [[72, 700, 330, 712]],
  };

  moveAdjust(store, longer, "the longer quote");

  expect(selectAdjust(store.getState())).toMatchObject({
    proposal: longer,
    text: "the longer quote",
  });
  expect(endAdjust(store)).toEqual(longer);
  expect(selectAdjust(store.getState())?.text).toBe("the longer quote");
});

/** A store with an image capture pressed on page one at (100, 500). */
function capturing() {
  const store = reader();
  beginCapture(store, { pageIndex: 0, from: [100, 500] });
  return store;
}

it("keeps nothing from a capture released under ten points on a side", () => {
  const store = capturing();
  moveCapture(store, [100, 491, 300, 500]);

  expect(endCapture(store)).toBeNull();
  expect(store.getState().floating).toEqual({ kind: "none" });
});

it("keeps nothing from a capture released where it was pressed", () => {
  const store = capturing();

  expect(endCapture(store)).toBeNull();
  expect(selectCapture(store.getState())).toBeNull();
});

it("begins no second capture while one stands", () => {
  const store = capturing();
  moveCapture(store, [100, 300, 300, 500]);

  beginCapture(store, { pageIndex: 1, from: [5, 5] });

  expect(selectCapture(store.getState())).toMatchObject({
    pageIndex: 0,
    rect: [100, 300, 300, 500],
  });
});

it("holds a released capture while it saves, and takes no more moves", () => {
  const store = capturing();
  moveCapture(store, [100, 300, 300, 500]);

  expect(endCapture(store)).toEqual([100, 300, 300, 500]);
  moveCapture(store, [100, 400, 300, 500]);

  expect(selectCapture(store.getState())).toEqual({
    kind: "capture",
    pageIndex: 0,
    from: [100, 500],
    rect: [100, 300, 300, 500],
    phase: "saving",
  });
});

it("notifies no one for a capture move that changes nothing", () => {
  const store = capturing();
  const heard = vi.fn();
  store.subscribe(selectCapture, heard);

  moveCapture(store, [100, 300, 300, 500]);
  moveCapture(store, [100, 300, 300, 500]);

  expect(heard).toHaveBeenCalledTimes(1);
});

it("takes the floating surface from a selected mark, and cancels to nothing", () => {
  const store = reader();
  ingestRecords(store, [PARAGRAPH, WORD]);
  selectMark(store, "WORD2222");

  beginCapture(store, { pageIndex: 0, from: [100, 500] });
  expect(selectFloatingHead(store.getState())).toEqual({
    kind: "capture",
    key: null,
    commenting: false,
  });
  // A capture has no comment to open.
  setCommenting(store, true);
  expect(selectFloatingHead(store.getState()).commenting).toBe(false);

  cancelCapture(store);
  expect(store.getState().floating).toEqual({ kind: "none" });
});

/** A stroke released on page one, rounded as a create sends it. */
const STROKE = {
  pageIndex: 0,
  width: 2,
  paths: [[120.5, 600.25, 130.125, 610.5, 140, 606.75]],
  color: "#2ea8e5",
};

it("publishes the Live Stroke beside the floating surface, and clears it", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  const floating = store.getState().floating;
  const live = {
    pageIndex: 0,
    paths: [[120, 600]],
    width: 2,
    color: "#2ea8e5",
  };

  publishLiveStroke(store, live);
  expect(store.getState().liveStroke).toEqual(live);
  // The popup host reads the floating surface alone, which a stroke leaves be.
  expect(store.getState().floating).toBe(floating);

  clearLiveStroke(store);
  expect(store.getState().liveStroke).toBeNull();
});

it.each(["highlight", "underline", "image"] as const)(
  "keeps the floating surface when %s is armed",
  (tool) => {
    const store = reader();
    selectMark(store, "WORD2222");

    arm(store, tool);

    expect(selectFloatingHead(store.getState()).key).toBe("WORD2222");
  },
);

it.each(["ink", "note", "text"] as const)(
  "clears the floating surface when %s is armed",
  (tool) => {
    const store = reader();
    selectMark(store, "WORD2222");

    arm(store, tool);

    expect(store.getState().floating).toEqual({ kind: "none" });
  },
);

it("appends Pending Strokes in release order", () => {
  const store = reader();

  appendPendingStroke(store, { id: 1, ...STROKE });
  appendPendingStroke(store, { id: 2, ...STROKE, pageIndex: 1 });

  expect(store.getState().pendingStrokes.map(({ id }) => id)).toEqual([1, 2]);
});

it("swaps a Pending Stroke for its record in one update", () => {
  const store = reader();
  appendPendingStroke(store, { id: 1, ...STROKE });
  const record = annotation("INK11111", "ink", {
    pageIndex: 0,
    width: 2,
    paths: [[120.5, 600.25, 130.125, 610.5, 140, 606.75]],
  });
  const frames: { records: number; pending: number }[] = [];
  store.subscribe(
    ({ records, pendingStrokes }) => ({ records, pendingStrokes }),
    ({ records, pendingStrokes }) =>
      frames.push({ records: records.length, pending: pendingStrokes.length }),
    { equalityFn: sameFlat },
  );

  ingestRecords(store, [PARAGRAPH, WORD, record]);

  // Never both drawn, and never neither.
  expect(frames).toEqual([{ records: 3, pending: 0 }]);
});

it("keeps a Pending Stroke through a read that does not yet hold it", () => {
  const store = reader();
  appendPendingStroke(store, { id: 1, ...STROKE });
  const other = annotation("INK22222", "ink", {
    pageIndex: 0,
    width: 2,
    paths: [[120.5, 600.25, 130.125, 610.5]],
  });

  ingestRecords(store, [PARAGRAPH, WORD, other]);

  expect(store.getState().pendingStrokes.map(({ id }) => id)).toEqual([1]);
});

it.each([
  ["another colour", { color: "#ff6666" }, 2],
  ["another pen width", {}, 3],
])(
  "keeps a Pending Stroke through a record of its points in %s",
  (_, colour, width) => {
    const store = reader();
    appendPendingStroke(store, { id: 1, ...STROKE });
    const other = {
      ...annotation("INK22222", "ink", {
        pageIndex: 0,
        width,
        paths: [[120.5, 600.25, 130.125, 610.5, 140, 606.75]],
      }),
      ...colour,
    };

    ingestRecords(store, [PARAGRAPH, WORD, other]);

    expect(store.getState().pendingStrokes.map(({ id }) => id)).toEqual([1]);
  },
);

it("swaps a Pending Stroke for a record that differs only in colour case", () => {
  const store = reader();
  appendPendingStroke(store, { id: 1, ...STROKE, color: "#2EA8E5" });

  ingestRecords(store, [
    PARAGRAPH,
    WORD,
    annotation("INK11111", "ink", {
      pageIndex: 0,
      width: 2,
      paths: [[120.5, 600.25, 130.125, 610.5, 140, 606.75]],
    }),
  ]);

  expect(store.getState().pendingStrokes).toEqual([]);
});

it("drops a settled Pending Stroke whose record already stands", () => {
  const store = reader();
  appendPendingStroke(store, { id: 1, ...STROKE });
  // Zotero stored other points than were sent, so no geometry matches.
  const stored = annotation("INK11111", "ink", {
    pageIndex: 0,
    width: 2,
    paths: [[121, 601]],
  });
  ingestRecords(store, [PARAGRAPH, WORD, stored]);
  expect(store.getState().pendingStrokes).toHaveLength(1);

  settlePendingStroke(store, { id: 1, key: "INK11111" });

  expect(store.getState().pendingStrokes).toEqual([]);
});

it("swaps a settled Pending Stroke for the record of its key when the read lands", () => {
  const store = reader();
  appendPendingStroke(store, { id: 1, ...STROKE });

  settlePendingStroke(store, { id: 1, key: "INK11111" });
  expect(store.getState().pendingStrokes).toHaveLength(1);
  ingestRecords(store, [
    PARAGRAPH,
    WORD,
    annotation("INK11111", "ink", {
      pageIndex: 0,
      width: 2,
      paths: [[121, 601]],
    }),
  ]);

  expect(store.getState().pendingStrokes).toEqual([]);
});

it("drops a failed create's Pending Stroke and leaves the others", () => {
  const store = reader();
  appendPendingStroke(store, { id: 1, ...STROKE });
  appendPendingStroke(store, { id: 2, ...STROKE, pageIndex: 1 });

  dropPendingStroke(store, 1);

  expect(store.getState().pendingStrokes.map(({ id }) => id)).toEqual([2]);
});

/** A text box opened by a click at `[100, 500]` on page one, at 14 points. */
function drafting() {
  const store = reader();
  arm(store, "text");
  openTextDraft(store, {
    pageIndex: 0,
    at: [100, 500],
    fontSize: 14,
    color: "#ffd400",
  });
  return store;
}

/** Half a font size per character, so a box is worked out by hand. */
const FIT = {
  measure: (text: string, fontSize: number) => (text.length * fontSize) / 2,
  pageBox: [0, 0, 612, 792],
};

/** `abcd` typed into {@link drafting}'s box, as Zotero's fit places it. */
const FITTED = [93, 490.2, 126, 507];

/** The record Zotero answers for {@link drafting}'s box once `abcd` saved. */
function typed(key: string, overrides: Partial<AnnotationRecord> = {}) {
  return {
    ...annotation(key, "text", {
      pageIndex: 0,
      fontSize: 14,
      rotation: 0,
      rects: [FITTED],
    }),
    color: "#ffd400",
    comment: "abcd",
    ...overrides,
  };
}

it.each(["", " \n\t "])(
  "discards a Text Draft finished with nothing but %j, and commits nothing",
  (text) => {
    const store = drafting();
    refitTextDraft(store, text, FIT);

    expect(finishTextDraft(store)).toBeNull();
    expect(store.getState().floating).toEqual({ kind: "none" });
  },
);

it("refits nothing while no Text Draft stands", () => {
  const store = reader();
  selectMark(store, "WORD2222");
  const { floating } = store.getState();

  refitTextDraft(store, "abcd", FIT);

  expect(store.getState().floating).toBe(floating);
});

it("takes no more typing once a Text Draft is saving, and commits it once", () => {
  const store = drafting();
  refitTextDraft(store, "abcd", FIT);
  expect(finishTextDraft(store)?.phase).toBe("saving");

  refitTextDraft(store, "abcde", FIT);

  expect(selectTextDraft(store.getState())?.text).toBe("abcd");
  expect(finishTextDraft(store)).toBeNull();
});

it("takes a failed create's Text Draft off the page", () => {
  const store = drafting();
  refitTextDraft(store, "abcd", FIT);
  finishTextDraft(store);

  dropTextDraft(store);

  expect(store.getState().floating).toEqual({ kind: "none" });
});

it("keeps a saving Text Draft through a read that does not yet hold it", () => {
  const store = drafting();
  refitTextDraft(store, "abcd", FIT);
  finishTextDraft(store);

  ingestRecords(store, [
    PARAGRAPH,
    WORD,
    typed("TEXT2222", { comment: "abcde" }),
    typed("TEXT3333", { color: "#ff6666" }),
  ]);

  expect(selectTextDraft(store.getState())?.phase).toBe("saving");
});

it("keeps a Text Draft still typing through a read of the very same text", () => {
  const store = drafting();
  refitTextDraft(store, "abcd", FIT);

  ingestRecords(store, [PARAGRAPH, WORD, typed("TEXT1111")]);

  expect(selectTextDraft(store.getState())?.phase).toBe("typing");
});

it("keeps a Text Draft when a tool is armed, which finishes it instead", () => {
  const store = drafting();

  arm(store, "note");

  expect(selectTextDraft(store.getState())).not.toBeNull();
});

it("opens a Text Draft on a font-size square round the press, and stands the tool down in the same update", () => {
  const store = reader();
  arm(store, "text");
  selectMark(store, "WORD2222");
  const frames: { armed: string | null; kind: string }[] = [];
  store.subscribe(
    ({ armed, floating }) => ({ armed, kind: floating.kind }),
    (frame) => frames.push(frame),
    { equalityFn: sameFlat },
  );

  openTextDraft(store, {
    pageIndex: 0,
    at: [100, 500],
    fontSize: 14,
    color: "#ffd400",
  });

  expect(frames).toEqual([{ armed: null, kind: "text-draft" }]);
  expect(selectTextDraft(store.getState())).toEqual({
    kind: "text-draft",
    pageIndex: 0,
    fontSize: 14,
    color: "#ffd400",
    rotation: 0,
    box: [93, 493, 107, 507],
    text: "",
    phase: "typing",
  });
});

it("refits the box to what is typed, keeping its top-left corner", () => {
  const store = drafting();

  refitTextDraft(store, "abcd", FIT);

  // Four characters at 7 points, plus Zotero's 5 points; one line of 1.2
  // font sizes hangs from the corner at [93, 507].
  const draft = selectTextDraft(store.getState());
  expect(draft?.text).toBe("abcd");
  draft?.box.forEach((value, index) =>
    expect(value).toBeCloseTo(FITTED[index]!, 9),
  );
});

it("stores a box as wide as each line the fit measured, once Zotero rounds it", () => {
  const store = drafting();
  // Two lines, each a hair over ten points in the draft's font.
  const measure = (text: string) => text.length * 5.0002;
  refitTextDraft(store, "ab\ncd", { ...FIT, measure });

  const { box } = selectTextDraft(store.getState())!;
  const [stored] = JSON.parse(
    writePosition({ pageIndex: 0, fontSize: 14, rotation: 0, rects: [box] }),
  ).rects as number[][];

  expect(
    freeTextLines("ab\ncd", stored![2]! - stored![0]!, {
      fontSize: 14,
      measure,
    }),
  ).toEqual(["ab", "cd"]);
});

it("holds a finished Text Draft as saving and hands it to the create", () => {
  const store = drafting();
  refitTextDraft(store, "abcd", FIT);

  const committed = finishTextDraft(store);

  expect(committed).toMatchObject({ text: "abcd", phase: "saving" });
  expect(selectTextDraft(store.getState())).toBe(committed);
});

it("swaps a saving Text Draft for its record in one update", () => {
  const store = drafting();
  refitTextDraft(store, "abcd", FIT);
  finishTextDraft(store);
  const frames: { records: number; draft: boolean }[] = [];
  store.subscribe(
    (state) => ({
      records: state.records.length,
      draft: selectTextDraft(state) !== null,
    }),
    (frame) => frames.push(frame),
    { equalityFn: sameFlat },
  );

  // Zotero stores the rects rounded and the colour as it likes.
  ingestRecords(store, [
    PARAGRAPH,
    WORD,
    typed("TEXT1111", { color: "#FFD400" }),
  ]);

  // Never both drawn, and never neither.
  expect(frames).toEqual([{ records: 3, draft: false }]);
});

it("drops a settled Text Draft whose record already stands", () => {
  const store = drafting();
  refitTextDraft(store, "abcd", FIT);
  finishTextDraft(store);
  // Zotero stored another box than was sent, so no identity matches.
  ingestRecords(store, [
    PARAGRAPH,
    WORD,
    { ...typed("TEXT1111"), position: typed("X").position, comment: "abcd " },
  ]);
  expect(selectTextDraft(store.getState())).not.toBeNull();

  settleTextDraft(store, "TEXT1111");

  expect(store.getState().floating).toEqual({ kind: "none" });
});

it("swaps a settled Text Draft for the record of its key when the read lands", () => {
  const store = drafting();
  refitTextDraft(store, "abcd", FIT);
  finishTextDraft(store);

  settleTextDraft(store, "TEXT1111");
  expect(selectTextDraft(store.getState())?.key).toBe("TEXT1111");
  ingestRecords(store, [PARAGRAPH, WORD, typed("TEXT1111", { comment: "x" })]);

  expect(store.getState().floating).toEqual({ kind: "none" });
});
