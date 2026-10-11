import {
  Link,
  useParams,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { FrameworkProvider } from "fumadocs-core/framework";
import type { Framework } from "fumadocs-core/framework";
import { i18nProvider, uiTranslations } from "fumadocs-ui/i18n";
import type { Translations } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/base";
import { useMemo, useRef } from "react";
import type { ReactNode } from "react";

import { DocsImage } from "@/components/docs-image";
import { i18n } from "@/lib/i18n";
import {
  deLocalizeHref,
  getLocale,
  isLocale,
  setLocale,
} from "@/paraglide/runtime.js";

import englishUI from "#i18n/en.json";
import chineseUI from "#i18n/zh-CN.json";

const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    en: englishUI.fumadocs satisfies Translations,
    "zh-CN": chineseUI.fumadocs satisfies Translations,
  });

/**
 * Fumadocs' TanStack adapter with the public pathname. Router rewrites keep
 * route matching unprefixed, while Fumadocs' locale trees use public URLs.
 * Keep the package adapter's stable pathname during pending navigation.
 */
const framework: Framework = {
  Link({ href = "#", prefetch = true, ...props }) {
    return (
      <Link
        to={
          href.startsWith("/") && !href.startsWith("//")
            ? deLocalizeHref(href)
            : href
        }
        preload={prefetch ? "intent" : false}
        {...props}
      />
    );
  },
  Image: DocsImage,
  usePathname() {
    const { isLoading, publicHref } = useRouterState({
      select: (state) => ({
        isLoading: state.isLoading,
        publicHref: state.location.publicHref,
      }),
    });
    const pathname = new URL(publicHref, "https://zotlit.invalid").pathname;
    const activePathname = useRef(pathname);
    return useMemo(() => {
      if (isLoading) return activePathname.current;
      activePathname.current = pathname;
      return pathname;
    }, [isLoading, pathname]);
  },
  useRouter() {
    const router = useRouter();
    return useMemo(
      () => ({
        push(url: string) {
          void router.navigate({ href: url });
        },
        refresh() {
          void router.invalidate();
        },
      }),
      [router],
    );
  },
  useParams() {
    return useParams({ strict: false });
  },
};

/** Native language controls and search, with Paraglide owning locale changes. */
export function LocaleProvider({ children }: { children: ReactNode }) {
  return (
    <FrameworkProvider {...framework}>
      <RootProvider
        i18n={{
          ...i18nProvider(translations, getLocale()),
          onLocaleChange(locale) {
            if (isLocale(locale)) void setLocale(locale);
          },
        }}
      >
        {children}
      </RootProvider>
    </FrameworkProvider>
  );
}
