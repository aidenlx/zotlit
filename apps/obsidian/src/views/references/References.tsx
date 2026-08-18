import type { IconName } from "obsidian";
import type { MouseEvent, ReactNode } from "react";

import { AmbiguousCandidates } from "@/components/ambiguous-candidates";
import { Button } from "@/components/obsidian/button";
import { IconButton } from "@/components/obsidian/icon-button";
import { SidebarToolbar } from "@/components/sidebar-toolbar";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";
import type { ReferenceSource } from "@/services/citation-index/service";
import type { UnusableProperty } from "@/services/pandoc/document-presentation";
import { InlineContent } from "@/services/pandoc/inline-content";
import type {
  PandocEngineFailure,
  PandocEngineStatus,
} from "@/services/pandoc/service";

import { useReferenceActions } from "./actions";
import type { ReferenceEntry } from "./entries";
import { useReferencesStore } from "./store";
import type { ReferencesCopyBlock } from "./store";

/**
 * The pane: the fixed toolbar above, then one scrolling region holding the
 * engine surface and the reference list. The list is a `ul` — a bare `ol` keeps
 * Obsidian's own unlayered numbering, which would double the numbers the
 * entries already carry.
 */
export function References() {
  const entries = useReferencesStore((s) => s.entries);
  const listMode = useReferencesStore((s) => s.listMode);
  const engine = useReferencesStore((s) => s.engine);
  const formattingFailed = useReferencesStore((s) => s.formattingFailed);
  const documentPresentationError = useReferencesStore(
    (s) => s.documentPresentationError,
  );
  const dbReady = useReferencesStore((s) => s.dbReady);
  const numbered = listMode.kind === "minimal";
  const serials = listMode.kind === "bibliography" && listMode.entrySerials;
  const guttered =
    numbered ||
    serials ||
    (listMode.kind === "bibliography" && listMode.hasEntryMarkers);

  return (
    <div className="zt:flex zt:h-full zt:flex-col zt:overflow-hidden">
      <Toolbar />
      <div
        className="zt:flex zt:min-h-0 zt:flex-1 zt:flex-col zt:overflow-y-auto"
        data-references-scroll
      >
        {/* The banners head this region rather than the pane, so they travel
            with the list they describe and the toolbar keeps its own place. */}
        <EngineSurface status={engine} />
        {/* The note itself is the repair, so this banner stands in front of
            the vault-level guidance the failure banner gives, and it names the
            property on that note the reader repairs. */}
        {documentPresentationError !== null && engine.kind === "installed" && (
          <Banner
            tone="warning"
            title={documentPresentationTitle(documentPresentationError)}
          >
            {documentPresentationBody(documentPresentationError)}
          </Banner>
        )}
        {formattingFailed && engine.kind === "installed" && (
          <Banner tone="warning" title={m.references_format_failed_title()}>
            {m.references_format_failed_body()}
          </Banner>
        )}
        {entries.length === 0 ? (
          <div
            className="zt:mx-auto zt:my-2 zt:px-4 zt:py-6 zt:text-center zt:text-sm zt:text-faint"
            data-references-empty
          >
            {dbReady ? m.references_empty() : m.references_db_unavailable()}
          </div>
        ) : (
          <ul
            className={cn(
              "zt:grid zt:gap-x-2 zt:text-sm",
              guttered
                ? "zt:grid-cols-[max-content_minmax(0,1fr)_max-content]"
                : "zt:grid-cols-[minmax(0,1fr)_max-content]",
            )}
          >
            {entries.map((entry) => (
              <Reference
                key={entry.id}
                entry={entry}
                numbered={numbered}
                serials={serials}
                guttered={guttered}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The pane-wide actions, outside the scrolling region so they stay reachable in
 * a long bibliography. The style action answers for the pane as a whole and
 * stays live in every state; copy answers for the current bibliography, so it
 * follows the list's copy readiness and says why when it cannot.
 */
function Toolbar() {
  const actions = useReferenceActions();
  const copy = useReferencesStore((s) => s.copy);
  const copyReady = copy.kind === "ready";

  return (
    <SidebarToolbar className="zt:shrink-0">
      <SidebarToolbar.Actions className="zt:w-full">
        <IconButton
          icon="clipboard-copy"
          data-references-copy-bibliography
          disabled={!copyReady}
          {...tooltipAttrs(
            copyReady
              ? m.references_copy_bibliography()
              : copyBlockedReason(copy.reason),
          )}
          onClick={() => {
            if (copy.kind === "ready") {
              void actions.onCopyBibliography(copy.target);
            }
          }}
        />
        <IconButton
          icon="book-type"
          data-references-change-style
          {...tooltipAttrs(m.references_change_style())}
          onClick={actions.onChangeStyle}
        />
      </SidebarToolbar.Actions>
    </SidebarToolbar>
  );
}

/** The note property a document-scoped presentation failure asks the reader to repair. */
function documentPresentationTitle(property: UnusableProperty): string {
  return property === "language"
    ? m.references_document_language_failed_title()
    : m.references_document_style_failed_title();
}

function documentPresentationBody(property: UnusableProperty): string {
  return property === "language"
    ? m.references_document_language_failed_body()
    : m.references_document_style_failed_body();
}

/** What the disabled copy action names in its tooltip as the thing to fix. */
function copyBlockedReason(reason: ReferencesCopyBlock): string {
  switch (reason) {
    case "no-note":
      return m.references_copy_blocked_no_note();
    case "no-references":
      return m.references_copy_blocked_no_references();
    case "pending":
      return m.references_copy_blocked_pending();
    case "unavailable":
      return m.references_copy_blocked_unavailable();
    case "failed":
      return m.references_copy_blocked_failed();
    case "errors":
      return m.references_copy_blocked_errors();
  }
}

/**
 * Fades a secondary action in on hover or keyboard focus. The opening delay
 * sits only on the hover variant, so collapsing and keyboard focus both stay
 * instant. Shared, so every action in a row reveals on the same beat.
 */
const revealOnHover =
  "zt:opacity-0 zt:transition-opacity zt:delay-0 zt:duration-150 zt:group-focus-within:opacity-100 zt:group-hover:opacity-100 zt:group-hover:delay-100";

/**
 * A clickable-icon defaults to ribbon proportions — an 18px glyph in a 30x26
 * box — which dwarfs the 13px text it sits beside in this pane. Trim the glyph
 * and the box so an icon button reads as a footnote to the text. `--icon-xs`
 * carries that 14px on the desktop and Obsidian's larger touch size on mobile.
 */
const compactIconButton = "zt:p-1 zt:[--icon-size:var(--icon-xs)]";

/**
 * A flat row: the gutter, entry text with a hover/focus-revealed toolbar
 * underneath, and an action column on the right. The text is inert and
 * selectable — it renders what the engine formatted, so it can be copied out
 * whole. Nothing the reader can act on overlaps the text.
 *
 * @param numbered whether the list carries Reference Numbers, which the minimal
 *   list does and an engine-rendered one leaves to the style.
 * @param serials whether the gutter carries Entry Serials, which it does for a
 *   document whose citations show them in place of the notes the style writes.
 * @param guttered whether the shared list grid includes its marker column.
 */
function Reference({
  entry,
  numbered,
  serials,
  guttered,
}: {
  entry: ReferenceEntry;
  numbered: boolean;
  serials: boolean;
  guttered: boolean;
}) {
  const actions = useReferenceActions();
  const presentation = referencePresentation(entry, { numbered, serials });
  const { source } = presentation;
  const occurrenceCount = entry.occurrences.length;

  return (
    <li className="zt:group zt:col-span-full zt:grid zt:grid-cols-subgrid zt:items-baseline zt:border-b zt:border-border zt:px-3 zt:py-2">
      {/* Every row participates in the same max-content column when the
          minimal list numbers its entries or the style supplies an Entry
          Marker. Reference Errors use that column but never create it. */}
      {guttered && (
        <span
          className={cn(
            "zt:min-w-5 zt:text-right zt:text-xs zt:text-muted-foreground zt:tabular-nums",
            presentation.warning && "zt:text-destructive",
          )}
        >
          {presentation.gutter}
        </span>
      )}
      <div className="zt:min-w-0">
        {/* Selectable, so a formatted entry can be copied out of the pane
              whole. Nothing else lives in this flow — the occurrence count
              rides with the jump button instead, where a selection cannot
              sweep it up. */}
        <div className="zt:select-text">
          <ReferenceBody entry={entry} />
        </div>
        {/* Collapsed to zero height as a class, never an inline style — an
              inline style on this element would outrank the hover/focus
              classes below and the toolbar could never open. The toolbar
              itself stays live on a missing entry, since the note button
              inside it still has somewhere to go. */}
        <div className="zt:grid zt:grid-rows-[0fr] zt:transition-[grid-template-rows] zt:delay-0 zt:duration-150 zt:ease-out zt:group-focus-within:grid-rows-[1fr] zt:group-hover:grid-rows-[1fr] zt:group-hover:delay-100">
          <div className={cn("zt:overflow-hidden", revealOnHover)}>
            <div className="zt:flex zt:items-center zt:gap-0.5 zt:pt-1">
              {/* The fade rides the shared wrapper above, never the button:
                    Obsidian's unlayered
                    `.clickable-icon[aria-disabled="true"] { opacity: .4 }`
                    outranks the whole utilities layer, so on a missing entry
                    an opacity class on the button itself loses and it would
                    sit permanently visible. That same rule is what dims the
                    button once revealed — disabled rather than hidden there,
                    so the row keeps its shape and the tooltip carries the
                    reason. */}
              <EntryAction
                icon="file-text"
                label={presentation.noteLabel}
                disabled={presentation.noteDisabled}
                onClick={() => actions.onOpenNote(entry)}
              />
              {source && (
                <>
                  <EntryAction
                    icon="external-link"
                    label={m.references_open_in_zotero()}
                    onClick={() => actions.onOpenInZotero(source)}
                  />
                  {/* Dropped outright when the Item stores nothing to open —
                        the row keeps "Open in Zotero" either way, so the
                        toolbar never empties. */}
                  {source.attachments.length > 0 && (
                    <EntryAction
                      icon="paperclip"
                      label={m.references_open_attachment()}
                      onClick={(event) =>
                        actions.onOpenAttachment(source, event)
                      }
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Live even on a missing entry: the citation is still in the document,
          and jumping to it is how the reader goes to fix it. */}
      <div className="zt:relative zt:self-start">
        <EntryAction
          icon="chevron-right"
          label={m.references_go_to_occurrence({ count: occurrenceCount })}
          onClick={() => actions.onSelect(entry)}
        />
        {/* The count rides in the button's top-left corner, which a chevron
            leaves empty, rather than beside it — a badge in the flow would
            widen the column on every multiply-cited row. It is a visual echo
            only; the button's tooltip already says the count out loud, since
            a bare number reads as part of the citation rather than as a count
            of citations. */}
        {occurrenceCount > 1 && (
          <span
            aria-hidden
            className="zt:pointer-events-none zt:absolute zt:top-0 zt:left-0 zt:text-[0.625rem] zt:leading-none zt:text-muted-foreground zt:tabular-nums"
          >
            {occurrenceCount}
          </span>
        )}
      </div>
    </li>
  );
}

function referencePresentation(
  entry: ReferenceEntry,
  { numbered, serials }: { numbered: boolean; serials: boolean },
): {
  gutter: ReactNode;
  warning: boolean;
  noteLabel: string;
  noteDisabled: boolean;
  source: ReferenceSource | undefined;
} {
  switch (entry.kind) {
    case "rendered":
      return {
        // The Entry Marker is a formatted flow of the style's own, so it shows
        // through the same renderer as the entry it belongs to, and it keeps
        // the gutter wherever the style writes one. The Entry Serial takes the
        // gutter only where it stands for the note a citation cannot show.
        gutter: entry.marker ? (
          <InlineContent nodes={entry.marker} />
        ) : serials ? (
          entry.serial
        ) : undefined,
        warning: false,
        noteLabel: m.references_open_note(),
        noteDisabled: false,
        source: entry.source,
      };
    case "summary":
      return {
        gutter: numbered ? entry.refNumber : undefined,
        warning: false,
        noteLabel: m.references_open_note(),
        noteDisabled: false,
        source: entry.source,
      };
    case "unrendered":
      return {
        gutter: "⚠",
        warning: true,
        noteLabel: m.references_open_note(),
        noteDisabled: false,
        source: entry.source,
      };
    case "missing":
      return {
        gutter: "⚠",
        warning: true,
        noteLabel: m.references_open_note_missing(),
        noteDisabled: true,
        source: undefined,
      };
    case "unresolved":
      return {
        gutter: "⚠",
        warning: true,
        noteLabel: m.references_open_note_unresolved(),
        noteDisabled: true,
        source: undefined,
      };
    // The key names several Items, so no one note is this row's to open: the
    // whole-row action stays disabled and the candidates say why.
    case "ambiguous":
      return {
        gutter: "⚠",
        warning: true,
        noteLabel: m.references_open_note_ambiguous(),
        noteDisabled: true,
        source: undefined,
      };
    case "malformed":
      return {
        gutter: "⚠",
        warning: true,
        noteLabel: m.references_open_note_invalid_fragment(),
        noteDisabled: true,
        source: undefined,
      };
  }
}

function ReferenceBody({ entry }: { entry: ReferenceEntry }) {
  const textClass = "zt:font-content zt:text-sm zt:leading-snug zt:break-words";
  switch (entry.kind) {
    case "rendered":
      return (
        <span className={cn(textClass, "zt:text-foreground")}>
          <InlineContent nodes={entry.content} />
        </span>
      );
    case "summary":
    case "unrendered":
      return (
        <span className={cn(textClass, "zt:text-foreground")}>
          {entry.source.summary}
        </span>
      );
    case "missing":
      return (
        <span className={cn(textClass, "zt:text-destructive")}>
          {m.references_item_missing({
            linkpath: entry.linkpath ?? `@${entry.occurrences[0]!.raw}`,
          })}
        </span>
      );
    case "unresolved":
      return (
        <span className={cn(textClass, "zt:text-destructive")}>
          {m.references_citekey_unresolved({ citekey: entry.citekey })}
        </span>
      );
    // The candidates stand in place of the entry the key names none of, so the
    // reader can tell the Items apart in Zotero and fix the key there.
    case "ambiguous":
      return (
        <div className="zt:flex zt:flex-col zt:gap-1">
          <span className={cn(textClass, "zt:text-destructive")}>
            {m.references_citekey_ambiguous({ citekey: entry.citekey })}
          </span>
          <AmbiguousCandidates
            candidates={entry.candidates}
            textClass={textClass}
          />
        </div>
      );
    case "malformed":
      return (
        <span className={cn(textClass, "zt:text-destructive")}>
          {m.references_citation_fragment_invalid()}
        </span>
      );
  }
}

function EntryAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
}) {
  return (
    <IconButton
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      className={compactIconButton}
      {...tooltipAttrs(label)}
    />
  );
}

/**
 * The one surface the engine speaks through: the dismissible install hint while
 * the engine is merely absent, and one banner per genuine failure. Both sit
 * above the same reference list, which stays the sidebar's normal content.
 */
function EngineSurface({ status }: { status: PandocEngineStatus }) {
  const actions = useReferenceActions();

  switch (status.kind) {
    case "installed":
    case "declined":
      return null;
    case "absent":
      return (
        <Banner
          title={m.references_engine_hint_title()}
          action={
            <Button variant="cta" onClick={actions.onOpenEngineSettings}>
              {m.references_engine_open_settings()}
            </Button>
          }
          onDismiss={actions.onDismissEngineHint}
        >
          {m.references_engine_hint_body()}
        </Banner>
      );
    case "installing":
      return (
        <Banner title={m.notice_pandoc_engine_downloading()}>
          {m.settings_citation_engine_status_installing()}
        </Banner>
      );
    case "failed":
      return (
        <Banner
          tone="warning"
          title={m.references_engine_failed_title()}
          action={
            <Button variant="cta" onClick={actions.onOpenEngineSettings}>
              {m.references_engine_open_settings()}
            </Button>
          }
        >
          {failureSentence(status.failure)}
        </Banner>
      );
  }
}

/** One sentence per arm, shared with the settings row that offers the fix. */
function failureSentence(failure: PandocEngineFailure): string {
  switch (failure.code) {
    case "download-failed":
      return m.settings_citation_engine_status_download_failed({
        detail: failure.detail,
      });
    case "hash-mismatch":
      return m.settings_citation_engine_status_hash_mismatch();
    case "init-failed":
      return m.settings_citation_engine_status_init_failed({
        detail: failure.detail,
      });
  }
}

/**
 * A strip across the head of the pane, in the shape of the docs site banner: a
 * flat alternate surface flush with the pane edges, the message ranged left,
 * and the action and close button on the trailing edge. It scrolls with the
 * list it describes, so the list travels below it rather than through its
 * translucent tint and the toolbar above keeps its own place.
 */
function Banner({
  tone = "normal",
  title,
  action,
  onDismiss,
  children,
}: {
  /** @defaultValue 'normal' */
  tone?: "normal" | "warning";
  title: string;
  action?: ReactNode;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  return (
    // `bg-muted` (`--background-modifier-hover`) rather than a control token or
    // a fixed surface: it is a translucent tint, so the strip steps away from
    // whatever it is dropped on — either colour scheme, sidebar or main pane —
    // and separates itself from the list below with no bottom border.
    // `relative` carries the close button, which sits out of flow in the
    // corner.
    <div
      className="zt:relative zt:flex zt:shrink-0 zt:flex-col zt:gap-2 zt:bg-muted zt:p-3 zt:ps-6 zt:text-sm zt:leading-snug"
      data-references-banner
    >
      <div>
        {/* Only the title reserves the corner, and only while something sits in
            it — the message below it and the action row both run to the full
            inset either way. */}
        <div
          className={cn(
            "zt:font-medium",
            onDismiss && "zt:pe-6",
            tone === "warning" && "zt:text-warning",
          )}
        >
          {title}
        </div>
        {children}
      </div>
      {/* The action gets its own line, ranged right: sharing the message's line
          in a sidebar leaves the copy about half the pane to wrap in. */}
      {action && <div className="zt:flex zt:justify-end">{action}</div>}
      {onDismiss && (
        <IconButton
          // Out of flow in the corner, so nothing else in the strip shifts to
          // make room for it. Offset by the button's own 4px padding, so the
          // glyph — not its transparent hit box — lands on the same 12px
          // trailing inset the action is ranged against.
          className={cn("zt:absolute zt:end-2 zt:top-2", compactIconButton)}
          icon="x"
          onClick={onDismiss}
          {...tooltipAttrs(m.references_engine_hint_dismiss())}
        />
      )}
    </div>
  );
}
