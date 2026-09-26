// The CodeMirror field editor an Annotation Card edits its comment in, and any
// other rich-text field Zotero stores with the same inline tags.
//
// The document is the field exactly as Zotero stores it, tags included, so
// saving sends back what was typed and nothing is converted on the way. What
// the editor draws is Zotero's rendering: each pair's text in its format, and
// the tags themselves hidden until the selection touches the pair, the way
// Obsidian's Live Preview reveals Markdown syntax.

import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
} from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder } from "@codemirror/view";
import { Menu, Scope } from "obsidian";
import type { App, ExtendedHotkey } from "obsidian";

import { overlapsSelection } from "@/lib/editor-decoration";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";

import {
  activeFormats,
  clearFormatting,
  htmlToComment,
  parseComment,
  toggleFormat,
} from "./comment-format";
import type { CommentEdit, CommentFormat } from "./comment-format";

const logger = getLogger(["views", "annot-view"]);

/**
 * What an editor says about the Annotation field it edits. Everything else —
 * the inline formats, the keys, the paste conversion and the context menu —
 * is the same for every field.
 */
export interface FieldEditorWording {
  /** What the empty editor shows. */
  placeholder: string;
  /** The editor's accessible name, which names the field. */
  label: string;
}

export interface FieldEditorOptions {
  app: App;
  parent: HTMLElement;
  /** The field the editor edits, for its placeholder and accessible name. */
  wording: FieldEditorWording;
  text: string;
  readOnly: boolean;
  /** Every change the user makes, as the whole field. */
  onChange: (text: string) => void;
  onEscape: () => void;
  /** Mod+Enter: store the field and keep editing. */
  onSubmit: () => void;
  /**
   * Focus left the editor for somewhere other than its own context menu.
   *
   * @param next the element focus went to, if any.
   */
  onBlur: (next: Node | null) => void;
}

export interface FieldEditor extends Disposable {
  readonly view: EditorView;
  /** Show text that changed outside this editor, keeping the caret near where it was. */
  setText(text: string): void;
  setReadOnly(readOnly: boolean): void;
}

/** Marks a transaction that brings outside text in, which is not a user edit. */
const external = Annotation.define<boolean>();

export function createFieldEditor(opts: FieldEditorOptions): FieldEditor {
  const readOnly = new Compartment();
  // The context menu takes focus from the editor while it stands; that blur is
  // not the user leaving.
  let menuOpen = false;
  let scope: Scope | null = null;
  const releaseKeys = (): void => {
    if (scope) opts.app.keymap.popScope(scope);
    scope = null;
  };

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.text,
      extensions: [
        readOnly.of(EditorState.readOnly.of(opts.readOnly)),
        history(),
        keymap.of([
          {
            key: "Escape",
            run: () => {
              opts.onEscape();
              return true;
            },
          },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        EditorView.lineWrapping,
        placeholder(opts.wording.placeholder),
        EditorView.contentAttributes.of({ "aria-label": opts.wording.label }),
        commentDecorations,
        commentTheme,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (update.transactions.every((tr) => tr.annotation(external)))
            return;
          opts.onChange(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          paste: (event, v) => pasteHtml(event, v),
          focus: (_event, v) => {
            releaseKeys();
            scope = editorKeyScope(opts.app, {
              submit: opts.onSubmit,
              toggle: (format) => toggle(v, format),
            });
            opts.app.keymap.pushScope(scope);
          },
          blur: (event) => {
            releaseKeys();
            // A focus event's related target is an element or nothing.
            if (!menuOpen) opts.onBlur(event.relatedTarget as Node | null);
          },
          contextmenu: (event, v) => {
            event.preventDefault();
            const menu = new Menu();
            fillCommentMenu(menu, v);
            // The editor is the menu's parent, so the surface it stands in
            // takes a press on the menu as its own.
            menu.setParentElement(v.dom);
            menuOpen = true;
            menu.onHide(() => {
              menuOpen = false;
              v.focus();
            });
            // A menu key or Shift+F10 reports no pointer, so the menu opens at
            // the caret instead.
            if (event.clientX === 0 && event.clientY === 0) {
              const caret = v.coordsAtPos(v.state.selection.main.head);
              menu.showAtPosition(
                { x: caret?.left ?? 0, y: caret?.bottom ?? 0 },
                v.dom.doc,
              );
            } else {
              menu.showAtMouseEvent(event);
            }
            return true;
          },
        }),
      ],
    }),
  });

  return {
    view,
    setText(text) {
      const edit = diff(view.state.doc.toString(), text);
      if (!edit) return;
      view.dispatch({
        changes: edit,
        annotations: [external.of(true), Transaction.addToHistory.of(false)],
      });
    },
    setReadOnly(value) {
      view.dispatch({
        effects: readOnly.reconfigure(EditorState.readOnly.of(value)),
      });
    },
    [Symbol.dispose]() {
      releaseKeys();
      view.destroy();
    },
  };
}

