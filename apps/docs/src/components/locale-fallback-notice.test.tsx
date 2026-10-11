// @vitest-environment happy-dom
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SiteLocale } from "@/lib/i18n";
import { getPageLocaleState } from "@/lib/locale-state";
import { zotlitLegacyUrl } from "@/lib/shared";
import * as m from "@/paraglide/messages.js";
import { deLocalizeUrl, localizeUrl } from "@/paraglide/runtime.js";

import { LocaleFallbackNotice } from "./locale-fallback-notice";
import { RedirectNotice } from "./redirect-notice";

const nativeChinesePages = new Set(["/docs/native"]);

function mount(href: string, locale: SiteLocale = "zh-CN") {
  using cleanup = new DisposableStack();
  const previousUrl = window.location.href;
  cleanup.defer(() => window.history.replaceState(null, "", previousUrl));
  window.history.replaceState(null, "", href);

  const actEnvironment = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  cleanup.defer(() => {
    if (actEnvironment) {
      Object.defineProperty(
        globalThis,
        "IS_REACT_ACT_ENVIRONMENT",
        actEnvironment,
      );
    } else {
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });

  const history = cleanup.adopt(
    createMemoryHistory({ initialEntries: [href.split("#")[0]!] }),
    (history) => history.destroy(),
  );
  const router = createRouter({
    history,
    routeTree: createRootRoute(),
    rewrite: {
      input: ({ url }) => deLocalizeUrl(url),
      output: ({ url }) => localizeUrl(url, { locale }),
    },
  });

  const container = cleanup.adopt(document.createElement("div"), (element) =>
    element.remove(),
  );
  document.body.appendChild(container);
  const tree = (
    <RouterContextProvider router={router}>
      <LocaleFallbackNotice
        state={getPageLocaleState(
          router.state.location.pathname,
          locale,
          nativeChinesePages,
        )}
      />
      <RedirectNotice />
    </RouterContextProvider>
  );
  // The server sees no fragment. Hydrate that HTML while the browser retains
  // its full URL, matching a cold navigation to an anchored document.
  const serverMarkup = renderToString(tree);
  container.innerHTML = serverMarkup;
  act(() => {
    cleanup.adopt(hydrateRoot(container, tree), (root) => {
      act(() => root.unmount());
    });
  });
  const lifetime = cleanup.move();
  return {
    container,
    router,
    serverMarkup,
    [Symbol.dispose]() {
      lifetime[Symbol.dispose]();
    },
  };
}

// Failure modes: missing pages have no action; the outgoing locale rewrite
// returns a reader to Chinese; query/hash context is lost; a stale V1 locale
// hint adds a second or contradictory translation notice.
describe("LocaleFallbackNotice", () => {
  it.each(["pending", "missing"])(
    "offers the English page for %s Chinese content",
    (slug) => {
      const href = `/zh-CN/docs/${slug}`;
      using view = mount(href);
      const note = view.container.querySelector('[role="note"]')!;
      expect(note.getAttribute("lang")).toBe("zh-CN");
      expect(note.textContent).toContain(
        m.docs_locale_fallback({}, { locale: "zh-CN" }),
      );
      const link = note.querySelector("a")!;
      expect(link.textContent).toBe(
        m.docs_read_in_english({}, { locale: "zh-CN" }),
      );
      expect(link.getAttribute("href")).toBe(`/docs/${slug}`);
      expect(link.hasAttribute("target")).toBe(false);
      // Rendering the choice does not navigate the reader.
      expect(window.location.pathname).toBe(`/zh-CN/docs/${slug}`);
    },
  );

  it("preserves every query value and the fragment without a locale-hint warning", () => {
    using view = mount(
      "/zh-CN/docs/pending?keep=one&lang=zh-CN&keep=two&lang=en#install",
    );
    const link = view.container.querySelector('[role="note"] a')!;
    expect(link.getAttribute("href")).toBe(
      "/docs/pending?keep=one&lang=zh-CN&keep=two&lang=en#install",
    );
    expect(view.container.querySelectorAll("p")).toHaveLength(1);
    expect(view.container.textContent).not.toContain(
      m.docs_redirect_translation_pending({}, { locale: "zh-CN" }),
    );
  });

  it("restores the browser fragment after hydrating a fragment-free server location", () => {
    using view = mount(
      "/zh-CN/docs/how-to/qa-english-only?keep=1&lang=zh-CN#qa-english-only-feature",
    );
    expect(view.serverMarkup).toContain('lang="zh-CN"');
    expect(view.serverMarkup).toContain(
      m.docs_locale_fallback({}, { locale: "zh-CN" }),
    );
    expect(view.router.state.location.hash).toBe("");
    expect(view.router.state.location.publicHref).not.toContain("#");
    expect(view.serverMarkup).toContain(
      'href="/docs/how-to/qa-english-only?keep=1&amp;lang=zh-CN"',
    );
    expect(
      view.container.querySelector('[role="note"] a')?.getAttribute("href"),
    ).toBe(
      "/docs/how-to/qa-english-only?keep=1&lang=zh-CN#qa-english-only-feature",
    );
  });

  it.each(["hashchange", "popstate"])(
    "tracks the browser fragment after %s",
    (event) => {
      using view = mount("/zh-CN/docs/pending?keep=1&lang=zh-CN#first");
      act(() => {
        window.history.replaceState(
          null,
          "",
          "/zh-CN/docs/pending?keep=1&lang=zh-CN#second",
        );
        window.dispatchEvent(new Event(event));
      });
      expect(
        view.container.querySelector('[role="note"] a')?.getAttribute("href"),
      ).toBe("/docs/pending?keep=1&lang=zh-CN#second");
    },
  );

  it("reads the browser fragment again on router-only history updates", () => {
    using view = mount("/zh-CN/docs/pending?keep=1&lang=zh-CN#first");
    act(() => {
      window.history.replaceState(
        null,
        "",
        "/zh-CN/docs/pending?keep=1&lang=zh-CN#client-navigation",
      );
      view.router.stores.location.set((location) => ({
        ...location,
        hash: "client-navigation",
      }));
    });
    expect(
      view.container.querySelector('[role="note"] a')?.getAttribute("href"),
    ).toBe("/docs/pending?keep=1&lang=zh-CN#client-navigation");
  });

  it("keeps the V1 arrival notice and original-page link without duplicating fallback text", () => {
    using view = mount(
      "/zh-CN/docs/pending?from=v1&src=%2Ffaq%2Fslurp&lang=zh-CN&keep=1#install",
    );
    expect(
      view.container.querySelector('[role="note"] a')?.getAttribute("href"),
    ).toBe(
      "/docs/pending?from=v1&src=%2Ffaq%2Fslurp&lang=zh-CN&keep=1#install",
    );
    const paragraphs = [...view.container.querySelectorAll("p")].map(
      (node) => node.textContent,
    );
    expect(paragraphs).toEqual([
      m.docs_locale_fallback({}, { locale: "zh-CN" }),
      m.docs_redirect_v1_notice(),
    ]);
    expect(
      view.container.querySelector('a[target="_blank"]')?.getAttribute("href"),
    ).toBe(`${zotlitLegacyUrl}/zh-CN/faq/slurp`);
  });

  it("shows no fallback on native Chinese pages, even with an old locale hint", () => {
    using view = mount("/zh-CN/docs/native?lang=zh-CN");
    expect(view.container.textContent).toBe("");
    expect(view.container.querySelector("a")).toBeNull();
  });

  it.each(["/docs/pending", "/docs/pending?lang=zh-CN"])(
    "shows no fallback on English pages: %s",
    (href) => {
      using view = mount(href, "en");
      expect(view.container.textContent).toBe("");
    },
  );

  it("keeps the original Chinese archive after following Read in English", () => {
    let englishHref: string;
    {
      using chinese = mount(
        "/zh-CN/docs/pending?from=v1&src=%2Ffaq%2Fslurp&lang=zh-CN#install",
      );
      englishHref = chinese.container
        .querySelector('[role="note"] a')!
        .getAttribute("href")!;
    }
    using english = mount(englishHref, "en");
    expect(english.container.querySelector('[role="note"]')).toBeNull();
    expect(
      [...english.container.querySelectorAll("p")].map(
        (node) => node.textContent,
      ),
    ).toEqual([m.docs_redirect_v1_notice()]);
    expect(
      english.container
        .querySelector('a[target="_blank"]')
        ?.getAttribute("href"),
    ).toBe(`${zotlitLegacyUrl}/zh-CN/faq/slurp`);
    expect(window.location.hash).toBe("#install");
  });

  it("rejects a caller-supplied external V1 source without adding a second notice", () => {
    using view = mount(
      "/zh-CN/docs/pending?from=v1&src=%2F%2Fexample.com&lang=zh-CN",
    );
    expect(view.container.querySelectorAll("p")).toHaveLength(1);
    expect(view.container.querySelector('a[target="_blank"]')).toBeNull();
  });
});
