// The Reading Card: the pane on the right of the Library View that shows the
// selected Item, laid out like the title page of a paper. Its header reads
// the paths the Papers row reads, its Annotations preview reads the first two
// Annotations alone, and "See all" opens the Annotation Cards of a second
// Query View whose Query Context is the Item, so editing, locks and the
// Editing Capability are the sidebar's. Its buttons run the operations of
// the row menu.
//
// @see apps/obsidian/docs/adr/0069-the-annotation-view-is-the-annotations-layout-of-the-query-view.md
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import { Component, Scope } from "obsidian";
import type { IconName } from "obsidian";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";

import { useUniqueId } from "@zotlit/ui";

import { Button } from "@/components/obsidian/button";
import { FirstLine, Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import { annotationColorLabel } from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";
import { itemTypeIcon } from "@/lib/item-type-icon";
import { cn, tooltipAttrs } from "@/lib/utils";
import { ViewRegistryProvider } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import type { TargetOpenGesture } from "@/services/attachment-open/actions";
import { AnnotList } from "@/views/annot-view/AnnotView";
import { viewTargetOpener } from "@/views/open-target";
import { serializeQueryFile } from "@/views/query-view/query-file";
import {
  LOADING_TEXT,
  ReaderLink,
  ZoteroNoteLink,
} from "@/views/query-view/table-layout";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps, QueryViewHost } from "@/views/query-view/view";

import type { CardItem, Values } from "./card-data";
import type { CardField } from "./card-fields";
import {
  makeCardModel,
  patchCard,
  cardLibraries,
  CardModelProvider,
  useCardState,
} from "./card-model";
import type { CardSession } from "./card-model";
import { FILTER_CHIP_LINE_CLASS, TAG_CHIP_CLASS } from "./chip";
import type { ReadingCardDisclosures } from "./document";
import type { ItemActions } from "./item-actions";
import { waitForRead } from "./model";
import type { MenuItem } from "./row-menu";

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
  registry: ViewRegistryHandle;
  items: ItemActions;
}

export interface ReadingCardHost {
  /** The row menu of the Item, under the button that asks for it. */
  menu: (item: MenuItem, button: HTMLElement) => void;
  /** Show the Item's Annotations in the sidebar Annotation View. */
  openInSidebar: (indexedKey: string) => void;
  /** Close the card, at any pane width, until a row asks for it again. */
  close: () => void;
  /** Keep a disclosure open or closed for the Library View. */
  keepDisclosure: (name: keyof ReadingCardDisclosures, open: boolean) => void;
  /** Select the tag `name` in the Tag Selector, beside any selected already. */
  selectTag: (name: string) => void;
  /** The values of the list's row of the Item `key`, where the list shows it. */
  row: (key: string) => Values | null;
  onEscape: NonNullable<QueryViewHost["layout"]>["onEscape"];
}

export class ReadingCard extends Component {
  readonly model;
  readonly registry;
  readonly query: QueryView;
  readonly #deps;
  readonly #host;
  readonly #scope: Scope;
  #release: (() => void) | null;
  readonly #waiting = new Set<() => void>();
  #annotationsOf: string | null = null;
  #shownKey: string | null = null;

  constructor(deps: ReadingCardDeps, host: ReadingCardHost) {
    super();
    this.#deps = deps;
    this.#host = host;
    this.registry = deps.registry;
    this.model = makeCardModel(host.row);
    this.#release = this.registry.mount(this.model.session);
    this.#scope = new Scope(deps.app.scope);
    this.query = new QueryView(deps, {
      scope: this.#scope,
      sourcePath: () => "",
      context: () => {
        const { key } = this.state;
        return key === null ? undefined : { item: key };
      },
      // The Item's own Library, which may lie outside the Library Scope.
      libraries: () => cardLibraries(this.state.key),
      // The card's query is fixed: nothing in it changes the text.
      save: () => {},
      layout: { onEscape: host.onEscape },
    });
  }