/** The Markdown editor commands a comment has a Zotero format for. */
const FORMAT_COMMANDS: Record<string, CommentFormat> = {
  "editor:toggle-bold": "b",
  "editor:toggle-italics": "i",
};

/**
 * The keys this editor takes while it has focus, pushed over whatever scope
 * the window holds — the way Obsidian's own embedded editors take theirs, since
 * focusing a card does not make its view the active leaf.
 *
 * Obsidian runs an editor command's hotkey against `workspace.activeEditor`,
 * which here is whatever Markdown note is open behind the view. So every
 * editor-command hotkey is held here: bold and italic run as their Zotero
 * formats, on whatever keys the user bound to them, and the rest reach
 * CodeMirror as plain keys rather than editing that note. Every other hotkey
 * passes on to the app.
 *
 * @see Obsidian 1.14.2 `app.js`, `Commands.addCommand` and `HotkeyManager.onTrigger`.
 */
function editorKeyScope(
  app: App,
  run: { submit: () => void; toggle: (format: CommentFormat) => void },
): Scope {
  const scope = new Scope(app.scope);
  scope.register(["Mod"], "Enter", () => {
    run.submit();
    return false;
  });
  for (const [id, command] of Object.entries(app.commands.editorCommands)) {
    // The map also holds every command pinned to the mobile toolbar, such as
    // the command palette, which acts on no editor and keeps its key.
    if (!command.editorCallback && !command.editorCheckCallback) continue;
    const format = FORMAT_COMMANDS[id];
    const hotkeys =
      app.hotkeyManager.getHotkeys(id) ??
      app.hotkeyManager.getDefaultHotkeys(id) ??
      [];
    for (const hotkey of hotkeys) {
      scope.register(hotkey.modifiers, hotkeyKey(hotkey), () => {
        // `true` ends the lookup without claiming the key.
        if (!format) return true;
        run.toggle(format);
        return false;
      });
    }
  }
  return scope;
}

/** The key Obsidian matches a stored hotkey on: `KeyB` reads as `B`. */
function hotkeyKey(hotkey: ExtendedHotkey): string {
  const { code } = hotkey;
  if (!code) return hotkey.key;
  return code.startsWith("Key") && code.length === 4 ? code.charAt(3) : code;
}

/**
 * Obsidian's own editor menu, cut to what a comment holds: the "Format"
 * submenu with the four Zotero formats, then the clipboard.
 *
 * @see Obsidian 1.13.7 `app.js`, the Markdown editor's `onContextMenu`.
 */
function fillCommentMenu(menu: Menu, view: EditorView): void {
  const { state } = view;
  const { from, to } = state.selection.main;
  const editable = !state.readOnly;
  const active = activeFormats(state.doc.toString(), from, to);

  menu.addItem((item) => {
    item
      .setSection("selection")
      .setTitle(m.comment_editor_format())
      .setIcon("lucide-paintbrush")
      .setDisabled(!editable);
    const sub = item.setSubmenu();
    for (const { format, title, icon } of FORMAT_ITEMS) {
      sub.addItem((entry) =>
        entry
          .setSection("basic")
          .setTitle(title())
          .setIcon(icon)
          .setChecked(active.has(format))
          .onClick(() => {
            toggle(view, format);
          }),
      );
    }
    sub.addItem((entry) =>
      entry
        .setSection("danger")
        .setTitle(m.comment_editor_clear_formatting())
        .setIcon("lucide-eraser")
        .onClick(() => apply(view, clearFormatting(docOf(view), selOf(view)))),
    );
  });

  const selected = from !== to;
  const clipboard: {
    title: string;
    icon: string;
    enabled: boolean;
    run: () => Promise<void>;
  }[] = [
    {
      title: m.comment_editor_cut(),
      icon: "lucide-scissors",
      enabled: selected && editable,
      run: async () => {
        await navigator.clipboard.writeText(state.sliceDoc(from, to));
        view.dispatch({
          changes: { from, to },
          selection: { anchor: from },
          userEvent: "delete.cut",
        });
      },
    },
    {
      title: m.comment_editor_copy(),
      icon: "lucide-copy",
      enabled: selected,
      run: () => navigator.clipboard.writeText(state.sliceDoc(from, to)),
    },
    {
      title: m.comment_editor_paste(),
      icon: "lucide-clipboard-check",
      enabled: editable,
      run: async () => insert(view, await readClipboard(true), "input.paste"),
    },
    {
      title: m.comment_editor_paste_plain(),
      icon: "lucide-clipboard-type",
      enabled: editable,
      run: async () => insert(view, await readClipboard(false), "input.paste"),
    },
  ];
  for (const { title, icon, enabled, run } of clipboard) {
    menu.addItem((item) =>
      item
        .setSection("clipboard")
        .setTitle(title)
        .setIcon(icon)
        .setDisabled(!enabled)
        .onClick(() => {
          run().catch((error: unknown) =>
            logger.warn("Comment editor clipboard action failed", { error }),
          );
        }),
    );
  }
  menu.addItem((item) =>
    item
      .setSection("clipboard")
      .setTitle(m.comment_editor_select_all())
      .setIcon("lucide-box-select")
      .onClick(() =>
        view.dispatch({ selection: { anchor: 0, head: state.doc.length } }),
      ),
  );
}

