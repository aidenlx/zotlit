// A tag chip input as unstyled parts (ADR 0061). Root owns the typed text and
// the key rules; the consumer picks the parts, their order, and their look.
// Each part renders one element marked with `data-slot` and takes `className`
// and the element's native props. Nothing takes `ref`: Preact does not forward
// it through a function component, so `Input` takes `inputRef` instead.

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type {
  ComponentPropsWithoutRef,
  KeyboardEvent,
  Ref,
  RefObject,
} from "react";

const DEFAULT_COMMIT_KEYS: readonly string[] = ["Enter"];

/**
 * The state a consumer's own component reads inside `TagsInput.Root`, such as
 * a suggester that adds the name the user picks.
 */
export interface TagsInputApi {
  /** The tag names, in order. */
  value: readonly string[];
  /**
   * Adds the trimmed text and clears the input. Blank text changes nothing;
   * an exact, case-sensitive duplicate clears the input and adds nothing.
   */
  add: (text: string) => void;
}

interface RootState extends TagsInputApi {
  inputValue: string;
  setInputValue: (text: string) => void;
  /** Removes the entry at `index`. */
  removeAt: (index: number) => void;
  commitKeys: readonly string[];
  inputRef: RefObject<HTMLInputElement | null>;
}

interface ItemState {
  value: string;
  index: number;
}

const RootContext = createContext<RootState | null>(null);
const ItemContext = createContext<ItemState | null>(null);

function useRoot(): RootState {
  const state = useContext(RootContext);
  if (!state) throw new Error("TagsInput part rendered outside TagsInput.Root");
  return state;
}

function useItem(): ItemState {
  const item = useContext(ItemContext);
  if (!item)
    throw new Error("TagsInput item part rendered outside TagsInput.Item");
  return item;
}

/** The {@link TagsInputApi} of the enclosing `TagsInput.Root`. */
export function useTagsInput(): TagsInputApi {
  const { value, add } = useRoot();
  return { value, add };
}

type RootProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "onChange" | "defaultValue"
> & {
  /** The tag names, in order. */
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  /**
   * The `KeyboardEvent.key` values that add the typed text.
   * @default ["Enter"]
   */
  commitKeys?: readonly string[];
};

/**
 * Holds the tag names and the typed text. A press on the root's own empty
 * space focuses the input.
 */
function Root({
  value,
  onValueChange,
  commitKeys = DEFAULT_COMMIT_KEYS,
  onMouseDown,
  ...props
}: RootProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const state: RootState = {
    value,
    inputValue,
    setInputValue,
    add(text) {
      const name = text.trim();
      if (name === "") return;
      setInputValue("");
      if (!value.includes(name)) onValueChange([...value, name]);
    },
    removeAt(index) {
      onValueChange(value.filter((_, at) => at !== index));
    },
    commitKeys,
    inputRef,
  };
  return (
    <RootContext.Provider value={state}>
      <div
        {...props}
        data-slot="tags-input"
        onMouseDown={(event) => {
          onMouseDown?.(event);
          if (event.defaultPrevented || event.target !== event.currentTarget)
            return;
          event.preventDefault();
          inputRef.current?.focus();
        }}
      />
    </RootContext.Provider>
  );
}

type ItemProps = Omit<ComponentPropsWithoutRef<"div">, "value"> & {
  /** The tag name this item shows. */
  value: string;
  /**
   * The item's position in Root's `value`, which `ItemRemove` removes. Pass it
   * when names can repeat; without it, the first entry equal to `value`.
   */
  index?: number;
};

/** One tag. `ItemText` and `ItemRemove` inside it act on this entry. */
function Item({ value, index, ...props }: ItemProps) {
  const root = useRoot();
  const item = { value, index: index ?? root.value.indexOf(value) };
  return (
    <ItemContext.Provider value={item}>
      <div {...props} data-slot="tags-input-item" />
    </ItemContext.Provider>
  );
}

