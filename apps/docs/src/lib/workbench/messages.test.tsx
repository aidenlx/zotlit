// Shared controls use the site's locale for each concurrent server render.
import { AsyncLocalStorage } from "node:async_hooks";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { DataExplorer, TabBar } from "@zotlit/workbench/ui";

import { m } from "@/paraglide/messages.js";
import {
  getServerAsyncLocalStorage,
  overwriteServerAsyncLocalStorage,
} from "@/paraglide/runtime.js";
import type { ParaglideAsyncLocalStorage } from "@/paraglide/runtime.js";

import { WebTestHost } from "./test-host";

it("keeps shared labels in the locale of each web request", async () => {
  const previous = getServerAsyncLocalStorage();
  const storage = new AsyncLocalStorage<
    NonNullable<ReturnType<ParaglideAsyncLocalStorage["getStore"]>>
  >();
  overwriteServerAsyncLocalStorage(storage);
  try {
    const ready = Promise.withResolvers<void>();
    const page = () =>
      renderToStaticMarkup(
        <WebTestHost>
          <TabBar />
          <DataExplorer
            root="note"
            data={{ title: "A paper" }}
            copy={async () => {}}
          />
        </WebTestHost>,
      );
    const [chinese, english] = await Promise.all([
      storage.run({ locale: "zh-CN" }, async () => {
        await ready.promise;
        return page();
      }),
      storage.run({ locale: "en" }, async () => {
        ready.resolve();
        await Promise.resolve();
        return page();
      }),
    ]);
    for (const [html, locale] of [
      [chinese, "zh-CN"],
      [english, "en"],
    ] as const) {
      expect(html).toContain(`>${m.workbench_tab_match({}, { locale })}<`);
      expect(html).toContain(
        `>${m.workbench_explorer_simple({}, { locale })}<`,
      );
    }
  } finally {
    overwriteServerAsyncLocalStorage(previous);
    storage.disable();
  }
});
