// The Partial Placeholder: the box a pane draws over every `render` or
// `include` call that names a Shared Partial outright, the preview that opens
// under it, and the actions a call to a partial the vault holds no document
// for offers instead.
//
// One pane, one open preview. A call the reader's selection touches shows as
// the source it is, which is the rule every box in Basic mode follows.

import type {
  PartialRenderSite,
  WorkbenchDocumentController,
  WorkbenchSliceId,
} from "#/document/index";
import { MapMode, StateEffect } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, EditorView } from "@codemirror/view";
import { Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useDocumentRevision } from "./editor";
import { PreviewWidget, boxAt, boxField, boxRanges } from "./editor-boxes";
import { useOptionalHost, useTooltip, useWorkbenchHost } from "./host";
import type { WorkbenchHost } from "./host";
import { useWorkbenchMessages } from "./messages";
import { useIcon, useParts } from "./theme";

import { partialCalls } from "#/document/index";

/**
 * What a host answers for the Shared Partials one pane's calls name. Creating
 * a partial and opening one are the host's own file operations, and the render
 * reads whatever data the pane's slice is previewed with.
 */
export interface PartialPlaceholderHost {
  /** Every Shared Partial the vault registers, which Pick another chooses from. */
  readonly names: readonly string[];
  /**
   * The partials the last render could not resolve, which is what marks a call
   * as a problem: a missing partial is the engine's own render failure.
   * @see docs/adr/0050-the-citation-template-is-one-document-and-partials-are-files.md
   */
  readonly missing: readonly string[];
  /**
   * Changes whenever a registered partial's own text does, so an open preview
   * renders the partial again. A host that never changes one leaves it out.
   */
  readonly revision?: string | number;
  /**
   * Changes whenever the caller data this pane's slice supplies does — the
   * chosen Item, the annotation example, the Citation example — so an open
   * preview renders again for the selection the reader has now. A host whose
   * data never changes leaves it out.
   */
  readonly dataRevision?: string | number;
  /** Opens the Shared Partial's own editor. */
  readonly onEdit: (name: string) => void;
  /** Starts the host's create flow for `name`, which asks before it writes. */
  readonly onCreate: (name: string) => void;
  /** The text `name` produces for the caller this pane's slice supplies. */
  readonly onRender: (name: string) => Promise<string>;
}

/** One pane's Partial Placeholders: the editor extension, and their contents. */
export interface PartialBoxes {
  /** Pass to the pane's editor, which draws a box over every call. */
  readonly extensions: Extension;
  /** Render beside the editor; each box is painted through a portal. */
  readonly boxes: ReactNode;
}

/**
 * The boxes one pane draws over its Shared Partial calls. Without a `host`
 * every call stays as source, which is what a pane that offers no partial
 * actions shows.
 */
export function usePartialBoxes(
  controller: WorkbenchDocumentController,
  slice: WorkbenchSliceId,
  host: PartialPlaceholderHost | undefined,
): PartialBoxes {
  useDocumentRevision(controller);
  const previewId = useId();
  const [opened, setOpened] = useState<{
    controller: WorkbenchDocumentController;
    /** The call's own start, in master offsets, so every pane moves it alike. */
    position: number;
  } | null>(null);
  const range = controller.sliceRange(slice);
  const sites = host
    ? partialCalls(controller.state.doc.toString(), range, controller.language)
    : [];
  // Stable portal hosts let CodeMirror move the shared preview below its call
  // while React keeps the rendered text alive. Each is made on first use, so
  // the calls are read once per draw rather than once here and once again.
  const boxes = useMemo(
    () => new Map<number, HTMLElement>(),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the deps are the reset key: fresh hosts when the pane changes document or slice, so a box never carries over to another editor's calls
    [controller, slice],
  );
  const previewHost = useMemo(() => document.createElement("div"), []);
  const pane = useRef<EditorView | null>(null);
  const extensions = useMemo(
    () => partialBoxes(boxes, previewHost, { pane, controller }),
    [boxes, previewHost, controller],
  );
  const expanded =
    opened?.controller === controller
      ? (sites.find(({ call }) => call.from === opened.position) ?? null)
      : null;
  // The open call is held in master offsets, so an edit made in another pane
  // keeps the preview on the call it belongs to.
  useEffect(
    () =>
      controller.subscribe(({ transaction, docChanged }) => {
        if (!docChanged) return;
        setOpened((current) => {
          if (current?.controller !== controller) return current;
          const position = transaction.changes.mapPos(
            current.position,
            -1,
            MapMode.TrackDel,
          );
          return position === null ? null : { controller, position };
        });
      }),
    [controller],
  );
  const line =
    expanded === null
      ? null
      : (pane.current?.state.doc.lineAt(expanded.call.to - range.from).to ??
        null);
  useEffect(() => {
    pane.current?.dispatch({ effects: expandPartial.of(line) });
  }, [line, extensions]);
  return {
    extensions,
    boxes: host && (
      <>
        {sites.map((site, index) =>
          createPortal(
            <PartialPlaceholder
              site={site}
              host={host}
              controller={controller}
              missing={host.missing.includes(site.name)}
              expanded={expanded?.call.from === site.call.from}
              previewId={previewId}
              onToggle={(pressed) =>
                setOpened(
                  pressed ? { controller, position: site.call.from } : null,
                )
              }
            />,
            boxAt(boxes, index),
            String(index),
          ),
        )}
        {expanded !== null &&
          createPortal(
            <PartialPreview
              id={previewId}
              name={expanded.name}
              revision={host.revision}
              dataRevision={host.dataRevision}
              onRender={host.onRender}
            />,
            previewHost,
          )}
      </>
    ),
  };
}

