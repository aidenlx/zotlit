// The Your note tab: the note source, with the two boxes the reader meets in
// it. The Managed Block reads as the part a note update keeps up to date, and
// the first annotation render call holds the highlight box — one rendered
// highlight first, and behind it a second pane over the Annotation Section of
// the same document, so the format is edited where it is used. Every later
// call is a chip that leads back to that one box.

import { StateField } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { noteRegions } from "@zotlit/workbench/document";
import type {
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";

import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages.js";

import { ResultSheet } from "./reading-view";
import { SliceEditor } from "./slice-editor";
import type { SuggestionSource } from "./slice-editor";

/** Which of the note tab's two editors the reader is in. */
export type NoteEditor = "note" | "annotation";

export interface NotePaneProps {
  controller: WorkbenchDocumentController;
  /** Master offsets to reveal in the note source. */
  reveal?: WorkbenchSliceRange | null;
  /** Master offsets to reveal in the highlight box, which also focuses it. */
  highlight?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  /** The contract both editors complete and explain against. */
  suggest?: SuggestionSource;
  /** The one highlight the render produced in this format, or null for a sample without. */
  preview: string | null;
  /** The render's complaint about the format, shown in place of the preview. */
  formatProblem: string | null;
  /** How many highlights the sample carries, which the one format is used for. */
  count: number;
  /** A later render call, or the reader, asked for the highlight editor. */
  onOpenHighlight: () => void;
  /** The reader asked for the Annotation Section as source, in Source mode. */
  onOpenSource: () => void;
  /** The reader is at the box, so the host can point at what it produced. */
  onEmphasis: (on: boolean) => void;
  onEditing: (editor: NoteEditor) => void;
}

/** The face of the box: the highlight it produces, or the format that produces it. */
type Face = "preview" | "source";

/** The one motion the box has: a cross-fade in place. Nothing else moves. */
const FADE = "transition-[opacity] duration-150 ease-[cubic-bezier(0.2,0,0,1)]";
const FACE_STYLE = `absolute inset-0 flex flex-col ${FADE}`;
const HIDDEN_FACE = "pointer-events-none opacity-0";

export function NotePane({
  controller,
  reveal,
  highlight,
  onSelection,
  suggest,
  preview,
  formatProblem,
  count,
  onOpenHighlight,
  onOpenSource,
  onEmphasis,
  onEditing,
}: NotePaneProps) {
  // One box for the life of the pane: the widget hands CodeMirror this element
  // and React paints into it, so the editor inside survives every redraw.
  const [box] = useState(() => document.createElement("div"));
  const open = useRef(onOpenHighlight);
  open.current = onOpenHighlight;
  const extensions = useMemo(
    () => noteBoxes(controller, box, () => open.current()),
    [controller, box],
  );
  // The box opens on the highlight it produces, which is what makes the slot
  // readable; the source behind it is one press away and stays mounted so the
  // two faces cross-fade rather than rebuild.
  const [expanded, setExpanded] = useState(true);
  const [face, setFace] = useState<Face>("preview");
  useEffect(() => {
    if (highlight) {
      setExpanded(true);
      setFace("source");
      // A chip further down the note asked for the box, so bring it back up.
      box.scrollIntoView?.({ block: "nearest" });
    }
  }, [highlight, box]);
  const call = controller.noteRegions.annotationCalls[0];
  const hasBox = controller.annotationSection !== null && call !== undefined;
  // Two editors report a caret, and the box's arrives last as it mounts. Only
  // the one the reader is in speaks for the pane, so the field list and Put in
  // note follow the editor on screen rather than the last one built.
  const active = useRef<NoteEditor>("note");
  const editing = (editor: NoteEditor) => {
    active.current = editor;
    onEditing(editor);
  };
  const selection = (editor: NoteEditor) => (range: WorkbenchSliceRange) => {
    if (active.current === editor) onSelection?.(range);
  };
  const showSource = () => {
    setExpanded(true);
    setFace("source");
  };
  const showPreview = () => {
    setFace("preview");
    editing("note");
  };

  return (
    <div className="flex min-h-80 flex-1 flex-col rounded-md border border-fd-border bg-fd-card min-[780px]:min-h-0 [&_.zt-managed]:bg-fd-muted/60 [&_.zt-managed]:shadow-[inset_2px_0_0_0_var(--color-fd-border)]">
      <SliceEditor
        controller={controller}
        slice="note"
        label={m.workbench_tab_note()}
        extensions={extensions}
        reveal={reveal}
        suggest={suggest}
        onSelection={selection("note")}
        onFocus={() => editing("note")}
      />
      {hasBox &&
        createPortal(
          <div
            data-highlight-box
            className="group/box my-3 flex flex-col rounded-md border border-fd-border bg-fd-card font-sans"
            onMouseEnter={() => onEmphasis(true)}
            onMouseLeave={() => onEmphasis(false)}
            onFocus={() => onEmphasis(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                onEmphasis(false);
              }
            }}
          >
            <div className="flex items-center gap-x-3 px-3 py-2">
              {/* The name and lede, and the real call, describe one fact, so
                  they share one slot: the call takes it while the reader is at
                  the box. */}
              <div className="relative min-w-0 flex-1 text-sm">
                <div
                  className={`flex min-w-0 items-baseline gap-x-3 ${FADE} group-focus-within/box:opacity-0 group-hover/box:opacity-0`}
                >
                  <h3 className="shrink-0 font-medium">
                    {m.workbench_highlight_label()}
                  </h3>
                  <p className="truncate text-fd-muted-foreground">
                    {count > 0
                      ? m.workbench_highlight_count({ count })
                      : m.workbench_highlight_lede()}
                  </p>
                </div>
                <p
                  className={`absolute inset-0 flex min-w-0 items-center gap-x-3 text-fd-muted-foreground opacity-0 ${FADE} group-focus-within/box:opacity-100 group-hover/box:opacity-100`}
                >
                  <code aria-hidden className="truncate font-mono text-xs">
                    {controller.source.slice(call.call.from, call.call.to)}
                  </code>
                  <button
                    type="button"
                    onClick={onOpenSource}
                    className="shrink-0 cursor-pointer underline underline-offset-2"
                  >
                    {m.workbench_highlight_open_source()}
                  </button>
                </p>
              </div>
              {/* Icon-only, so the slot beside it has room for the call. */}
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? m.workbench_highlight_close()
                    : m.workbench_highlight_edit()
                }
                title={
                  expanded
                    ? m.workbench_highlight_close()
                    : m.workbench_highlight_edit()
                }
                onClick={() => {
                  setExpanded((value) => !value);
                  if (expanded) editing("note");
                }}
              >
                <ChevronDown
                  aria-hidden
                  className={expanded ? "rotate-180" : ""}
                />
              </Button>
            </div>
            <div
              className={
                expanded
                  ? "relative flex h-56 flex-col border-t border-fd-border"
                  : "hidden"
              }
            >
              <div
                data-face="preview"
                inert={face !== "preview"}
                className={`${FACE_STYLE} ${face === "preview" ? "" : HIDDEN_FACE}`}
              >
                <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
                  {formatProblem !== null ? (
                    <p className="border-l-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-sm">
                      {formatProblem}
                    </p>
                  ) : preview === null ? (
                    <p className="text-sm text-fd-muted-foreground">
                      {m.workbench_highlight_preview_empty()}
                    </p>
                  ) : (
                    <ResultSheet
                      markdown={preview}
                      properties={[]}
                      showMarkdown={false}
                    />
                  )}
                </div>
                <div className="flex justify-end px-3 pb-2">
                  <Button variant="outline" size="sm" onClick={showSource}>
                    {formatProblem !== null
                      ? m.workbench_highlight_fix()
                      : m.workbench_highlight_edit_format()}
                  </Button>
                </div>
              </div>
              <div
                data-face="source"
                inert={face !== "source"}
                className={`${FACE_STYLE} ${face === "source" ? "" : HIDDEN_FACE}`}
              >
                <SliceEditor
                  controller={controller}
                  slice="annotation"
                  label={m.workbench_highlight_label()}
                  reveal={highlight}
                  suggest={suggest}
                  onSelection={selection("annotation")}
                  onFocus={() => editing("annotation")}
                />
                <div className="flex justify-end border-t border-fd-border px-3 py-2">
                  <Button variant="outline" size="sm" onClick={showPreview}>
                    {m.workbench_highlight_done()}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          box,
        )}
    </div>
  );
}

