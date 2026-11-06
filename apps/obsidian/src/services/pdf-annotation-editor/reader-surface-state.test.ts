import { expect, it, vi } from "vitest";

import type { SelectedText } from "@zotlit/pdf-structure";

import { passAborted } from "@/lib/abort-error";
import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import { watch } from "@/lib/view-atoms";
import { deadlineAfter } from "@/services/annotation-repository/__fixtures__/capability";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationRecord,
  TextFieldDraft,
} from "@/services/annotation-repository/service";
import { IDLE, writePosition } from "@/services/annotation-repository/write";

import {
  annotation,
  readerSurface,
  repositoryOver,
  selection,
  toolColors,
} from "./__fixtures__";
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
  current,
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
  modify,
  moveAdjust,
  moveCapture,
  openTextDraft,
  publishLiveStroke,
  refitTextDraft,
  sameFlat,
  sameFlatList,
  selectAdjust,
  selectCapture,
  selectCreateRow,
  selectCreationToolbar,
  selectFloatingHead,
  selectMark,
  selectSelectedRow,
  selectTextDraft,
  setCommenting,
  setInFlight,
  setTagging,
  settlePendingStroke,
  settleTextDraft,
  setToolColor,
  stepStack,
  tick,
  update,
} from "./reader-surface-state";

const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");
const RETRY_AFTER = deadlineAfter(NOW, 45);

/**
 * One store and a listener on each of its three slices, the way the reader's
 * surfaces subscribe to it.
 */
function observed(capability: EditingCapability = { kind: "writable" }) {
  const colors = toolColors();
  const surface = readerSurface({
    colors: colors.current(),
    capability,
    now: NOW,
  });
  const toolbar = vi.fn();
  const affordance = vi.fn();
  const capabilitySlice = vi.fn();
  const { registry, model } = surface;
  watch(registry, model.toolbar, toolbar);
  watch(registry, model.capabilityAffordance, affordance);
  watch(registry, model.capability, capabilitySlice);
  return { surface, colors, toolbar, affordance, capability: capabilitySlice };
}

/** A new object that means what the given capability means. */
function sameMeaning(capability: EditingCapability): EditingCapability {
  return capability.kind === "cooldown"
    ? {
        kind: "cooldown",
        retryAfter: deadlineAfter(NOW, 45),
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
      surface,
      toolbar,
      affordance,
      capability: slice,
    } = observed(capability);

    // A fresh object with the same meaning, as a repeated probe answers it.
    update(surface, ingestCapability(sameMeaning(capability), NOW));

    expect(toolbar).not.toHaveBeenCalled();
    expect(affordance).not.toHaveBeenCalled();
    expect(slice).not.toHaveBeenCalled();
  },
);

it("fires the capability slice when a cooldown's deadline moves", () => {
  const { surface, capability } = observed({
    kind: "cooldown",
    retryAfter: RETRY_AFTER,
  });

  update(
    surface,
    ingestCapability(
      { kind: "cooldown", retryAfter: deadlineAfter(NOW, 75) },
      NOW,
    ),
  );

  expect(capability).toHaveBeenCalledOnce();
});

it("counts a cooldown down in the affordance and leaves the toolbar alone", () => {
  const { surface, toolbar, affordance } = observed({
    kind: "cooldown",
    retryAfter: RETRY_AFTER,
  });

  update(surface, tick(NOW.add({ seconds: 1 })));

  expect(affordance).toHaveBeenCalledOnce();
  expect(affordance.mock.calls[0]![0]).toMatchObject({ countdown: 44 });
  expect(toolbar).not.toHaveBeenCalled();
});

it("changes only the armed tool's toggle when a tool is armed", () => {
  const { surface, toolbar } = observed();
  const before = selectCreationToolbar(current(surface));

  update(surface, arm("highlight"));

  expect(toolbar).toHaveBeenCalledOnce();
  const after = toolbar.mock.calls[0]![0] as CreationToolbarControl[];
  expect(changedIds(before, after)).toEqual(["highlight"]);
  expect(after.find(({ id }) => id === "highlight")?.pressed).toBe(true);
});

it("changes only that tool's toggle on a colour change, and keeps the colour", () => {
  const { surface, colors, toolbar } = observed();
  const before = selectCreationToolbar(current(surface));
  const chosen = ANNOTATION_COLORS[3]!;

  setToolColor(surface, colors, { tool: "underline", color: chosen });

  expect(toolbar).toHaveBeenCalledOnce();
  const after = toolbar.mock.calls[0]![0] as CreationToolbarControl[];
  expect(changedIds(before, after)).toEqual(["underline"]);
  expect(after.find(({ id }) => id === "underline")?.color).toBe(chosen);
  // The colour outlives this view: the next PDF opened reads it back.
  expect(colors.current().underline).toBe(chosen);
});