const FORMAT_ITEMS: {
  format: CommentFormat;
  title: () => string;
  icon: string;
}[] = [
  { format: "b", title: m.comment_editor_bold, icon: "lucide-bold" },
  { format: "i", title: m.comment_editor_italic, icon: "lucide-italic" },
  {
    format: "sub",
    title: m.comment_editor_subscript,
    icon: "lucide-subscript",
  },
  {
    format: "sup",
    title: m.comment_editor_superscript,
    icon: "lucide-superscript",
  },
];

function toggle(view: EditorView, format: CommentFormat): boolean {
  if (view.state.readOnly) return false;
  apply(view, toggleFormat(docOf(view), selOf(view), format));
  return true;
}

const docOf = (view: EditorView): string => view.state.doc.toString();
const selOf = (view: EditorView) => {
  const { anchor, head } = view.state.selection.main;
  return { anchor, head };
};

/** One format edit, sent as the smallest change that produces it. */
function apply(view: EditorView, edit: CommentEdit): void {
  view.dispatch({
    changes: diff(docOf(view), edit.text) ?? [],
    selection: { anchor: edit.anchor, head: edit.head },
    userEvent: "input.format",
  });
  view.focus();
}

function insert(view: EditorView, text: string, userEvent: string): void {
  view.dispatch(view.state.replaceSelection(text), { userEvent });
  view.focus();
}

/**
 * Rich text pasted in keeps the formats a comment can hold, as it does in
 * Zotero's own editor; plain text goes CodeMirror's usual way.
 */
function pasteHtml(event: ClipboardEvent, view: EditorView): boolean {
  const html = event.clipboardData?.getData("text/html");
  if (!html || view.state.readOnly) return false;
  event.preventDefault();
  insert(view, parseHtml(html), "input.paste");
  return true;
}

async function readClipboard(rich: boolean): Promise<string> {
  if (rich) {
    try {
      for (const item of await navigator.clipboard.read()) {
        if (!item.types.includes("text/html")) continue;
        const blob = await item.getType("text/html");
        return parseHtml(await blob.text());
      }
    } catch (error) {
      logger.debug("Rich clipboard read failed; pasting plain text", {
        error,
      });
    }
  }
  return navigator.clipboard.readText();
}

function parseHtml(html: string): string {
  // The parsed document is only read, never adopted into a window.
  const parser = new DOMParser();
  return htmlToComment(parser.parseFromString(html, "text/html").body);
}

/** The single change that turns `from` into `to`, or `null` for none. */
function diff(from: string, to: string) {
  if (from === to) return null;
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start])
    start++;
  let end = 0;
  while (
    end < from.length - start &&
    end < to.length - start &&
    from[from.length - 1 - end] === to[to.length - 1 - end]
  )
    end++;
  return {
    from: start,
    to: from.length - end,
    insert: to.slice(start, to.length - end),
  };
}

const FORMAT_MARKS: Record<CommentFormat, Decoration> = {
  b: Decoration.mark({ tagName: "b" }),
  i: Decoration.mark({ tagName: "i" }),
  sub: Decoration.mark({ tagName: "sub" }),
  sup: Decoration.mark({ tagName: "sup" }),
};
const SHOWN_TAG = Decoration.mark({ class: "zt:text-faint" });
const HIDDEN_TAG = Decoration.replace({});

/** Each pair drawn in its format, its tags hidden until the selection touches it. */
const commentDecorations: Extension = EditorView.decorations.compute(
  ["doc", "selection"],
  (state) => {
    const ranges = state.selection.ranges;
    const decorations: Range<Decoration>[] = [];
    for (const span of parseComment(state.doc.toString())) {
      if (span.contentTo > span.contentFrom) {
        decorations.push(
          FORMAT_MARKS[span.format].range(span.contentFrom, span.contentTo),
        );
      }
      const tag = overlapsSelection(ranges, span.from, span.to)
        ? SHOWN_TAG
        : HIDDEN_TAG;
      decorations.push(
        tag.range(span.from, span.contentFrom),
        tag.range(span.contentTo, span.to),
      );
    }
    return Decoration.set(decorations, true);
  },
);

/**
 * The editor is the card's own text with a caret in it: the comment's font,
 * size and leading, no gutter, no focus ring of its own, and exactly the height
 * of its text, so it takes the rendered comment's place without a shift.
 */
const commentTheme = EditorView.theme({
  "&": { fontSize: "inherit" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
  ".cm-content": { padding: "0", caretColor: "var(--caret-color)" },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "var(--text-faint)" },
});
