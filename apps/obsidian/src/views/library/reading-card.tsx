// The Reading Card: the pane on the right of the Library View that shows the
// selected Item. Its bibliographic line reads as the Papers row reads it, its
// Annotations are the Annotation Cards of a second Query View whose Query
// Context is the Item, so editing, locks and the Editing Capability are the
// sidebar's, and its buttons run the operations of the row menu.
//
// @see apps/obsidian/docs/adr/0069-the-annotation-view-is-the-annotations-layout-of-the-query-view.md
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import { Component, Scope } from "obsidian";
import type { IconName } from "obsidian";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { useUniqueId } from "@zotlit/ui";

import { Button } from "@/components/obsidian/button";
import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { itemTypeIcon } from "@/lib/item-type-icon";
import { getLogger } from "@/lib/log";
import { cn, tooltipAttrs } from "@/lib/utils";
import type { QueryViewValue } from "@/services/item-query/query-view";
import { libraryLabel } from "@/services/library-scope/label";
import type { LibraryScope } from "@/services/library-scope/scope";
import { AnnotList } from "@/views/annot-view/AnnotView";
import { metaText } from "@/views/query-view/papers-layout";
import { serializeQueryFile } from "@/views/query-view/query-file";
import {
  LOADING_TEXT,
  ReaderLink,
  ZoteroNoteLink,
} from "@/views/query-view/table-layout";
import type { TableReaders } from "@/views/query-view/table-readers";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps, QueryViewHost } from "@/views/query-view/view";

import {
  CARD_PATHS,
  itemTypeLabel,
  keyFacts,
  list,
  otherFields,
  record,
  text,
} from "./card-fields";
import type { CardField } from "./card-fields";
import type { ReadingCardDisclosures } from "./document";
import type { ItemActions } from "./item-actions";
import { libraryOf, sameLibrary } from "./tree";

type Values = Readonly<Record<string, QueryViewValue>>;

const logger = getLogger(["library-view", "reading-card"]);

/** The Query File of the card: every Annotation of the Item `this` names. */
function readingCardQueryText(): string {
  return serializeQueryFile({
    filters: "item == this.item",
    views: [
      {
        type: "annotations",
        name: m.library_view_card_annotations(),
        from: "annotations",
        problems: [],
        source: {},
      },
    ],
    problems: [],
    source: {},
  });
}

export interface ReadingCardDeps extends QueryViewDeps {
  items: ItemActions;
}

export interface ReadingCardHost {
  /** The row menu of the Item, under the button that asks for it. */
  menu: (indexedKey: string, button: HTMLElement) => void;
  /** Show the Item's Annotations in the sidebar Annotation View. */
  openInSidebar: (indexedKey: string) => void;
  /** Put away the card that shows over the list on a narrow pane. */
  close: () => void;
  /** Keep a disclosure open or closed for the Library View. */
  keepDisclosure: (name: keyof ReadingCardDisclosures, open: boolean) => void;
  /** Select the tag `name` in the Tag Selector, beside any selected already. */
  selectTag: (name: string) => void;
  /** The values of the list's row of the Item `key`, where the list shows it. */
  row: (key: string) => Values | null;
  onEscape: NonNullable<QueryViewHost["layout"]>["onEscape"];
}

/** One file of the Item. */
interface CardFile {
  readonly key: string;
  readonly title: string;
  readonly fileType: string;
}

/** One Zotero note of the Item. */
interface CardNote {
  readonly key: string;
  readonly title: string;
}

/** The Item as the card shows it. */
interface CardItem {
  title: string;
  /** Creators, year and Venue, as the Papers row's second line. */
  meta: string;
  /** The label of the Item type; `null` for a type this build does not know. */
  type: string | null;
  itemType: string;
  facts: readonly CardField[];
  fields: readonly CardField[];
  abstract: string | null;
  /** Each place the Item sits, as Library › Collection names. */
  where: readonly (readonly string[])[];
  tags: readonly string[];
  files: readonly CardFile[];
  notes: readonly CardNote[];
  annotations: number;
}

/**
 * What the card shows. The Item, its fields and its buttons change together,
 * so the header and the buttons never name two Items.
 */
