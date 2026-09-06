// Note placement: editable loops and Managed Blocks, with an example disclosure
// and a route to the shared format at every recognized annotation call.

import { Toggle } from "@base-ui/react/toggle";
import { MapMode, StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { Eye, Pencil } from "lucide-react";
import { Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { noteRegions } from "@zotlit/workbench/document";
import type {
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";

import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages.js";

import { ResultSheet } from "./result-sheet";
import { SliceEditor } from "./slice-editor";
import type { SuggestionSource } from "./slice-editor";

export interface NotePaneProps {
  controller: WorkbenchDocumentController;
  reveal?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  suggest?: SuggestionSource;
  preview: string | null;
  formatProblem: string | null;
  annotationSelector?: ReactNode;
  onOpenAnnotation: () => void;
}

export function NotePane({
  controller,
  reveal,
  onSelection,
  suggest,
  ...example
}: NotePaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const previewId = useId();
  const [opened, setOpened] = useState<{
    controller: WorkbenchDocumentController;
    line: number;
  } | null>(null);
  const expanded = opened?.controller === controller ? opened.line : null;
  const localLine =
    expanded === null ? null : expanded - controller.sliceRange("note").from;
  // Stable portal hosts let CodeMirror move the shared preview below its call
  // while React keeps the selector and rendered example alive.
  const boxes = useMemo(
    () =>
      new Map<number, HTMLElement>(
        controller.noteRegions.annotationCalls.map((_, index) => [
          index,
          document.createElement("span"),
        ]),
      ),
    [controller],
  );
  const previewHost = useMemo(() => document.createElement("div"), []);
  const extensions = useMemo(
    () => noteBoxes(boxes, previewHost),
    [boxes, previewHost],
  );
  // The active line lives in master offsets so both Note and Source edits move
  // it with the text. Every call on that line reads this one selection.
  useEffect(
    () =>
      controller.subscribe(({ transaction, docChanged }) => {
        if (!docChanged) return;
        const { doc } = transaction.state;
        const lines = new Set(
          controller.noteRegions.annotationCalls.map(
            ({ call }) => doc.lineAt(call.to).to,
          ),
        );
        setOpened((current) => {
          if (current?.controller !== controller) return current;
          const position = transaction.changes.mapPos(
            current.line,
            -1,
            MapMode.TrackDel,
          );
          const line = position === null ? null : doc.lineAt(position).to;
          return line !== null && lines.has(line) ? { controller, line } : null;
        });
      }),
    [controller],
  );
  useEffect(() => {
    const element = host.current?.querySelector<HTMLElement>(".cm-editor");
    const view = element && EditorView.findFromDOM(element);
    view?.dispatch({ effects: expandPreview.of(localLine) });
  }, [localLine, extensions]);
  useEffect(() => {
    const element = host.current?.querySelector<HTMLElement>(".cm-editor");
    if (element) EditorView.findFromDOM(element)?.requestMeasure();
  }, [example.preview, example.formatProblem]);
  return (
    <div
      ref={host}
      className="flex min-h-0 flex-1 flex-col rounded-md border border-fd-border bg-fd-card [&_.zt-managed]:bg-fd-muted/60 [&_.zt-managed]:shadow-[inset_2px_0_0_0_var(--color-fd-border)]"
    >
      <SliceEditor
        controller={controller}
        slice="note"
        label={m.workbench_tab_note()}
        extensions={extensions}
        reveal={reveal}
        suggest={suggest}
        onSelection={onSelection}
      />
      {controller.noteRegions.annotationCalls.map(({ call }, index) => {
        const line = controller.state.doc.lineAt(call.to).to;
        return createPortal(
          <AnnotationPlaceholder
            expanded={expanded === line}
            previewId={previewId}
            onToggle={(pressed) =>
              setOpened(pressed ? { controller, line } : null)
            }
            onOpenAnnotation={example.onOpenAnnotation}
          />,
          annotationBox(boxes, index),
          String(index),
        );
      })}
      {expanded !== null &&
        createPortal(
          <AnnotationPreview {...example} id={previewId} />,
          previewHost,
        )}
    </div>
  );
}

function AnnotationPlaceholder({
  expanded,
  previewId,
  onToggle,
  onOpenAnnotation,
}: {
  expanded: boolean;
  previewId: string;
  onToggle: (pressed: boolean) => void;
  onOpenAnnotation: () => void;
}) {
  return (
    <span
      data-annotation-box
      className="inline-flex max-w-full items-center gap-1 rounded-md border border-fd-border bg-fd-card p-0.5 ps-2 align-middle text-xs font-medium text-fd-muted-foreground"
    >
      <span className="min-w-0 whitespace-normal">
        {m.workbench_annotation_slot()}
      </span>
      <span className="inline-flex shrink-0 items-center">
        <Toggle
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-6 rounded-sm data-pressed:bg-fd-muted [&_svg]:size-3.5"
            />
          }
          aria-label={m.workbench_annotation_preview()}
          title={m.workbench_annotation_preview()}
          pressed={expanded}
          aria-controls={expanded ? previewId : undefined}
          onPressedChange={onToggle}
        >
          <Eye aria-hidden />
        </Toggle>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-sm [&_svg]:size-3.5"
          aria-label={m.workbench_annotation_edit_format()}
          title={m.workbench_annotation_edit_format()}
          onClick={onOpenAnnotation}
        >
          <Pencil aria-hidden />
        </Button>
      </span>
    </span>
  );
}

function AnnotationPreview({
  id,
  preview,
  formatProblem,
  annotationSelector,
}: Pick<NotePaneProps, "preview" | "formatProblem" | "annotationSelector"> & {
  id: string;
}) {
  return (
    <div
      id={id}
      data-annotation-preview
      className="border-y border-fd-border px-2 pb-2 font-sans whitespace-normal [&_[role=document]>:first-child]:mt-0 [&_[role=document]>:last-child]:mb-0"
    >
      <div className="-mx-2 mb-2 min-w-0 border-b border-fd-border bg-fd-muted/40 px-2 py-1 [&>div]:mb-0">
        {annotationSelector}
      </div>
      {formatProblem !== null && (
        <p className="mb-2 border-s-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-sm">
          {formatProblem}
        </p>
      )}
      {preview !== null ? (
        <Suspense
          fallback={
            <p className="text-sm text-fd-muted-foreground">
              {m.workbench_result_pending()}
            </p>
          }
        >
          <ResultSheet
            markdown={preview}
            properties={[]}
            showMarkdown={false}
          />
        </Suspense>
      ) : (
        formatProblem === null && (
          <p className="text-sm text-fd-muted-foreground">
            {m.workbench_result_pending()}
          </p>
        )
      )}
    </div>
  );
}

function annotationBox(
  boxes: Map<number, HTMLElement>,
  index: number,
): HTMLElement {
  let box = boxes.get(index);
  if (!box) {
    box = document.createElement("span");
    boxes.set(index, box);
  }
  return box;
}

const expandPreview = StateEffect.define<number | null>();

function noteBoxes(
  boxes: Map<number, HTMLElement>,
  previewHost: HTMLElement,
): Extension {
  function build(
    { doc, selection }: EditorState,
    expanded: number | null,
  ): DecorationSet {
    const body = doc.toString();
    const { annotationCalls, managedBlock } = noteRegions(body, {
      from: 0,
      to: body.length,
    });
    const ranges: Range<Decoration>[] = [];
    const selected = ({ from, to }: WorkbenchSliceRange) =>
      selection.ranges.some((range) => range.from <= to && range.to >= from);
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
        if (selected(tag)) continue;
        ranges.push(
          Decoration.replace({ widget: new LabelWidget(label, tag) }).range(
            tag.from,
            tag.to,
          ),
        );
      }
    }
    if (
      expanded !== null &&
      annotationCalls.some(({ call }) => doc.lineAt(call.to).to === expanded)
    ) {
      ranges.push(
        Decoration.widget({
          widget: new PreviewWidget(previewHost),
          block: true,
          side: 1,
        }).range(expanded),
      );
    }
    for (const [index, { call }] of annotationCalls.entries()) {
      if (selected(call)) continue;
      ranges.push(
        Decoration.replace({
          widget: new BoxWidget(annotationBox(boxes, index), call),
        }).range(call.from, call.to),
      );
    }
    return Decoration.set(ranges, true);
  }

  return StateField.define<{
    expanded: number | null;
    decorations: DecorationSet;
  }>({
    create: (state) => ({ expanded: null, decorations: build(state, null) }),
    update: (value, transaction) => {
      let expanded = value.expanded;
      for (const effect of transaction.effects) {
        if (effect.is(expandPreview)) expanded = effect.value;
      }
      return transaction.docChanged ||
        transaction.selection ||
        expanded !== value.expanded
        ? { expanded, decorations: build(transaction.state, expanded) }
        : value;
    },
    provide: (field) =>
      EditorView.decorations.from(field, (value) => value.decorations),
  });
}

