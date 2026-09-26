// The write path's pure parts: what one command sends, what a write leaves on
// the Annotation it touched, and what a failed one says to the user.
//
// @see https://github.com/aidenlx/zotlit/issues/1145

import type {
  AnnotationPosition,
  ResolvedAnnotationTypeName,
  TagType,
} from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import type { LocalApiFailure } from "@/services/zotero-local-api/service";
import type { WireTag } from "@/services/zotero-local-api/wire";

import { capabilityOfFailure } from "./capability";
import type { EditingCapability } from "./capability";
import { editingCapabilityCopy } from "./capability-copy";

/**
 * Why a write did not land, beside every failure Zotero itself can answer.
 * The three extra members are refusals: none ever left ZotLit.
 */
export type WriteFailure =
  | LocalApiFailure
  /**
   * The Annotation came from the Zotero DB source, which keeps no object
   * version, so there is no precondition to send and the write is refused
   * before any request.
   *
   * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
   */
  | { kind: "db-source" }
  /** No list the repository holds names this Annotation, so nothing was read. */
  | { kind: "unknown-annotation" }
  /**
   * The stored position would be longer than Zotero accepts, so the create or
   * Geometry Edit is refused before the write rather than answered `413`.
   *
   * @see https://github.com/aidenlx/zotlit/issues/1139 — "Zotero Local API contract"
   */
  | { kind: "position-too-large" };

/**
 * The Annotation fields typed as text in a field editor: the comment and the
 * Quoted Text. Each one drafts, saves, conflicts, and records its History Step
 * on the same rules, so a field added here reaches every one of them.
 */
export const TEXT_FIELDS = ["comment", "text"] as const;

/** One of the {@link TEXT_FIELDS}, which also names its write. */
export type TextField = (typeof TEXT_FIELDS)[number];

/** Whether a write, or a field, is one of the {@link TEXT_FIELDS}. */
export function isTextField(write: string): write is TextField {
  return (TEXT_FIELDS as readonly string[]).includes(write);
}

/** One value per text field, each built by `build`. */
export function byTextField<V>(
  build: (field: TextField) => V,
): Record<TextField, V> {
  return Object.fromEntries(
    TEXT_FIELDS.map((field) => [field, build(field)]),
  ) as Record<TextField, V>;
}

/** Which editing verb a Write Conflict stands on. */
export type ConflictedWrite = "color" | "delete" | "geometry" | TextField;

/**
 * Zotero's copy of one Annotation moved between the read a write stamped its
 * precondition off and the write itself. Both values travel, because the card
 * shows the fresh Zotero value beside the user's input and neither may be lost
 * silently.
 *
 * A Geometry Edit carries its whole attempt, so "Apply again" re-sends the
 * position, Sort Index, and quoted text it computed.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1139 — "Editing Capability and degraded states"
 */
export type WriteConflict =
  | {
      write: Exclude<ConflictedWrite, "geometry">;
      /** What the user asked for; `null` for a delete, which names no value. */
      attempted: string | null;
      /** What Zotero holds now for the same field; `null` where Zotero holds none. */
      fresh: string | null;
    }
  | {
      write: "geometry";
      attempted: GeometryEdit;
      /**
       * What made the refused edit, which "Apply again" sends it again as: a
       * nudge re-sent by hand is still a nudge, and joins the run it belongs
       * to.
       */
      input: GeometryInput;
      /** The geometry Zotero holds now. */
      fresh: { position: AnnotationPosition; text: string | null };
    };

/**
 * Which write is in flight: one of the editing verbs, a create, or one
 * tag editing session's save. A tag save never stands in a Write Conflict: its
 * names merge into the tags Zotero holds.
 *
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
export type PendingWrite = ConflictedWrite | "create" | "tags";

/**
 * What a write left on one Annotation. `pending` stands from the moment a
 * write is asked for, through every write queued behind it, and names the one
 * in flight, because not every write in flight stands the verbs down. Every
 * surface draws what a write proposes as its Pending Proposal; a gesture's
 * write also shows as disabled verbs. A comment write shows as nothing more: any verb pressed
 * meanwhile queues behind it, so the save is a background sync the user only
 * hears about when it fails. A tag editing session's own save is marked
 * `session`, and stands down no verb either. A tag undo or redo carries no
 * mark, and is a gesture's write like any other.
 *
 * A conflict stands on one Annotation and carries both values the card offers.
 */
