// A CodeMirror pane bound to one slice of the master Profile document.

import type {
  WorkbenchDocumentController,
  WorkbenchSliceId,
  WorkbenchSliceRange,
} from "#/document/index";
import type { SuggestionSource } from "#/language/index";
import { linter, setDiagnostics } from "@codemirror/lint";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import type { ReactNode } from "react";

import { completionFields } from "./completion-fields";
import { useDocumentRevision } from "./editor";
import { HiddenName, useOptionalHost } from "./host";
import type { WorkbenchInsertTarget } from "./host";
import { useWorkbenchMessages } from "./messages";
import { partialSuggestions } from "./partial-suggestions";
import {
  sourceDiagnostics,
  sourceProblemGutter,
  useSourceDiagnoses,
  useRevealSourceDiagnosis,
} from "./source-diagnostics";
import { tagDescription } from "./tag-help";
import { useParts, useEditorExtension } from "./theme";

import { workbenchSlice, jsonLayout, jsonPosition } from "#/document/index";
import {
  liquidTemplate,
  etaLanguage,
  etaBody,
  liquidBody,
  templatePairing,
  embeddedTemplates,
  jsonRule,
  embeddedJsonE,
} from "#/language/index";

export type { SuggestionSource } from "#/language/index";

/**
 * Whether the panes under this provider are on screen. A retained pane stays
 * mounted inside a hidden wrapper and provides `false`, so the editors under it
 * report no selection. A host with its own notion of visibility sets `visible`
 * on the editor itself instead.
 */
const Visible = createContext(true);

export function SliceEditorVisibility({
  visible,
  children,
}: {
  visible: boolean;
  children?: ReactNode;
}) {
  return <Visible.Provider value={visible}>{children}</Visible.Provider>;
}

/** The expression pane edits a bare Liquid expression; the note includes Markdown. */
export type SliceLanguage = "liquid" | "json-e" | "expression";

export interface SliceReveal extends WorkbenchSliceRange {
  anchor?: number;
  head?: number;
  slice?: WorkbenchSliceId;
  /** Native restoration can select text while preserving focus and scroll. */
  focus?: boolean;
  scrollIntoView?: boolean;
}

export interface SliceEditorProps {
  controller: WorkbenchDocumentController;
  slice: WorkbenchSliceId;
  label: string;
  invalid?: boolean;
  describedBy?: string;
  /** @default "liquid" */
  language?: SliceLanguage;
  /**
   * Refuses a line break. A pane over a manifest scalar — the note name is the
   * one — holds a value a break would end, taking the document with it.
   */
  singleLine?: boolean;
  /**
   * The host's own extensions over this pane — the boxes it draws on the text.
   * They are read once, when the view is built, so a caller keeps one value.
   */
  extensions?: Extension;
  /**
   * Whether this pane is on screen, overriding the surrounding visibility. A
   * pane that is not visible reports no selection and answers no reveal, so a
   * retained editor never moves the caret the reader is working with in the
   * pane they can see. A pane inside a hidden `SliceEditorVisibility` needs no
   * prop; a host with its own notion of visibility sets this itself.
   * @default true
   */
  visible?: boolean;
  /**
   * Master offsets to select and scroll to, so a problem opens on the text
   * that caused it. Each new object reveals again.
   */
  reveal?: SliceReveal | null;
  /**
   * The contract this pane's completion and hover resolve against. It is read
   * per keystroke, so a pane that follows the caret into another root needs no
   * new editor. A rule pane holds YAML, where the Template contract says
   * nothing, so it offers neither.
   */
  suggest?: SuggestionSource;
  /** The selection in master offsets, whenever it moves or the pane takes focus. */
  onSelection?: (selection: WorkbenchInsertTarget["range"]) => void;
  /** The pane took focus, so the host knows which editor the reader is in. */
  onFocus?: () => void;
}

