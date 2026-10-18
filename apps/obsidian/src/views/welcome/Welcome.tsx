// Welcome onboarding banner: the header, the timeline of setup steps with the documentation and community links, the template conversion, the v1 Migration Prompt and the Zotero 10 Companion guidance, each as a section the store decides.
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

type NodeState = "done" | "active" | "warn" | "todo" | "keep";

function nodeClass(state: NodeState): string {
  switch (state) {
    case "done":
      return "zt:border-green zt:text-green";
    case "active":
    case "keep":
      return "zt:border-link zt:text-link";
    case "warn":
      return "zt:border-warning zt:text-warning";
    case "todo":
      return "zt:border-faint zt:text-faint";
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
      <div className="zt:min-w-0 zt:flex-1">
        <div className="zt:flex zt:flex-wrap zt:items-center zt:gap-2.5">
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
        </div>
        <p className="zt:mt-1 zt:mb-0 zt:text-sm zt:text-muted-foreground">
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

/**
 * One node of the timeline: its state in a ring, then its heading, text and
 * action, with a line down to the next node unless it is the last. The ring is
 * smaller than the Welcome View tab's, since the banner takes at most half the
 * Library View; the line runs from the ring's centre.
 */
function TimelineNode({
  state,
  icon,
  last,
  children,
}: {
  state: NodeState;
  icon: IconName;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "zt:relative zt:grid zt:grid-cols-[32px_1fr] zt:gap-3",
        !last && "zt:pb-4",
      )}
    >
      {!last ? (
        <div className="zt:absolute zt:top-8 zt:bottom-[-6px] zt:left-[15px] zt:w-0.5 zt:bg-border" />
      ) : null}
      <div
        className={cn(
          "zt:relative zt:z-[1] zt:flex zt:size-8 zt:items-center zt:justify-center zt:rounded-full zt:border-2 zt:bg-background",
          nodeClass(state),
        )}
      >
        <Icon
          name={icon}
          size="var(--icon-s)"
          className={state === "active" ? "zt:animate-spin" : undefined}
        />
      </div>
      <div className="zt:min-w-0 zt:pt-1">{children}</div>
    </div>
  );
}

function StepConnect() {
  const connection = useWelcomeStore((s) => s.connection);
  const actions = useWelcomeActions();

  const state: NodeState =
    connection.status === "connected"
      ? "done"
      : connection.status === "missing"
        ? "warn"
        : "active";
  const icon: IconName =
    connection.status === "connected"
      ? "check"
      : connection.status === "missing"
        ? "circle-alert"
        : "loader";

  return (
    <TimelineNode state={state} icon={icon}>
      <StepHeading>{m.welcome_step_connect_title()}</StepHeading>
      {connection.status === "checking" ? (
        <p className="zt:mt-1 zt:animate-pulse zt:text-sm zt:text-muted-foreground">
          {m.welcome_step_connect_checking()}
        </p>
      ) : connection.status === "missing" ? (
        <>
          <p className="zt:mt-1 zt:text-sm zt:text-muted-foreground">
            {m.welcome_step_connect_missing()}
          </p>
          <Button
            icon="folder-search"
            className="zt:mt-2"
            onClick={actions.locateZotero}
          >
            {m.welcome_action_locate()}
          </Button>
        </>
      ) : (
        <>
          <div className="zt:mt-1 zt:flex zt:flex-wrap zt:items-center zt:gap-2">
            <code className="zt:max-w-full zt:truncate zt:rounded-sm zt:border zt:border-border zt:bg-muted zt:px-2 zt:py-0.5 zt:font-mono zt:text-xs">
              {connection.path}
            </code>
            <span className="zt:text-sm zt:text-muted-foreground">
              {m.welcome_step_connect_connected({
                count: connection.itemCount,
              })}
            </span>
          </div>
          <Button
            icon="settings"
            className="zt:mt-2"
            onClick={actions.openSettings}
          >
            {m.welcome_action_open_settings()}
          </Button>
        </>
      )}
    </TimelineNode>
  );
}

function StepFolder() {
  const literatureFolder = useWelcomeStore((s) => s.literatureFolder);
  const done = useWelcomeStore((s) => s.literatureFolderExists);
  const actions = useWelcomeActions();
  return (
    <TimelineNode
      state={done ? "done" : "todo"}
      icon={done ? "check" : "folder"}
    >
      <StepHeading>{m.welcome_step_folder_title()}</StepHeading>
      <p className="zt:mt-1 zt:text-sm zt:text-muted-foreground">
        {m.welcome_step_folder_body({ folder: literatureFolder })}
      </p>
      <Button icon="folder" className="zt:mt-2" onClick={actions.pickFolder}>
        {m.welcome_action_pick_folder()}
      </Button>
    </TimelineNode>
  );
}

/**
 * The library lists below the banner once ZotLit reads Zotero's database.
 * Its search is the Library View's own search box, which the not-found state
 * takes away.
 */