export type MutationState =
  | { kind: "idle" }
  | { kind: "pending"; write: PendingWrite; session?: true }
  | { kind: "conflict"; conflict: WriteConflict }
  | { kind: "failed"; failure: WriteFailure };

/** The state an Annotation no write is standing on is in. */
export const IDLE: MutationState = { kind: "idle" };

/** The Annotation one command names, as the route spells it. */
export interface WriteTarget {
  /** `users/0`, or the group's route. */
  library: string;
  /** The bare item key, without the Indexed Key's group suffix. */
  key: string;
  /** The version the last read answered, which the write sends as its precondition. */
  version: number;
}

/** One request, as the Zotero Local API client's authorized seam takes it. */
export interface WriteRequest {
  path: string;
  method: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
}

const JSON_CONTENT: Readonly<Record<string, string>> = {
  "Content-Type": "application/json",
};

/**
 * Zotero's own colour rule is case-sensitive: `annotationColor` is matched
 * against lower-case hex, so `#FFD400` is refused where `#ffd400` is taken.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L4512-L4518
 */
export function wireColor(color: string): string {
  return color.toLowerCase();
}

/**
 * A colour change, on an Annotation of any type — Zotero's colour setter is
 * one rule for all six, so an ink stroke recolours like a highlight.
 *
 * A `PATCH` is a merge patch, so naming the colour changes the colour and
 * nothing else: only a Geometry Edit rewrites the Sort Index after creation,
 * and this body carries none.
 *
 * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
 */
export function colorPatch(target: WriteTarget, color: string): WriteRequest {
  return patch(target, { annotationColor: wireColor(color) });
}

/**
 * A comment change. An empty string is how a comment is cleared: Zotero trims
 * a string field and stores an empty one as no value.
 */
export function commentPatch(
  target: WriteTarget,
  comment: string,
): WriteRequest {
  return patch(target, { annotationComment: comment });
}

/**
 * A Text Edit: the Quoted Text of a highlight or underline, and nothing else.
 * The position and the Sort Index stay out of the body, so the Annotation
 * keeps its range and its place in the reading order. An empty string clears
 * the text, which Zotero stores as no value.
 */
export function textPatch(target: WriteTarget, text: string): WriteRequest {
  return patch(target, { annotationText: text });
}

/** One Annotation Tag as Zotero stores it: a name and the tag's type. */
export interface AnnotationTag {
  name: string;
  /**
   * Zotero's own number, which a tag write sends back unchanged. It is wider
   * than the db's `TagType`, because a Zotero reply can name a type that
   * Zotero added after that mapping was written.
   */
  type: number;
}

/** The type Zotero stores for a tag the user adds by hand. */
export const MANUAL_TAG_TYPE = 0 satisfies TagType;

/** A record's tags with their types; a record without types holds manual tags. */
export function annotationTags(record: {
  tags: readonly string[];
  tagDetails?: readonly AnnotationTag[];
}): readonly AnnotationTag[] {
  return (
    record.tagDetails ??
    record.tags.map((name) => ({ name, type: MANUAL_TAG_TYPE }))
  );
}

/**
 * What one change to an Annotation's tags added and removed. A tag editing
 * session names its tags by name; a History Step holds them with their types.
 */
export interface TagChange<T extends string | AnnotationTag = string> {
  added: readonly T[];
  removed: readonly T[];
}

/**
 * The tags one side holds and the other lacks, compared by name. Names
 * compare case-sensitively, as Zotero's do.
 *
 * @param before the names a session started from, or the tags a write was
 *   built against.
 * @param after the names it ends on, or the tags Zotero confirmed.
 * @returns what went from `before` to `after`.
 */
export function tagChange<T extends string | AnnotationTag>(
  before: readonly T[],
  after: readonly T[],
): TagChange<T> {
  return {
    added: after.filter((tag) => !hasTag(before, tag)),
    removed: before.filter((tag) => !hasTag(after, tag)),
  };
}

/** Whether a change adds and removes no name at all. */
export function noTagChange({
  added,
  removed,
}: TagChange<string | AnnotationTag>): boolean {
  return added.length === 0 && removed.length === 0;
}