/**
 * The note source's own decorations: the Managed Block as a marked box with a
 * beginner label in place of each raw tag, and every annotation render call
 * replaced — the first by the highlight box, the rest by a chip leading to it. They are
 * read from the pane's own text, which is the note body, so they never lag the
 * keystroke that moved them. Block decorations belong to a state field.
 */
function noteBoxes(
  controller: WorkbenchDocumentController,
  box: HTMLElement,
  openHighlight: () => void,
): Extension {
  function build({ doc }: EditorState): DecorationSet {
    const body = doc.toString();
    const { annotationCalls, managedBlock } = noteRegions(body, {
      from: 0,
      to: body.length,
    });
    const ranges: Range<Decoration>[] = [];
    if (managedBlock) {
      const last = doc.lineAt(managedBlock.range.to).number;
      for (
        let line = doc.lineAt(managedBlock.range.from).number;
        line <= last;
        line += 1
      ) {
        ranges.push(
          Decoration.line({ class: "zt-managed" }).range(doc.line(line).from),
        );
      }
      for (const [tag, label] of [
        [managedBlock.open, m.workbench_managed_start()],
        [managedBlock.close, m.workbench_managed_end()],
      ] as const) {
        ranges.push(
          Decoration.replace({ widget: new LabelWidget(label) }).range(
            tag.from,
            tag.to,
          ),
        );
      }
    }
    // The section the first box edits has to exist; without one every call
    // links out instead, and the link opens the section in Advanced.
    const editable = controller.annotationSection !== null;
    for (const [index, { call, line }] of annotationCalls.entries()) {
      const target = line ?? call;
      ranges.push(
        Decoration.replace({
          block: line !== null,
          widget:
            index === 0 && editable
              ? new BoxWidget(box)
              : new LinkWidget(
                  m.workbench_highlight_label(),
                  m.workbench_highlight_chip_hint(),
                  openHighlight,
                ),
        }).range(target.from, target.to),
      );
    }
    return Decoration.set(ranges, true);
  }

  return StateField.define<DecorationSet>({
    create: build,
    update: (value, transaction) =>
      transaction.docChanged ? build(transaction.state) : value,
    provide: (field) => EditorView.decorations.from(field),
  });
}

