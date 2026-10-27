// Service gestures owned by one Workbench leaf.
import { Effect } from "effect";
import type { App, TFile } from "obsidian";

import { isChildItemFields, parseIndexedKey } from "@zotlit/db";
import type { LiteratureNoteTemplatePartial } from "@zotlit/templates/literature-note-pack";

import { itemSummary } from "@/lib/item-summary";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { listInstalledStylesOrNone } from "@/services/pandoc/installed-styles";
import { Profile } from "@/services/profile/service";
import { openCitationTemplate } from "@/services/template/actions";
import { Template } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { makeWorkbenchCommand, makeWorkbenchTask } from "./command";
import { getSampleItem } from "./selection-data";

export function makeWorkbenchCommands(registry: ViewRegistryHandle) {
  const commands = {
    select: makeWorkbenchCommand(registry, (indexedKey: string) =>
      Effect.gen(function* () {
        const sample = getSampleItem(indexedKey);
        if (sample) return { id: indexedKey, title: sample.item.title ?? null };
        if (!parseIndexedKey(indexedKey)) return null;
        const db = yield* ZoteroReads;
        if ((yield* db.current).state === "degraded") return null;
        const items = yield* db.reads.ItemsByIndexedKeys({
          indexedKeys: [indexedKey],
        });
        const item = items.get(indexedKey);
        return !item || isChildItemFields(item.fields)
          ? null
          : { id: indexedKey, title: itemSummary(item, item.fields).formatted };
      }),
    ),
    builtIn: makeWorkbenchTask(registry, () =>
      Effect.gen(function* () {
        return yield* (yield* Profile).getBuiltInSource();
      }),
    ),
    profileOf: makeWorkbenchCommand(registry, (file: TFile) =>
      Effect.gen(function* () {
        return yield* (yield* Profile).profileOf(file);
      }),
    ),
    settle: makeWorkbenchTask(registry, () =>
      Effect.gen(function* () {
        return yield* (yield* Template).waitUntilSettled(10_000);
      }),
    ),
    materialize: makeWorkbenchTask(registry, () =>
      Effect.gen(function* () {
        return yield* (yield* Profile).materializeDefault();
      }),
    ),
    restore: makeWorkbenchTask(registry, () =>
      Effect.gen(function* () {
        const profile = yield* Profile;
        yield* profile.restoreDefault();
        return yield* profile.getSource("default");
      }),
    ),
    citation: makeWorkbenchCommand(registry, (app: App) =>
      Effect.gen(function* () {
        yield* openCitationTemplate(app, yield* Template);
      }),
    ),
    unpack: makeWorkbenchCommand(
      registry,
      (bundled: readonly LiteratureNoteTemplatePartial[]) =>
        Effect.gen(function* () {
          const templates = yield* Template;
          return yield* templates.unpackPartials(
            yield* templates.planPartialUnpack(bundled),
          );
        }),
    ),
    styles: makeWorkbenchTask(registry, () =>
      Effect.gen(function* () {
        const { dataDir } = yield* (yield* ZoteroPref).current;
        return dataDir ? yield* listInstalledStylesOrNone(dataDir) : [];
      }),
    ),
  };
  return {
    ...commands,
    [Symbol.dispose]() {
      for (const command of Object.values(commands).reverse())
        command[Symbol.dispose]();
    },
  };
}

/** The shared native chooser still owns its modal and its search session. */
export const makeChoiceCommand = <A>(
  registry: ViewRegistryHandle,
  choose: () => Promise<A>,
) =>
  makeWorkbenchTask(registry, () =>
    Effect.tryPromise((signal) => {
      signal.throwIfAborted();
      return choose();
    }),
  );

export const makeDefaultSourceCommand = (registry: ViewRegistryHandle) =>
  makeWorkbenchTask(registry, () =>
    Effect.gen(function* () {
      return yield* (yield* Profile).getSource("default");
    }),
  );