interface CardState {
  /** The Item shown, by Indexed Key; `null` hides the card. */
  key: string | null;
  /**
   * The Item's fields; only the header's while {@link loading}, and those
   * of its list row, or none, where the read failed.
   */
  item: CardItem | null;
  /** Whether the Item's fields are still being read. */
  loading: boolean;
  /** Whether the vault holds the Item's Literature Note. */
  noted: boolean;
  disclosures: ReadingCardDisclosures;
}

/**
 * How long the card keeps the last Item while it reads the next one, before
 * it shows the next one's header from its list row and the rest as loading.
 */
const PREVIEW_DELAY_MS = 150;

export class ReadingCard extends Component {
  readonly store = createStore<CardState>(() => ({
    key: null,
    item: null,
    loading: false,
    noted: false,
    disclosures: { allFields: false, annotations: false },
  }));
  /** The card's Annotations: a Query View bound to the Item. */
  readonly query: QueryView;
  readonly #deps: ReadingCardDeps;
  readonly #host: ReadingCardHost;
  readonly #scope: Scope;
  #read: AbortController | null = null;
  #reading: Promise<void> = Promise.resolve();
  /** The Item asked for whose read has not landed yet. */
  #pending: string | null = null;
  /** The timer of the header from the list row, and the window that runs it. */
  #previewTimer: { win: Window; id: number } | null = null;
  /** Where the card is drawn; its window runs the card's timer. */
  #el: HTMLElement | null = null;
  /** The Item whose Annotations the query reads; `null` before it runs. */
  #annotationsOf: string | null = null;

  constructor(deps: ReadingCardDeps, host: ReadingCardHost) {
    super();
    this.#deps = deps;
    this.#host = host;
    this.#scope = new Scope(deps.app.scope);
    this.query = new QueryView(deps, {
      scope: this.#scope,
      sourcePath: () => "",
      context: () => {
        const { key } = this.store.getState();
        return key === null ? undefined : { item: key };
      },
      // The Item's own Library, which may lie outside the Library Scope.
      libraries: () => this.#libraries(this.store.getState().key),
      // The card's query is fixed: nothing in it changes the text.
      save: () => {},
      layout: { onEscape: host.onEscape },
    });
  }

  /** Settles once the card shows its Item and, where open, its Annotations. Never rejects. */
  get settled(): Promise<void> {
    return this.#reading.then(() => this.query.settled);
  }