const PARAGRAPH = annotation("PARA7777", "highlight", {
  pageIndex: 0,
  rects: [[100, 600, 500, 640]],
});
const WORD = annotation("WRDS2222", "highlight", {
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
  const surface = readerSurface({
    colors: toolColors().current(),
    capability: { kind: "writable" },
    now: NOW,
  });
  update(surface, ingestRecords([PARAGRAPH, WORD]));
  return surface;
}

/** One Annotation's comment draft, as the repository holds it. */
function draft(
  annotationKey: string,
  state: TextFieldDraft["state"] = { kind: "editing" },
): TextFieldDraft {
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
  const surface = reader();

  update(surface, selectMark("PARA7777", { stack: ["WRDS2222", "PARA7777"] }));

  expect(current(surface).floating).toEqual({
    kind: "selected",
    key: "PARA7777",
    stack: ["WRDS2222", "PARA7777"],
    index: 1,
    quiet: false,
    commenting: false,
    tagging: false,
  });
});

it("holds a Landing's selection quiet, and the next selection loud", () => {
  const surface = reader();

  update(surface, selectMark("WRDS2222", { quiet: true }));
  expect(current(surface).floating).toMatchObject({
    key: "WRDS2222",
    stack: ["WRDS2222"],
    quiet: true,
  });

  update(surface, selectMark("PARA7777"));
  expect(current(surface).floating).toMatchObject({ quiet: false });
});

it("keeps the comment editor open for a repeat selection of the same mark", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  update(surface, setCommenting(true));

  update(surface, selectMark("WRDS2222"));
  expect(current(surface).floating).toMatchObject({ commenting: true });

  update(surface, selectMark("PARA7777"));
  expect(current(surface).floating).toMatchObject({ commenting: false });
});

it("opens the tag editor in place of the comment editor, and the reverse", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  update(surface, setCommenting(true));

  update(surface, setTagging(true));
  expect(current(surface).floating).toMatchObject({
    commenting: false,
    tagging: true,
  });

  update(surface, setCommenting(true));
  expect(current(surface).floating).toMatchObject({
    commenting: true,
    tagging: false,
  });
});

it("keeps the tag editor open for a repeat selection of the same mark only", () => {
  const surface = reader();
  const stack = ["WRDS2222", "PARA7777"];
  update(surface, selectMark("WRDS2222", { stack }));
  update(surface, setTagging(true));

  update(surface, selectMark("WRDS2222", { stack }));
  expect(selectFloatingHead(current(surface)).tagging).toBe(true);

  update(surface, stepStack);
  expect(selectFloatingHead(current(surface))).toMatchObject({
    key: "PARA7777",
    tagging: false,
  });
});

it("selects a mark with its comment editor open when asked to", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));

  update(surface, selectMark("PARA7777", { commenting: true }));
  expect(current(surface).floating).toMatchObject({
    key: "PARA7777",
    quiet: false,
    commenting: true,
  });
});

it("clears a floating surface of either kind, and a null selection clears too", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  update(surface, clearFloating);
  expect(current(surface).floating).toEqual({ kind: "none" });

  update(
    surface,
    captureSelection({ captured: CAPTURED, anchorAt: ANCHOR_AT }),
  );
  update(surface, selectMark(null));
  expect(current(surface).floating).toEqual({ kind: "none" });
});

it("lets a captured selection take the place of a selected mark", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  update(surface, setCommenting(true));

  update(
    surface,
    captureSelection({ captured: CAPTURED, anchorAt: ANCHOR_AT }),
  );

  expect(current(surface).floating).toEqual({
    kind: "create",
    captured: CAPTURED,
    anchorAt: ANCHOR_AT,
    commenting: false,
    inFlight: false,
  });
});

it("steps forward through the stack and wraps, closing the editor", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222", { stack: ["WRDS2222", "PARA7777"] }));
  update(surface, setCommenting(true));

  update(surface, stepStack);
  expect(current(surface).floating).toMatchObject({
    key: "PARA7777",
    index: 1,
    commenting: false,
  });

  update(surface, stepStack);
  expect(current(surface).floating).toMatchObject({
    key: "WRDS2222",
    index: 0,
  });
});

it("opens the comment sheet and marks a create in flight on the create variant", () => {
  const surface = reader();
  update(
    surface,
    captureSelection({ captured: CAPTURED, anchorAt: ANCHOR_AT }),
  );

  update(surface, setCommenting(true));
  update(surface, setInFlight(true));

  expect(current(surface).floating).toMatchObject({
    kind: "create",
    commenting: true,
    inFlight: true,
  });
});

it("stands the selection down when the next read no longer holds its Annotation", () => {
  const surface = reader();
  update(surface, selectMark("PARA7777"));

  update(surface, ingestRecords([PARAGRAPH]));
  expect(current(surface).floating).toMatchObject({ key: "PARA7777" });

  update(surface, ingestRecords([WORD]));
  expect(current(surface).floating).toEqual({ kind: "none" });
  expect(current(surface).records).toEqual([WORD]);
});

