// The inline Annotation Tags editor: `TagsInput` with the view's own tag chips,
// automatic tags marked, and the Library's tag names in Obsidian's suggestion
// popup.
import {
  AbstractInputSuggest,
  prepareSimpleSearch,
  renderMatches,
} from "obsidian";
import type { App } from "obsidian";
import { useId, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";

import { TagsInput, useTagsInput } from "@zotlit/ui";

import { Icon } from "@/components/obsidian/icon";
import { useObsidianApp } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { tooltipAttrs } from "@/lib/utils";

import { tagChipVariants } from "./tag-chip";

export interface TagEditorProps {
  /** The session's current names, in order. */
  names: readonly string[];
  /** The names Zotero holds as automatic tags. */
  auto: ReadonlySet<string>;
  /** The save is in flight: the input and the remove buttons rest disabled. */
  saving: boolean;
  /** The tag names of the Annotation's Library, read when the editor opens. */
  libraryNames: () => readonly string[];
  onChange: (names: string[]) => void;
  /** The session ends, once: after this call the editor changes nothing. */
  onClose: () => void;
  /**
   * Where the editor puts its own end of the session, for a gesture outside
   * it, such as the card's tag toggle. That end adds the typed text first.
   */
  endRef: RefObject<(() => void) | null>;
}

/**
 * One tag editing session, drawn in place of the tag chips. Enter adds the
 * typed name and a comma stays part of it. Focus leaving the editor, the
 * editor going away, or {@link TagEditorProps.endRef} ends the session with
 * the typed text added; Escape ends it without that text.
 *
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
export function TagEditor({
  names,
  auto,
  saving,
  libraryNames,
  onChange,
  onClose,
  endRef,
}: TagEditorProps) {
  return (
    <TagsInput.Root
      value={names}
      onValueChange={onChange}
      aria-busy={saving}
      // A press on a chip keeps the focus in the field, so it neither ends the
      // session nor lands on the surface around the editor. A press on the
      // editor's own empty space is Root's to answer.
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        if (target === event.currentTarget) return;
        if (target.dataset.slot === "tags-input-input") return;
        event.preventDefault();
      }}
      className="zt:flex zt:flex-wrap zt:items-center zt:gap-1 zt:rounded-sm zt:p-0.5 zt:ring-1 zt:ring-border zt:focus-within:ring-border-focus"
    >
      {names.map((name) => (
        <TagsInput.Item
          key={name}
          value={name}
          data-auto={auto.has(name) ? "" : undefined}
          className={tagChipVariants({
            state: "resting",
            density: "dense",
            truncate: true,
            class:
              "zt:flex zt:cursor-default zt:items-center zt:gap-0.5 zt:pe-0.5",
          })}
        >
          {auto.has(name) && (
            <span
              className="zt:flex zt:shrink-0"
              {...tooltipAttrs(m.annot_view_card_tag_auto())}
            >
              <Icon name="bot" size={12} aria-hidden />
              <span className="zt:sr-only">{m.annot_view_card_tag_auto()}</span>
            </span>
          )}
          <TagsInput.ItemText className="zt:block zt:truncate" />
          <TagsInput.ItemRemove
            className="zt-annot-tag-remove clickable-icon"
            disabled={saving}
            {...tooltipAttrs(m.annot_view_card_tag_remove({ name }))}
          >
            <Icon name="x" size={12} />
          </TagsInput.ItemRemove>
        </TagsInput.Item>
      ))}
      <TagField
        saving={saving}
        libraryNames={libraryNames}
        onClose={onClose}
        endRef={endRef}
      />
    </TagsInput.Root>
  );
}

/**
 * The text field, with the Library's names attached as Obsidian's suggestion
 * popup. The field takes focus as the editor opens.
 */
function TagField({
  saving,
  libraryNames,
  onClose,
  endRef,
}: Pick<TagEditorProps, "saving" | "libraryNames" | "onClose" | "endRef">) {
  const app = useObsidianApp();
  const { value, add } = useTagsInput();
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const suggest = useRef<TagSuggest | null>(null);
  /**
   * Whether the session has ended. Every way out runs through {@link end},
   * and only the first one counts: Escape and the blur of the field it
   * disables both end the same session.
   */
  const ended = useRef(false);
  const endSession = useRef<(withText: boolean) => void>(() => {});
  // The suggester and the focus listener outlive renders; they read these.
  const latest = useRef({ value, add, onClose, libraryNames });
  latest.current = { value, add, onClose, libraryNames };

  useLayoutEffect(() => {
    const input = inputRef.current;
    const editor = input?.closest("[data-slot=tags-input]");
    if (!input || !editor) return;
    /**
     * Ends the session. `add` hands the names on at once, so the text still
     * typed is in the draft before the save reads it.
     */
    const end = (withText: boolean): void => {
      if (ended.current) return;
      ended.current = true;
      suggest.current?.close();
      if (withText) latest.current.add(input.value);
      latest.current.onClose();
    };
    const library = latest.current.libraryNames();
    suggest.current = new TagSuggest(app, input, {
      names: () => library,
      taken: () => latest.current.value,
      pick: (name) => latest.current.add(name),
    });
    // Focus moving between the field and a remove button stays inside the
    // session; focus leaving the editor ends it.
    const leave = (event: FocusEvent) => {
      if (editor.contains(event.relatedTarget as Node | null)) return;
      end(true);
    };
    editor.addEventListener("focusout", leave as EventListener);
    endSession.current = end;
    endRef.current = () => end(true);
    input.focus({ preventScroll: true });
    return () => {
      editor.removeEventListener("focusout", leave as EventListener);
      suggest.current?.close();
      suggest.current = null;
      endRef.current = null;
      // An editor that goes with no blur — the view closing, the item
      // changing, the card leaving the list — still ends its session.
      end(true);
    };
  }, [app, endRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const open = suggest.current?.showing ?? false;
    // The popup answers Enter with the highlighted name, which is the typed
    // text itself until the user moves to a Library name.
    if (event.key === "Enter" && open) event.preventDefault();
    if (event.key === "Escape" && !open) {
      // Escape closes the editor alone, never a surface around it.
      event.preventDefault();
      event.stopPropagation();
      endSession.current(false);
    }
  };

  return (
    <>
      {/* The field's name, held apart so that the pointer passes over the
          field with no tooltip. */}
      <span id={labelId} hidden>
        {m.annot_view_card_tag_placeholder()}
      </span>
      <TagsInput.Input
        inputRef={inputRef}
        className="zt-annot-tag-input zt:min-w-[8ch] zt:flex-1 zt:px-1 zt:outline-none"
        disabled={saving}
        placeholder={
          saving
            ? m.annot_view_card_saving()
            : m.annot_view_card_tag_placeholder()
        }
        aria-labelledby={labelId}
        autoComplete="off"
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // A session that has ended takes no more text.
          if (ended.current) event.preventDefault();
        }}
      />
    </>
  );
}