/** A beginner name in place of a raw tag the reader does not have to read. */
class LabelWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly range: WorkbenchSliceRange,
  ) {
    super();
  }

  eq(other: LabelWidget): boolean {
    return (
      other.label === this.label &&
      other.range.from === this.range.from &&
      other.range.to === this.range.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className =
      "rounded-sm border border-fd-border bg-fd-card px-2 py-1 text-xs font-medium text-fd-muted-foreground";
    element.textContent = this.label;
    revealSourceOnClick(element, view, this.range);
    return element;
  }
}

/** The place the annotation box is painted into, held across every redraw. */
class BoxWidget extends WidgetType {
  constructor(
    readonly box: HTMLElement,
    readonly range: WorkbenchSliceRange,
  ) {
    super();
  }

  eq(other: BoxWidget): boolean {
    return (
      other.box === this.box &&
      other.range.from === this.range.from &&
      other.range.to === this.range.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    revealSourceOnClick(this.box, view, this.range);
    return this.box;
  }
}

/** One full-width block, placed after the line containing the open call. */
class PreviewWidget extends WidgetType {
  constructor(readonly host: HTMLElement) {
    super();
  }

  eq(other: PreviewWidget): boolean {
    return other.host === this.host;
  }

  toDOM(): HTMLElement {
    return this.host;
  }
}

function revealSourceOnClick(
  element: HTMLElement,
  view: EditorView,
  range: WorkbenchSliceRange,
): void {
  element.onclick = (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest("button, [data-annotation-preview]")
    )
      return;
    view.focus();
    view.dispatch({
      selection: { anchor: range.to, head: range.from },
      scrollIntoView: true,
      userEvent: "select.pointer",
    });
  };
}