/** The item's tag name. */
function ItemText(props: Omit<ComponentPropsWithoutRef<"span">, "children">) {
  const { value } = useItem();
  return (
    <span {...props} data-slot="tags-input-item-text">
      {value}
    </span>
  );
}

/**
 * Removes its item's tag. A pointer press leaves focus where it is, so the
 * input keeps it; a keyboard press moves focus from the button to the input.
 * The consumer gives it an accessible name.
 */
function ItemRemove({
  onMouseDown,
  onClick,
  ...props
}: ComponentPropsWithoutRef<"button">) {
  const root = useRoot();
  const { index } = useItem();
  return (
    <button
      type="button"
      {...props}
      data-slot="tags-input-item-remove"
      onMouseDown={(event) => {
        onMouseDown?.(event);
        event.preventDefault();
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        const focused =
          event.currentTarget.ownerDocument.activeElement ===
          event.currentTarget;
        root.removeAt(index);
        if (focused) root.inputRef.current?.focus();
      }}
    />
  );
}

type InputProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "value" | "defaultValue"
> & {
  /** Receives the input element, for a suggester or a focus call. */
  inputRef?: Ref<HTMLInputElement>;
};

/**
 * Runs a consumer handler and answers whether it called `preventDefault`. The
 * call is the signal: a blur is not cancelable, so under Preact, which passes
 * the native event, `defaultPrevented` stays false after the call.
 */
function prevented<
  E extends { preventDefault(): void; defaultPrevented: boolean },
>(event: E, handler: ((event: E) => void) | undefined): boolean {
  if (!handler) return false;
  const preventDefault = event.preventDefault.bind(event);
  let called = false;
  event.preventDefault = () => {
    called = true;
    preventDefault();
  };
  handler(event);
  return called || event.defaultPrevented;
}

/** A keystroke that belongs to an in-flight IME composition. */
function composing(event: KeyboardEvent<HTMLInputElement>): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/**
 * The text field. A commit key adds the trimmed text, Backspace in an empty
 * field removes the last tag, and blur adds pending text. A consumer's
 * `onKeyDown` and `onBlur` run first, and a `preventDefault` call in either
 * skips the part's own key or blur rule. A consumer's `onChange` runs before
 * the part records the typed text, which it always does.
 */
function Input({
  inputRef,
  onChange,
  onKeyDown,
  onBlur,
  ...props
}: InputProps) {
  const root = useRoot();
  const rootRef = root.inputRef;
  const ref = useCallback(
    (input: HTMLInputElement | null) => {
      rootRef.current = input;
      if (typeof inputRef === "function") inputRef(input);
      else if (inputRef) inputRef.current = input;
    },
    [rootRef, inputRef],
  );
  return (
    <input
      type="text"
      {...props}
      data-slot="tags-input-input"
      ref={ref}
      value={root.inputValue}
      onChange={(event) => {
        onChange?.(event);
        root.setInputValue(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (prevented(event, onKeyDown) || composing(event)) return;
        if (root.commitKeys.includes(event.key)) {
          event.preventDefault();
          root.add(root.inputValue);
        } else if (
          event.key === "Backspace" &&
          root.inputValue === "" &&
          root.value.length > 0
        ) {
          root.removeAt(root.value.length - 1);
        }
      }}
      onBlur={(event) => {
        if (prevented(event, onBlur)) return;
        root.add(root.inputValue);
      }}
    />
  );
}

/**
 * The tag input composition:
 *
 * ```tsx
 * <TagsInput.Root value={names} onValueChange={setNames}>
 *   {names.map((name) => (
 *     <TagsInput.Item key={name} value={name}>
 *       <TagsInput.ItemText />
 *       <TagsInput.ItemRemove aria-label={`Remove ${name}`} />
 *     </TagsInput.Item>
 *   ))}
 *   <TagsInput.Input inputRef={suggesterRef} />
 * </TagsInput.Root>
 * ```
 */
export const TagsInput = { Root, Item, ItemText, ItemRemove, Input };