/** Where a {@link TagSuggest} reads its names and hands its pick. */
interface TagSuggestSource {
  names(): readonly string[];
  /** The names the Annotation already carries, which are no addition. */
  taken(): readonly string[];
  pick(name: string): void;
}

/**
 * The Library's tag names that match the typed text, minus the names the
 * Annotation already carries. The typed text itself leads the list, so Enter
 * adds exactly what was typed until the user moves to another name.
 */
class TagSuggest extends AbstractInputSuggest<string> {
  readonly #source: TagSuggestSource;
  #search = prepareSimpleSearch("");
  #open = false;

  constructor(app: App, input: HTMLInputElement, source: TagSuggestSource) {
    super(app, input);
    this.#source = source;
  }

  /** Whether the popup shows. Obsidian keeps an untyped `isOpen` of its own. */
  get showing(): boolean {
    return this.#open;
  }

  override open(): void {
    super.open();
    this.#open = true;
  }

  override close(): void {
    super.close();
    this.#open = false;
  }

  override getSuggestions(query: string): string[] {
    const text = query.trim();
    if (text === "") return [];
    this.#search = prepareSimpleSearch(text);
    const taken = this.#source.taken();
    const matches = this.#source
      .names()
      .filter(
        (name) =>
          name !== text && !taken.includes(name) && this.#search(name) !== null,
      );
    return taken.includes(text) ? matches : [text, ...matches];
  }

  override renderSuggestion(name: string, el: HTMLElement): void {
    el.addClass("mod-nowrap");
    renderMatches(el, name, this.#search(name)?.matches ?? null);
  }

  override selectSuggestion(name: string): void {
    this.#source.pick(name);
    this.close();
  }
}
