import { Analytics } from "@vercel/analytics/next";

import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import { type Metadata } from "next";
import { Gelasio, Inter } from "next/font/google";
import localFont from "next/font/local";

import { appName, baseURL } from "@/lib/shared";

// App-wide base font, exposed as a variable and assigned via --font-sans in
// global.css. preload is off because preload scope follows this call site (the
// root layout = every route) while paint is route-dependent — /docs stays on
// the sans stack and (home) never renders it at all. /docs discovers it at
// CSS-parse time and swaps from the metric-adjusted "Inter Fallback", so the
// cost there is a brief shift-free FOUT.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  preload: false,
});

// Serif voice paints on every route — (home) chrome and now /docs article
// body too — so the loader and its preload belong at the root. The
// `fallback` list both serves as the runtime stack and suppresses next/font's
// generated metric-fallback face.
const gelasio = Gelasio({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-gelasio",
  fallback: ["Iowan Old Style", "Charter", "Georgia", "serif"],
});

// Archivo SemiBold subset to the five "ZotLit" glyphs (~1 KB) — brand wordmark only.
const archivo = localFont({
  src: "./fonts/archivo-semibold-zotlit.woff2",
  weight: "600",
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: baseURL,
  title: {
    default: appName,
    template: `%s | ${appName}`,
  },
  description:
    "ZotLit integrates Zotero with Obsidian — literature notes, citations, and annotations, all inside your vault.",
};

// Suppress React 19 "Encountered a script tag" dev warning from next-themes.
// next-themes injects an inline <script> to prevent FOUC — works correctly on
// SSR but React warns when re-rendered on the client. Setting type to a non-JS
// MIME prevents the warning while preserving SSR execution.
// See: https://github.com/pacocoursey/next-themes/issues/387
const scriptProps =
  typeof window === "undefined"
    ? undefined
    : ({ type: "application/json" } as const);

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${gelasio.variable} ${archivo.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col">
        <RootProvider theme={{ scriptProps }}>{children}</RootProvider>
        <Analytics />
      </body>
    </html>
  );
}
