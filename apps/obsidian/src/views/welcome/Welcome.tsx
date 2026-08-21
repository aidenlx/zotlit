// Presentational tree for the Welcome View: fresh-state onboarding timeline with doc chips and footer links, plus the upgraded-state Migration Prompt banner.
import type { IconName } from "obsidian";
import type { ReactNode } from "react";

import { Button } from "@/components/obsidian/button";
import { Icon } from "@/components/obsidian/icon";
import { DOCS_COMPANION } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";

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
import { useWelcomeStore } from "./store";

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
    <div
      role="heading"
      aria-level={3}
      className="zt:text-base zt:font-semibold"
    >
      {children}
    </div>
  );
}

function Header() {
  return (
    <header>
      <div className="zt:flex zt:items-center zt:gap-2.5">
        <span className="zt:text-lg zt:font-bold">ZotLit</span>
        <span className="zt:rounded-full zt:bg-primary zt:px-2 zt:py-0.5 zt:text-xs zt:text-primary-foreground">
          {m.welcome_badge()}
        </span>
      </div>
      <p className="zt:mt-1.5 zt:text-muted-foreground">
        {m.welcome_tagline()}
      </p>
    </header>
  );
}

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
    <div className="zt:relative zt:grid zt:grid-cols-[40px_1fr] zt:gap-4 zt:pb-5.5">
      {!last ? (
        <div className="zt:absolute zt:top-10 zt:bottom-[-6px] zt:left-[19px] zt:w-0.5 zt:bg-border" />
      ) : null}
      <div
        className={cn(
          "zt:relative zt:z-[1] zt:flex zt:size-10 zt:items-center zt:justify-center zt:rounded-full zt:border-2 zt:bg-background",
          nodeClass(state),
        )}
      >
        <Icon
          name={icon}
          className={state === "active" ? "zt:animate-spin" : undefined}
        />
      </div>
      <div className="zt:pt-0.5">{children}</div>
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
            className="zt:mt-3"
            onClick={actions.locateZotero}
          >
            {m.welcome_action_locate()}
          </Button>
        </>
      ) : (
        <>
          <div className="zt:mt-1 zt:flex zt:flex-wrap zt:items-center zt:gap-2">
            <code className="zt:rounded-sm zt:border zt:border-border zt:bg-muted zt:px-2 zt:py-0.5 zt:font-mono zt:text-xs">
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
            className="zt:mt-3"
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
  const actions = useWelcomeActions();
  return (
    <TimelineNode state="todo" icon="folder">
      <StepHeading>{m.welcome_step_folder_title()}</StepHeading>
      <p className="zt:mt-1 zt:text-sm zt:text-muted-foreground">
        {m.welcome_step_folder_body({ folder: literatureFolder })}
      </p>
      <Button icon="folder" className="zt:mt-3" onClick={actions.pickFolder}>
        {m.welcome_action_pick_folder()}
      </Button>
    </TimelineNode>
  );
}

function StepCompanion() {
  const actions = useWelcomeActions();
  return (
    <TimelineNode state="todo" icon="puzzle">
      <StepHeading>{m.welcome_step_companion_title()}</StepHeading>
      <p className="zt:mt-1 zt:text-sm zt:text-muted-foreground">
        {m.welcome_step_companion_body()}
      </p>
      <Button
        icon="external-link"
        className="zt:mt-3"
        onClick={() => actions.openExternal(DOCS_COMPANION)}
      >
        {m.welcome_action_install_companion()}
      </Button>
    </TimelineNode>
  );
}

