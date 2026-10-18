// Welcome onboarding banner: the header, the update of ZotLit, the checklist of setup steps, the template conversion, the v1 Migration Prompt and the Zotero 10 Companion guidance, each as a section the store decides, and the Help Links whatever it shows.
import { join } from "node:path/posix";
import type { IconName } from "obsidian";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { CONVERTED_DEFAULT_PROFILE_DOCUMENT } from "@zotlit/templates/facade";
import { useUniqueId } from "@zotlit/ui";

import { Button } from "@/components/obsidian/button";
import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import { DOCS_COMPANION } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";

import { useWelcomeActions } from "./actions";
import {
  BLOG,
  CHANGELOG,
  COMMUNITY,
  DOCS_CITATIONS,
  DOCS_GETTING_STARTED,
  DOCS_TEMPLATES,
  GITHUB,
  MIGRATION_GUIDE,
  SPONSOR,
} from "./links";
import { templateMigrationNotice } from "./migration-notice";
import { bannerBadge, bannerSections, useWelcomeStore } from "./store";

/**
 * Where a setup step stands. Its icon and its words carry it: a check and
 * "Done", a spinner and "Looking for Zotero…", an alert and "We couldn't
 * find…"; the colour only repeats them.
 */
type StepState = "done" | "checking" | "warn" | "todo";

function markClass(state: StepState, open: boolean): string {
  switch (state) {
    case "done":
      return "zt:border-green zt:text-green";
    case "warn":
      return "zt:border-warning zt:text-warning";
    case "checking":
      return "zt:border-link zt:text-link";
    case "todo":
      return open
        ? "zt:border-primary zt:text-link"
        : "zt:border-border zt:text-muted-foreground";
  }
}

function StepHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="heading"
      aria-level={3}
      className={cn("zt:text-sm zt:font-semibold", className)}
    >
      {children}
    </div>
  );
}

const BADGE_TEXT = {
  upgraded: m.welcome_badge_upgraded,
  updated: m.welcome_badge_updated,
  "get-started": m.welcome_badge,
} satisfies Record<ReturnType<typeof bannerBadge>, () => string>;

function Header({ titleId }: { titleId: string }) {
  const actions = useWelcomeActions();
  const badge = BADGE_TEXT[useWelcomeStore(bannerBadge)]();
  return (
    <header className="zt:flex zt:items-start zt:gap-3">
      {/* The tagline joins the title's line where the pane is wide enough. */}
      <div className="zt:flex zt:min-w-0 zt:flex-1 zt:flex-wrap zt:items-center zt:gap-x-2.5 zt:gap-y-1">
        <span
          id={titleId}
          role="heading"
          aria-level={2}
          className="zt:text-base zt:font-bold"
        >
          ZotLit
        </span>
        {/* Text on the accent fill reads below 4.5:1 in either theme, so
            the accent keeps to the border. */}
        <span
          data-welcome-badge=""
          className="zt:rounded-full zt:border zt:border-primary zt:bg-muted zt:px-2 zt:py-0.5 zt:text-xs zt:text-foreground"
        >
          {badge}
        </span>
        <p className="zt:m-0 zt:text-sm zt:text-muted-foreground">
          {m.welcome_tagline()}
        </p>
      </div>
      <IconButton
        icon="x"
        data-welcome-dismiss=""
        {...tooltipAttrs(m.welcome_dismiss())}
        onClick={actions.dismiss}
      />
    </header>
  );
}

interface Step {
  id: string;
  state: StepState;
  title: string;
  /** What a done step settled on, after its title on the same line. */
  summary?: ReactNode;
  /** The text the step says while it is the next one. */
  body: ReactNode;
  action?: ReactNode;
}

const MARK_ICON: Record<Exclude<StepState, "todo">, IconName> = {
  done: "check",
  warn: "circle-alert",
  checking: "loader",
};

