// The Welcome model follows service changes and releases the reads owned by its leaves.
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { expect } from "vitest";

import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { QueryClients } from "@/services/query-client/service";
import { Release } from "@/services/release/service";
import { PluginSettings } from "@/services/settings/service";

import { makeWelcomeHost, waitFor } from "./__fixtures__";
import { requestWelcome, setConverted } from "./model";

const openHost = Effect.fnUntraced(function* () {
  return yield* Effect.acquireDisposable(
    Effect.promise(() => makeWelcomeHost()),
  );
});

it.effect(
  "shares the connection read across leaves and keeps each session's gestures separate",
  () =>
    Effect.gen(function* () {
      const host = yield* openHost();
      const first = yield* Effect.acquireDisposable(
        Effect.sync(() => host.openSession()),
      );
      const second = yield* Effect.acquireDisposable(
        Effect.sync(() => host.openSession()),
      );
      yield* Effect.promise(() =>
        waitFor(() => {
          expect(first.state().connection.status).toBe("connected");
          expect(second.state().connection.status).toBe("connected");
        }),
      );
      host.registry.update(first.model.session, requestWelcome);
      host.registry.update(first.model.session, setConverted(true));
      expect(first.state().requests).toBe(1);
      expect(first.state().converted).toBe(true);
      expect(second.state().requests).toBe(0);
      expect(second.state().converted).toBe(false);
      expect(host.reads()).toBe(1);
    }),
);

it.effect(
  "reads again after a database change and keeps the count on unrelated settings and refresh requests",
  () =>
    Effect.gen(function* () {
      const host = yield* openHost();
      const leaf = yield* Effect.acquireDisposable(
        Effect.sync(() => host.openSession()),
      );
      yield* Effect.promise(() =>
        waitFor(() => expect(leaf.state().connection.status).toBe("connected")),
      );
      host.publish({ _tag: "changed" });
      yield* Effect.promise(() =>
        waitFor(() => {
          expect(host.reads()).toBe(2);
          expect(host.registry.get(leaf.model.loaded).waiting).toBe(false);
        }),
      );
      const settings = yield* Effect.provideContext(
        PluginSettings,
        host.context,
      );
      yield* settings.update({ "welcome.steps-shown": true });
      host.publish({ _tag: "refresh-requested" });
      yield* Effect.promise(() =>
        waitFor(() => expect(leaf.state().stepsShown).toBe(true)),
      );
      expect(host.reads()).toBe(2);
    }),
);

it.effect("invalidates the cached count while every leaf is closed", () =>
  Effect.gen(function* () {
    const host = yield* openHost();
    const first = host.openSession();
    yield* Effect.promise(() =>
      waitFor(() => expect(first.state().connection.status).toBe("connected")),
    );
    first[Symbol.dispose]();
    host.publish({ _tag: "changed" });
    const next = yield* Effect.acquireDisposable(
      Effect.sync(() => host.openSession()),
    );
    yield* Effect.promise(() =>
      waitFor(() => {
        expect(next.state().connection.status).toBe("connected");
        expect(host.reads()).toBe(2);
      }),
    );
  }),
);

it.effect(
  "interrupts a connection wait when a refresh replaces it and when the last leaf closes",
  () =>
    Effect.gen(function* () {
      let started = 0;
      let cancelled = 0;
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          makeWelcomeHost({
            services: Layer.mock(QueryClients, {
              client: stubService<QueryClients["Service"]["client"]>(
                "QueryClient",
                {},
              ),
              peek: () => Effect.succeed(null),
              invalidate: () => Effect.void,
              read: () =>
                Effect.gen(function* () {
                  started += 1;
                  return yield* Effect.never;
                }).pipe(
                  Effect.ensuring(
                    Effect.sync(() => {
                      cancelled += 1;
                    }),
                  ),
                ),
            }),
          }),
        ),
      );
      const leaf = host.openSession();
      yield* Effect.promise(() => waitFor(() => expect(started).toBe(1)));
      host.publish({ _tag: "changed" });
      yield* Effect.promise(() =>
        waitFor(() => {
          expect(started).toBe(2);
          expect(cancelled).toBe(1);
        }),
      );
      leaf[Symbol.dispose]();
      yield* Effect.promise(() => waitFor(() => expect(cancelled).toBe(2)));
    }),
);

it.effect(
  "updates vault evidence on folder and template changes, with no read for other settings",
  () =>
    Effect.gen(function* () {
      const vault = new MemoryVault();
      let evidenceReads = 0;
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          makeWelcomeHost({
            sources: { vault },
            services: Layer.mock(Release, {
              version: "2.2.0",
              hasV1Templates: (path) =>
                Effect.sync(() => {
                  evidenceReads += 1;
                  return vault.getFileByPath(`${path}/zt-note.eta.md`) !== null;
                }),
            }),
          }),
        ),
      );
      const leaf = yield* Effect.acquireDisposable(
        Effect.sync(() => host.openSession()),
      );
      const settings = yield* Effect.provideContext(
        PluginSettings,
        host.context,
      );
      yield* settings.update({ "template.folder": "templates" });
      yield* Effect.promise(() =>
        waitFor(() => expect(leaf.state().templateFolder).toBe("templates")),
      );
      const before = evidenceReads;
      yield* settings.update({ "welcome.steps-shown": true });
      yield* Effect.promise(() =>
        waitFor(() => expect(leaf.state().stepsShown).toBe(true)),
      );
      expect(evidenceReads).toBe(before);
      vault.addFolder(leaf.state().literatureFolder);
      const file = vault.add("templates/zt-note.eta.md");
      yield* Effect.promise(() =>
        waitFor(() => {
          expect(leaf.state().literatureFolderExists).toBe(true);
          expect(leaf.state().v1TemplatesPresent).toBe(true);
        }),
      );
      vault.rename(file, "templates/Converted.md");
      yield* Effect.promise(() =>
        waitFor(() => expect(leaf.state().v1TemplatesPresent).toBe(false)),
      );
      vault.add("templates/zt-note.eta.md");
      yield* Effect.promise(() =>
        waitFor(() => expect(leaf.state().v1TemplatesPresent).toBe(true)),
      );
      vault.remove("templates/zt-note.eta.md");
      yield* Effect.promise(() =>
        waitFor(() => expect(leaf.state().v1TemplatesPresent).toBe(false)),
      );
    }),
);
