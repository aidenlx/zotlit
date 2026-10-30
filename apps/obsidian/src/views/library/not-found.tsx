// The Library View where ZotLit cannot find the Zotero data directory: the
// tree says so in one line, the list offers to locate the folder or open
// settings, and the papers come back as soon as the database reads again.
// Where only a refresh failed, the list keeps the rows it read last under a
// short note.
//
// @see apps/obsidian/docs/adr/0077-the-library-view-is-the-first-screen.md
import { Component } from "obsidian";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { useUniqueId } from "@zotlit/ui";

import { Button } from "@/components/obsidian/button";
import { Icon } from "@/components/obsidian/icon";
import { PaneState } from "@/components/pane-state";
import * as m from "@/lib/i18n/generated/messages";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { zoteroStateAtom } from "@/services/zotero-reads/atoms";
import type { ZoteroReadsState } from "@/services/zotero-reads/service";
import { refreshFailed, unavailable } from "@/views/welcome/connection";
import type { SetupActions } from "@/views/welcome/setup-actions";

export interface ZoteroNotFoundDeps {
  registry: ViewRegistryHandle;
  setupActions: Pick<SetupActions, "locateZotero" | "openSettings">;
}

export interface ZoteroNotFoundSlots {
  /** Carries `data-zotero-missing` while the database cannot be read. */
  shell: HTMLElement;
  /** Where the tree's part goes. */
  tree: HTMLElement;
  /** Where the list's part goes. */
  list: HTMLElement;
  /** Where the note of a failed refresh goes, above the list. */
  note: HTMLElement;
}

export class ZoteroNotFound extends Component {
  readonly #deps: ZoteroNotFoundDeps;
  readonly #slots: ZoteroNotFoundSlots;
  readonly #found: () => void;
  #roots: Root[] = [];
  #note: Root | null = null;

  /** `found` runs when the database reads again after it could not. */
  constructor(
    deps: ZoteroNotFoundDeps,
    slots: ZoteroNotFoundSlots,
    found: () => void,
  ) {
    super();
    this.#deps = deps;
    this.#slots = slots;
    this.#found = found;
  }

  override onload(): void {
    const { registry, setupActions } = this.#deps;
    const { shell, tree, list, note } = this.#slots;
    this.#note = this.#mount(note, null);
    // Read from the database service on each of its changes, so a folder
    // that is set brings the papers back.
    const update = (reads: ZoteroReadsState) => {
      const missing = unavailable({ reads });
      const was = shell.hasAttribute("data-zotero-missing");
      shell.toggleAttribute("data-zotero-missing", missing);
      this.#note?.render(
        refreshFailed({ reads }) ? (
          <RefreshFailedNote actions={setupActions} />
        ) : null,
      );
      if (was && !missing) this.#found();
    };
    this.register(
      registry.subscribe(zoteroStateAtom, update, { immediate: true }),
    );
    this.#mount(tree, <TreeNotFound />);
    this.#mount(list, <ListNotFound actions={setupActions} />);
  }

  #mount(el: HTMLElement, content: ReactNode): Root {
    const root = createRoot(el);
    root.render(content);
    this.#roots.push(root);
    return root;
  }

  override onunload(): void {
    for (const root of this.#roots) root.unmount();
    this.#roots = [];
    this.#note = null;
  }
}

type Actions = ZoteroNotFoundDeps["setupActions"];

/** One line in place of the tree: the list says the rest and offers the actions. */
function TreeNotFound() {
  return (
    <div
      data-library-not-found="tree"
      className="zt:flex zt:items-center zt:gap-(--size-2-3) zt:p-(--size-4-2) zt:px-(--size-4-4) zt:text-(length:--nav-item-size) zt:text-warning"
    >
      <Icon name="triangle-alert" size="s" />
      {m.library_view_not_found()}
    </div>
  );
}

function RefreshFailedNote({ actions }: { actions: Actions }) {
  return (
    <div
      role="status"
      data-library-refresh-failed=""
      className="zt:mx-(--zt-query-toolbar-inset-start) zt:mt-(--size-4-2) zt:flex zt:flex-wrap zt:items-center zt:gap-(--size-4-2) zt:rounded-(--radius-m) zt:border-(length:--border-width) zt:border-(--background-modifier-border) zt:px-(--size-4-3) zt:py-(--size-4-2) zt:text-(length:--font-ui-small) zt:text-muted-foreground"
    >
      <Icon name="triangle-alert" size="s" className="zt:text-warning" />
      <span className="zt:min-w-0 zt:flex-1">
        {m.library_view_refresh_failed()}
      </span>
      <Button icon="folder-search" onClick={actions.locateZotero}>
        {m.library_view_locate()}
      </Button>
    </div>
  );
}

function ListNotFound({ actions }: { actions: Actions }) {
  const titleId = useUniqueId();
  return (
    // The card stands centred in the list, as an empty list does.
    <PaneState>
      {/* Obsidian shows a tooltip for each `aria-label`, so the card takes
          its name from the title on screen. */}
      <section
        aria-labelledby={titleId}
        data-library-not-found="list"
        className="zt:w-full zt:max-w-120 zt:px-(--size-4-6) zt:py-(--size-4-12) zt:text-center"
      >
        <div
          id={titleId}
          role="heading"
          aria-level={2}
          className="zt:text-(length:--font-ui-medium) zt:font-(--font-semibold)"
        >
          {m.library_view_not_found()}
        </div>
        <p className="zt:mt-(--size-4-2) zt:text-sm zt:text-balance zt:text-muted-foreground">
          {m.library_view_not_found_body()}
        </p>
        <div className="zt:mt-(--size-4-4) zt:flex zt:flex-wrap zt:justify-center zt:gap-(--size-4-2)">
          <Button
            variant="cta"
            icon="folder-search"
            onClick={actions.locateZotero}
          >
            {m.library_view_locate()}
          </Button>
          <Button icon="settings" onClick={actions.openSettings}>
            {m.welcome_action_open_settings()}
          </Button>
        </div>
      </section>
    </PaneState>
  );
}
