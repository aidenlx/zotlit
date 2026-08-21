// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DOCS_COMPANION } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";

import { WelcomeActionsContext } from "./actions";
import type { WelcomeActions } from "./actions";
import { WelcomeStoreProvider, createWelcomeStore } from "./store";
import { Welcome } from "./Welcome";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("Welcome Companion setup", () => {
  it("shows the installation step and link in fresh onboarding", async () => {
    const { actions, container } = await render("fresh");
    const button = [...container.querySelectorAll("button")].find(
      (candidate) =>
        candidate.textContent === m.welcome_action_install_companion(),
    );

    expect(container.textContent).toContain(m.welcome_step_companion_title());
    await act(() => button?.click());
    expect(actions.openExternal).toHaveBeenCalledWith(DOCS_COMPANION);
  });

  it("does not show the installation step in upgraded onboarding", async () => {
    const { container } = await render("upgraded");

    expect(container.textContent).not.toContain(
      m.welcome_step_companion_title(),
    );
  });
});

async function render(mode: "fresh" | "upgraded"): Promise<{
  actions: WelcomeActions;
  container: HTMLElement;
}> {
  const store = createWelcomeStore();
  store.setState({ mode, literatureFolder: "Literature" });
  const actions: WelcomeActions = {
    locateZotero: vi.fn(),
    openExternal: vi.fn(),
    openSettings: vi.fn(),
    pickFolder: vi.fn(),
    searchLibrary: vi.fn(),
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => {
    root!.render(
      createElement(
        WelcomeStoreProvider,
        { value: store },
        createElement(
          WelcomeActionsContext,
          { value: actions },
          createElement(Welcome),
        ),
      ),
    );
  });
  return { actions, container };
}
