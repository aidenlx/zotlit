// The Reading Card: the pane on the right of the Library View that shows the
// selected Item. Its bibliographic line reads as the Papers row reads it, its
// Annotations are the Annotation Cards of a second Query View whose Query
// Context is the Item, so editing, locks and the Editing Capability are the
// sidebar's, and its buttons run the operations of the row menu.
//
// @see apps/obsidian/docs/adr/0069-the-annotation-view-is-the-annotations-layout-of-the-query-view.md
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import { Component, Scope } from "obsidian";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { useUniqueId } from "@zotlit/ui";

import { Button } from "@/components/obsidian/button";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { cn, tooltipAttrs } from "@/lib/utils";
import type { QueryViewValue } from "@/services/item-query/query-view";
import type { LibraryScope } from "@/services/library-scope/scope";
import { AnnotList } from "@/views/annot-view/AnnotView";
import { metaText } from "@/views/query-view/papers-layout";
import { serializeQueryFile } from "@/views/query-view/query-file";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps, QueryViewHost } from "@/views/query-view/view";

import type { ItemActions } from "./item-actions";
import { libraryOf } from "./tree";

const logger = getLogger(["library-view", "reading-card"]);

/** The fields of the Item the card reads: the Papers row's line, and the abstract. */
const CARD_FIELDS = [
  "title",
  "creators",
  "date",
  "publicationTitle",
  "publisher",
  "abstractNote",
] as const;

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
  onEscape: NonNullable<QueryViewHost["layout"]>["onEscape"];
}

/** The Item as the card shows it. */
interface CardItem {
  title: string;
  /** Creators, year and Venue, as the Papers row's second line. */
  meta: string;
  abstract: string | null;
}

interface CardState {
  /** The Item shown, by Indexed Key; `null` hides the card. */
  key: string | null;
  /** The Item's fields; `null` until they are read, or where the read failed. */
  item: CardItem | null;
  /** Whether the vault holds the Item's Literature Note. */
  noted: boolean;
}

export class ReadingCard extends Component {
  readonly store = createStore<CardState>(() => ({
    key: null,
    item: null,
    noted: false,
  }));
  /** The card's Annotations: a Query View bound to the Item. */
  readonly query: QueryView;
  readonly #deps: ReadingCardDeps;
  readonly #host: ReadingCardHost;
  readonly #scope: Scope;
  #read: AbortController | null = null;
  #reading: Promise<void> = Promise.resolve();

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
      libraries: () => this.#libraries(),
      // The card's query is fixed: nothing in it changes the text.
      save: () => {},
      layout: { onEscape: host.onEscape },
    });
  }

  /** Settles once the card shows its Item and the Item's Annotations. Never rejects. */
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
    this.register(() => this.#read?.abort());
  }

  /** Draw the card into `el`; the card's own keys act while focus is in it. */
  render(el: HTMLElement): void {
    this.query.layout.render(el, <CardBody card={this} />);
    const keys = this.#deps.cardFocus.hold(el, this.#scope, this.query);
    this.register(() => keys[Symbol.dispose]());
  }

  /** Show the Item `key`, or nothing for `null`. */
  show(key: string | null): void {
    if (key === this.store.getState().key) return;
    this.#read?.abort();
    this.#read = null;
    this.store.setState({
      key,
      item: null,
      noted: key !== null && this.#deps.literatureNotes.find(key) !== null,
    });
    if (key === null) {
      this.query.clear();
      this.#reading = Promise.resolve();
      return;
    }
    this.query.setText(readingCardQueryText());
    this.query.contextChanged();
    const controller = new AbortController();
    this.#read = controller;
    this.#reading = this.#readItem(key, controller.signal);
  }

  /** Read the Item shown again, keeping its fields on screen until the read lands. */
  #reread(): void {
    const { key } = this.store.getState();
    if (key === null) return;
    this.#read?.abort();
    const controller = new AbortController();
    this.#read = controller;
    this.#reading = this.#readItem(key, controller.signal);
  }

  /** The Library of the Item shown. */
  #libraries(): LibraryScope {
    const { key } = this.store.getState();
    const library = key === null ? null : libraryOf(key);
    return { mode: "selected", libraries: library ? [library] : [] };
  }

  async #readItem(key: string, signal: AbortSignal): Promise<void> {
    try {
      const outcome = await this.#deps.query.run(
        {
          from: "items",
          filter: `${JSON.stringify([key])}.contains(indexedKey)`,
          fields: [...CARD_FIELDS],
          limit: 1,
          libraries: this.#libraries(),
        },
        signal,
      );
      if (signal.aborted) return;
      const values =
        outcome.kind === "result" ? outcome.result.rows?.[0]?.values : null;
      if (!values) return;
      this.store.setState({ item: cardItem(values) });
    } catch (error) {
      if (signal.aborted) return;
      logger.warn("The Reading Card could not read its Item", {
        indexedKey: key,
        error,
      });
    }
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

  get host(): ReadingCardHost {
    return this.#host;
  }
}