it("drops a deleted Annotation, its selection, and what was held on it at once", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  update(
    surface,
    ingestMutation("WRDS2222", { kind: "pending", write: "color" }),
  );
  update(surface, ingestCommentDraft("WRDS2222", draft("WRDS2222")));
  update(
    surface,
    ingestMutation("PARA7777", { kind: "pending", write: "color" }),
  );

  update(surface, dropRecord("WRDS2222"));

  const { records, floating, mutations, commentDrafts } = current(surface);
  expect(records).toEqual([PARAGRAPH]);
  expect(floating).toEqual({ kind: "none" });
  expect([...mutations.keys()]).toEqual(["PARA7777"]);
  expect(commentDrafts.size).toBe(0);
});

it("takes a read's records with the drafts and write states that stood before it", async () => {
  await using stack = new AsyncDisposableStack();
  const surface = reader();
  const { repository, service, bridge, zotero } = await repositoryOver(stack, [
    PARAGRAPH,
    WORD,
  ]);
  zotero.holdWrites();
  // The held write is still away when the stack closes, and unload rejects it.
  void repository.patchColor("PARA7777", "#ff6666").catch(passAborted);
  repository.editTextField("comment", "WRDS2222", "worth quoting");

  ingestAnnotations(surface, [PARAGRAPH, WORD], {
    annotations: service,
    bridge,
  });

  const { records, mutations, commentDrafts } = current(surface);
  expect(records).toEqual([PARAGRAPH, WORD]);
  expect([...mutations]).toEqual([
    ["PARA7777", { kind: "pending", write: "color" }],
  ]);
  expect(commentDrafts.get("WRDS2222")?.text).toBe("worth quoting");
});

it("takes a write's state and a comment draft as the repository announces them", async () => {
  await using stack = new AsyncDisposableStack();
  const surface = reader();
  const { repository, service, bridge, zotero } = await repositoryOver(stack, [
    PARAGRAPH,
    WORD,
  ]);
  using _listening = listenAnnotationEvents(surface, service, bridge);
  const release = zotero.holdWrites();

  const saving = repository.patchColor("PARA7777", "#ff6666");
  repository.editTextField("comment", "WRDS2222", "worth quoting");
  expect(current(surface).mutations.get("PARA7777")).toEqual({
    kind: "pending",
    write: "color",
  });
  expect(current(surface).commentDrafts.get("WRDS2222")?.text).toBe(
    "worth quoting",
  );

  release();
  await saving;
  expect(current(surface).mutations.has("PARA7777")).toBe(false);
});

it("drops the selected mark Zotero erased while it held a draft", async () => {
  await using stack = new AsyncDisposableStack();
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  const { repository, service, bridge, zotero } = await repositoryOver(stack, [
    PARAGRAPH,
    WORD,
  ]);
  using _listening = listenAnnotationEvents(surface, service, bridge);
  repository.editTextField("comment", "WRDS2222", "worth quoting");

  zotero.eraseInZotero("WRDS2222");
  await repository.refresh("RGRPDF24");

  const { records, floating, commentDrafts } = current(surface);
  expect(records).toEqual([PARAGRAPH]);
  expect(floating).toEqual({ kind: "none" });
  expect(commentDrafts.has("WRDS2222")).toBe(false);
});

it("takes no announcement once disposed", async () => {
  await using stack = new AsyncDisposableStack();
  const surface = reader();
  const { repository, service, bridge } = await repositoryOver(stack, [
    PARAGRAPH,
    WORD,
  ]);
  const listening = listenAnnotationEvents(surface, service, bridge);

  listening[Symbol.dispose]();
  repository.editTextField("comment", "WRDS2222", "worth quoting");

  expect(current(surface).commentDrafts.has("WRDS2222")).toBe(false);
});

it("holds what a write left on an Annotation, and forgets it once idle", () => {
  const surface = reader();

  update(
    surface,
    ingestMutation("WRDS2222", { kind: "pending", write: "color" }),
  );
  expect(current(surface).mutations.get("WRDS2222")).toEqual({
    kind: "pending",
    write: "color",
  });

  update(surface, ingestMutation("WRDS2222", IDLE));
  expect(current(surface).mutations.has("WRDS2222")).toBe(false);
});

it("fires no row subscriber for a mutation announced again unchanged", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  update(
    surface,
    ingestMutation("WRDS2222", { kind: "pending", write: "color" }),
  );
  const row = vi.fn();
  watch(
    surface.registry,
    selection(surface, selectSelectedRow, sameFlatList),
    row,
  );

  update(
    surface,
    ingestMutation("WRDS2222", { kind: "pending", write: "color" }),
  );
  expect(row).not.toHaveBeenCalled();

  update(surface, ingestMutation("WRDS2222", IDLE));
  expect(row).toHaveBeenCalledOnce();
});

