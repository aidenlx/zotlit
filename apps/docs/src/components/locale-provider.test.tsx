// @vitest-environment happy-dom
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { MarkdownCopyButton } from "fumadocs-ui/layouts/docs/page";
import {
  LanguageSelect,
  LanguageSelectText,
} from "fumadocs-ui/layouts/shared/slots/language-select";
import {
  FullSearchTrigger,
  SearchTrigger,
} from "fumadocs-ui/layouts/shared/slots/search-trigger";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPageLocaleState } from "@/lib/locale-state";
import { deLocalizeUrl, getLocale, localizeUrl } from "@/paraglide/runtime.js";
import { paraglideMiddleware } from "@/paraglide/server.js";

import { LocaleFallbackNotice } from "./locale-fallback-notice";
import { LocaleProvider } from "./locale-provider";

afterEach(() => vi.unstubAllGlobals());

async function withPage(
  href: string,
  check: (container: HTMLElement) => void | Promise<void>,
) {
  await import("fumadocs-ui/components/dialog/search-default");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const previousUrl = window.location.href;
  window.history.replaceState(null, "", href);
  try {
    await paraglideMiddleware(
      new Request(new URL(href, "https://zotlit.aidenlx.site")),
      async () => {
        using cleanup = new DisposableStack();
        const history = cleanup.adopt(
          createMemoryHistory({ initialEntries: [href] }),
          (history) => history.destroy(),
        );
        const router = createRouter({
          history,
          routeTree: createRootRoute(),
          rewrite: {
            input: ({ url }) => deLocalizeUrl(url),
            output: ({ url }) => localizeUrl(url, { locale: getLocale() }),
          },
        });
        const container = cleanup.adopt(
          document.createElement("div"),
          (element) => element.remove(),
        );
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
          await act(async () => {
            root.render(
              <RouterContextProvider router={router}>
                <LocaleProvider>
                  <FullSearchTrigger />
                  <SearchTrigger />
                  <LanguageSelect>
                    <LanguageSelectText />
                  </LanguageSelect>
                  <MarkdownCopyButton markdownUrl="/docs/new-feature.md" />
                  <LocaleFallbackNotice
                    state={getPageLocaleState(
                      "/docs/new-feature",
                      getLocale(),
                      new Set(),
                    )}
                  />
                  <article lang="en">
                    English-only feature documentation.
                  </article>
                </LocaleProvider>
              </RouterContextProvider>,
            );
          });
          await check(container);
        } finally {
          await act(async () => root.unmount());
        }
        return new Response("ok");
      },
    );
  } finally {
    window.history.replaceState(null, "", previousUrl);
  }
}

// Reader seam: real packaged controls must use the URL locale, including
// when the documentation body falls back to English.
describe("native documentation controls", () => {
  it("renders Chinese controls around an English fallback body", async () => {
    await withPage("/zh-CN/docs/new-feature?keep=1#install", (container) => {
      expect(
        container.querySelector("[data-search-full]")?.textContent,
      ).toContain("搜索");
      expect(
        container.querySelector('[aria-label="选择语言"]')?.textContent,
      ).toBe("简体中文");
      expect(
        [...container.querySelectorAll("button")].some(
          (button) => button.textContent === "复制 Markdown",
        ),
      ).toBe(true);
      expect(container.querySelector("article")?.textContent).toBe(
        "English-only feature documentation.",
      );
      expect(
        container.querySelector('[role="note"]')?.getAttribute("lang"),
      ).toBe("zh-CN");
    });
  });

  it.each([
    {
      href: "/zh-CN/docs/new-feature?keep=1#install",
      search: "搜索",
      open: "打开搜索",
      close: "关闭搜索",
      language: "选择语言",
      copy: "复制 Markdown",
      hasFallback: true,
    },
    {
      href: "/docs/new-feature?lang=zh-CN&keep=1#install",
      search: "Search",
      open: "Open Search",
      close: "Close Search",
      language: "Choose a language",
      copy: "Copy Markdown",
      hasFallback: false,
    },
  ])(
    "keeps native search and language controls in the URL locale at $href",
    async ({ href, search, open, close, language, copy, hasFallback }) => {
      await withPage(href, async (container) => {
        const trigger = container.querySelector<HTMLButtonElement>(
          `[aria-label="${open}"]`,
        )!;
        expect(trigger).not.toBeNull();
        expect(
          [...container.querySelectorAll("button")].some(
            (button) => button.textContent === copy,
          ),
        ).toBe(true);
        const languageSelect = container.querySelector<HTMLButtonElement>(
          `[aria-label="${language}"]`,
        )!;
        expect(languageSelect).not.toBeNull();
        await act(async () => languageSelect.click());
        expect(
          document.querySelector('[role="dialog"]')?.textContent,
        ).toContain(language);
        expect(
          document.querySelector('[role="dialog"]')?.textContent,
        ).toContain("English");
        expect(
          document.querySelector('[role="dialog"]')?.textContent,
        ).toContain("简体中文");
        await act(async () => languageSelect.click());

        for (let attempt = 0; attempt < 2; attempt++) {
          await act(async () => trigger.click());
          const input = document.querySelector<HTMLInputElement>(
            "[data-fd-search-dialog-input]",
          );
          expect(input?.placeholder).toBe(search);
          const closeButton = document.querySelector<HTMLButtonElement>(
            `[aria-label="${close}"]`,
          )!;
          expect(closeButton).not.toBeNull();
          await act(async () => closeButton.click());
          expect(
            document.querySelector("[data-fd-search-dialog-input]"),
          ).toBeNull();
        }
        expect(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        ).toBe(href);
        expect(container.querySelector('[role="note"]') !== null).toBe(
          hasFallback,
        );
      });
    },
  );
});