function cardItem(values: Readonly<Record<string, QueryViewValue>>): CardItem {
  const text = (value: QueryViewValue | undefined) =>
    typeof value === "string" ? value : "";
  const abstract = text(values.abstractNote).trim();
  return {
    title: text(values.title),
    meta: metaText(values),
    abstract: abstract === "" ? null : abstract,
  };
}

function CardBody({ card }: { card: ReadingCard }) {
  const key = useStore(card.store, (s) => s.key);
  const item = useStore(card.store, (s) => s.item);
  const noted = useStore(card.store, (s) => s.noted);
  const count = useStore(card.query.state, (s) =>
    s.phase === "ready" ? (s.results?.count ?? 0) : null,
  );
  const failed = useStore(card.query.state, (s) => s.phase === "failed");
  const titleId = useUniqueId();
  if (key === null) return null;
  const { items, host } = card;
  return (
    <section
      className="zt:flex zt:h-full zt:min-h-0 zt:flex-col"
      aria-labelledby={titleId}
    >
      {/* The Annotations take the lower half; with none, the Item takes it all. */}
      <div
        className={cn(
          "zt:flex zt:min-h-0 zt:flex-col zt:gap-(--size-4-2) zt:overflow-y-auto zt:px-(--size-4-3) zt:pt-(--size-4-3) zt:pb-(--size-4-2)",
          count !== 0 && "zt:max-h-1/2 zt:shrink-0",
        )}
      >
        <div className="zt:flex zt:items-start zt:gap-(--size-2-2)">
          <div
            role="heading"
            aria-level={2}
            id={titleId}
            className="zt:m-0 zt:min-w-0 zt:flex-1 zt:text-(length:--font-ui-medium) zt:leading-(--line-height-tight) zt:font-(--font-semibold)"
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
          className="zt:text-(length:--font-ui-small) zt:text-(--text-muted)"
          data-library-card-meta=""
        >
          {item?.meta}
        </div>
        <div className="zt:flex zt:flex-wrap zt:items-center zt:gap-(--size-2-2)">
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
        </div>
        {item?.abstract && (
          <p
            className="zt:m-0 zt:text-(length:--font-ui-small) zt:whitespace-pre-line zt:select-text"
            data-library-card-abstract=""
          >
            {item.abstract}
          </p>
        )}
      </div>
      {/* An Item with no Annotation shows no Annotations section. */}
      {failed ? (
        <div
          role="alert"
          className="zt:px-(--size-4-3) zt:py-(--size-4-2) zt:text-(length:--font-ui-small) zt:text-(--text-error)"
          data-library-card-failed=""
        >
          {m.library_view_card_failed()}
        </div>
      ) : (
        count !== 0 && (
          <>
            <div className="zt:flex zt:shrink-0 zt:items-center zt:justify-between zt:gap-(--size-2-2) zt:border-t-(length:--border-width) zt:border-(--divider-color) zt:px-(--size-4-3) zt:pt-(--size-4-2)">
              <div
                role="heading"
                aria-level={3}
                className="zt:m-0 zt:text-(length:--font-ui-smaller) zt:font-(--font-semibold) zt:text-(--text-muted)"
              >
                {m.library_view_card_annotations()}
                {count !== null && ` · ${count}`}
              </div>
              {count !== null && (
                <IconButton
                  icon="panel-right"
                  data-library-card-action="sidebar"
                  {...tooltipAttrs(m.library_view_card_open_in_sidebar())}
                  onClick={() => host.openInSidebar(key)}
                />
              )}
            </div>
            <AnnotList collapsed />
          </>
        )
      )}
    </section>
  );
}
