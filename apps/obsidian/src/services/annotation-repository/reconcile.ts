// How a create whose answer never arrived is matched against what Zotero
// holds, and how a refused write's two values are compared.
//
// Both are pure: the repository re-reads Zotero and hands the answers here, so
// what "the same Annotation" and "an equal fresh value" mean is decided as data
// and read by a test rather than watched for on a card.
//
// @see apps/obsidian/docs/adr/0039-an-uncertain-create-is-reconciled-by-stable-fields-and-retried-only-by-the-user.md
// @see https://github.com/aidenlx/zotlit/issues/1151

import type { LocalApiAnnotation } from "@/services/zotero-local-api/service";

import { wireColor, writePosition } from "./write";
import type { AnnotationDraft, ConflictedWrite } from "./write";

/** What one reconciliation found, and the candidates it weighed. */
export type CreateMatch =
  /** Exactly one Annotation carries every stable field. */
  | { kind: "confirmed"; annotationKey: string }
  /**
   * None did, or several did. Either way ZotLit cannot say whether the create
   * landed, so the user resolves it.
   *
   * @param candidates how many Annotations matched — 0, or 2 and up.
   */
  | { kind: "unmatched"; candidates: number };

/** The instants a matching `dateAdded` must fall between, both ends included. */
export interface CreateWindow {
  /** When the create request left ZotLit. */
  from: Temporal.Instant;
  /** When the reconciliation ran. */
  to: Temporal.Instant;
}

/**
 * The Annotation one lost create asked Zotero for, if Zotero holds it.
 *
 * The fields matched on are the ones that do not move after a create: the
 * parent Attachment, the type, the position rects rounded the way the write
 * rounded them, the quoted text, the colour, and a `dateAdded` inside the
 * window the request ran in. The comment is left out deliberately — the user
 * may edit it in Zotero between the lost answer and the re-read, and a create
 * that landed would then never be found.
 *
 * @param draft what the create asked for.
 * @param attachmentKey the Attachment's Indexed Key, which a match must name.
 * @param candidates every Annotation the Attachment holds now.
 */
export function matchCreatedAnnotation(
  draft: AnnotationDraft,
  attachmentKey: string,
  {
    candidates,
    window,
  }: { candidates: readonly LocalApiAnnotation[]; window: CreateWindow },
): CreateMatch {
  const matched = candidates.filter((candidate) =>
    isSameAnnotation({ draft, attachmentKey, candidate, window }),
  );
  const [only] = matched;
  return matched.length === 1 && only
    ? { kind: "confirmed", annotationKey: only.key }
    : { kind: "unmatched", candidates: matched.length };
}

/**
 * Whether the value Zotero holds now is the one the write asked for, in which
 * case the conflict is no conflict: the user's edit is already what stands, so
 * it resolves silently rather than asking them to choose between two equal
 * values.
 *
 * A delete never resolves this way. It names no value, so there is nothing for
 * a fresh read to equal, and the user is asked "Delete anyway" against the copy
 * Zotero holds now.
 */
export function resolvesSilently(
  write: ConflictedWrite,
  attempted: string | null,
  fresh: string | null,
): boolean {
  if (write === "delete") return false;
  if (write === "color") {
    return (
      attempted !== null &&
      fresh !== null &&
      wireColor(attempted) === wireColor(fresh)
    );
  }
  // Zotero stores a cleared comment as no comment, so the empty string the
  // editor sends and the absent value Zotero answers are the same value.
  return (attempted ?? "") === (fresh ?? "");
}

function isSameAnnotation({
  draft,
  attachmentKey,
  candidate,
  window,
}: {
  draft: AnnotationDraft;
  attachmentKey: string;
  candidate: LocalApiAnnotation;
  window: CreateWindow;
}): boolean {
  if (candidate.parentKey !== attachmentKey) return false;
  if (candidate.type !== draft.type) return false;
  if ((candidate.text ?? "") !== draft.text) return false;
  if (
    candidate.color === null ||
    wireColor(candidate.color) !== wireColor(draft.color)
  ) {
    return false;
  }
  if (!isInWindow(candidate.dateAdded, window)) return false;
  // The write rounded the rects to three decimals, so the stored position is
  // the rounded one: rounding the draft the same way is what makes the two
  // comparable at all.
  if (candidate.position.kind !== "pdf-rects") return false;
  return writePosition(candidate.position) === writePosition(draft.position);
}

/**
 * Whether Zotero stored this Annotation while the create was in flight. An
 * answer that named no `dateAdded`, or one this build cannot read as an
 * instant, is outside every window: an unreadable stamp is not evidence.
 */
function isInWindow(
  dateAdded: string | null,
  { from, to }: CreateWindow,
): boolean {
  if (dateAdded === null) return false;
  let added: Temporal.Instant;
  try {
    added = Temporal.Instant.from(dateAdded);
  } catch {
    return false;
  }
  return (
    Temporal.Instant.compare(added, from) >= 0 &&
    Temporal.Instant.compare(added, to) <= 0
  );
}