function StepNote() {
  const actions = useWelcomeActions();
  return (
    <TimelineNode state="todo" icon="file-plus-2">
      <StepHeading>{m.welcome_step_note_title()}</StepHeading>
      <p className="zt:mt-1 zt:text-sm zt:text-muted-foreground">
        {m.welcome_step_note_body()}
      </p>
      <Button
        variant="cta"
        icon="search"
        className="zt:mt-3"
        onClick={actions.searchLibrary}
      >
        {m.welcome_action_search()}
      </Button>
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

function KeepGoing() {
  return (
    <TimelineNode state="keep" icon="compass" last>
      <StepHeading>{m.welcome_keep_going_title()}</StepHeading>
      <p className="zt:mt-1 zt:text-sm zt:text-muted-foreground">
        {m.welcome_keep_going_body()}
      </p>
      <div className="zt:mt-3 zt:flex zt:flex-wrap zt:gap-2">
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

function FooterGroups() {
  return (
    <div className="zt:mt-3.5 zt:flex zt:flex-col zt:gap-4 zt:border-t zt:border-border zt:pt-6">
      <div className="zt:grid zt:grid-cols-[96px_1fr] zt:items-center zt:gap-3.5">
        <div className="zt:text-xs zt:tracking-wider zt:text-faint zt:uppercase">
          {m.welcome_group_community()}
        </div>
        <div className="zt:flex zt:flex-wrap zt:gap-2">
          <LinkPill icon="git-branch" url={GITHUB}>
            {m.welcome_link_github()}
          </LinkPill>
          <LinkPill icon="messages-square" url={COMMUNITY}>
            {m.welcome_link_discussions()}
          </LinkPill>
          <LinkPill icon="heart" iconClassName="zt:text-pink" url={SPONSOR}>
            {m.welcome_link_sponsor()}
          </LinkPill>
        </div>
      </div>
      <div className="zt:grid zt:grid-cols-[96px_1fr] zt:items-center zt:gap-3.5">
        <div className="zt:text-xs zt:tracking-wider zt:text-faint zt:uppercase">
          {m.welcome_group_news()}
        </div>
        <div className="zt:flex zt:flex-wrap zt:gap-2">
          <LinkPill icon="rss" url={BLOG}>
            {m.welcome_link_blog()}
          </LinkPill>
          <LinkPill icon="history" url={CHANGELOG}>
            {m.welcome_link_changelog()}
          </LinkPill>
        </div>
      </div>
    </div>
  );
}

function FooterLink() {
  const actions = useWelcomeActions();
  return (
    <p className="zt:mt-5 zt:text-xs zt:text-faint">
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

function MigrationBanner() {
  const actions = useWelcomeActions();
  return (
    <div
      className="zt:relative zt:mt-6 zt:flex zt:flex-wrap zt:items-center zt:gap-4.5 zt:rounded-lg zt:border zt:px-6 zt:py-5.5"
      style={{
        background: "hsla(var(--interactive-accent-hsl), 0.14)",
        borderColor: "hsla(var(--interactive-accent-hsl), 0.35)",
      }}
    >
      <div className="zt:min-w-0 zt:flex-1 zt:basis-[220px]">
        <StepHeading>{m.welcome_migration_title()}</StepHeading>
        <p className="zt:mt-1 zt:text-sm zt:text-muted-foreground">
          {m.welcome_migration_body()}
        </p>
      </div>
      <Button
        variant="cta"
        icon="book-marked"
        onClick={() => actions.openExternal(MIGRATION_GUIDE)}
      >
        {m.welcome_action_open_migration_guide()}
      </Button>
    </div>
  );
}

export function Welcome() {
  const mode = useWelcomeStore((s) => s.mode);
  return (
    <div className="zt:mx-auto zt:max-w-160 zt:px-8 zt:pt-6 zt:pb-2">
      <Header />
      {mode === "upgraded" ? <MigrationBanner /> : null}
      <div className="zt:mt-9">
        <StepConnect />
        {mode === "fresh" ? <StepCompanion /> : null}
        <StepFolder />
        <StepNote />
        <KeepGoing />
      </div>
      <FooterGroups />
      {mode === "fresh" ? <FooterLink /> : null}
    </div>
  );
}