it("fires the row subscriber for a change to the stored tags, not a re-read", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  const tagged = (names: string[]): AnnotationRecord => ({
    ...WORD,
    tags: names,
    tagDetails: names.map((name) => ({ name, type: 0 })),
  });
  update(surface, ingestRecords([PARAGRAPH, tagged(["to read"])]));
  const row = vi.fn();
  watch(
    surface.registry,
    selection(surface, selectSelectedRow, sameFlatList),
    row,
  );

  update(surface, ingestRecords([PARAGRAPH, tagged(["to read"])]));
  expect(row).not.toHaveBeenCalled();

  update(surface, ingestRecords([PARAGRAPH, tagged(["to read", "method"])]));
  expect(row).toHaveBeenCalledOnce();
});

it("fires no row subscriber for a mutation on an Annotation not selected", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  const row = vi.fn();
  watch(
    surface.registry,
    selection(surface, selectSelectedRow, sameFlatList),
    row,
  );

  update(
    surface,
    ingestMutation("PARA7777", { kind: "pending", write: "color" }),
  );

  expect(row).not.toHaveBeenCalled();
});

it("holds a comment draft, and forgets one the repository dropped", () => {
  const surface = reader();
  const held = draft("WRDS2222");

  update(surface, ingestCommentDraft("WRDS2222", held));
  expect(current(surface).commentDrafts.get("WRDS2222")).toBe(held);

  update(surface, ingestCommentDraft("WRDS2222", null));
  expect(current(surface).commentDrafts.has("WRDS2222")).toBe(false);
});

it("keeps the editor open when an ordinary draft settles and is dropped", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  update(surface, setCommenting(true));
  update(surface, ingestCommentDraft("WRDS2222", draft("WRDS2222")));

  update(surface, ingestCommentDraft("WRDS2222", null));

  expect(current(surface).floating).toMatchObject({ commenting: true });
});

it("closes the editor when the selected draft turns into a Write Conflict", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  update(surface, setCommenting(true));

  update(
    surface,
    ingestCommentDraft(
      "WRDS2222",
      draft("WRDS2222", { kind: "conflict", fresh: "theirs" }),
    ),
  );

  expect(current(surface).floating).toMatchObject({
    key: "WRDS2222",
    commenting: false,
  });
});

it("closes the editor when a database switch hides the selected draft", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  update(surface, setCommenting(true));
  update(surface, ingestCommentDraft("WRDS2222", draft("WRDS2222")));

  update(surface, hideCommentDraft("WRDS2222"));

  expect(current(surface).commentDrafts.has("WRDS2222")).toBe(false);
  expect(current(surface).floating).toMatchObject({ commenting: false });
});

it("closes the editors when a database switch hides their drafts", async () => {
  await using stack = new AsyncDisposableStack();
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  const zotero = await repositoryOver(stack, [PARAGRAPH, WORD]);
  const { repository, service, bridge } = zotero;
  using _listening = listenAnnotationEvents(surface, service, bridge);
  repository.editTextField("comment", "WRDS2222", "worth quoting");
  update(surface, setCommenting(true));
  repository.editTags("WRDS2222", ["to read"]);
  update(surface, setTagging(true));
  expect(current(surface).tagDrafts.get("WRDS2222")?.names).toEqual([
    "to read",
  ]);

  await zotero.switchDatabase();

  const { tagDrafts, commentDrafts, floating } = current(surface);
  expect(tagDrafts.has("WRDS2222")).toBe(false);
  expect(commentDrafts.has("WRDS2222")).toBe(false);
  expect(floating).toMatchObject({
    key: "WRDS2222",
    commenting: false,
    tagging: false,
  });
});

it("leaves another Annotation's editor alone when a draft is hidden", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  update(surface, setCommenting(true));

  update(surface, hideCommentDraft("PARA7777"));
  update(
    surface,
    ingestCommentDraft(
      "PARA7777",
      draft("PARA7777", { kind: "conflict", fresh: "theirs" }),
    ),
  );

  expect(current(surface).floating).toMatchObject({ commenting: true });
});

it("draws the selected row from the record, its mutation, and its stack", () => {
  const surface = reader();
  update(surface, selectMark("PARA7777", { stack: ["WRDS2222", "PARA7777"] }));
  update(
    surface,
    ingestMutation("PARA7777", { kind: "pending", write: "color" }),
  );

  const row = selectSelectedRow(current(surface));

  expect(
    row.flatMap((part) =>
      "disabled" in part ? [[part.id, part.disabled]] : [],
    ),
  ).toEqual([
    ["color", true],
    ["tags", true],
    ["copy", true],
    ["delete", true],
    ["reveal", false],
  ]);
  expect(row.at(-1)).toMatchObject({
    key: "PARA7777",
    color: "#2ea8e5",
    stackIndex: 1,
    stackTotal: 2,
  });
  expect(selectSelectedRow(current(reader()))).toEqual([]);
});

