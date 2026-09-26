// The Mark Popup's tag section: the Annotation Tags read-only under the
// comment, or the inline tag editor in their place.
//
// @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
import { useMemo } from "react";
import type { RefObject } from "react";

import { cn } from "@/lib/utils";
import type {
  AnnotationRecord,
  TagDraft,
} from "@/services/annotation-repository/service";
import { shownTagNames } from "@/views/annot-view/card-controls";
import type { HeldTags } from "@/views/annot-view/card-controls";
import type { HeldDraftActions } from "@/views/annot-view/comment-sheet";
import { tagChipVariants } from "@/views/annot-view/tag-chip";
import {
  autoTags,
  HeldTagsPanel,
  TagEditor,
} from "@/views/annot-view/tag-editor";
import type {
  EndTagSession,
  TagEditorProps,
} from "@/views/annot-view/tag-editor";

export interface TagSectionProps {
  annotation: AnnotationRecord;
  /** The shared tag draft of the Annotation, or `null` while none stands. */
  draft: TagDraft | null;
  /** Whether the tag editor stands open. */
  tagging: boolean;
  /**
   * Whether editing is unavailable. The editor then closes, which holds the
   * draft for Save tags.
   */
  readOnly: boolean;
  /** The line under the editor, as the card's editor says it. */
  hint: string | null;
  /** The held tag draft the section shows in the chips' place, if any. */
  held: HeldTags | null;
  heldActions: HeldDraftActions;
  /** Opens the tag editor from the held chips; absent while editing is unavailable. */
  onOpen?: () => void;
  libraryNames: () => readonly string[];
  onChange: (names: readonly string[]) => void;
  /**
   * The session ends, once: focus left the popup, Escape was pressed, or the
   * section went away.
   */
  onClose: () => void;
  /** The popup's content, which focus may move within during a session. */
  within: HTMLElement;
}

/**
 * Whether the tag section stands: while the Annotation has tags, or a session
 * elsewhere left it some, while the editor is open, and while a tag draft is
 * held.
 */
export function tagSectionShows({
  annotation,
  draft,
  tagging,
  held,
}: Pick<
  TagSectionProps,
  "annotation" | "draft" | "tagging" | "held"
>): boolean {
  return (
    tagging || held !== null || shownTagNames(annotation, draft).length > 0
  );
}

export interface MarkPopupTagSectionProps extends TagSectionProps {
  /** The section's own element, which a press inside belongs to. */
  sectionRef: RefObject<HTMLDivElement | null>;
  /** The open editor's own end of its session. */
  endSession: RefObject<EndTagSession | null>;
  /** The editor's suggestion popup while it shows, outside the popup. */
  suggestRef: RefObject<HTMLElement | null>;
}

/**
 * The tag section in its own element under the popup column. It takes the
 * inset and width of every block under the row, so the chips share the
 * comment's edge and wrap at the row's width; a held panel takes its own, as
 * the held comment does. A block above already leaves its own inset, so the
 * section draws up to it and reads as part of the Annotation's content;
 * straight under the row, it keeps the column gap.
 */
export function MarkPopupTagSection({
  sectionRef,
  ...props
}: MarkPopupTagSectionProps) {
  const panel = props.held !== null && !(props.tagging && !props.readOnly);
  return (
    <div
      ref={sectionRef}
      className={cn(
        !panel && "zt:w-0 zt:min-w-[max(100%,12em)] zt:px-1.5 zt:pb-1.5",
        "zt:not-nth-2:-mt-1",
      )}
      data-zt-section="tags"
    >
      <TagSection {...props} />
    </div>
  );
}

function TagSection({
  annotation,
  draft,
  tagging,
  readOnly,
  hint,
  held,
  heldActions,
  onOpen,
  libraryNames,
  onChange,
  onClose,
  within,
  endSession,
  suggestRef,
}: TagSectionProps & Pick<TagEditorProps, "endSession" | "suggestRef">) {
  // Read once per record, as the card reads it: an unknown tag type logs.
  const auto = useMemo(() => autoTags(annotation), [annotation]);
  // Editing that becomes unavailable closes the editor, which holds the draft.
  if (tagging && !readOnly) {
    return (
      <TagEditor
        names={shownTagNames(annotation, draft)}
        auto={auto}
        hint={hint}
        libraryNames={libraryNames}
        onChange={onChange}
        onClose={onClose}
        endSession={endSession}
        within={within}
        suggestRef={suggestRef}
      />
    );
  }
  if (held) {
    return (
      <HeldTagsPanel
        held={held}
        surface="popup"
        actions={heldActions}
        onOpen={onOpen}
      />
    );
  }
  return (
    <div className="zt:flex zt:flex-wrap zt:gap-1">
      {shownTagNames(annotation, draft).map((tag) => (
        <span
          key={tag}
          className={tagChipVariants({
            state: "resting",
            density: "dense",
            truncate: true,
            // Read-only here: the chip filters nothing.
            class: "zt:cursor-default",
          })}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