/**
 * One change applied to the tags Zotero holds now. A kept tag keeps its type,
 * an added name is manual, an added tag keeps the type it carries, and an
 * automatic tag can be removed. A tag that Zotero added or removed beside the
 * change is left as Zotero holds it, so the merge never needs a Write
 * Conflict.
 *
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
export function mergeTags(
  current: readonly AnnotationTag[],
  { added, removed }: TagChange<string | AnnotationTag>,
): AnnotationTag[] {
  const kept = current.filter((tag) => !hasTag(removed, tag));
  const fresh = added.filter((tag) => !hasTag(kept, tag)).map(typedTag);
  return [...kept, ...fresh];
}

function hasTag(
  tags: readonly (string | AnnotationTag)[],
  tag: string | AnnotationTag,
): boolean {
  const name = tagName(tag);
  return tags.some((other) => tagName(other) === name);
}

function tagName(tag: string | AnnotationTag): string {
  return typeof tag === "string" ? tag : tag.name;
}

/** A bare name is a tag the user adds, which is a manual tag. */
function typedTag(tag: string | AnnotationTag): AnnotationTag {
  return typeof tag === "string" ? { name: tag, type: MANUAL_TAG_TYPE } : tag;
}

/**
 * A tag change, which sends the whole list: Zotero replaces an item's tags
 * with the list a patch names, so a list with one tag left out removes it.
 */
export function tagsPatch(
  target: WriteTarget,
  tags: readonly AnnotationTag[],
): WriteRequest {
  return patch(target, {
    tags: tags.map(({ name, type }) => ({ tag: name, type })),
  });
}

/**
 * A Geometry Edit: the position as the JSON string Zotero's setter demands, the
 * recomputed Sort Index, and for a highlight or underline the quoted text. The
 * Page Label stays, because a Geometry Edit never changes the page.
 *
 * @param type the Annotation's own type, which decides whether text is sent.
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L4586-L4605
 * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
 */
export function geometryPatch(
  target: WriteTarget,
  type: ResolvedAnnotationTypeName,
  edit: GeometryEdit,
): WriteRequest {
  const quotes = type === "highlight" || type === "underline";
  return patch(target, {
    annotationPosition: writePosition(edit.position),
    annotationSortIndex: edit.sortIndex,
    ...(quotes && edit.text !== undefined && { annotationText: edit.text }),
  });
}

/**
 * The longest `annotationPosition` a create or a Geometry Edit may send.
 * Zotero's own reader splits a longer position into several Annotations;
 * ZotLit creates one Annotation per selection, so it refuses rather than
 * splits.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L4546-L4560
 */
export const MAX_POSITION_LENGTH = 65_000;

/** How many decimals a stored PDF coordinate keeps. */
const POSITION_DECIMALS = 1e3;

/** The PDF position a created highlight or underline covers, unrounded. */
export interface CreatePosition {
  pageIndex: number;
  rects: readonly (readonly number[])[];
  /** The second page's boxes, for a quote that ran over a page break. */
  nextPageRects?: readonly (readonly number[])[];
}

/** The strokes of an ink Annotation, unrounded. */
export interface InkPosition {
  pageIndex: number;
  width: number;
  paths: readonly (readonly number[])[];
}

/**
 * The box of a free-text Annotation, unrounded, with the font size and turn
 * its text is laid out at.
 */
export interface TextPosition {
  pageIndex: number;
  fontSize: number;
  /** Degrees counter-clockwise, as Zotero stores it. */
  rotation: number;
  rects: readonly (readonly number[])[];
}

/** Every PDF position ZotLit writes: rects, ink strokes, or a text box. */
export type WritablePosition = CreatePosition | InkPosition | TextPosition;

/**
 * A read position as a write sends it, or `null` for a position no write ever
 * proposes — an EPUB or snapshot selector, or one this plugin could not parse.
 */
export function writablePosition(
  position: AnnotationPosition,
): WritablePosition | null {
  switch (position.kind) {
    case "pdf-rects":
    case "pdf-ink":
    case "pdf-text":
      return position;
    default:
      return null;
  }
}

/**
 * What made one Geometry Edit. The Annotation History reads it and nothing
 * else does: a run of keyboard edits joins into one History Step, and every
 * pointer gesture is a step of its own.
 */
export type GeometryInput = "pointer" | "keyboard";

/**
 * One Geometry Edit, as the reader computed it: the new position, the Sort
 * Index recomputed from it, and for a highlight or underline the quoted text
 * the new range covers.
 */
export interface GeometryEdit {
  position: WritablePosition;
  /** Computed from the **unrounded** position, as Zotero's reader does. */
  sortIndex: string;
  /** The quoted text; sent for highlight and underline only. */
  text?: string;
}

