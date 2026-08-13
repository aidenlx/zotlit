// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnnotViewAttachment } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";

import { AnnotActionsContext } from "./actions";
import type { AnnotActions } from "./actions";
import { AnnotView } from "./AnnotView";
import { AnnotStoreProvider, createAnnotStore } from "./store";
import type { AnnotState, AnnotStore } from "./store";

vi.mock("zustand", async () => {
  const { useSyncExternalStore } = await import("preact/compat");
  return {
    useStore: <T, U>(
      store: {
        subscribe: (listener: () => void) => () => void;
        getState: () => T;
      },
      selector: (state: T) => U,
    ) =>
      useSyncExternalStore(store.subscribe, () => selector(store.getState())),
  };
});

const attachments: AnnotViewAttachment[] = [
  { itemID: 1, path: "storage:first.pdf", annotCount: 2 },
  { itemID: 2, path: "storage:second.pdf", annotCount: 3 },
];

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(state: Partial<AnnotState> = {}): Promise<{
  container: HTMLElement;
  spies: ReturnType<typeof createSpies>;
  store: AnnotStore;
}> {
  const store = createAnnotStore();
  store.setState({
    itemKey: "ABCD2345",
    attachments,
    serverAvailable: true,
    ...state,
  });
  const spies = createSpies();
  const actions: AnnotActions = {
    ...spies,
    onMoreOptions: () => undefined,
    onDragStart: () => undefined,
    getImgSrc: () => "",
    getBacklink: () => undefined,
    renderComment: () => () => undefined,
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => {
    root!.render(
      createElement(
        AnnotStoreProvider,
        { value: store },
        createElement(
          AnnotActionsContext,
          { value: actions },
          createElement(AnnotView),
        ),
      ),
    );
  });
  return { container, spies, store };
}

/** The toolbar-reachable actions, held apart from the context so each stays a plain function to assert on. */
function createSpies() {
  return {
    onRefresh: vi.fn(),
    onToggleFollowReader: vi.fn(),
    onLinkItem: vi.fn(),
    onUnlinkItem: vi.fn(),
  };
}

/** One toolbar control, addressed by the accessible name it carries. */
function control(container: HTMLElement, label: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
}

/** The accessible names of the action group holding a known control. */
function groupLabels(container: HTMLElement, label: string): (string | null)[] {
  const group = control(container, label).parentElement!;
  return [...group.children].map((child) => child.getAttribute("aria-label"));
}

describe("AnnotView toolbar", () => {
  const follow = m.annot_view_follow_reader_tooltip();
  const link = m.annot_view_link_tooltip();

  it("carries the follow controls and the item actions in one group", async () => {
    const { container } = await render();

    expect(groupLabels(container, follow)).toStrictEqual([
      follow,
      link,
      m.annot_view_expand_tooltip(),
      m.annot_view_refresh_tooltip(),
      m.annot_view_search_tooltip(),
    ]);
  });

  it("keeps the follow controls alone while no item resolves", async () => {
    const { container } = await render({ itemKey: null, attachments: null });

    expect(groupLabels(container, follow)).toStrictEqual([follow, link]);
  });

  it("follows the reader when its control is activated", async () => {
    const { container, spies } = await render();
    await act(() => control(container, follow).click());

    expect(spies.onToggleFollowReader).toHaveBeenCalledTimes(1);
  });

  it("leaves the reader control inert while the server is unavailable", async () => {
    const { container, spies } = await render({ serverAvailable: false });
    const disabled = control(
      container,
      m.annot_view_follow_reader_disabled_tooltip(),
    );
    await act(() => disabled.click());

    expect(spies.onToggleFollowReader).not.toHaveBeenCalled();
  });

  it("refreshes from the keyboard as well as the pointer", async () => {
    const { container, spies } = await render();
    const refresh = control(container, m.annot_view_refresh_tooltip());
    await act(() => {
      refresh.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(spies.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("swaps the collapse control's meaning as it is toggled", async () => {
    const { container } = await render();
    await act(() => control(container, m.annot_view_expand_tooltip()).click());

    expect(control(container, m.annot_view_collapse_tooltip())).not.toBeNull();
  });

  it("opens the search row from the toolbar", async () => {
    const { container, store } = await render();
    await act(() => control(container, m.annot_view_search_tooltip()).click());

    expect(store.getState().searchOpen).toBe(true);
    expect(container.querySelector('input[type="search"]')).not.toBeNull();
  });

  it("keeps the attachment selector beside the actions", async () => {
    const { container, store } = await render();
    const select = container.querySelector("select")!;

    expect([...select.options].map((option) => option.value)).toStrictEqual([
      "1",
      "2",
    ]);
    select.value = "2";
    await act(() => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(store.getState().selectedAttachmentID).toBe(2);
  });

  it("drops the attachment selector while the reader is followed", async () => {
    const { container } = await render({ followMode: "reader" });

    expect(container.querySelector("select")).toBeNull();
    expect(control(container, m.annot_view_refresh_tooltip())).not.toBeNull();
  });
});
