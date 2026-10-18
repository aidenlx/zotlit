// Welcome onboarding banner: the header, the checklist of setup steps, the template conversion, the v1 Migration Prompt and the Zotero 10 Companion guidance, each as a section the store decides, and the Help Links whatever it shows.
import { join } from "node:path/posix";
import type { IconName } from "obsidian";
import type { ReactNode } from "react";
import { useState } from "react";

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
import { bannerSections, useWelcomeStore } from "./store";

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

function StepHeading({ children }: { children: ReactNode }) {
  return (
    <div role="heading" aria-level={3} className="zt:text-sm zt:font-semibold">
      {children}
    </div>
  );
}

function Header({ titleId }: { titleId: string }) {
  const actions = useWelcomeActions();
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
        <span className="zt:rounded-full zt:border zt:border-primary zt:bg-muted zt:px-2 zt:py-0.5 zt:text-xs zt:text-foreground">
          {m.welcome_badge()}
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
  icon: IconName;
  title: string;
  /** What a done step settled on, after its title on the same line. */
  summary?: ReactNode;
  /** The text the step says while it is the next one. */
  body: ReactNode;
  action?: ReactNode;
}

/**
 * One row of the checklist. The next step opens into a card with its text
 * and action; every other row keeps to one line, its action at the end of it,
 * so a done step can still be changed.
 */