  override onload(): void {
    this.addChild(this.query);
    this.register(
      this.#deps.literatureNotes.on("changed", () => this.#noteChanged()),
    );
    // Zotero's database changed: the Item may read otherwise now.
    this.register(this.#deps.reads.on("changed", () => this.#reread()));
    this.register(() => {
      this.#read?.abort();
      this.#cancelPreview();
    });
  }

  /** Draw the card into `el`; the card's own keys act while focus is in it. */
  render(el: HTMLElement): void {
    this.#el = el;
    this.query.layout.render(el, <CardBody card={this} />);
    const keys = this.#deps.cardFocus.hold(el, this.#scope, this.query);
    this.register(() => keys[Symbol.dispose]());
  }

  /**
   * Show the Item `key`, or nothing for `null`. The card keeps the Item it
   * shows until the next one's fields are read, and then shows the next one
   * whole; a read that takes a while shows the next one's header from its
   * list row first.
   */
  show(key: string | null): void {
    if (key === (this.#pending ?? this.store.getState().key)) return;
    this.#read?.abort();
    this.#read = null;
    this.#cancelPreview();
    if (key === null || key === this.store.getState().key) {
      this.#pending = null;
      if (key === null) this.#commit(null, null, false);
      this.#reading = Promise.resolve();
      return;
    }
    this.#pending = key;
    const preview = () => {
      const values = this.#host.row(key);
      this.#commit(key, values && previewItem(values), true);
    };
    // A card that shows no Item yet has none to keep: it opens on the
    // header from the list row.
    if (this.store.getState().key === null) preview();
    else {
      const win = this.#el?.win ?? window;
      this.#previewTimer = {
        win,
        id: win.setTimeout(() => {
          this.#previewTimer = null;
          if (this.#pending === key) preview();
        }, PREVIEW_DELAY_MS),
      };
    }
    const controller = new AbortController();
    this.#read = controller;
    this.#reading = this.#readItem(key, controller.signal);
  }

  /**
   * Show the Item `key` with `item`, buttons and all, in one render. The last
   * Item's Annotation Cards never show under this one.
   */
  #commit(key: string | null, item: CardItem | null, loading: boolean): void {
    const shown = this.store.getState().key;
    this.store.setState({
      key,
      item,
      loading,
      noted: key !== null && this.#deps.literatureNotes.find(key) !== null,
    });
    if (key === shown) return;
    this.query.clear();
    this.#annotationsOf = null;
    if (key !== null && this.store.getState().disclosures.annotations)
      this.#readAnnotations();
  }

  #cancelPreview(): void {
    if (this.#previewTimer !== null)
      this.#previewTimer.win.clearTimeout(this.#previewTimer.id);
    this.#previewTimer = null;
  }

  /** Show the disclosures as the Library View keeps them. */
  showDisclosures(disclosures: ReadingCardDisclosures): void {
    this.store.setState({ disclosures });
    if (disclosures.annotations) this.#readAnnotations();
  }

  /** Open or close a disclosure, for every Item the card shows. */
  disclose(name: keyof ReadingCardDisclosures, open: boolean): void {
    const { disclosures } = this.store.getState();
    this.store.setState({ disclosures: { ...disclosures, [name]: open } });
    this.#host.keepDisclosure(name, open);
    // The Annotations are read the first time they open for an Item.
    if (name === "annotations" && open) this.#readAnnotations();
  }

  /** Read the shown Item's Annotations, once for each Item. */
  #readAnnotations(): void {
    const { key } = this.store.getState();
    if (key === null || this.#annotationsOf === key) return;
    this.#annotationsOf = key;
    this.query.setText(readingCardQueryText());
    this.query.contextChanged();
  }

  /** Read the Item shown again, keeping its fields on screen until the read lands. */
  #reread(): void {
    const key = this.#pending ?? this.store.getState().key;
    if (key === null) return;
    this.#read?.abort();
    const controller = new AbortController();
    this.#read = controller;
    this.#reading = this.#readItem(key, controller.signal);
  }

  /** The Library of the Item `key`. */
  #libraries(key: string | null): LibraryScope {
    const library = key === null ? null : libraryOf(key);
    return { mode: "selected", libraries: library ? [library] : [] };
  }

  /** The name of the Library that holds the Item `key`. */
  #libraryName(key: string): string | null {
    const selector = libraryOf(key);
    if (!selector) return null;
    const available = this.#deps.libraryScope.current?.available.find(
      (library) => sameLibrary(library.selector, selector),
    );
    return libraryLabel(available ?? { selector, libraryID: 0, name: null });
  }

  async #readItem(key: string, signal: AbortSignal): Promise<void> {
    try {
      const outcome = await this.#deps.query.run(
        {
          from: "items",
          filter: `${JSON.stringify([key])}.contains(indexedKey)`,
          fields: [...CARD_PATHS],
          limit: 1,
          libraries: this.#libraries(key),
        },
        signal,
      );
      if (signal.aborted) return;
      const values =
        outcome.kind === "result" ? outcome.result.rows?.[0]?.values : null;
      if (values) this.#land(key, cardItem(values, this.#libraryName(key)));
      else this.#land(key, null);
    } catch (error) {
      if (signal.aborted) return;
      logger.warn("The Reading Card could not read its Item", {
        indexedKey: key,
        error,
      });
      this.#land(key, null);
    }
  }

  /**
   * The read of `key` landed with `item`, or with nothing where it failed: a
   * failed read keeps the fields shown of an Item read before, and shows a
   * new one by its list row.
   */
  #land(key: string, item: CardItem | null): void {
    const shown = this.store.getState();
    if (this.#pending === key) {
      this.#pending = null;
      this.#cancelPreview();
    } else if (shown.key !== key) return;
    if (item === null && shown.key === key && !shown.loading) return;
    const values = item === null ? this.#host.row(key) : null;
    this.#commit(key, item ?? (values && previewItem(values)), false);
  }

  #noteChanged(): void {
    const { key } = this.store.getState();
    if (key === null) return;
    this.store.setState({
      noted: this.#deps.literatureNotes.find(key) !== null,
    });
  }

  get items(): ItemActions {
    return this.#deps.items;
  }

  get readers(): TableReaders {
    return this.#deps.readers;
  }

  get host(): ReadingCardHost {
    return this.#host;
  }
}