/** A beginner name in place of a raw tag the reader does not have to read. */
class LabelWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  eq(other: LabelWidget): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className =
      "rounded-sm border border-fd-border bg-fd-card px-2 py-1 text-xs font-medium text-fd-muted-foreground";
    element.textContent = this.label;
    return element;
  }
}

/**
 * A later render call as a chip: the same name as the box, and the way back to
 * it. The first call is always the one above, so the hint has one direction.
 */
class LinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly hint: string,
    readonly open: () => void,
  ) {
    super();
  }

  eq(other: LinkWidget): boolean {
    return (
      other.label === this.label &&
      other.hint === this.hint &&
      other.open === this.open
    );
  }

  toDOM(): HTMLElement {
    const element = document.createElement("button");
    element.type = "button";
    element.title = this.hint;
    element.className =
      "cursor-pointer rounded-sm border border-dashed border-fd-primary px-2 py-0.5 text-left text-xs font-medium text-fd-primary";
    element.textContent = this.label;
    element.addEventListener("click", this.open);
    return element;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** The place the highlight box is painted into, held across every redraw. */
class BoxWidget extends WidgetType {
  constructor(readonly box: HTMLElement) {
    super();
  }

  eq(other: BoxWidget): boolean {
    return other.box === this.box;
  }

  toDOM(): HTMLElement {
    return this.box;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