/**
 * The accent surface of the next setup step and of a callout that asks for an
 * action: one tint, so the banner's calls to act read as one family.
 */
const ACCENT_SURFACE = {
  background: "hsla(var(--interactive-accent-hsl), 0.07)",
  borderColor: "hsla(var(--interactive-accent-hsl), 0.35)",
};

/**
 * One row of the checklist: its mark, its title and its action at the end of
 * the line, so a done step can still be changed. A step that isn't done shows
 * its number; the next one wears the accent and adds its text under the title.
 */
function StepRow({
  step,
  number,
  open,
}: {
  step: Step;
  number: number;
  open: boolean;
}) {
  return (
    <li
      data-welcome-step={step.state}
      data-open={open ? "" : undefined}
      // A flex box, not a list item: Obsidian's unlayered `ol` rule sets a
      // decimal marker that `zt:list-none` cannot reach, and the mark already
      // carries the number.
      className="zt:flex zt:flex-col zt:gap-0.5 zt:rounded-lg zt:border zt:border-transparent zt:px-3 zt:py-1.5"
      style={open ? ACCENT_SURFACE : undefined}
    >
      <div className="zt:flex zt:min-h-7 zt:items-center zt:gap-2">
        <span
          className={cn(
            "zt:flex zt:size-5 zt:shrink-0 zt:items-center zt:justify-center zt:rounded-full zt:border-2 zt:text-xs zt:font-semibold zt:tabular-nums",
            markClass(step.state, open),
          )}
        >
          {step.state === "todo" ? (
            <span aria-hidden="true">{number}</span>
          ) : (
            <Icon
              name={MARK_ICON[step.state]}
              size="xs"
              className={
                step.state === "checking"
                  ? "zt:motion-safe:animate-spin"
                  : undefined
              }
            />
          )}
        </span>
        {/* One line however narrow the pane: the title keeps its width and
            the summary takes what is left, so it gives way first; the step's
            action reaches the full value. */}
        <div className="zt:flex zt:min-w-0 zt:flex-1 zt:items-baseline zt:gap-x-2 zt:overflow-hidden zt:whitespace-nowrap">
          <StepHeading className="zt:max-w-full zt:shrink-0 zt:truncate">
            {step.title}
          </StepHeading>
          {step.state === "done" ? (
            <span className="zt:sr-only">{m.welcome_step_done()}</span>
          ) : null}
          {!open && step.summary ? (
            <span className="zt:flex zt:min-w-0 zt:items-baseline zt:gap-1.5 zt:overflow-hidden zt:text-xs zt:text-muted-foreground">
              {step.summary}
            </span>
          ) : null}
        </div>
        {step.action ? <div className="zt:shrink-0">{step.action}</div> : null}
      </div>
      {open ? (
        <div className="zt:ms-7 zt:text-sm zt:text-pretty zt:text-muted-foreground">
          {step.body}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The setup steps as a checklist: Connect to Zotero (left out while the
 * Library View shows its not-found card, which says the same), the
 * literature-notes folder, and the library, which lists below the banner once
 * ZotLit reads Zotero's database. Only the first step that isn't done opens.
 */
function Checklist({ connect }: { connect: boolean }) {
  const connection = useWelcomeStore((s) => s.connection);
  const literatureFolder = useWelcomeStore((s) => s.literatureFolder);
  const folderDone = useWelcomeStore((s) => s.literatureFolderExists);
  const notFound = useWelcomeStore((s) => s.notFound);
  const actions = useWelcomeActions();
  const connected = connection.status === "connected";

  const steps: Step[] = [];
  if (connect) {
    steps.push({
      id: "connect",
      state:
        connection.status === "connected"
          ? "done"
          : connection.status === "missing"
            ? "warn"
            : "checking",
      title: m.welcome_step_connect_title(),
      summary:
        connection.status === "connected" ? (
          <>
            <code className="zt:max-w-60 zt:min-w-0 zt:shrink-[1000] zt:truncate zt:font-mono">
              {connection.path}
            </code>
            <span aria-hidden="true">·</span>
            {/* The count is short and says more than the path, so the path
                gives way first and the count keeps every character. */}
            <span className="zt:shrink-0">
              {m.welcome_step_connect_connected({
                count: connection.itemCount,
              })}
            </span>
          </>
        ) : undefined,
      body:
        connection.status === "checking" ? (
          <p className="zt:m-0 zt:motion-safe:animate-pulse">
            {m.welcome_step_connect_checking()}
          </p>
        ) : (
          <p className="zt:m-0">{m.welcome_step_connect_missing()}</p>
        ),
      action:
        connection.status === "connected" ? (
          <Button icon="settings" onClick={actions.openSettings}>
            {m.welcome_action_open_settings()}
          </Button>
        ) : connection.status === "missing" ? (
          <Button icon="folder-search" onClick={actions.locateZotero}>
            {m.welcome_action_locate()}
          </Button>
        ) : undefined,
    });
  }
  steps.push({
    id: "folder",
    state: folderDone ? "done" : "todo",
    title: m.welcome_step_folder_title(),
    summary: <span className="zt:truncate">{literatureFolder}</span>,
    body: (
      <p className="zt:m-0">
        {m.welcome_step_folder_body({ folder: literatureFolder })}
      </p>
    ),
    action: (
      <Button icon="folder" onClick={actions.pickFolder}>
        {m.welcome_action_pick_folder()}
      </Button>
    ),
  });
  steps.push({
    id: "library",
    state: connected ? "done" : "todo",
    title: m.welcome_step_library_title(),
    summary: connected ? (
      <span className="zt:truncate">{m.welcome_step_library_done()}</span>
    ) : undefined,
    body: <p className="zt:m-0">{m.welcome_step_library_body()}</p>,
    // The search is the Library View's own search box, which the not-found
    // state takes away.
    action: notFound ? undefined : (
      <Button icon="search" onClick={actions.searchLibrary}>
        {m.welcome_action_search()}
      </Button>
    ),
  });
  const next = steps.findIndex((step) => step.state !== "done");

  return (
    <ol className="zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-0.5 zt:p-0">
      {steps.map((step, index) => (
        <StepRow
          key={step.id}
          step={step}
          number={index + 1}
          open={index === next}
        />
      ))}
    </ol>
  );
}

/**
 * The setup steps once every one is done, beside a notice: one "Setup done"
 * line naming the Zotero data folder and the literature-notes folder, whose
 * "Show steps" opens the checklist under it.
 */
function FoldedChecklist({ connect }: { connect: boolean }) {
  const connection = useWelcomeStore((s) => s.connection);
  const literatureFolder = useWelcomeStore((s) => s.literatureFolder);
  const [open, setOpen] = useState(false);
  const stepsId = useUniqueId();
  return (
    <div className="zt:flex zt:flex-col zt:gap-0.5">
      <div
        data-welcome-setup-done=""
        className="zt:flex zt:min-h-7 zt:items-center zt:gap-2 zt:px-3 zt:py-1.5"
      >
        <span
          className={cn(
            "zt:flex zt:size-5 zt:shrink-0 zt:items-center zt:justify-center zt:rounded-full zt:border-2",
            markClass("done", false),
          )}
        >
          <Icon name="check" size="xs" />
        </span>
        <div className="zt:flex zt:min-w-0 zt:flex-1 zt:items-baseline zt:gap-x-2 zt:overflow-hidden zt:whitespace-nowrap">
          <span className="zt:shrink-0 zt:text-sm zt:font-semibold">
            {m.welcome_setup_done()}
          </span>
          <span className="zt:flex zt:min-w-0 zt:items-baseline zt:gap-1.5 zt:overflow-hidden zt:text-xs zt:text-muted-foreground">
            {connection.status === "connected" ? (
              <>
                <code className="zt:max-w-60 zt:min-w-0 zt:shrink-[1000] zt:truncate zt:font-mono">
                  {connection.path}
                </code>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span className="zt:truncate">
              {m.welcome_setup_done_folder({ folder: literatureFolder })}
            </span>
          </span>
        </div>
        <Button
          className="zt:shrink-0"
          icon={open ? "chevrons-down-up" : "chevrons-up-down"}
          aria-expanded={open}
          aria-controls={stepsId}
          onClick={() => setOpen((now) => !now)}
        >
          {open ? m.welcome_hide_steps() : m.welcome_show_steps()}
        </Button>
      </div>
      <div id={stepsId} hidden={!open}>
        {open ? <Checklist connect={connect} /> : null}
      </div>
    </div>
  );
}

/**
 * Obsidian's unlayered `a` rule colours and underlines every link above any
 * utility, so the colour stays inline; the rest is utilities.
 */
const LINK_COLOR = { color: "var(--text-normal)" };

function useOpenExternal(url: string) {
  const actions = useWelcomeActions();
  return (e: { preventDefault(): void }) => {
    e.preventDefault();
    actions.openExternal(url);
  };
}

const FOCUS_RING =
  "zt:focus-visible:ring-2 zt:focus-visible:ring-(--interactive-accent)";

/**
 * A Help Link tile: its icon in an accent square, its title, which names the
 * link, and a subtitle that describes it. The large tile holds both lines
 * beside its icon; a small one puts the subtitle under the icon and the title,
 * so it keeps to one line in the narrow column.
 */
function HelpTile({
  icon,
  url,
  title,
  subtitle,
  primary,
}: {
  icon: IconName;
  url: string;
  title: string;
  subtitle: string;
  primary?: boolean;
}) {
  const titleId = useUniqueId();
  const subtitleId = useUniqueId();
  return (
    <a
      href={url}
      onClick={useOpenExternal(url)}
      aria-labelledby={titleId}
      aria-describedby={subtitleId}
      style={{ ...LINK_COLOR, textDecoration: "none" }}
      className={cn(
        "zt:grid zt:min-w-0 zt:cursor-pointer zt:grid-cols-[auto_minmax(0,1fr)] zt:items-center zt:gap-x-2 zt:gap-y-0.5 zt:rounded-lg zt:border zt:bg-background zt:px-2.5 zt:py-1.5 zt:transition-colors zt:hover:border-(--background-modifier-border-hover) zt:hover:bg-(--background-modifier-hover)",
        FOCUS_RING,
        primary
          ? "zt:col-span-2 zt:gap-x-2.5 zt:border-primary zt:hover:border-primary"
          : // A tile in a row with a taller one keeps its title at the top.
            "zt:content-start zt:border-border",
      )}
    >
      <span
        className={cn(
          "zt:flex zt:items-center zt:justify-center zt:rounded-md zt:bg-[hsla(var(--interactive-accent-hsl),0.14)] zt:text-link",
          primary ? "zt:row-span-2 zt:size-8" : "zt:size-6",
        )}
      >
        <Icon name={icon} size={primary ? "s" : "xs"} />
      </span>
      <span id={titleId} className="zt:truncate zt:text-sm zt:font-semibold">
        {title}
      </span>
      {/* A small tile gives its subtitle the full width under the icon. */}
      <span
        id={subtitleId}
        className={cn(
          "zt:text-xs zt:text-muted-foreground",
          // Under 760px the small tiles keep their icon and title only.
          !primary && "zt:col-span-2 zt:@max-[760px]:hidden",
        )}
      >
        {subtitle}
      </span>
    </a>
  );
}

function TextLink({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a
      href={url}
      onClick={useOpenExternal(url)}
      style={{ ...LINK_COLOR, textDecorationLine: "underline" }}
      className={cn(
        "zt:inline-flex zt:cursor-pointer zt:items-center zt:gap-1 zt:rounded-sm zt:decoration-(--text-muted) zt:underline-offset-2 zt:hover:decoration-(--text-normal)",
        FOCUS_RING,
      )}
    >
      {children}
    </a>
  );
}

/**
 * The Help Links: the documentation and community tiles, then the news and
 * sponsor text links and, in the fresh state, the migration guide, whose
 * Migration Prompt says it in the upgraded state. They show whatever the
 * banner shows.
 */
function HelpLinks() {
  const migrationPending = useWelcomeStore((s) => s.migrationPending);
  const nameId = useUniqueId();
  return (
    <nav aria-labelledby={nameId} data-welcome-help="" className="zt:min-w-0">
      <span id={nameId} className="zt:sr-only">
        {m.welcome_help_links_name()}
      </span>
      <div className="zt:grid zt:grid-cols-2 zt:gap-2">
        <HelpTile
          primary
          icon="book-open"
          url={DOCS_GETTING_STARTED}
          title={m.welcome_docs_getting_started()}
          subtitle={m.welcome_help_getting_started_subtitle()}
        />
        <HelpTile
          icon="messages-square"
          url={COMMUNITY}
          title={m.welcome_link_discussions()}
          subtitle={m.welcome_help_discussions_subtitle()}
        />
        <HelpTile
          icon="star"
          url={GITHUB}
          title={m.welcome_help_github_title()}
          subtitle={m.welcome_help_github_subtitle()}
        />
        <HelpTile
          icon="layout-template"
          url={DOCS_TEMPLATES}
          title={m.welcome_docs_templates()}
          subtitle={m.welcome_help_templates_subtitle()}
        />
        <HelpTile
          icon="quote"
          url={DOCS_CITATIONS}
          title={m.welcome_docs_citations()}
          subtitle={m.welcome_help_citations_subtitle()}
        />
      </div>
      <div className="zt:mt-2 zt:flex zt:flex-wrap zt:items-center zt:gap-x-3 zt:gap-y-1 zt:text-xs">
        <TextLink url={BLOG}>{m.welcome_link_blog()}</TextLink>
        <TextLink url={CHANGELOG}>{m.welcome_link_changelog()}</TextLink>
        <TextLink url={SPONSOR}>
          <Icon name="heart" size="xs" className="zt:text-pink" />
          {m.welcome_link_sponsor()}
        </TextLink>
        {migrationPending ? null : (
          <span className="zt:text-muted-foreground">
            {m.welcome_footer_migration_lead()}{" "}
            <TextLink url={MIGRATION_GUIDE}>
              {m.welcome_footer_migration_link()}
            </TextLink>
          </span>
        )}
      </div>
    </nav>
  );
}

/**
 * A titled callout, in the shape of the open setup step: its title and its
 * action on one line, the action at the end, and its text underneath at the
 * full width of the card, so no column stands empty beside a short body. Where
 * the title and the action don't fit on one line, the action wraps under the
 * title. One that asks for an action wears the accent; one that informs sits on
 * the surface of the Help Links.
 */
function Callout({
  tone,
  title,
  action,
  children,
}: {
  tone: "accent" | "muted";
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "zt:flex zt:flex-col zt:gap-0.5 zt:rounded-lg zt:border zt:px-3 zt:py-2",
        tone === "muted" && "zt:border-border zt:bg-background",
      )}
      style={tone === "accent" ? ACCENT_SURFACE : undefined}
    >
      <div className="zt:flex zt:min-h-7 zt:flex-wrap zt:items-center zt:justify-between zt:gap-x-3 zt:gap-y-1.5">
        <StepHeading className="zt:min-w-0">{title}</StepHeading>
        {action ? <div className="zt:shrink-0">{action}</div> : null}
      </div>
      <div className="zt:text-sm zt:text-pretty zt:text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

/**
 * The longer explanation of a notice, folded behind "How it works" so the
 * notice reads as one sentence and its action.
 */
function HowItWorks({ children }: { children: ReactNode }) {
  return (
    <details className="zt:group/how zt:mt-1">
      <summary className="zt:inline-flex zt:cursor-(--cursor) zt:list-none zt:items-center zt:gap-1 zt:rounded-sm zt:text-xs zt:text-(--text-normal) zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none zt:[&::-webkit-details-marker]:hidden">
        <Icon
          name="right-triangle"
          size="xs"
          className="zt:shrink-0 zt:[rotate:calc(var(--direction)*-90deg)] zt:text-(--nav-collapse-icon-color) zt:group-open/how:[rotate:none]"
        />
        {m.welcome_how_it_works()}
      </summary>
      <p className="zt:mt-1 zt:mb-0">{children}</p>
    </details>
  );
}

/** The update of ZotLit: its version, and the Release Note that says what changed. */
function UpdateCallout() {
  const actions = useWelcomeActions();
  const version = useWelcomeStore((s) => s.version);
  return (
    <Callout
      tone="accent"
      title={m.welcome_update_title({ version })}
      action={
        <Button icon="sparkles" onClick={actions.openReleaseNote}>
          {m.welcome_update_action()}
        </Button>
      }
    >
      {m.welcome_update_body()}
    </Callout>
  );
}

function ConversionOffer() {
  const actions = useWelcomeActions();
  const templateFolder = useWelcomeStore((state) => state.templateFolder);
  const [converting, setConverting] = useState(false);
  // The notice that names a refusal is transient; the banner keeps the same
  // sentence beside the button until the next attempt.
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <Callout
      tone="accent"
      title={m.welcome_template_conversion_title()}
      action={
        <Button
          icon="combine"
          loading={converting}
          disabled={converting}
          onClick={() => {
            setConverting(true);
            setRefusal(null);
            void actions
              .convertLiteratureNoteTemplates()
              .then((outcome) => {
                if (outcome.outcome === "refused")
                  setRefusal(templateMigrationNotice(outcome));
              })
              .finally(() => {
                setConverting(false);
              });
          }}
        >
          {m.welcome_template_conversion_action()}
        </Button>
      }
    >
      <p className="zt:m-0">{m.welcome_template_conversion_lead()}</p>
      <HowItWorks>
        {m.welcome_template_conversion_body({
          path: join(templateFolder, CONVERTED_DEFAULT_PROFILE_DOCUMENT),
        })}
      </HowItWorks>
      {refusal ? (
        <p className="zt:mt-2 zt:mb-0 zt:text-destructive" role="alert">
          {refusal}
        </p>
      ) : null}
    </Callout>
  );
}

function ConversionResult() {
  const actions = useWelcomeActions();
  const result = useWelcomeStore((state) => state.templateConversionResult);
  const [retrying, setRetrying] = useState(false);
  if (!result) return null;
  const retained = result.pendingCleanup;
  return (
    <Callout
      tone="muted"
      title={m.welcome_template_conversion_completed_title()}
      action={
        retained.length > 0 ? (
          <Button
            icon="rotate-ccw"
            loading={retrying}
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              void actions.retryTemplateCleanup().finally(() => {
                setRetrying(false);
              });
            }}
          >
            {m.welcome_template_cleanup_retry()}
          </Button>
        ) : undefined
      }
    >
      <p className="zt:m-0">
        {result.document
          ? m.welcome_template_conversion_completed_body({
              path: result.document,
              count: result.trashed,
            })
          : m.welcome_template_conversion_completed_files({
              count: result.trashed,
            })}
      </p>
      {retained.length > 0 ? (
        <>
          <p className="zt:mt-2 zt:mb-0">{m.welcome_template_cleanup_body()}</p>
          <ul className="zt:my-1 zt:flex zt:list-none zt:flex-col zt:gap-1 zt:p-0">
            {retained.map((path) => (
              <li key={path}>
                <code className="zt:rounded-sm zt:border zt:border-border zt:bg-muted zt:px-2 zt:py-0.5 zt:font-mono zt:text-xs">
                  {path}
                </code>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Callout>
  );
}

function MigrationGuide() {
  const actions = useWelcomeActions();
  return (
    <Callout
      tone="accent"
      title={m.welcome_migration_title()}
      action={
        <Button
          icon="book-marked"
          onClick={() => actions.openExternal(MIGRATION_GUIDE)}
        >
          {m.welcome_action_open_migration_guide()}
        </Button>
      }
    >
      {m.welcome_migration_body()}
    </Callout>
  );
}

/** What a v1 upgrader on Zotero 10 needs: ZotLit Companion reads its recent changes. */
function CompanionGuidance() {
  const actions = useWelcomeActions();
  return (
    <Callout
      tone="muted"
      title={m.welcome_companion_title()}
      action={
        <Button
          icon="external-link"
          onClick={() => actions.openExternal(DOCS_COMPANION)}
        >
          {m.notice_companion_install_action()}
        </Button>
      }
    >
      {m.companion_zotero_10_guidance()}
    </Callout>
  );
}

/**
 * The Welcome View as a banner above the Library View: exactly the sections
 * {@link bannerSections} names, and nothing while it names none.
 *
 * @see apps/obsidian/docs/adr/0077-the-library-view-is-the-first-screen.md
 */
export function Welcome() {
  const shown = useWelcomeStore((s) => bannerSections(s) !== null);
  const steps = useWelcomeStore((s) => bannerSections(s)?.steps ?? false);

  const connect = useWelcomeStore((s) => bannerSections(s)?.connect ?? false);
  const conversion = useWelcomeStore(
    (s) => bannerSections(s)?.conversion ?? null,
  );
  const migration = useWelcomeStore(
    (s) => bannerSections(s)?.migration ?? false,
  );
  const companion = useWelcomeStore(
    (s) => bannerSections(s)?.companion ?? false,
  );
  const update = useWelcomeStore((s) => bannerSections(s)?.update ?? false);
  const titleId = useUniqueId();
  // A request for the banner moves focus to it, once it shows.
  const requests = useWelcomeStore((s) => s.requests);
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (requests > 0) sectionRef.current?.focus();
  }, [requests]);
  if (!shown) return null;
  return (
    // Obsidian shows a tooltip for each `aria-label`, so the banner takes its
    // name from the title on screen.
    <section
      ref={sectionRef}
      aria-labelledby={titleId}
      data-welcome-banner=""
      tabIndex={-1}
      // The bar spans the tab; its content starts where the Library Tree's
      // rows do, at the tree's own inset.
      className="zt:@container zt:border-b-(length:--border-width) zt:border-(--divider-color) zt:bg-(--background-secondary) zt:px-(--size-4-2) zt:py-(--size-4-4) zt:outline-none"
    >
      {/* One column, at most 64rem, holds the header, its dismiss button and
          the body, so on a large pane the banner reads as one block and the
          dismiss button ends the content it closes. */}
      <div className="zt:max-w-[64rem]">
        <Header titleId={titleId} />
        {/* What to do comes first; the Help Links take a 20rem column beside
            it, and go last under 760px. */}
        <div className="zt:mt-3 zt:grid zt:grid-cols-1 zt:gap-4 zt:@min-[760px]:grid-cols-[minmax(0,1fr)_20rem] zt:@min-[760px]:gap-6">
          <div className="zt:flex zt:min-w-0 zt:flex-col zt:gap-3">
            {update && <UpdateCallout />}
            {migration && <MigrationGuide />}
            {conversion === "offer" && <ConversionOffer />}
            {conversion === "result" && <ConversionResult />}
            {companion && <CompanionGuidance />}
            {steps === "open" && <Checklist connect={connect} />}
            {steps === "folded" && <FoldedChecklist connect={connect} />}
          </div>
          <HelpLinks />
        </div>
      </div>
    </section>
  );
}