/** The header of the Item as its list row reads it, while the card reads the rest. */
function previewItem(values: Values): CardItem {
  return {
    title: text(values.title),
    meta: metaText(values),
    itemType: text(values.itemType),
    type: itemTypeLabel(text(values.itemType)),
    facts: [],
    fields: [],
    abstract: null,
    where: [],
    tags: [],
    files: [],
    notes: [],
    annotations: 0,
  };
}

function cardItem(values: Values, library: string | null): CardItem {
  const abstract = text(values.abstractNote);
  const { facts, shown } = keyFacts(values);
  const paths = list(values.collections).flatMap((path) =>
    typeof path === "string" && path !== "" ? [path.split("/")] : [],
  );
  const lead = library === null ? [] : [library];
  const keys = list(values["attachments[].indexedKey"]);
  const titles = list(values["attachments[].title"]);
  const kinds = list(values["attachments[].fileType"]);
  return {
    title: text(values.title),
    meta: metaText(values),
    itemType: text(values.itemType),
    type: itemTypeLabel(text(values.itemType)),
    facts,
    fields: otherFields(values, shown),
    abstract: abstract === "" ? null : abstract,
    where:
      paths.length > 0
        ? paths.map((path) => [...lead, ...path])
        : lead.length > 0
          ? [lead]
          : [],
    tags: list(values.tags).flatMap((tag) => {
      const name = text(record(tag)?.name);
      return name === "" ? [] : [name];
    }),
    files: keys.flatMap((key, index) =>
      typeof key === "string"
        ? [
            {
              key,
              title: text(titles[index]) || key,
              fileType: text(kinds[index]),
            },
          ]
        : [],
    ),
    notes: list(values.notes).flatMap((entry) => {
      const note = record(entry);
      const key = text(note?.indexedKey);
      return key === "" ? [] : [{ key, title: text(note?.title) || key }];
    }),
    annotations: list(values["annotations[].indexedKey"]).length,
  };
}

/** The icon of a file, by its kind. */
const FILE_ICONS: Readonly<Record<string, string>> = {
  pdf: "file-text",
  epub: "book-open",
  web: "globe",
  image: "image",
};

/** A small label over a part of the card. */
const LABEL =
  "zt:m-0 zt:text-xs zt:font-(--font-medium) zt:text-muted-foreground";

