// The Mark Popup's tag section: the Annotation Tags read-only under the
// comment, or the inline tag editor in their place. It is the one Preact root
// inside the PDF reader; the row, the comment view, and the comment sheet
// around it stay vanilla DOM.
//
// @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
// @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
import type { App } from "obsidian";
import { useMemo } from "react";
import type { RefObject } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { AppContext } from "@/lib/app-context";
import type {
  AnnotationRecord,
  TagDraft,
} from "@/services/annotation-repository/service";
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
 * elsewhere left it some, while the editor is open, while a session's save is
 * in flight, which the editor shows as saving until the read-back, and while
 * a tag draft is held.
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
    tagging ||
    draft?.state.kind === "pending" ||
    held !== null ||
    sessionNames(annotation, draft).length > 0
  );
}

/**
 * The names the section draws: a session's own, while one stands on either
 * surface, so the card and the popup show the same unsaved change.
 */
function sessionNames(
  annotation: AnnotationRecord,
  draft: TagDraft | null,
): readonly string[] {
  return draft?.names ?? annotation.tags;
}

/**
 * One Preact root in its own element under the popup column. It is mounted
 * when the section appears and unmounted when the popup rebuilds its content
 * or hides; between the two, a refresh renders it again in place.
 */
export class MarkPopupTags implements Disposable {
  /** The element the root renders into, moved into each new column. */
  readonly el: HTMLElement;
  /** The Annotation the section was mounted for. */
  readonly key: string;
  readonly #app: App;
  readonly #root: Root;
  /** The open editor's own end of its session. */
  readonly #endSession: RefObject<EndTagSession | null> = { current: null };
  /** The editor's suggestion popup while it shows, outside the popup. */
  readonly #suggest: RefObject<HTMLElement | null> = { current: null };

  constructor(column: HTMLElement, app: App, key: string) {
    // The inset and width every block under the row takes, so the chips share
    // the comment's edge and wrap at the row's width. A block above already
    // leaves its own inset, so the section draws up to it and reads as part of
    // the Annotation's content; straight under the row, it keeps the column gap.
    this.el = column.createDiv({
      cls: "zt:w-0 zt:min-w-[max(100%,12em)] zt:px-1.5 zt:pb-1.5 zt:not-nth-2:-mt-1",
      attr: { "data-zt-section": "tags" },
    });
    this.key = key;
    this.#app = app;
    this.#root = createRoot(this.el);
  }

  render(props: TagSectionProps): void {
    this.#root.render(
      <AppContext value={this.#app}>
        <TagSection
          {...props}
          endSession={this.#endSession}
          suggestRef={this.#suggest}
        />
      </AppContext>,
    );
  }

  /** Moves the section into a new column, where a refresh built the row. */
  moveTo(column: HTMLElement): void {
    if (this.el.parentElement !== column) column.append(this.el);
  }

  /**
   * Whether a node belongs to the section: one inside it, or inside the
   * editor's suggestion popup, which hangs outside it.
   */
  contains(node: Node | null): boolean {
    return (
      this.el.contains(node) || (this.#suggest.current?.contains(node) ?? false)
    );
  }

  /**
   * Ends the open editor's session as the editor itself would; nothing while
   * no editor is open.
   *
   * @param withText whether the text still typed is added first, as focus
   *   leaving adds it; Escape leaves it out.
   * @returns whether an editor was open to end.
   */
  end(withText = true): boolean {
    const end = this.#endSession.current;
    end?.(withText);
    return end !== null;
  }

  [Symbol.dispose](): void {
    this.#root.unmount();
    this.el.remove();
  }
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
  const saving = draft?.state.kind === "pending";
  // Read once per record, as the card reads it: an unknown tag type logs.
  const auto = useMemo(() => autoTags(annotation), [annotation]);
  // Editing that becomes unavailable closes the editor, which holds the draft.
  if (saving || (tagging && !readOnly)) {
    return (
      <TagEditor
        names={sessionNames(annotation, draft)}
        auto={auto}
        saving={saving}
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
      {sessionNames(annotation, draft).map((tag) => (
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