export function SliceEditor({
  controller,
  slice,
  label,
  invalid = false,
  describedBy,
  language = "liquid",
  singleLine = false,
  extensions,
  visible,
  reveal,
  suggest,
  onSelection,
  onFocus,
}: SliceEditorProps) {
  const onScreen = visible ?? useContext(Visible);
  const revision = useDocumentRevision(controller);
  const diagnoses = useSourceDiagnoses();
  const revealDiagnosis = useRevealSourceDiagnosis();
  const readOnly = controller.readOnly;
  const engine = controller.templateLanguage;
  const m = useWorkbenchMessages();
  const part = useParts("sliceEditor");
  const adapter = useOptionalHost();
  const editorExtension = useEditorExtension();
  const nameId = useId();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>(null);
  const syntaxSlot = useRef(new Compartment());
  const syntax = useMemo(
    () =>
      language === "json-e"
        ? jsonRule
        : slice === "advanced" || language === "expression"
          ? []
          : engine === "eta"
            ? slice === "filename"
              ? etaLanguage
              : etaBody
            : slice === "filename"
              ? liquidTemplate
              : liquidBody,
    [engine, language, slice],
  );
  // The view outlives every render, so it reads the current callbacks through
  // a ref instead of being rebuilt whenever the host passes new ones.
  const report = useRef({
    onSelection,
    revealDiagnosis,
    onFocus,
    suggest,
    adapter,
    editorExtension,
    syntax,
    m,
    visible: onScreen,
  });
  report.current = {
    onSelection,
    revealDiagnosis,
    onFocus,
    suggest,
    adapter,
    editorExtension,
    syntax,
    m,
    visible: onScreen,
  };

  useEffect(() => {
    const read: SuggestionSource = (position) => {
      const sliceRange = controller.sliceRange(slice);
      const local =
        language === "json-e" && editor.current
          ? jsonPosition(
              editor.current.state.doc.toString(),
              controller.sliceText(slice),
              position,
            )
          : position;
      const masterPosition = sliceRange.from + local;
      const region = controller.templateRegions.find(
        (region) =>
          masterPosition >= region.from && masterPosition <= region.to,
      );
      if (!region && language !== "json-e") return null;
      const root = region?.root ?? "note";
      const expression = region?.expression ?? false;
      const supplied = report.current.suggest?.(masterPosition);
      return {
        ...partialSuggestions(
          report.current.m,
          controller.dependencies,
          report.current.adapter?.partials,
        ),
        ...supplied,
        root,
        language: language === "json-e" ? "json-e" : region?.language,
        mode: expression ? "expression" : undefined,
        scope:
          language === "json-e"
            ? undefined
            : {
                from: region!.from - sliceRange.from,
                to: region!.to - sliceRange.from,
              },
        fields: completionFields(report.current.m, root),
        tagDescription: (name) => tagDescription(report.current.m, name),
        filterDescription: (name) =>
          report.current.m.workbench_filter_description({ name }),
      };
    };
    const view = new EditorView({
      state: EditorState.create({
        doc:
          language === "json-e"
            ? jsonLayout(controller.sliceText(slice), true).text
            : controller.sliceText(slice),
        extensions: [
          EditorState.readOnly.of(readOnly),
          workbenchSlice(controller, slice, language === "json-e"),
          syntaxSlot.current.of(report.current.syntax),
          ...(language === "expression"
            ? [
                embeddedTemplates((source) => [
                  { from: 0, to: source.length, expression: true },
                ]),
              ]
            : []),
          ...(slice === "advanced"
            ? [
                embeddedTemplates(
                  () =>
                    controller.templateRegions
                      .filter((region) => region.language !== "json-e")
                      .map((region) => ({
                        ...region,
                        body: !region.expression && region.root !== "filename",
                      })),
                  () => controller.sliceRange("note").from,
                ),
              ]
            : []),
          report.current.editorExtension?.(slice, language) ?? [],
          templatePairing((position) => {
            const config = read(position);
            return config?.language === "json-e" ? null : config;
          }),
          report.current.adapter?.editorPopups?.(read, host.current!) ?? [],
          ...(language === "json-e" || slice === "advanced"
            ? [
                embeddedJsonE((source) =>
                  language === "json-e"
                    ? [{ from: 0, to: source.length }]
                    : controller.templateRegions
                        .filter(
                          (region) =>
                            region.language === "json-e" &&
                            region.from >= controller.sliceRange(slice).from &&
                            region.to <= controller.sliceRange(slice).to,
                        )
                        .map((region) => ({
                          from: region.from - controller.sliceRange(slice).from,
                          to: region.to - controller.sliceRange(slice).from,
                        })),
                ),
              ]
            : []),
          ...(singleLine
            ? [
                EditorState.transactionFilter.of((transaction) =>
                  transaction.newDoc.lines > 1 ? [] : transaction,
                ),
              ]
            : []),
          EditorView.lineWrapping,
          linter(null, { tooltipFilter: () => [] }),
          // CodeMirror still mounts an empty filtered tooltip.
          EditorView.theme({ ".cm-tooltip-lint": { display: "none" } }),
          sourceProblemGutter(
            (id) => report.current.revealDiagnosis?.(id),
            () => report.current.m.workbench_problem_show(),
          ),
          // The whole-file pane is the one place a reader counts lines, so the
          // gutter rides with Advanced alone.
          ...(slice === "advanced" ? [lineNumbers()] : []),
          EditorView.contentAttributes.of({ "aria-labelledby": nameId }),
          extensions ?? [],
          EditorView.updateListener.of((update) => {
            if (!update.selectionSet && !update.focusChanged) return;
            if (update.focusChanged && update.view.hasFocus) {
              report.current.onFocus?.();
            }
            if (!report.current.visible) return;
            const { from } = controller.sliceRange(slice);
            report.current.onSelection?.(
              sliceSelection(
                update.view,
                from,
                language === "json-e" ? controller.sliceText(slice) : undefined,
              ),
            );
          }),
        ],
      }),
      parent: host.current!,
    });
    editor.current = view;
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, [controller, slice, nameId, language, singleLine, extensions, readOnly]);

  // A pane reports where its own caret starts whenever it comes on screen — on
  // mount, and again when a host shows a pane it had kept mounted and hidden.
  // The host follows the pane on screen, not the pane before it.
  useEffect(() => {
    const view = editor.current;
    if (!view || !onScreen) return;
    report.current.onSelection?.(
      sliceSelection(
        view,
        controller.sliceRange(slice).from,
        language === "json-e" ? controller.sliceText(slice) : undefined,
      ),
    );
  }, [controller, slice, language, onScreen]);

  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    const diagnostics = sourceDiagnostics({
      controller,
      slice,
      source: view.state.doc.toString(),
      diagnoses,
      messages: m,
      json: language === "json-e",
    });
    view.dispatch(setDiagnostics(view.state, diagnostics));
    view.contentDOM.setAttribute(
      "aria-invalid",
      String(invalid || diagnostics.length > 0),
    );
    if (describedBy)
      view.contentDOM.setAttribute("aria-describedby", describedBy);
    else view.contentDOM.removeAttribute("aria-describedby");
  }, [
    controller,
    slice,
    revision,
    diagnoses,
    m,
    language,
    invalid,
    describedBy,
    extensions,
    readOnly,
    singleLine,
  ]);

  useEffect(() => {
    editor.current?.dispatch({
      effects: syntaxSlot.current.reconfigure(syntax),
    });
  }, [syntax]);

  useEffect(() => {
    const view = editor.current;
    if (
      !view ||
      !onScreen ||
      !reveal ||
      (reveal.slice && reveal.slice !== slice)
    )
      return;
    const { from } = controller.sliceRange(slice);
    const inSlice = (offset: number) => {
      const local = Math.min(
        Math.max(offset - from, 0),
        controller.sliceText(slice).length,
      );
      return language === "json-e"
        ? jsonPosition(
            controller.sliceText(slice),
            view.state.doc.toString(),
            local,
          )
        : local;
    };
    view.dispatch({
      selection: EditorSelection.range(
        inSlice(reveal.anchor ?? reveal.from),
        inSlice(reveal.head ?? reveal.to),
      ),
      scrollIntoView: reveal.scrollIntoView ?? true,
    });
    if (reveal.focus !== false) view.focus();
  }, [controller, slice, reveal, language, onScreen]);

  // The host is the scroll container and the editor grows to its content, so
  // the browser's own scroll anchoring holds the pane in place when a block
  // widget in it changes height. An editor that scrolls itself takes that job
  // over with CodeMirror's anchor heuristics, which treat a height change it
  // did not make as the reader scrolling to the bottom and move the pane. The
  // focus ring sits outside the scroll container and follows the same tokens
  // as the site's Input control.
  return (
    <div {...part("slice-editor")}>
      <HiddenName id={nameId}>{label}</HiddenName>
      <div
        ref={host}
        data-workbench-scroll={slice}
        dir="ltr"
        {...part("slice-scroll")}
      />
    </div>
  );
}

/** The pane's own selection in master offsets, which is what the host tracks. */
function sliceSelection(
  view: EditorView,
  sliceFrom: number,
  jsonSource?: string,
): WorkbenchInsertTarget["range"] {
  const { main } = view.state.selection;
  const map = (position: number) =>
    sliceFrom +
    (jsonSource === undefined
      ? position
      : jsonPosition(view.state.doc.toString(), jsonSource, position));
  return {
    from: map(main.from),
    to: map(main.to),
    ...(main.anchor > main.head
      ? { anchor: map(main.anchor), head: map(main.head) }
      : {}),
  };
}