function StepRow({ step, open }: { step: Step; open: boolean }) {
  return (
    <li
      data-welcome-step={step.state}
      data-open={open ? "" : undefined}
      className="zt:flex zt:flex-col zt:gap-1.5"
    >
      <div className="zt:flex zt:min-h-7 zt:items-center zt:gap-2">
        <span
          className={cn(
            "zt:flex zt:size-5 zt:shrink-0 zt:items-center zt:justify-center zt:rounded-full zt:border-2",
            markClass(step.state, open),
          )}
        >
          <Icon
            name={step.icon}
            size="var(--icon-xs)"
            className={
              step.state === "checking" ? "zt:animate-spin" : undefined
            }
          />
        </span>
        <div className="zt:flex zt:min-w-0 zt:flex-1 zt:flex-wrap zt:items-baseline zt:gap-x-2">
          <StepHeading>{step.title}</StepHeading>
          {step.state === "done" ? (
            <span className="zt:sr-only">{m.welcome_step_done()}</span>
          ) : null}
          {!open && step.summary ? (
            <span className="zt:flex zt:min-w-0 zt:items-center zt:gap-1.5 zt:text-xs zt:text-muted-foreground">
              {step.summary}
            </span>
          ) : null}
        </div>
        {!open && step.action ? (
          <div className="zt:shrink-0">{step.action}</div>
        ) : null}
      </div>
      {open ? (
        <div className="zt:ms-7 zt:rounded-lg zt:border zt:border-primary zt:bg-background zt:px-3 zt:py-2.5">
          <div className="zt:text-sm zt:text-pretty zt:text-muted-foreground">
            {step.body}
          </div>
          {step.action ? <div className="zt:mt-2">{step.action}</div> : null}
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
      icon:
        connection.status === "connected"
          ? "check"
          : connection.status === "missing"
            ? "circle-alert"
            : "loader",
      title: m.welcome_step_connect_title(),
      summary:
        connection.status === "connected" ? (
          <>
            <code className="zt:max-w-60 zt:truncate zt:font-mono">
              {connection.path}
            </code>
            <span aria-hidden="true">·</span>
            <span className="zt:whitespace-nowrap">
              {m.welcome_step_connect_connected({
                count: connection.itemCount,
              })}
            </span>
          </>
        ) : undefined,
      body:
        connection.status === "checking" ? (
          <p className="zt:m-0 zt:animate-pulse">
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
    icon: folderDone ? "check" : "folder",
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
    icon: connected ? "check" : "library",
    title: m.welcome_step_library_title(),
    summary: connected ? m.welcome_step_library_done() : undefined,
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
    <ol className="zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-1.5 zt:p-0">
      {steps.map((step, index) => (
        <StepRow key={step.id} step={step} open={index === next} />
      ))}
    </ol>
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
 * link, and a subtitle that describes it.
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
        "zt:flex zt:min-w-0 zt:cursor-pointer zt:items-center zt:gap-2.5 zt:rounded-lg zt:border zt:bg-background zt:px-2.5 zt:py-2 zt:transition-colors zt:hover:border-(--background-modifier-border-hover) zt:hover:bg-(--background-modifier-hover)",
        FOCUS_RING,
        primary
          ? "zt:col-span-2 zt:border-primary zt:hover:border-primary"
          : "zt:border-border",
      )}
    >
      <span
        className={cn(
          "zt:flex zt:shrink-0 zt:items-center zt:justify-center zt:rounded-md zt:bg-[hsla(var(--interactive-accent-hsl),0.14)] zt:text-link",
          primary ? "zt:size-8" : "zt:size-7",
        )}
      >
        <Icon name={icon} />
      </span>
      <span className="zt:flex zt:min-w-0 zt:flex-col">
        <span id={titleId} className="zt:text-sm zt:font-semibold">
          {title}
        </span>
        <span id={subtitleId} className="zt:text-xs zt:text-muted-foreground">
          {subtitle}
        </span>
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
      <div className="zt:mt-2.5 zt:flex zt:flex-wrap zt:gap-x-3 zt:gap-y-1 zt:text-xs">
        <TextLink url={BLOG}>{m.welcome_link_blog()}</TextLink>
        <TextLink url={CHANGELOG}>{m.welcome_link_changelog()}</TextLink>
        <TextLink url={SPONSOR}>
          <Icon name="heart" className="zt:text-pink" />
          {m.welcome_link_sponsor()}
        </TextLink>
      </div>
      {migrationPending ? null : (
        <p className="zt:mt-1.5 zt:mb-0 zt:text-xs zt:text-muted-foreground">
          {m.welcome_footer_migration_lead()}{" "}
          <TextLink url={MIGRATION_GUIDE}>
            {m.welcome_footer_migration_link()}
          </TextLink>
        </p>
      )}
    </nav>
  );
}

/**
 * The accent surface a callout that carries an action wears: the accent at the
 * two opacities the Help Links' icon squares use, so it reads as the same
 * palette.
 */
const ACCENT_CALLOUT_SURFACE = {
  background: "hsla(var(--interactive-accent-hsl), 0.14)",
  borderColor: "hsla(var(--interactive-accent-hsl), 0.35)",
};

/**
 * A titled callout. The body runs the full width of the card and the action
 * takes the row below it, the same order the open setup step reads in. Holding
 * the action in a side column instead costs the body the width of one button
 * for every line it wraps, and leaves that column empty below the first line.
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
        "zt:relative zt:rounded-lg zt:border zt:px-4 zt:py-3",
        tone === "muted" && "zt:border-border zt:bg-muted",
      )}
      style={tone === "accent" ? ACCENT_CALLOUT_SURFACE : undefined}
    >
      <StepHeading>{title}</StepHeading>
      <div className="zt:mt-1 zt:text-sm zt:text-pretty zt:text-muted-foreground">
        {children}
      </div>
      {action ? <div className="zt:mt-3">{action}</div> : null}
    </div>
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
      <p className="zt:m-0">
        {m.welcome_template_conversion_body({
          path: join(templateFolder, CONVERTED_DEFAULT_PROFILE_DOCUMENT),
        })}
      </p>
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
  const titleId = useUniqueId();
  if (!shown) return null;
  return (
    // Obsidian shows a tooltip for each `aria-label`, so the banner takes its
    // name from the title on screen.
    <section
      aria-labelledby={titleId}
      data-welcome-banner=""
      className="zt:@container zt:border-b-(length:--border-width) zt:border-(--divider-color) zt:bg-(--background-secondary) zt:px-(--size-4-6) zt:py-(--size-4-4)"
    >
      <Header titleId={titleId} />
      {/* A wide pane holds the Help Links in a column beside the checklist
          and the callouts; a narrow one puts them underneath. */}
      <div className="zt:mt-3 zt:grid zt:grid-cols-1 zt:gap-4 zt:@2xl:grid-cols-[minmax(0,1fr)_300px] zt:@2xl:gap-6">
        <div className="zt:flex zt:min-w-0 zt:flex-col zt:gap-3">
          {conversion === "offer" && <ConversionOffer />}
          {conversion === "result" && <ConversionResult />}
          {migration && <MigrationGuide />}
          {companion && <CompanionGuidance />}
          {steps && <Checklist connect={connect} />}
        </div>
        <HelpLinks />
      </div>
    </section>
  );
}