function PartialPlaceholder({
  site,
  host,
  controller,
  missing,
  expanded,
  previewId,
  onToggle,
}: {
  site: PartialRenderSite;
  host: PartialPlaceholderHost;
  controller: WorkbenchDocumentController;
  missing: boolean;
  expanded: boolean;
  previewId: string;
  onToggle: (pressed: boolean) => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("notePane");
  const icon = useIcon();
  const adapter = useWorkbenchHost();
  const previewTooltip = useTooltip(m.workbench_partial_preview());
  const editTooltip = useTooltip(m.workbench_partial_edit());
  return (
    <span
      data-partial-box
      {...part("partial-box", missing ? "missing" : "known")}
    >
      <span {...part("partial-name")}>{site.name}</span>
      {site.arguments && (
        <span {...part("partial-arguments")}>{site.arguments}</span>
      )}
      {missing && (
        <span {...part("partial-problem")}>
          {m.workbench_diagnostic_missing_partial({ name: site.name })}
        </span>
      )}
      <span {...part("annotation-actions")}>
        {missing ? (
          <>
            <button
              type="button"
              {...part("partial-action")}
              onClick={() => host.onCreate(site.name)}
            >
              {m.workbench_partial_create()}
            </button>
            <button
              type="button"
              {...part("partial-action")}
              disabled={controller.readOnly}
              onClick={(event) =>
                void pickPartial(event.currentTarget, {
                  adapter,
                  controller,
                  names: host.names,
                  site,
                  title: m.workbench_partial_choose(),
                  empty: m.workbench_partial_choose_empty(),
                })
              }
            >
              {m.workbench_partial_pick()}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              {...part("annotation-toggle", expanded ? "active" : "inactive")}
              aria-label={m.workbench_partial_preview()}
              {...previewTooltip}
              aria-pressed={expanded}
              aria-controls={expanded ? previewId : undefined}
              onClick={() => onToggle(!expanded)}
            >
              {icon("preview")}
            </button>
            <button
              type="button"
              {...part("annotation-edit")}
              aria-label={m.workbench_partial_edit()}
              {...editTooltip}
              onClick={() => host.onEdit(site.name)}
            >
              {icon("edit")}
            </button>
          </>
        )}
      </span>
    </span>
  );
}

/**
 * Choose another Shared Partial for one call and write it in place of the name
 * that call holds, which is the whole edit: every other caller stays as
 * authored.
 */
async function pickPartial(
  anchor: HTMLElement,
  {
    adapter,
    controller,
    names,
    site,
    title,
    empty,
  }: {
    adapter: WorkbenchHost;
    controller: WorkbenchDocumentController;
    names: readonly string[];
    site: PartialRenderSite;
    title: string;
    empty: string;
  },
): Promise<void> {
  // An edit can land from anywhere while the suggester is open, so the name
  // this choice replaces is followed through every change: a call the document
  // moved is still written in place, and one the document edited or deleted
  // takes no write at all.
  let target: { from: number; to: number } | null = { ...site.nameRange };
  const unfollow = controller.subscribe(({ transaction, docChanged }) => {
    if (!docChanged || target === null) return;
    const from = transaction.changes.mapPos(target.from, 1, MapMode.TrackDel);
    const to = transaction.changes.mapPos(target.to, -1, MapMode.TrackDel);
    target = from === null || to === null ? null : { from, to };
  });
  try {
    const chosen = await adapter.suggester({
      anchor,
      title,
      selected: site.name,
      groups: [
        {
          label: title,
          empty,
          options: names.map((name) => ({ id: name, label: name })),
        },
      ],
    });
    if (chosen === null || chosen === site.name || target === null) return;
    if (controller.state.doc.sliceString(target.from, target.to) !== site.name)
      return;
    controller.dispatch({
      changes: { ...target, insert: chosen },
      userEvent: "input.form",
    });
  } finally {
    unfollow();
  }
}

/** The partial's own text, rendered for the caller this pane supplies. */
function PartialPreview({
  id,
  name,
  revision,
  dataRevision,
  onRender,
}: {
  id: string;
  name: string;
  revision: string | number | undefined;
  dataRevision: string | number | undefined;
  onRender: (name: string) => Promise<string>;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("notePane");
  const Markdown = useOptionalHost()?.markdown;
  const [state, setState] = useState<
    { kind: "text"; text: string } | { kind: "error"; message: string } | null
  >(null);
  // The render is read through a ref: a host that passes a fresh callback on
  // every draw would otherwise start a render on every draw.
  const render = useRef(onRender);
  render.current = onRender;
  useEffect(() => {
    let current = true;
    setState(null);
    void render.current(name).then(
      (text) => {
        if (current) setState({ kind: "text", text });
      },
      (error: unknown) => {
        if (current)
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      current = false;
    };
    // `revision` re-renders the open preview after the partial itself is
    // saved, `dataRevision` after the reader chooses other data to read it
    // against: the render callback is read through a ref, so the key alone
    // decides when a preview follows the selection.
  }, [name, revision, dataRevision]);
  return (
    <div id={id} data-partial-preview {...part("annotation-preview")}>
      {state?.kind === "error" && (
        <p {...part("annotation-problem")}>{state.message}</p>
      )}
      {state?.kind === "text" && Markdown ? (
        <Suspense
          fallback={<p {...part("pending")}>{m.workbench_result_pending()}</p>}
        >
          <Markdown
            markdown={state.text}
            properties={[]}
            showMarkdown={false}
          />
        </Suspense>
      ) : (
        state?.kind !== "error" && (
          <p {...part("pending")}>{m.workbench_result_pending()}</p>
        )
      )}
    </div>
  );
}

/** The line the open preview sits under, in this pane's own offsets. */
const expandPartial = StateEffect.define<number | null>();

function partialBoxes(
  boxes: Map<number, HTMLElement>,
  previewHost: HTMLElement,
  {
    pane,
    controller,
  }: {
    readonly pane: { current: EditorView | null };
    /** Read live, so a document switched to Eta redraws its boxes in the Eta form. */
    readonly controller: WorkbenchDocumentController;
  },
): Extension {
  function build(
    { doc, selection }: EditorState,
    expanded: number | null,
  ): DecorationSet {
    const body = doc.toString();
    const calls = partialCalls(
      body,
      { from: 0, to: body.length },
      controller.language,
    ).map(({ call }) => call);
    const ranges = boxRanges(calls, boxes, selection);
    if (
      expanded !== null &&
      calls.some((call) => doc.lineAt(call.to).to === expanded)
    ) {
      ranges.push(
        Decoration.widget({
          widget: new PreviewWidget(previewHost),
          block: true,
          side: 1,
        }).range(expanded),
      );
    }
    return Decoration.set(ranges, true);
  }

  return [
    boxField(expandPartial, build),
    // The pane's own view, so the hook can open a preview under its line.
    ViewPlugin.define((view) => {
      pane.current = view;
      return {
        destroy: () => {
          if (pane.current === view) pane.current = null;
        },
      };
    }),
  ];
}