/** A part of the card under its small label, which names it. */
function Part({
  name,
  label,
  children,
  className,
}: {
  name: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useUniqueId();
  return (
    <section
      aria-labelledby={id}
      data-library-card-part={name}
      className={cn("zt:flex zt:flex-col zt:gap-(--size-2-2)", className)}
    >
      {/* Obsidian's unlayered `h3` rule would outrank the label's size. */}
      <div role="heading" aria-level={3} id={id} className={LABEL}>
        {label}
      </div>
      {children}
    </section>
  );
}

/** A list of fields: each label over its value. */
function Fields({
  fields,
  id,
  after,
}: {
  fields: readonly CardField[];
  id?: string;
  /** What follows a field's value on its line, such as a copy button. */
  after?: (field: CardField) => ReactNode;
}) {
  return (
    <dl id={id} className="zt:m-0 zt:grid zt:grid-cols-1 zt:gap-y-(--size-4-2)">
      {fields.map((field) => (
        <div key={field.name} data-library-card-fact={field.name}>
          <dt className={LABEL}>{field.label}</dt>
          <dd className="zt:m-0 zt:flex zt:items-center zt:gap-1 zt:text-(length:--font-ui-small)">
            <span className="zt:min-w-0 zt:break-words zt:whitespace-pre-line zt:select-text">
              {field.href ? (
                <a
                  className="external-link"
                  href={field.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {field.text}
                </a>
              ) : (
                field.text
              )}
            </span>
            {after?.(field)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A native button that opens and closes the body `controls` names. */
function Disclosure({
  name,
  open,
  controls,
  onToggle,
  icon,
  children,
}: {
  name: string;
  open: boolean;
  controls: string;
  onToggle: () => void;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      data-library-card-toggle={name}
      onClick={onToggle}
      className="zt-library-card-toggle zt:flex zt:w-full zt:cursor-(--cursor) zt:items-center zt:gap-(--size-2-2) zt:rounded-(--clickable-icon-radius) zt:px-(--size-2-2) zt:py-(--size-2-3) zt:text-(length:--font-ui-small) zt:text-(--text-normal) zt:hover:bg-(--background-modifier-hover) zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none"
    >
      {icon && <Icon name={icon} size="var(--icon-s)" />}
      <span className="zt:flex-1 zt:text-start">{children}</span>
      <Icon
        name={open ? "chevron-down" : "chevron-right"}
        size="var(--icon-xs)"
        strokeWidth="var(--icon-xs-stroke-width)"
      />
    </button>
  );
}

/** The abstract, cut to about four lines until the researcher asks for the rest. */
function Abstract({ abstract }: { abstract: string }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useUniqueId();
  useLayoutEffect(() => {
    setOpen(false);
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // Hidden, or with no layout: judge by length, about four lines of
      // the card's width.
      setLong(
        el.clientHeight === 0
          ? abstract.length > ABSTRACT_LINES_LENGTH
          : el.scrollHeight > el.clientHeight + 1,
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [abstract]);
  return (
    <Part name="abstract" label={m.library_view_card_abstract()}>
      <p
        id={id}
        ref={ref}
        className={cn(
          "zt:m-0 zt:text-(length:--font-ui-small) zt:leading-(--line-height-normal) zt:whitespace-pre-line zt:select-text",
          !open && "zt:line-clamp-4",
        )}
        data-library-card-abstract=""
      >
        {abstract}
      </p>
      {(long || open) && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          data-library-card-toggle="abstract"
          onClick={() => setOpen(!open)}
          className="zt-library-card-toggle zt:cursor-(--cursor) zt:self-start zt:rounded-(--radius-s) zt:text-(length:--font-ui-small) zt:text-(--text-accent) zt:hover:underline zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none"
        >
          {open
            ? m.library_view_card_show_less()
            : m.library_view_card_show_more()}
        </button>
      )}
    </Part>
  );
}

/** About four lines of the card's width, for an abstract with no layout to measure. */
const ABSTRACT_LINES_LENGTH = 180;

/** A chip: a tag, or a place the Item sits. */
const CHIP =
  "zt:inline-flex zt:max-w-full zt:items-center zt:gap-1 zt:rounded-(--radius-s) zt:bg-(--background-modifier-hover) zt:px-(--size-2-2) zt:py-0.5 zt:text-xs zt:text-(--text-normal)";

function CardBody({ card }: { card: ReadingCard }) {
  const key = useStore(card.store, (s) => s.key);
  const item = useStore(card.store, (s) => s.item);
  const loading = useStore(card.store, (s) => s.loading);
  const noted = useStore(card.store, (s) => s.noted);
  const disclosures = useStore(card.store, (s) => s.disclosures);
  const failed = useStore(card.query.state, (s) => s.phase === "failed");
  const titleId = useUniqueId();
  const fieldsId = useUniqueId();
  const annotationsId = useUniqueId();
  // The height of what the last Item showed under its buttons, which the
  // next one keeps while its fields are read.
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyHeight = useRef(0);
  useLayoutEffect(() => {
    if (!loading && bodyRef.current)
      bodyHeight.current = bodyRef.current.offsetHeight;
  });
  if (key === null) return null;
  const { items, host, readers } = card;
  const hasFacts = !!item && (item.facts.length > 0 || item.fields.length > 0);
  // The card's 16 px inline padding keeps what ends a line, the chevrons of
  // its disclosures and the close button, clear of an overlay scrollbar, so
  // the card takes no `scroll-gutter`: on macOS that would cut its end
  // padding to Obsidian's 12 px scrollbar width.
  return (
    <section
      className="zt:flex zt:h-full zt:min-h-0 zt:flex-col zt:gap-(--size-4-5) zt:overflow-y-auto zt:px-(--size-4-4) zt:pt-(--size-4-4) zt:pb-(--size-4-8)"
      aria-labelledby={titleId}
    >
      <div className="zt:flex zt:flex-col zt:gap-(--size-4-2)">
        <div className="zt:flex zt:items-start zt:gap-(--size-2-2)">
          <div
            role="heading"
            aria-level={2}
            id={titleId}
            className="zt:m-0 zt:min-w-0 zt:flex-1 zt:text-(length:--font-ui-large) zt:leading-(--line-height-tight) zt:font-(--font-semibold) zt:break-words zt:select-text"
            data-library-card-title=""
          >
            {item?.title}
          </div>
          {/* On a narrow pane the card shows over the list, and puts itself
              away here. Obsidian's own rule shows a clickable icon, so the
              wide pane hides a wrapper. */}
          <span className="zt:flex zt:@4xl:hidden">
            <IconButton
              icon="x"
              data-library-card-close=""
              {...tooltipAttrs(m.library_view_card_close())}
              onClick={host.close}
            />
          </span>
        </div>
        <div
          className="zt:text-(length:--font-ui-small) zt:text-muted-foreground"
          data-library-card-meta=""
        >
          {item?.meta}
        </div>
        {item?.type && (
          <div
            className="zt:flex zt:items-center zt:gap-1 zt:text-xs zt:text-muted-foreground"
            data-library-card-part="type"
          >
            {/* The icon of the Item type, from the map the Papers rows use. */}
            <Icon
              name={itemTypeIcon(item.itemType)}
              size="var(--icon-xs)"
              data-library-card-type-icon={itemTypeIcon(item.itemType)}
            />
            {item.type}
          </div>
        )}
        <div className="zt:flex zt:flex-wrap zt:items-center zt:gap-(--size-2-2) zt:pt-(--size-2-2)">
          <Button
            variant="cta"
            icon="file-text"
            data-library-card-action="pdf"
            onClick={() => void items.openPdf(key, false)}
          >
            {m.library_view_menu_open_pdf()}
          </Button>
          <Button
            icon={noted ? "notebook-pen" : "file-plus"}
            data-library-card-action="note"
            onClick={() => void items.openNote(key, false)}
          >
            {noted
              ? m.library_view_menu_open_note()
              : m.library_view_menu_write_note()}
          </Button>
          <IconButton
            icon="more-horizontal"
            {...tooltipAttrs(m.library_view_card_more())}
            data-library-card-action="more"
            onClick={(event: ReactMouseEvent<HTMLElement>) =>
              host.menu(key, event.currentTarget)
            }
          />
          <IconButton
            icon="panel-right"
            data-library-card-action="sidebar"
            {...tooltipAttrs(m.library_view_card_open_in_sidebar())}
            onClick={() => host.openInSidebar(key)}
          />
        </div>
      </div>
      {loading ? (
        <div
          data-library-card-loading=""
          style={{ minHeight: bodyHeight.current }}
          className="zt:text-(length:--font-ui-small) zt:text-muted-foreground"
        >
          <span className={LOADING_TEXT}>{m.query_view_table_loading()}</span>
        </div>
      ) : (
        // The card's gap between the parts, kept inside the body.
        <div
          ref={bodyRef}
          className="zt:flex zt:flex-col zt:gap-(--size-4-5) zt:empty:hidden"
        >
          {item && hasFacts && (
            <div
              data-library-card-part="facts"
              className="zt:flex zt:flex-col zt:gap-(--size-4-2)"
            >
              {item.facts.length > 0 && (
                <Fields
                  fields={item.facts}
                  after={(fact) =>
                    fact.name === "citationKey" && (
                      <CopyCitationKey
                        onCopy={() => void items.copyCitationKey(key)}
                      />
                    )
                  }
                />
              )}
              {item.fields.length > 0 && (
                <>
                  <Disclosure
                    name="fields"
                    open={disclosures.allFields}
                    controls={fieldsId}
                    onToggle={() =>
                      card.disclose("allFields", !disclosures.allFields)
                    }
                  >
                    {m.library_view_card_all_fields()}
                  </Disclosure>
                  {disclosures.allFields ? (
                    <div data-library-card-part="fields">
                      <Fields fields={item.fields} id={fieldsId} />
                    </div>
                  ) : (
                    <div id={fieldsId} hidden />
                  )}
                </>
              )}
            </div>
          )}
          {item?.abstract && <Abstract abstract={item.abstract} />}
          {item && item.where.length > 0 && (
            <Part name="where" label={m.library_view_card_where()}>
              <ul className="zt:m-0 zt:flex zt:list-none zt:flex-col zt:items-start zt:gap-(--size-2-2) zt:p-0">
                {item.where.map((path) => (
                  <li
                    key={path.join("\u0000")}
                    className={CHIP}
                    data-library-card-path=""
                  >
                    <Icon
                      name={path.length > 1 ? "folder" : "library"}
                      size="var(--icon-xs)"
                      className="zt:shrink-0 zt:text-muted-foreground"
                    />
                    <span className="zt:min-w-0 zt:break-words">
                      {path.map((name, index) => (
                        <Fragment key={index}>
                          {index > 0 && (
                            <span
                              aria-hidden="true"
                              className="zt:text-muted-foreground"
                            >
                              {" › "}
                            </span>
                          )}
                          {name}
                        </Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </Part>
          )}
          {item && item.tags.length > 0 && (
            <Part name="tags" label={m.library_view_card_tags()}>
              <ul className="zt:m-0 zt:flex zt:list-none zt:flex-wrap zt:gap-(--size-2-2) zt:p-0">
                {/* A tag selects itself in the Tag Selector, which narrows the
                  list to the papers that carry it. Obsidian's unlayered
                  `button` rules outrank the chip's utilities, so the chip is a
                  `role="button"` of its own. */}
                {item.tags.map((tag) => (
                  <li key={tag} className="zt:flex zt:max-w-full">
                    <span
                      role="button"
                      tabIndex={0}
                      data-library-card-tag={tag}
                      className={cn(
                        CHIP,
                        "zt:cursor-(--cursor) zt:outline-hidden zt:hover:bg-(--background-modifier-active-hover) zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]",
                      )}
                      {...tooltipAttrs(m.library_view_card_tag_filter({ tag }))}
                      onClick={() => host.selectTag(tag)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        host.selectTag(tag);
                      }}
                    >
                      {tag}
                    </span>
                  </li>
                ))}
              </ul>
            </Part>
          )}
          {item && item.files.length > 0 && (
            <Part name="files" label={m.library_view_card_files()}>
              <ul className="zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-(--size-2-2) zt:p-0 zt:text-(length:--font-ui-small)">
                {item.files.map((file) => (
                  <li key={file.key} className="zt:min-w-0">
                    <ReaderLink
                      readers={readers}
                      target={{ kind: "attachment", attachmentKey: file.key }}
                    >
                      <Icon
                        name={FILE_ICONS[file.fileType] ?? "paperclip"}
                        size="var(--icon-xs)"
                        className="zt:shrink-0"
                      />
                      <span className="zt:truncate">{file.title}</span>
                    </ReaderLink>
                  </li>
                ))}
              </ul>
            </Part>
          )}
          {item && item.notes.length > 0 && (
            <Part name="notes" label={m.library_view_card_notes()}>
              <ul className="zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-(--size-2-2) zt:p-0 zt:text-(length:--font-ui-small)">
                {item.notes.map((note) => (
                  <li
                    key={note.key}
                    className="zt:flex zt:min-w-0 zt:items-center zt:gap-1.5"
                  >
                    <Icon
                      name="sticky-note"
                      size="var(--icon-xs)"
                      className="zt:shrink-0 zt:text-muted-foreground"
                    />
                    <ZoteroNoteLink noteKey={note.key}>
                      {note.title}
                    </ZoteroNoteLink>
                  </li>
                ))}
              </ul>
            </Part>
          )}
          {item && item.annotations > 0 && (
            <div
              data-library-card-part="annotations"
              className="zt:-mx-(--size-2-2) zt:flex zt:flex-col zt:gap-(--size-2-2)"
            >
              <Disclosure
                name="annotations"
                icon="highlighter"
                open={disclosures.annotations}
                controls={annotationsId}
                onToggle={() =>
                  card.disclose("annotations", !disclosures.annotations)
                }
              >
                {m.library_view_card_annotation_count({
                  count: item.annotations,
                })}
              </Disclosure>
              <div id={annotationsId} hidden={!disclosures.annotations}>
                {/* The Annotation Cards mount once the row opens. */}
                {disclosures.annotations &&
                  (failed ? (
                    <div
                      role="alert"
                      className="zt:px-(--size-2-2) zt:text-(length:--font-ui-small) zt:text-(--text-error)"
                      data-library-card-failed=""
                    >
                      {m.library_view_card_failed()}
                    </div>
                  ) : (
                    <div data-library-card-annotations="">
                      <AnnotList collapsed />
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CopyCitationKey({ onCopy }: { onCopy: () => void }) {
  return (
    <IconButton
      icon="copy"
      className="zt:shrink-0"
      data-library-card-copy=""
      {...tooltipAttrs(m.library_view_card_copy_citation_key())}
      onClick={onCopy}
    />
  );
}