function StepLibrary() {
  const done = useWelcomeStore((s) => s.connection.status === "connected");
  const notFound = useWelcomeStore((s) => s.notFound);
  const actions = useWelcomeActions();
  return (
    <TimelineNode
      state={done ? "done" : "todo"}
      icon={done ? "check" : "library"}
    >
      <StepHeading>{m.welcome_step_library_title()}</StepHeading>
      <p className="zt:mt-1 zt:text-sm zt:text-muted-foreground">
        {m.welcome_step_library_body()}
      </p>
      {notFound ? null : (
        <Button
          icon="search"
          className="zt:mt-2"
          onClick={actions.searchLibrary}
        >
          {m.welcome_action_search()}
        </Button>
      )}
    </TimelineNode>
  );
}

function LinkPill({
  icon,
  iconClassName,
  url,
  children,
}: {
  icon: IconName;
  iconClassName?: string;
  url: string;
  children: ReactNode;
}) {
  const actions = useWelcomeActions();
  return (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault();
        actions.openExternal(url);
      }}
      style={{ color: "var(--text-normal)", textDecoration: "none" }}
      className="zt:inline-flex zt:cursor-pointer zt:items-center zt:gap-1.5 zt:rounded-full zt:border zt:border-border zt:px-2.5 zt:py-1 zt:text-xs zt:transition-colors zt:hover:bg-muted"
    >
      <Icon name={icon} className={cn("zt:text-link", iconClassName)} />
      {children}
    </a>
  );
}

/** The last node of the timeline: the documentation links. */
function KeepGoing() {
  return (
    <TimelineNode state="keep" icon="compass" last>
      <StepHeading>{m.welcome_keep_going_title()}</StepHeading>
      <p className="zt:mt-1 zt:text-sm zt:text-muted-foreground">
        {m.welcome_keep_going_body()}
      </p>
      <div className="zt:mt-2 zt:flex zt:flex-wrap zt:gap-2">
        <LinkPill icon="book-open" url={DOCS_GETTING_STARTED}>
          {m.welcome_docs_getting_started()}
        </LinkPill>
        <LinkPill icon="layout-template" url={DOCS_TEMPLATES}>
          {m.welcome_docs_templates()}
        </LinkPill>
        <LinkPill icon="quote" url={DOCS_CITATIONS}>
          {m.welcome_docs_citations()}
        </LinkPill>
      </div>
    </TimelineNode>
  );
}

function LinkGroup({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="zt:grid zt:grid-cols-[96px_1fr] zt:items-center zt:gap-3">
      <div className="zt:text-xs zt:tracking-wider zt:text-muted-foreground zt:uppercase">
        {name}
      </div>
      <div className="zt:flex zt:flex-wrap zt:gap-2">{children}</div>
    </div>
  );
}

/** The community and news links, each group under its name. */
function FooterGroups() {
  return (
    <div className="zt:mt-4 zt:flex zt:flex-col zt:gap-3 zt:border-t zt:border-border zt:pt-4">
      <LinkGroup name={m.welcome_group_community()}>
        <LinkPill icon="git-branch" url={GITHUB}>
          {m.welcome_link_github()}
        </LinkPill>
        <LinkPill icon="messages-square" url={COMMUNITY}>
          {m.welcome_link_discussions()}
        </LinkPill>
        <LinkPill icon="heart" iconClassName="zt:text-pink" url={SPONSOR}>
          {m.welcome_link_sponsor()}
        </LinkPill>
      </LinkGroup>
      <LinkGroup name={m.welcome_group_news()}>
        <LinkPill icon="rss" url={BLOG}>
          {m.welcome_link_blog()}
        </LinkPill>
        <LinkPill icon="history" url={CHANGELOG}>
          {m.welcome_link_changelog()}
        </LinkPill>
      </LinkGroup>
    </div>
  );
}

function FooterLink() {
  const actions = useWelcomeActions();
  return (
    <p className="zt:mt-3 zt:mb-0 zt:text-xs zt:text-muted-foreground">
      {m.welcome_footer_migration_lead()}{" "}
      <a
        href={MIGRATION_GUIDE}
        onClick={(e) => {
          e.preventDefault();
          actions.openExternal(MIGRATION_GUIDE);
        }}
        className="zt:cursor-pointer zt:text-link zt:hover:underline"
      >
        {m.welcome_footer_migration_link()}
      </a>
    </p>
  );
}

/**
 * The accent surface a callout that carries an action wears: the accent at the
 * two opacities the timeline nodes use, so it reads as the same palette.
 */
const ACCENT_CALLOUT_SURFACE = {
  background: "hsla(var(--interactive-accent-hsl), 0.14)",
  borderColor: "hsla(var(--interactive-accent-hsl), 0.35)",
};

/**
 * A titled callout. The body runs the full width of the card and the action
 * takes the row below it, the same order the timeline steps read in. Holding
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
        "zt:relative zt:mt-4 zt:rounded-lg zt:border zt:px-5 zt:py-4",
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
  const migrationPending = useWelcomeStore((s) => s.migrationPending);
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
      {conversion === "offer" && <ConversionOffer />}
      {conversion === "result" && <ConversionResult />}
      {migration && <MigrationGuide />}
      {companion && <CompanionGuidance />}
      {steps && (
        <>
          <div className="zt:mt-4">
            {connect && <StepConnect />}
            <StepFolder />
            <StepLibrary />
            <KeepGoing />
          </div>
          <FooterGroups />
          {migrationPending ? null : <FooterLink />}
        </>
      )}
    </section>
  );
}