/** One Annotation to create, as the reader decided it. */
export interface AnnotationDraft {
  /** The Attachment it hangs from, by bare item key. */
  parentKey: string;
  type: ResolvedAnnotationTypeName;
  /** A swatch in any case; the write sends lower case. */
  color: string;
  /** Empty where the user typed none, which Zotero stores as no comment. */
  comment: string;
  /** The quoted text, which Zotero keeps for highlight and underline only. */
  text: string;
  /** Zotero's printed-page label for the page the Annotation sits on. */
  pageLabel: string;
  /** Computed from the **unrounded** position, as Zotero's reader does. */
  sortIndex: string;
  position: WritablePosition;
  /** The tags a restore puts back; a fresh Annotation carries none. */
  tags?: readonly AnnotationTag[];
}

/** One create request with Zotero's write token as a transport detail. */
export interface CreateRequest extends WriteRequest {
  /** Zotero uses this token to identify the request. */
  writeToken: string;
}

/**
 * A fresh write token: 32 hexadecimal characters, the shape Zotero's own
 * clients send.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L1889-L1906
 */
export function newWriteToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/**
 * The create: a one-element multi-object `POST` carrying a write token and
 * neither a client key nor a version, because Zotero generates the key and a
 * supplied one is refused on Zotero 10.
 *
 * `annotationType` is the first key of the object. Zotero's `fromJSON` walks
 * the body with `for (let field in json)` and every other `annotation*` setter
 * asserts the type is already set, so a later type is a `400`.
 *
 * The rectangles are rounded to three decimals here and nowhere else: the Sort
 * Index in `draft` was computed from the unrounded values, as Zotero's reader
 * computes it.
 *
 * @param library the library the create targets, as the route spells it.
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L5677
 */
export function createRequest(
  library: string,
  draft: AnnotationDraft,
  writeToken: string = newWriteToken(),
): CreateRequest {
  const quotes = draft.type === "highlight" || draft.type === "underline";
  return {
    path: `/api/${library}/items`,
    method: "POST",
    headers: { ...JSON_CONTENT, "Zotero-Write-Token": writeToken },
    writeToken,
    body: JSON.stringify([
      {
        annotationType: draft.type,
        itemType: "annotation",
        parentItem: draft.parentKey,
        ...(quotes && { annotationText: draft.text }),
        annotationComment: draft.comment,
        annotationColor: wireColor(draft.color),
        annotationPageLabel: draft.pageLabel,
        annotationSortIndex: draft.sortIndex,
        annotationPosition: writePosition(draft.position),
        ...(draft.tags?.length && {
          tags: draft.tags.map(({ name, type }) => ({ tag: name, type })),
        }),
      },
    ]),
  };
}

/** One PDF coordinate as Zotero stores it: three decimals. */
export function roundCoordinate(value: number): number {
  return Math.round(value * POSITION_DECIMALS) / POSITION_DECIMALS;
}

/**
 * The stored position, rounded the way Zotero's reader rounds it before every
 * save: three decimals in PDF user-space points, on rects, ink paths, and ink
 * width alike. A text box's font size and rotation are kept as given, as
 * Zotero keeps them.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/lib/utilities.js#L686-L712
 */
export function writePosition(position: WritablePosition): string {
  const roundAll = (rects: readonly (readonly number[])[]) =>
    rects.map((rect) => rect.map(roundCoordinate));
  if ("paths" in position) {
    return JSON.stringify({
      pageIndex: position.pageIndex,
      width: roundCoordinate(position.width),
      paths: roundAll(position.paths),
    });
  }
  if ("fontSize" in position) {
    return JSON.stringify({
      pageIndex: position.pageIndex,
      fontSize: position.fontSize,
      rotation: position.rotation,
      rects: roundAll(position.rects),
    });
  }
  return JSON.stringify({
    pageIndex: position.pageIndex,
    rects: roundAll(position.rects),
    ...(position.nextPageRects && {
      nextPageRects: roundAll(position.nextPageRects),
    }),
  });
}

/**
 * A fitted box, `[left, bottom, right, top]`, widened out to the thousandths
 * of a point Zotero stores. A box fitted to its widest line has no room past
 * it, and rounding its sides to the nearest thousandth could narrow it enough
 * to wrap that line.
 */
export function storedWide([left, bottom, right, top]: readonly [
  number,
  number,
  number,
  number,
]): [number, number, number, number] {
  return [
    Math.floor(left * POSITION_DECIMALS) / POSITION_DECIMALS,
    bottom,
    Math.ceil(right * POSITION_DECIMALS) / POSITION_DECIMALS,
    top,
  ];
}