it("draws the create row only while a selection waits, pressing the comment toggle", () => {
  const surface = reader();
  expect(selectCreateRow(current(surface))).toEqual([]);

  update(
    surface,
    captureSelection({ captured: CAPTURED, anchorAt: ANCHOR_AT }),
  );
  update(surface, setCommenting(true));

  const row = selectCreateRow(current(surface));
  expect(row.find(({ id }) => id === "comment")).toMatchObject({
    pressed: true,
  });
  expect(sameFlatList(row, selectCreateRow(current(surface)))).toBe(true);
});

it("stands the create row down while its create is in flight", () => {
  const surface = reader();
  update(
    surface,
    captureSelection({ captured: CAPTURED, anchorAt: ANCHOR_AT }),
  );

  update(surface, setInFlight(true));

  const row = selectCreateRow(current(surface));
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
  const surface = reader();
  update(surface, ingestRecords([PARAGRAPH, WORD, FIGURE]));
  update(surface, selectMark("FDRFQ7C2"));
  const heard = vi.fn();
  watch(surface.registry, surface.model.adjust, heard);
  return { surface, heard };
}

it("begins an adjustment that proposes the confirmed position", () => {
  const { surface } = adjusting();

  update(surface, beginAdjust({ grip: "br", from: [570, 395.509] }));

  expect(selectAdjust(current(surface))).toEqual({
    grip: "br",
    from: [570, 395.509],
    proposal: FIGURE.position,
    phase: "pressed",
  });
});

it("moves the proposal, and notifies no one for a move that changes nothing", () => {
  const { surface, heard } = adjusting();
  update(surface, beginAdjust({ grip: "r", from: [570, 569] }));
  heard.mockClear();

  update(surface, moveAdjust(widened(600)));
  update(surface, moveAdjust(widened(600.0001)));

  expect(heard).toHaveBeenCalledTimes(1);
  expect(selectAdjust(current(surface))).toMatchObject({
    proposal: widened(600),
    phase: "dragging",
  });
});

it("cancels an adjustment and keeps the mark selected", () => {
  const { surface } = adjusting();
  update(surface, beginAdjust({ grip: "r", from: [570, 569] }));
  update(surface, moveAdjust(widened(600)));

  update(surface, cancelAdjust);

  expect(selectAdjust(current(surface))).toBeNull();
  expect(current(surface).floating).toMatchObject({ key: "FDRFQ7C2" });
});

it("ends a release that moved nothing with nothing to save", () => {
  const { surface } = adjusting();
  update(surface, beginAdjust({ grip: "r", from: [570, 569] }));

  expect(modify(surface, endAdjust)).toBeNull();
  expect(selectAdjust(current(surface))).toBeNull();
});

it("ends a drag back to the confirmed geometry with nothing to save", () => {
  const { surface } = adjusting();
  update(surface, beginAdjust({ grip: "r", from: [570, 569] }));
  update(surface, moveAdjust(widened(600)));
  update(surface, moveAdjust(widened(570.0002)));

  expect(modify(surface, endAdjust)).toBeNull();
  expect(selectAdjust(current(surface))).toBeNull();
});

it("holds a changed release's proposal while it saves, and takes no more moves", () => {
  const { surface } = adjusting();
  update(surface, beginAdjust({ grip: "r", from: [570, 569] }));
  update(surface, moveAdjust(widened(600)));

  expect(modify(surface, endAdjust)).toEqual(widened(600));

  update(surface, moveAdjust(widened(610)));
  expect(selectAdjust(current(surface))).toMatchObject({
    proposal: widened(600),
    phase: "saving",
  });
});

it("drops the adjustment with the selection it stood on", () => {
  const { surface } = adjusting();
  update(surface, beginAdjust({ grip: "r", from: [570, 569] }));

  update(surface, selectMark("WRDS2222"));

  expect(selectAdjust(current(surface))).toBeNull();
});

it("adjusts selected ink and a selected free-text mark", () => {
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
  const surface = reader();
  update(surface, ingestRecords([stroke, typed]));

  update(surface, selectMark("TEXT1111"));
  update(surface, beginAdjust({ grip: "body", from: [150, 110] }));
  expect(selectAdjust(current(surface))?.proposal).toEqual(typed.position);
  update(surface, cancelAdjust);

  update(surface, selectMark("4PE492KU"));
  update(surface, beginAdjust({ grip: "body", from: [220, 680] }));
  update(surface, moveAdjust(moved));
  expect(modify(surface, endAdjust)).toEqual(moved);
});

it("carries a text range's quoted text with its proposal", () => {
  const surface = reader();
  update(surface, ingestRecords([PARAGRAPH]));
  update(surface, selectMark(PARAGRAPH.key));
  update(surface, beginAdjust({ grip: "end", from: [300, 700] }));
  const longer: EditablePosition = {
    kind: "pdf-rects",
    pageIndex: 0,
    rects: [[72, 700, 330, 712]],
  };

  update(surface, moveAdjust(longer, "the longer quote"));

  expect(selectAdjust(current(surface))).toMatchObject({
    proposal: longer,
    text: "the longer quote",
  });
  expect(modify(surface, endAdjust)).toEqual(longer);
  expect(selectAdjust(current(surface))?.text).toBe("the longer quote");
});

/** A store with an image capture pressed on page one at (100, 500). */
function capturing() {
  const surface = reader();
  update(surface, beginCapture({ pageIndex: 0, from: [100, 500] }));
  return surface;
}

it("keeps nothing from a capture released under ten points on a side", () => {
  const surface = capturing();
  update(surface, moveCapture([100, 491, 300, 500]));

  expect(modify(surface, endCapture)).toBeNull();
  expect(current(surface).floating).toEqual({ kind: "none" });
});

it("keeps nothing from a capture released where it was pressed", () => {
  const surface = capturing();

  expect(modify(surface, endCapture)).toBeNull();
  expect(selectCapture(current(surface))).toBeNull();
});

it("begins no second capture while one stands", () => {
  const surface = capturing();
  update(surface, moveCapture([100, 300, 300, 500]));

  update(surface, beginCapture({ pageIndex: 1, from: [5, 5] }));

  expect(selectCapture(current(surface))).toMatchObject({
    pageIndex: 0,
    rect: [100, 300, 300, 500],
  });
});

it("holds a released capture while it saves, and takes no more moves", () => {
  const surface = capturing();
  update(surface, moveCapture([100, 300, 300, 500]));

  expect(modify(surface, endCapture)).toEqual([100, 300, 300, 500]);
  update(surface, moveCapture([100, 400, 300, 500]));

  expect(selectCapture(current(surface))).toEqual({
    kind: "capture",
    pageIndex: 0,
    from: [100, 500],
    rect: [100, 300, 300, 500],
    phase: "saving",
  });
});

it("takes the floating surface from a selected mark, and cancels to nothing", () => {
  const surface = reader();
  update(surface, ingestRecords([PARAGRAPH, WORD]));
  update(surface, selectMark("WRDS2222"));

  update(surface, beginCapture({ pageIndex: 0, from: [100, 500] }));
  expect(selectFloatingHead(current(surface))).toEqual({
    kind: "capture",
    key: null,
    commenting: false,
    tagging: false,
  });
  // A capture has no comment to open.
  update(surface, setCommenting(true));
  expect(selectFloatingHead(current(surface)).commenting).toBe(false);

  update(surface, cancelCapture);
  expect(current(surface).floating).toEqual({ kind: "none" });
});

/** A stroke released on page one, rounded as a create sends it. */
const STROKE = {
  pageIndex: 0,
  width: 2,
  paths: [[120.5, 600.25, 130.125, 610.5, 140, 606.75]],
  color: "#2ea8e5",
};

it("publishes the Live Stroke beside the floating surface, and clears it", () => {
  const surface = reader();
  update(surface, selectMark("WRDS2222"));
  const floating = current(surface).floating;
  const live = {
    pageIndex: 0,
    paths: [[120, 600]],
    width: 2,
    color: "#2ea8e5",
  };

  update(surface, publishLiveStroke(live));
  expect(current(surface).liveStroke).toEqual(live);
  // The popup host reads the floating surface alone, which a stroke leaves be.
  expect(current(surface).floating).toBe(floating);

  update(surface, clearLiveStroke);
  expect(current(surface).liveStroke).toBeNull();
});

it.each(["highlight", "underline", "image"] as const)(
  "keeps the floating surface when %s is armed",
  (tool) => {
    const surface = reader();
    update(surface, selectMark("WRDS2222"));

    update(surface, arm(tool));

    expect(selectFloatingHead(current(surface)).key).toBe("WRDS2222");
  },
);

it.each(["ink", "note", "text"] as const)(
  "clears the floating surface when %s is armed",
  (tool) => {
    const surface = reader();
    update(surface, selectMark("WRDS2222"));

    update(surface, arm(tool));

    expect(current(surface).floating).toEqual({ kind: "none" });
  },
);

it("appends Pending Strokes in release order", () => {
  const surface = reader();

  update(surface, appendPendingStroke({ id: 1, ...STROKE }));
  update(surface, appendPendingStroke({ id: 2, ...STROKE, pageIndex: 1 }));

  expect(current(surface).pendingStrokes.map(({ id }) => id)).toEqual([1, 2]);
});

it("swaps a Pending Stroke for its record in one update", () => {
  const surface = reader();
  update(surface, appendPendingStroke({ id: 1, ...STROKE }));
  const record = annotation("INK11111", "ink", {
    pageIndex: 0,
    width: 2,
    paths: [[120.5, 600.25, 130.125, 610.5, 140, 606.75]],
  });
  const frames: { records: number; pending: number }[] = [];
  watch(
    surface.registry,
    selection(
      surface,
      ({ records, pendingStrokes }) => ({ records, pendingStrokes }),
      sameFlat,
    ),
    ({ records, pendingStrokes }) =>
      frames.push({ records: records.length, pending: pendingStrokes.length }),
  );

  update(surface, ingestRecords([PARAGRAPH, WORD, record]));

  // Never both drawn, and never neither.
  expect(frames).toEqual([{ records: 3, pending: 0 }]);
});

it("keeps a Pending Stroke through a read that does not yet hold it", () => {
  const surface = reader();
  update(surface, appendPendingStroke({ id: 1, ...STROKE }));
  const other = annotation("INK22222", "ink", {
    pageIndex: 0,
    width: 2,
    paths: [[120.5, 600.25, 130.125, 610.5]],
  });

  update(surface, ingestRecords([PARAGRAPH, WORD, other]));

  expect(current(surface).pendingStrokes.map(({ id }) => id)).toEqual([1]);
});

it.each([
  ["another colour", { color: "#ff6666" }, 2],
  ["another pen width", {}, 3],
])(
  "keeps a Pending Stroke through a record of its points in %s",
  (_, colour, width) => {
    const surface = reader();
    update(surface, appendPendingStroke({ id: 1, ...STROKE }));
    const other = {
      ...annotation("INK22222", "ink", {
        pageIndex: 0,
        width,
        paths: [[120.5, 600.25, 130.125, 610.5, 140, 606.75]],
      }),
      ...colour,
    };

    update(surface, ingestRecords([PARAGRAPH, WORD, other]));

    expect(current(surface).pendingStrokes.map(({ id }) => id)).toEqual([1]);
  },
);

it("swaps a Pending Stroke for a record that differs only in colour case", () => {
  const surface = reader();
  update(surface, appendPendingStroke({ id: 1, ...STROKE, color: "#2EA8E5" }));

  update(
    surface,
    ingestRecords([
      PARAGRAPH,
      WORD,
      annotation("INK11111", "ink", {
        pageIndex: 0,
        width: 2,
        paths: [[120.5, 600.25, 130.125, 610.5, 140, 606.75]],
      }),
    ]),
  );

  expect(current(surface).pendingStrokes).toEqual([]);
});

it("drops a settled Pending Stroke whose record already stands", () => {
  const surface = reader();
  update(surface, appendPendingStroke({ id: 1, ...STROKE }));
  // Zotero stored other points than were sent, so no geometry matches.
  const stored = annotation("INK11111", "ink", {
    pageIndex: 0,
    width: 2,
    paths: [[121, 601]],
  });
  update(surface, ingestRecords([PARAGRAPH, WORD, stored]));
  expect(current(surface).pendingStrokes).toHaveLength(1);

  update(surface, settlePendingStroke({ id: 1, key: "INK11111" }));

  expect(current(surface).pendingStrokes).toEqual([]);
});

it("swaps a settled Pending Stroke for the record of its key when the read lands", () => {
  const surface = reader();
  update(surface, appendPendingStroke({ id: 1, ...STROKE }));

  update(surface, settlePendingStroke({ id: 1, key: "INK11111" }));
  expect(current(surface).pendingStrokes).toHaveLength(1);
  update(
    surface,
    ingestRecords([
      PARAGRAPH,
      WORD,
      annotation("INK11111", "ink", {
        pageIndex: 0,
        width: 2,
        paths: [[121, 601]],
      }),
    ]),
  );

  expect(current(surface).pendingStrokes).toEqual([]);
});

it("drops a failed create's Pending Stroke and leaves the others", () => {
  const surface = reader();
  update(surface, appendPendingStroke({ id: 1, ...STROKE }));
  update(surface, appendPendingStroke({ id: 2, ...STROKE, pageIndex: 1 }));

  update(surface, dropPendingStroke(1));

  expect(current(surface).pendingStrokes.map(({ id }) => id)).toEqual([2]);
});

/** A text box opened by a click at `[100, 500]` on page one, at 14 points. */
function drafting() {
  const surface = reader();
  update(surface, arm("text"));
  update(
    surface,
    openTextDraft({
      pageIndex: 0,
      at: [100, 500],
      fontSize: 14,
      color: "#ffd400",
    }),
  );
  return surface;
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
    const surface = drafting();
    update(surface, refitTextDraft(text, FIT));

    expect(modify(surface, finishTextDraft)).toBeNull();
    expect(current(surface).floating).toEqual({ kind: "none" });
  },
);