  get state() {
    return this.registry.get(this.model.state);
  }
  #patch(patch: Partial<CardSession>): void {
    this.registry.update(this.model.session, patchCard(patch));
  }

  /** Settles once the card and its open Annotations have landed. */
  get settled(): Promise<void> {
    return waitForRead(this.registry, this.model.loaded, this.#waiting).then(
      () => this.query.settled,
    );
  }

  override onload(): void {
    this.#release ??= this.registry.mount(this.model.session);
    this.addChild(this.query);
    this.register(
      this.registry.subscribe(this.model.state, ({ key, disclosures }) => {
        if (key !== this.#shownKey) {
          this.#shownKey = key;
          this.query.clear();
          this.#annotationsOf = null;
        }
        if (key !== null && disclosures.annotations) this.#readAnnotations();
      }),
    );
    this.register(() => {
      this.#release?.();
      this.#release = null;
    });
  }

  override onunload(): void {
    for (const finish of this.#waiting) finish();
  }

  render(el: HTMLElement): void {
    this.query.layout.render(
      el,
      <ViewRegistryProvider registry={this.registry}>
        <CardModelProvider value={this.model}>
          <CardBody card={this} />
        </CardModelProvider>
      </ViewRegistryProvider>,
    );
    const keys = this.#deps.cardFocus.hold(el, this.#scope, this.query);
    this.register(() => keys[Symbol.dispose]());
  }

  show(key: string | null): void {
    this.#patch({ key });
  }

  showDisclosures(disclosures: ReadingCardDisclosures): void {
    this.#patch({ disclosures });
  }

  disclose(name: keyof ReadingCardDisclosures, open: boolean): void {
    const { disclosures } = this.state;
    this.#patch({ disclosures: { ...disclosures, [name]: open } });
    this.#host.keepDisclosure(name, open);
  }

  /** Read the shown Item's Annotations, once for each Item. */
  #readAnnotations(): void {
    const { key } = this.state;
    if (key === null || this.#annotationsOf === key) return;
    this.#annotationsOf = key;
    this.query.setText(readingCardQueryText());
    this.query.contextChanged();
  }

  get items(): ItemActions {
    return this.#deps.items;
  }

  get readers(): TargetOpenGesture {
    return viewTargetOpener(this.registry, this.#deps.opener);
  }

  get host(): ReadingCardHost {
    return this.#host;
  }
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
}: {
  name: string;
  label: string;
  children: ReactNode;
}) {
  const id = useUniqueId();
  return (
    <section
      aria-labelledby={id}
      data-library-card-part={name}
      className="zt:flex zt:flex-col zt:gap-(--size-2-2)"
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
function Fields({ fields, id }: { fields: readonly CardField[]; id?: string }) {
  return (
    <dl id={id} className="zt:m-0 zt:grid zt:grid-cols-1 zt:gap-y-(--size-4-2)">
      {fields.map((field) => (
        <div key={field.name} data-library-card-fact={field.name}>
          <dt className={LABEL}>{field.label}</dt>
          <dd className="zt:m-0 zt:min-w-0 zt:text-(length:--font-ui-small) zt:break-words zt:whitespace-pre-line zt:select-text">
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
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A native button, drawn as a link, that opens and closes the body `controls`
 * names. Its chevron points to the side while the body is shut and down while
 * it is open, as the tree's do. `className` sets its size and its place.
 */
function Disclosure({
  name,
  open,
  controls,
  onToggle,
  className,
  children,
}: {
  name: string;
  open: boolean;
  controls: string;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      data-library-card-toggle={name}
      onClick={onToggle}
      className={cn(
        "zt-library-card-toggle zt:inline-flex zt:cursor-(--cursor) zt:items-center zt:gap-0.5 zt:rounded-(--radius-s) zt:text-xs zt:text-(--text-accent) zt:hover:underline",
        FOCUS_RING,
        className,
      )}
    >
      {children}
      <Icon name={open ? "chevron-down" : "chevron-right"} size="xs" />
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

/** A quiet chip: a tag, the DOI, the citation key. */
const CHIP =
  "zt:inline-flex zt:max-w-full zt:min-w-0 zt:items-center zt:gap-1 zt:rounded-(--radius-l) zt:bg-(--background-modifier-hover) zt:px-(--size-4-2) zt:py-0.5 zt:text-xs zt:text-(--text-normal)";

/** The focus ring of a control drawn on an element of its own. */
const FOCUS_RING =
  "zt:outline-hidden zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]";

/**
 * One line of the card's info: a small icon, then what it holds, named for a
 * screen reader by a heading only it reads.
 */
function InfoLine({
  name,
  label,
  icon,
  chips = false,
  children,
}: {
  name: string;
  label: string;
  icon: IconName;
  /** The line holds chips, so its icon centres on a chip's height. */
  chips?: boolean;
  children: ReactNode;
}) {
  const id = useUniqueId();
  return (
    <section
      aria-labelledby={id}
      data-library-card-part={name}
      className="zt:flex zt:min-w-0 zt:items-start zt:gap-(--size-4-2)"
    >
      <FirstLine
        className={
          chips ? FILTER_CHIP_LINE_CLASS : "zt:text-(length:--font-ui-small)"
        }
      >
        <Icon
          name={icon}
          size="xs"
          className="zt:shrink-0 zt:text-muted-foreground"
        />
      </FirstLine>
      {/* Obsidian's unlayered `h3` rule would outrank the heading's size. */}
      <div role="heading" aria-level={3} id={id} className="zt:sr-only">
        {label}
      </div>
      <div className="zt:min-w-0 zt:flex-1 zt:text-(length:--font-ui-small)">
        {children}
      </div>
    </section>
  );
}

function CardBody({ card }: { card: ReadingCard }) {
  const key = useCardState((s) => s.key);
  const item = useCardState((s) => s.item);
  const loading = useCardState((s) => s.loading);
  const noted = useCardState((s) => s.noted);
  const disclosures = useCardState((s) => s.disclosures);
  const titleId = useUniqueId();
  const fieldsId = useUniqueId();
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
  const hasInfo =
    !!item &&
    (item.where.length > 0 ||
      item.tags.length > 0 ||
      item.files.length > 0 ||
      item.notes.length > 0 ||
      item.added !== null ||
      item.fields.length > 0);
  // The card's 16 px inline padding keeps what ends a line, the close
  // button and the colour counts, clear of an overlay scrollbar, so the card
  // takes no `scroll-gutter`: on macOS that would cut its end padding to
  // Obsidian's 12 px scrollbar width.
  return (
    <section
      className="zt:flex zt:h-full zt:min-h-0 zt:flex-col zt:overflow-y-auto zt:px-(--size-4-4) zt:pt-(--size-4-4) zt:pb-(--size-4-8)"
      aria-labelledby={titleId}
    >
      <div className="zt:flex zt:flex-col">
        <div className="zt:flex zt:min-h-(--icon-size) zt:items-center zt:gap-(--size-2-2)">
          {item?.type && (
            <div
              className="zt:flex zt:min-w-0 zt:flex-1 zt:items-center zt:gap-1.5 zt:text-xs zt:font-(--font-medium) zt:tracking-[0.06em] zt:text-muted-foreground zt:uppercase"
              data-library-card-part="type"
            >
              {/* The icon of the Item type, from the map the Papers rows use. */}
              <Icon
                name={itemTypeIcon(item.itemType)}
                size="xs"
                className="zt:shrink-0"
                data-library-card-type-icon={itemTypeIcon(item.itemType)}
              />
              <span className="zt:truncate">{item.type}</span>
            </div>
          )}
          {/* The card puts itself away here at every pane width: over a
              narrow list it uncovers the list, and beside a wide one the
              list takes its room until a row is asked for again. */}
          <span className="zt:ms-auto zt:flex">
            <IconButton
              icon="x"
              data-library-card-close=""
              {...tooltipAttrs(m.library_view_card_close())}
              onClick={host.close}
            />
          </span>
        </div>
        <div
          role="heading"
          aria-level={2}
          id={titleId}
          className="zt:m-0 zt:mt-(--size-2-3) zt:font-(family-name:--zt-font-display) zt:text-base zt:leading-[1.3] zt:font-(--font-semibold) zt:text-balance zt:break-words zt:text-(--text-normal) zt:select-text"
          data-library-card-title=""
        >
          {item?.title}
        </div>
        {item?.creators && (
          <div
            className="zt:mt-(--size-2-3) zt:text-(length:--font-ui-small) zt:break-words zt:text-(--text-normal) zt:select-text"
            data-library-card-creators=""
          >
            {item.creators}
          </div>
        )}
        {item?.venue && (
          <div
            className="zt:mt-(--size-2-1) zt:text-(length:--font-ui-small) zt:break-words zt:text-muted-foreground zt:italic zt:select-text"
            data-library-card-venue=""
          >
            {item.venue}
          </div>
        )}
        {item && (item.doi || item.citationKey) && (
          <div
            className="zt:mt-(--size-4-3) zt:flex zt:flex-wrap zt:items-center zt:gap-(--size-2-3)"
            data-library-card-part="ids"
          >
            {item.doi && (
              <a
                className={cn(
                  CHIP,
                  FOCUS_RING,
                  "zt:no-underline zt:hover:bg-(--background-modifier-active-hover)",
                )}
                href={item.doi.href}
                target="_blank"
                rel="noopener noreferrer"
                data-library-card-doi=""
              >
                <Icon
                  name="link"
                  size="xs"
                  className="zt:shrink-0 zt:text-muted-foreground"
                />
                <span className="zt:truncate">{`doi:${item.doi.text}`}</span>
              </a>
            )}
            {item.citationKey && (
              <span
                className={cn(CHIP, "zt:pe-0.5")}
                data-library-card-citekey=""
              >
                <Icon
                  name="at-sign"
                  size="xs"
                  className="zt:shrink-0 zt:text-muted-foreground"
                />
                <span className="zt:truncate zt:select-text">
                  {item.citationKey}
                </span>
                <CopyCitationKey onCopy={() => items.copyCitationKey(key)} />
              </span>
            )}
          </div>
        )}
        <div className="zt:mt-(--size-4-4) zt:flex zt:flex-wrap zt:items-center zt:gap-(--size-2-2)">
          {/* Open PDF leads where there is a PDF; without one, the
              Literature Note is the primary action. */}
          {item?.pdf && (
            <Button
              variant="cta"
              icon="file-text"
              data-library-card-action="pdf"
              onClick={() => items.openPdf(key, false)}
            >
              {m.library_view_menu_open_pdf()}
            </Button>
          )}
          <Button
            {...(!item?.pdf && { variant: "cta" as const })}
            icon={noted ? "notebook-pen" : "file-plus"}
            data-library-card-action="note"
            onClick={() => items.openNote(key, false)}
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
              host.menu(
                { indexedKey: key, pdf: item?.pdf ?? false },
                event.currentTarget,
              )
            }
          />
          {/* The annotation view's own icon, so the button names where it
              leads. */}
          <IconButton
            icon="highlighter"
            data-library-card-action="sidebar"
            {...tooltipAttrs(m.library_view_card_open_in_annot_view())}
            onClick={() => host.openInSidebar(key)}
          />
        </div>
      </div>
      {loading ? (
        <div
          data-library-card-loading=""
          style={
            {
              "--zt-card-body-height": `${bodyHeight.current}px`,
            } as CSSProperties
          }
          className="zt:mt-(--size-4-4) zt:min-h-(--zt-card-body-height) zt:border-t-(length:--border-width) zt:border-(--background-modifier-border) zt:pt-(--size-4-4) zt:text-(length:--font-ui-small) zt:text-muted-foreground"
        >
          <span className={LOADING_TEXT}>{m.query_view_table_loading()}</span>
        </div>
      ) : (
        // Sections parted by thin rules: the abstract, the info, and the
        // Annotations; a part with nothing in it is left out with its rule.
        <div
          ref={bodyRef}
          className="zt:mt-(--size-4-4) zt:flex zt:flex-col zt:divide-y-(length:--border-width) zt:divide-(--background-modifier-border) zt:border-t-(length:--border-width) zt:border-(--background-modifier-border) zt:empty:hidden zt:[&>*]:py-(--size-4-4) zt:[&>*:last-child]:pb-0"
        >
          {item?.abstract && <Abstract abstract={item.abstract} />}
          {item && hasInfo && (
            <div className="zt:flex zt:flex-col zt:gap-(--size-4-3)">
              {item.where.length > 0 && (
                <InfoLine
                  name="where"
                  label={m.library_view_card_where()}
                  icon={
                    item.where.some((path) => path.length > 1)
                      ? "folder"
                      : "library"
                  }
                >
                  <ul className="zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-(--size-2-1) zt:p-0">
                    {item.where.map((path) => (
                      <li
                        key={path.join("\u0000")}
                        className="zt:break-words"
                        data-library-card-path=""
                      >
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
                      </li>
                    ))}
                  </ul>
                </InfoLine>
              )}
              {item.tags.length > 0 && (
                <InfoLine
                  name="tags"
                  label={m.library_view_card_tags()}
                  icon="tag"
                  chips
                >
                  <ul className="zt:m-0 zt:flex zt:list-none zt:flex-wrap zt:gap-(--size-2-2) zt:p-0">
                    {/* A tag selects itself in the Tag Selector, which narrows
                      the list to the papers that carry it, and is drawn as
                      the Tag Selector draws it. Obsidian's unlayered
                      `button` rules outrank the chip's utilities, so the
                      chip is a `role="button"` of its own. */}
                    {item.tags.map((tag) => (
                      <li key={tag} className="zt:flex zt:max-w-full">
                        <span
                          role="button"
                          tabIndex={0}
                          data-library-card-tag={tag}
                          className={TAG_CHIP_CLASS}
                          {...tooltipAttrs(
                            m.library_view_card_tag_filter({ tag }),
                          )}
                          onClick={() => host.selectTag(tag)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ")
                              return;
                            event.preventDefault();
                            host.selectTag(tag);
                          }}
                        >
                          {tag}
                        </span>
                      </li>
                    ))}
                  </ul>
                </InfoLine>
              )}
              {item.files.length > 0 && (
                <InfoLine
                  name="files"
                  label={m.library_view_card_files()}
                  icon="paperclip"
                >
                  <ul className="zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-(--size-2-1) zt:p-0">
                    {item.files.map((file) => (
                      <li key={file.key} className="zt:min-w-0">
                        <ReaderLink
                          readers={readers}
                          target={{
                            kind: "attachment",
                            attachmentKey: file.key,
                          }}
                        >
                          <Icon
                            name={FILE_ICONS[file.fileType] ?? "file"}
                            size="xs"
                            className="zt:shrink-0"
                          />
                          <span className="zt:truncate">{file.title}</span>
                        </ReaderLink>
                      </li>
                    ))}
                  </ul>
                </InfoLine>
              )}
              {item.notes.length > 0 && (
                <InfoLine
                  name="notes"
                  label={m.library_view_card_notes()}
                  icon="sticky-note"
                >
                  <ul className="zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-(--size-2-1) zt:p-0">
                    {item.notes.map((note) => (
                      <li key={note.key} className="zt:flex zt:min-w-0">
                        <ZoteroNoteLink noteKey={note.key}>
                          {note.title}
                        </ZoteroNoteLink>
                      </li>
                    ))}
                  </ul>
                </InfoLine>
              )}
              {(item.added !== null || item.fields.length > 0) && (
                <div
                  data-library-card-part="footer"
                  className="zt:flex zt:flex-col zt:gap-(--size-4-2)"
                >
                  <div className="zt:flex zt:flex-wrap zt:items-center zt:justify-between zt:gap-(--size-2-2) zt:text-xs zt:text-muted-foreground">
                    {item.added !== null && (
                      <span data-library-card-added="">
                        {m.library_view_card_added({ date: item.added })}
                      </span>
                    )}
                    {item.fields.length > 0 && (
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
                    )}
                  </div>
                  {item.fields.length > 0 &&
                    (disclosures.allFields ? (
                      <div data-library-card-part="fields">
                        <Fields fields={item.fields} id={fieldsId} />
                      </div>
                    ) : (
                      <div id={fieldsId} hidden />
                    ))}
                </div>
              )}
            </div>
          )}
          {item && item.annotations > 0 && (
            <Annotations
              card={card}
              item={item}
              open={disclosures.annotations}
            />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * "Your annotations": the count of each colour, the first two Annotations
 * as quotes, and "See all", which mounts the Annotation Cards.
 */
function Annotations({
  card,
  item,
  open,
}: {
  card: ReadingCard;
  item: CardItem;
  open: boolean;
}) {
  const failed = useSyncExternalStore(
    card.query.state.subscribe,
    () => card.query.state.getState().phase === "failed",
  );
  const headingId = useUniqueId();
  const coloursId = useUniqueId();
  const cardsId = useUniqueId();
  return (
    <section
      aria-labelledby={headingId}
      data-library-card-part="annotations"
      className="zt:flex zt:flex-col zt:gap-(--size-4-3)"
    >
      <div className="zt:flex zt:flex-wrap zt:items-center zt:justify-between zt:gap-(--size-2-2)">
        <div role="heading" aria-level={3} id={headingId} className={LABEL}>
          {m.library_view_card_your_annotations()}
        </div>
        {item.colours.length > 0 && (
          <>
            <span id={coloursId} className="zt:sr-only">
              {m.library_view_card_colours()}
            </span>
            <ul
              aria-labelledby={coloursId}
              className="zt:m-0 zt:flex zt:list-none zt:flex-wrap zt:items-center zt:gap-(--size-4-2) zt:p-0 zt:text-xs zt:text-muted-foreground zt:tabular-nums"
              data-library-card-colours=""
            >
              {item.colours.map(({ color, count }) => (
                <li
                  key={color}
                  className="zt:flex zt:items-center zt:gap-1"
                  data-library-card-colour={color}
                  style={{ "--zt-annot-color": color } as CSSProperties}
                >
                  <span
                    aria-hidden="true"
                    className="zt:size-2.5 zt:rounded-[2px] zt:bg-(--zt-annot-color)"
                  />
                  <span className="zt:sr-only">{`${annotationColorLabel(color)}: `}</span>
                  {count}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {!open && item.quotes.length > 0 && (
        <ul className="zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-(--size-4-2) zt:p-0">
          {item.quotes.map((quote) => (
            <li
              key={quote.key}
              data-library-card-quote={quote.kind}
              style={
                {
                  "--zt-annot-color":
                    quote.color || "var(--background-modifier-border)",
                } as CSSProperties
              }
              className="zt:border-s-[3px] zt:border-(--zt-annot-color) zt:ps-(--size-4-2) zt:text-(length:--font-ui-small)"
            >
              {quote.kind === "image" ? (
                // An area or a drawing has no text: its kind and its page
                // share one line.
                <p className="zt:m-0 zt:text-muted-foreground">
                  {[
                    quote.text,
                    quote.page === ""
                      ? ""
                      : m.annot_view_page({ page: quote.page }),
                  ]
                    .filter((part) => part !== "")
                    .join(" · ")}
                </p>
              ) : (
                <>
                  <p className="zt:m-0 zt:line-clamp-3 zt:leading-(--line-height-normal) zt:break-words zt:whitespace-pre-line zt:select-text">
                    {quote.kind === "quote" ? `“${quote.text}”` : quote.text}
                  </p>
                  {(quote.page !== "" || quote.kind === "note") && (
                    <div
                      className="zt:mt-0.5 zt:text-xs zt:text-muted-foreground"
                      data-library-card-quote-page=""
                    >
                      {[
                        quote.page === ""
                          ? ""
                          : m.annot_view_page({ page: quote.page }),
                        quote.kind === "note"
                          ? m.library_view_card_annotation_note()
                          : "",
                      ]
                        .filter((part) => part !== "")
                        .join(" · ")}
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Disclosure
        name="annotations"
        open={open}
        controls={cardsId}
        onToggle={() => card.disclose("annotations", !open)}
        className="zt:self-start zt:text-(length:--font-ui-small)"
      >
        {open
          ? m.library_view_card_hide_annotations()
          : m.library_view_card_see_all({ count: item.annotations })}
      </Disclosure>
      <div id={cardsId} hidden={!open} className="zt:-mx-(--size-2-2)">
        {/* The Annotation Cards mount once "See all" opens them. */}
        {open &&
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
    </section>
  );
}

function CopyCitationKey({ onCopy }: { onCopy: () => void }) {
  return (
    <IconButton
      icon="copy"
      size="xs"
      className="zt:shrink-0 zt:p-(--size-2-1)"
      data-library-card-copy=""
      {...tooltipAttrs(m.library_view_card_copy_citation_key())}
      onClick={onCopy}
    />
  );
}
