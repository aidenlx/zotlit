import type { IconName } from "obsidian";
import type { MouseEvent, ReactNode } from "react";

import { Button } from "@/components/obsidian/button";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { useDomContent } from "@/lib/sanitize-html";
import { cn, tooltipAttrs } from "@/lib/utils";
import type {
  PandocEngineFailure,
  PandocEngineStatus,
} from "@/services/pandoc/service";

import { useReferenceActions } from "./actions";
import type { ReferenceEntry } from "./entries";
import { useReferencesStore } from "./store";

/**
 * The pane: the engine surface above, the reference list below. The list is a
 * `ul` — a bare `ol` keeps Obsidian's own unlayered numbering, which would
 * double the numbers the entries already carry.
 */
export function References() {
  const entries = useReferencesStore((s) => s.entries);
  const engine = useReferencesStore((s) => s.engine);
  const dbReady = useReferencesStore((s) => s.dbReady);
  // Reference Numbers belong to the minimal list. Once the engine has formatted
  // an entry, the list reads as the style's own bibliography, and numbering the
  // rest of it would set a second numbering against the style's markers.
  const numbered = !entries.some((entry) => entry.kind === "rendered");

  return (
    <div className="zt:flex zt:h-full zt:flex-col zt:overflow-y-auto">
      <EngineSurface status={engine} />
      {entries.length === 0 ? (
        <div className="pane-empty zt:p-2">
          {dbReady ? m.references_empty() : m.references_db_unavailable()}
        </div>
      ) : (
        <ul className="zt:flex zt:flex-col zt:text-sm">
          {entries.map((entry) => (
            <Reference key={entry.id} entry={entry} numbered={numbered} />
          ))}
        </ul>
      )}
    </div>
  );
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
 */
function Reference({
  entry,
  numbered,
}: {
  entry: ReferenceEntry;
  numbered: boolean;
}) {
  const actions = useReferenceActions();
  // Both error states read the same way in the row: a warning gutter, and no
  // note to open. What differs is the sentence and the tooltip that say why.
  const inError = entry.kind === "missing" || entry.kind === "unresolved";
  const occurrenceCount = entry.occurrences.length;
  const gutter = gutterLabel(entry, numbered);

  return (
    <li>
      <div className="zt:group zt:flex zt:items-baseline zt:gap-2 zt:border-b zt:border-border zt:px-3 zt:py-2">
        {/* The gutter is only there when something numbers the entry: a style
            that numbers nothing gives the entry text the whole row instead of
            an empty column to start after. It holds its width for the numbers
            it does carry, and a marker wider than that widens its own row. */}
        {gutter !== undefined && (
          <span
            className={cn(
              "zt:min-w-5 zt:shrink-0 zt:text-right zt:text-xs zt:text-muted-foreground zt:tabular-nums",
              inError && "zt:text-destructive",
            )}
          >
            {gutter}
          </span>
        )}
        <div className="zt:min-w-0 zt:flex-1">
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
                  label={openNoteLabel(entry)}
                  disabled={inError}
                  onClick={() => actions.onOpenNote(entry)}
                />
                {(entry.kind === "rendered" || entry.kind === "summary") && (
                  <>
                    <EntryAction
                      icon="external-link"
                      label={m.references_open_in_zotero()}
                      onClick={() => actions.onOpenInZotero(entry.source)}
                    />
                    {/* Dropped outright when the Item stores nothing to open —
                        the row keeps "Open in Zotero" either way, so the
                        toolbar never empties. */}
                    {entry.source.attachments.length > 0 && (
                      <EntryAction
                        icon="paperclip"
                        label={m.references_open_attachment()}
                        onClick={(event) =>
                          actions.onOpenAttachment(entry.source, event)
                        }
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Live even on a missing entry: the citation is still in the
            document, and jumping to it is how the reader goes to fix it. */}
        <div className="zt:relative zt:shrink-0 zt:self-start">
          <EntryAction
            icon="chevron-right"
            label={m.references_go_to_occurrence({ count: occurrenceCount })}
            onClick={() => actions.onSelect(entry)}
          />
          {/* The count rides in the button's top-left corner, which a
              chevron leaves empty, rather than beside it — a badge in the
              flow would widen the column on every multiply-cited row. It is
              a visual echo only; the button's tooltip already says the count
              out loud, since a bare number reads as part of the citation
              rather than as a count of citations. */}
          {occurrenceCount > 1 && (
            <span
              aria-hidden
              className="zt:pointer-events-none zt:absolute zt:top-0 zt:left-0 zt:text-[0.625rem] zt:leading-none zt:text-muted-foreground zt:tabular-nums"
            >
              {occurrenceCount}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * What the gutter shows, or `undefined` to leave the row without one: the
 * style's own Entry Marker on a rendered entry, the Reference Number while the
 * list numbers its entries, and the warning state of a missing Item either way.
 */
function gutterLabel(
  entry: ReferenceEntry,
  numbered: boolean,
): string | number | undefined {
  switch (entry.kind) {
    case "rendered":
      return entry.marker;
    case "summary":
      return numbered ? entry.refNumber : undefined;
    case "missing":
    case "unresolved":
      return "⚠";
  }
}

/** Why the note button is there, or why it is dimmed. */
function openNoteLabel(entry: ReferenceEntry): string {
  switch (entry.kind) {
    case "rendered":
    case "summary":
      return m.references_open_note();
    case "missing":
      return m.references_open_note_missing();
    case "unresolved":
      return m.references_open_note_unresolved();
  }
}

function ReferenceBody({ entry }: { entry: ReferenceEntry }) {
  const textClass = "zt:font-content zt:text-sm zt:leading-snug";
  switch (entry.kind) {
    case "rendered":
      return (
        <RenderedEntry
          content={entry.content}
          className={cn(textClass, "zt:text-foreground")}
        />
      );
    case "summary":
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
  }
}

function RenderedEntry({
  content,
  className,
}: {
  content: DocumentFragment;
  className?: string;
}) {
  return (
    <span className={className} ref={useDomContent<HTMLSpanElement>(content)} />
  );
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
 * and the action and close button on the trailing edge. Sticky, so the notice
 * stays put while the reference list scrolls under it.
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
    // and separates itself from the list below with no bottom border. `z-1`
    // only has to clear the list, which sets no z-index of its own.
    <div className="zt:sticky zt:top-0 zt:z-1 zt:flex zt:shrink-0 zt:flex-col zt:gap-2 zt:bg-muted zt:p-3 zt:ps-6 zt:text-sm zt:leading-snug">
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