it("takes no more typing once a Text Draft is saving, and commits it once", () => {
  const surface = drafting();
  update(surface, refitTextDraft("abcd", FIT));
  expect(modify(surface, finishTextDraft)?.phase).toBe("saving");

  update(surface, refitTextDraft("abcde", FIT));

  expect(selectTextDraft(current(surface))?.text).toBe("abcd");
  expect(modify(surface, finishTextDraft)).toBeNull();
});

it("takes a failed create's Text Draft off the page", () => {
  const surface = drafting();
  update(surface, refitTextDraft("abcd", FIT));
  modify(surface, finishTextDraft);

  update(surface, dropTextDraft);

  expect(current(surface).floating).toEqual({ kind: "none" });
});

it("keeps a saving Text Draft through a read that does not yet hold it", () => {
  const surface = drafting();
  update(surface, refitTextDraft("abcd", FIT));
  modify(surface, finishTextDraft);

  update(
    surface,
    ingestRecords([
      PARAGRAPH,
      WORD,
      typed("TEXT2222", { comment: "abcde" }),
      typed("TEXT3333", { color: "#ff6666" }),
    ]),
  );

  expect(selectTextDraft(current(surface))?.phase).toBe("saving");
});

it("keeps a Text Draft still typing through a read of the very same text", () => {
  const surface = drafting();
  update(surface, refitTextDraft("abcd", FIT));

  update(surface, ingestRecords([PARAGRAPH, WORD, typed("TEXT1111")]));

  expect(selectTextDraft(current(surface))?.phase).toBe("typing");
});

