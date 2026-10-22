// @vitest-environment happy-dom
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
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

import type { SiteLocale } from "@/lib/i18n";
import { getPageLocaleState } from "@/lib/locale-state";
import { m } from "@/paraglide/messages.js";
import { deLocalizeUrl, getLocale, localizeUrl } from "@/paraglide/runtime.js";
import { paraglideMiddleware } from "@/paraglide/server.js";

import { LocaleFallbackNotice } from "./locale-fallback-notice";
import { LocaleProvider } from "./locale-provider";

// Compare packaged controls with the root facade in an explicit locale.
function expectedMessages(locale: SiteLocale) {
  return {
    docs_fumadocs_search: m.docs_fumadocs_search({}, { locale }),
    docs_fumadocs_choose_a_language: m.docs_fumadocs_choose_a_language(
      {},
      { locale },
    ),
    docs_fumadocs_language_name: m.docs_fumadocs_language_name({}, { locale }),
    docs_fumadocs_copy_markdown: m.docs_fumadocs_copy_markdown({}, { locale }),
    docs_fumadocs_open_search: m.docs_fumadocs_open_search({}, { locale }),
    docs_fumadocs_close_search: m.docs_fumadocs_close_search({}, { locale }),
  };
}

const englishMessages = expectedMessages("en");
const chineseMessages = expectedMessages("zh-CN");

afterEach(() => vi.unstubAllGlobals());

async function withPage(
  href: string,
  check: (container: HTMLElement) => void | Promise<void>,
) {
  await import("fumadocs-ui/components/dialog/search-default");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using cleanup = new AsyncDisposableStack();
  const previousUrl = window.location.href;
  cleanup.defer(() => window.history.replaceState(null, "", previousUrl));
  window.history.replaceState(null, "", href);
  await paraglideMiddleware(
    new Request(new URL(href, "https://zotlit.aidenlx.site")),
    async () => {
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
        (element) => {
          element.remove();
        },
      );
      document.body.appendChild(container);
      const root = cleanup.adopt(createRoot(container), async (root) => {
        await act(async () => root.unmount());
      });
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
              <ViewOptionsPopover
                data-testid="page-actions"
                markdownUrl="/docs/new-feature.md"
              />
              <LocaleFallbackNotice
                state={getPageLocaleState("/docs/new-feature", getLocale(), {
                  nativeChinesePages: new Set(),
                })}
              />
              <article lang="en">English-only feature documentation.</article>
            </LocaleProvider>
          </RouterContextProvider>,
        );
      });
      await check(container);
      return new Response("ok");
    },
  );
}

// Reader seam: real packaged controls must use the URL locale, including
// when the documentation body falls back to English.
describe("native documentation controls", () => {
  it("gives English and Chinese distinct language choices", () => {
    expect(chineseMessages.docs_fumadocs_language_name).not.toBe(
      englishMessages.docs_fumadocs_language_name,
    );
  });

  it("renders the requested catalog around an English fallback body", async () => {
    await withPage("/zh-CN/docs/new-feature?keep=1#install", (container) => {
      expect(
        container.querySelector("[data-search-full]")?.textContent,
      ).toContain(chineseMessages.docs_fumadocs_search);
      expect(
        container.querySelector(
          `[aria-label="${chineseMessages.docs_fumadocs_choose_a_language}"]`,
        )?.textContent,
      ).toBe(chineseMessages.docs_fumadocs_language_name);
      expect(
        [...container.querySelectorAll("button")].some(
          (button) =>
            button.textContent === chineseMessages.docs_fumadocs_copy_markdown,
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

  it.each(["/zh-CN/docs/new-feature", "/docs/new-feature"])(
    "interpolates the native page action URL in its locale at %s",
    async (href) => {
      await withPage(href, async (container) => {
        const trigger = container.querySelector<HTMLButtonElement>(
          '[data-testid="page-actions"]',
        )!;
        await act(async () => trigger.click());
        const link = document.querySelector<HTMLAnchorElement>(
          'a[href^="https://chatgpt.com/"]',
        );
        expect(link).not.toBeNull();
        const prompt = new URL(link!.href).searchParams.get("prompt");
        expect(prompt).toBe(
          m.docs_fumadocs_read_url_prompt({
            url: new URL(href, window.location.origin).href,
          }),
        );
        expect(prompt).not.toContain("{url}");
        await act(async () => trigger.click());
      });
    },
  );

  it.each([
    {
      href: "/zh-CN/docs/new-feature?keep=1#install",
      messages: chineseMessages,
      hasFallback: true,
    },
    {
      href: "/docs/new-feature?lang=zh-CN&keep=1#install",
      messages: englishMessages,
      hasFallback: false,
    },
  ])(
    "keeps native search and language controls in the URL locale at $href",
    async ({ href, messages, hasFallback }) => {
      const search = messages.docs_fumadocs_search;
      const open = messages.docs_fumadocs_open_search;
      const close = messages.docs_fumadocs_close_search;
      const language = messages.docs_fumadocs_choose_a_language;
      const copy = messages.docs_fumadocs_copy_markdown;
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
        ).toContain(englishMessages.docs_fumadocs_language_name);
        expect(
          document.querySelector('[role="dialog"]')?.textContent,
        ).toContain(chineseMessages.docs_fumadocs_language_name);
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