/**
 * A text Annotation as Zotero stores it: its rounded position, colour and
 * text. Two that compare equal are the same stored Annotation.
 */
export function textIdentity(
  position: TextPosition,
  { color, comment }: { color: string | null; comment: string | null },
): string {
  return JSON.stringify([
    color?.toLowerCase(),
    comment,
    writePosition({
      pageIndex: position.pageIndex,
      fontSize: position.fontSize,
      rotation: position.rotation,
      rects: position.rects,
    }),
  ]);
}

/**
 * A delete, whose precondition is a header rather than a body: Zotero's
 * single-object delete reads `If-Unmodified-Since-Version` alone and answers
 * `428` without it.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L2315-L2330
 */
export function eraseRequest(target: WriteTarget): WriteRequest {
  return {
    path: itemPath(target),
    method: "DELETE",
    headers: { "If-Unmodified-Since-Version": String(target.version) },
  };
}

/**
 * The notices a group write raises: one for each distinct reason among the
 * Annotations that did not land, so ten deletes refused for one reason say it
 * once. A conflict is no failure here: its card shows it.
 *
 * @param now the instant a cooldown's remaining seconds are measured from.
 */
export function groupFailureMessages(
  outcomes: readonly MutationState[],
  now: Temporal.Instant,
): string[] {
  return [
    ...new Set(
      outcomes.flatMap((outcome) =>
        outcome.kind === "failed"
          ? [writeFailureMessage(outcome.failure, now)]
          : [],
      ),
    ),
  ];
}

/**
 * One notice for a write that did not land, in the same words the Editing
 * Capability affordance uses wherever a failure has a capability behind it.
 * The outcomes no capability describes — a source that cannot be written to,
 * an Annotation nothing holds, one Zotero has deleted, one that moved under
 * the write, and an answer that never arrived — name themselves.
 *
 * @param now the instant a cooldown's remaining seconds are measured from.
 */
export function writeFailureMessage(
  failure: WriteFailure,
  now: Temporal.Instant,
): string {
  return m.annot_view_write_failed({
    reason: writeFailureReason(failure, now),
  });
}

/**
 * Why a write did not land, in one clause — the half a caller with its own
 * sentence around it needs. A create says "not created" rather than "not
 * saved", and takes this as its reason.
 *
 * @param now the instant a cooldown's remaining seconds are measured from.
 */
export function writeFailureReason(
  failure: WriteFailure,
  now: Temporal.Instant,
): string {
  switch (failure.kind) {
    case "db-source":
      return m.annot_view_write_reason_db_source();
    case "unknown-annotation":
      return m.annot_view_write_reason_unknown_annotation();
    case "position-too-large":
      return m.annot_view_write_reason_position_too_large();
    case "not-found":
      return m.annot_view_write_reason_deleted();
    // A patch and a delete both send a version and no write token, so a replayed
    // token is as much "Zotero's copy moved" as a stale version is.
    case "conflict":
    case "write-token-used":
      return m.annot_view_write_reason_conflict();
    case "unknown-outcome":
      return m.annot_view_write_reason_unknown_outcome();
    default:
      return blockedReason(
        capabilityOfFailure(failure, () => now),
        now,
      );
  }
}

/**
 * Why a blocked Editing Capability lets no write land, in one clause, as
 * {@link writeFailureReason} says it for a failure with that capability behind
 * it.
 *
 * @param now the instant a cooldown's remaining seconds are measured from.
 */
export function blockedReason(
  capability: EditingCapability,
  now: Temporal.Instant,
): string {
  const copy = editingCapabilityCopy(capability, now);
  return copy.detail === null ? copy.label : `${copy.label}. ${copy.detail}`;
}

/**
 * A single-object patch. The version goes in the body, which is the
 * precondition Zotero prefers and checks for equality; the header form it
 * falls back to asks only that the object has not moved past the version.
 *
 * @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L2160-L2191
 */
function patch(
  target: WriteTarget,
  fields: Readonly<Record<string, string | readonly WireTag[]>>,
): WriteRequest {
  return {
    path: itemPath(target),
    method: "PATCH",
    headers: JSON_CONTENT,
    body: JSON.stringify({ version: target.version, ...fields }),
  };
}

function itemPath({ library, key }: WriteTarget): string {
  return `/api/${library}/items/${key}`;
}