it("keeps a Text Draft when a tool is armed, which finishes it instead", () => {
  const surface = drafting();

  update(surface, arm("note"));

  expect(selectTextDraft(current(surface))).not.toBeNull();
});

it("opens a Text Draft on a font-size square round the press, and stands the tool down in the same update", () => {
  const surface = reader();
  update(surface, arm("text"));
  update(surface, selectMark("WRDS2222"));
  const frames: { armed: string | null; kind: string }[] = [];
  watch(
    surface.registry,
    selection(
      surface,
      ({ armed, floating }) => ({ armed, kind: floating.kind }),
      sameFlat,
    ),
    (frame) => frames.push(frame),
  );

  update(
    surface,
    openTextDraft({
      pageIndex: 0,
      at: [100, 500],
      fontSize: 14,
      color: "#ffd400",
    }),
  );

  expect(frames).toEqual([{ armed: null, kind: "text-draft" }]);
  expect(selectTextDraft(current(surface))).toEqual({
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
  const surface = drafting();

  update(surface, refitTextDraft("abcd", FIT));

  // Four characters at 7 points, plus Zotero's 5 points; one line of 1.2
  // font sizes hangs from the corner at [93, 507].
  const draft = selectTextDraft(current(surface));
  expect(draft?.text).toBe("abcd");
  draft?.box.forEach((value, index) =>
    expect(value).toBeCloseTo(FITTED[index]!, 9),
  );
});

it("stores a box as wide as each line the fit measured, once Zotero rounds it", () => {
  const surface = drafting();
  // Two lines, each a hair over ten points in the draft's font.
  const measure = (text: string) => text.length * 5.0002;
  update(surface, refitTextDraft("ab\ncd", { ...FIT, measure }));

  const { box } = selectTextDraft(current(surface))!;
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
  const surface = drafting();
  update(surface, refitTextDraft("abcd", FIT));

  const committed = modify(surface, finishTextDraft);

  expect(committed).toMatchObject({ text: "abcd", phase: "saving" });
  expect(selectTextDraft(current(surface))).toBe(committed);
});

it("swaps a saving Text Draft for its record in one update", () => {
  const surface = drafting();
  update(surface, refitTextDraft("abcd", FIT));
  modify(surface, finishTextDraft);
  const frames: { records: number; draft: boolean }[] = [];
  watch(
    surface.registry,
    selection(
      surface,
      (state) => ({
        records: state.records.length,
        draft: selectTextDraft(state) !== null,
      }),
      sameFlat,
    ),
    (frame) => frames.push(frame),
  );

  // Zotero stores the rects rounded and the colour as it likes.
  update(
    surface,
    ingestRecords([PARAGRAPH, WORD, typed("TEXT1111", { color: "#FFD400" })]),
  );

  // Never both drawn, and never neither.
  expect(frames).toEqual([{ records: 3, draft: false }]);
});

it("drops a settled Text Draft whose record already stands", () => {
  const surface = drafting();
  update(surface, refitTextDraft("abcd", FIT));
  modify(surface, finishTextDraft);
  // Zotero stored another box than was sent, so no identity matches.
  update(
    surface,
    ingestRecords([
      PARAGRAPH,
      WORD,
      { ...typed("TEXT1111"), position: typed("X").position, comment: "abcd " },
    ]),
  );
  expect(selectTextDraft(current(surface))).not.toBeNull();

  update(surface, settleTextDraft("TEXT1111"));

  expect(current(surface).floating).toEqual({ kind: "none" });
});

it("swaps a settled Text Draft for the record of its key when the read lands", () => {
  const surface = drafting();
  update(surface, refitTextDraft("abcd", FIT));
  modify(surface, finishTextDraft);

  update(surface, settleTextDraft("TEXT1111"));
  expect(selectTextDraft(current(surface))?.key).toBe("TEXT1111");
  update(
    surface,
    ingestRecords([PARAGRAPH, WORD, typed("TEXT1111", { comment: "x" })]),
  );

  expect(current(surface).floating).toEqual({ kind: "none" });
});
