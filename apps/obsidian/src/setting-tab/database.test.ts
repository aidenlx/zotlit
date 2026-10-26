// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { DropdownComponent, Setting } from "@mock/obsidian";
import { Effect, Layer, PubSub, Stream, SubscriptionRef } from "effect";
import type { Setting as ObsidianSetting, SettingGroup } from "obsidian";
import { vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";
import type {
  ZoteroPrefSnapshot,
  ZoteroProfileInfo,
} from "@/services/zotero-pref/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type {
  ZoteroReadsApi,
  ZoteroReadsEvent,
  ZoteroReadsState,
} from "@/services/zotero-reads/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { testSettingTab } from "./__fixtures__";
import type { SettingTabContext } from "./context";
import { databaseLocationItems } from "./database";

const SNAPSHOT: ZoteroPrefSnapshot = {
  state: "ready",
  prefs: new Map(),
  resolvedProfileDir: "/home/ada/.zotero/abc.default",
  profileDirOverride: null,
  dataDirOverride: null,
  dataDir: "/home/ada/Zotero",
  databasePath: "/home/ada/Zotero/zotero.sqlite",
  sourceId: "source-1",
  baseAttachmentPath: null,
  httpPort: null,
};

const PROFILES: ZoteroProfileInfo[] = [
  { dir: "/home/ada/.zotero/abc.default", name: "default", isDefault: true },
  { dir: "/home/ada/.zotero/xyz.thesis", name: "thesis", isDefault: false },
];

const READS: ZoteroReadsState = {
  state: "ready",
  error: null,
  moved: false,
  dbFileMissing: false,
  activeReadMode: "copy",
};

/**
 * The Zotero location rows over a preference store and reads the test drives.
 * A folder write re-reads the preferences, as the real service does.
 */
const setup = Effect.fn("setup")(function* () {
  const pref = yield* SubscriptionRef.make(SNAPSHOT);
  const reads = yield* SubscriptionRef.make(READS);
  const events = yield* PubSub.unbounded<ZoteroReadsEvent>({ replay: 1 });
  const writes: string[] = [];
  const write = (
    field: "profileDirOverride" | "dataDirOverride",
    dir: string | null,
  ) =>
    Effect.sync(() => writes.push(`${field}=${dir}`)).pipe(
      Effect.andThen(
        SubscriptionRef.update(pref, (current) => ({
          ...current,
          prefs: new Map(),
          [field]: dir,
        })),
      ),
    );
  const services = yield* Layer.build(
    Layer.mergeAll(
      Layer.mock(ZoteroPref, {
        current: SubscriptionRef.get(pref),
        changes: SubscriptionRef.changes(pref),
        listProfiles: Effect.succeed(PROFILES),
        setProfileDir: (dir) => write("profileDirOverride", dir),
        setDataDir: (dir) => write("dataDirOverride", dir),
      }),
      Layer.mock(ZoteroReads, {
        reads: stubService<ZoteroReadsApi>("ZoteroReadsApi", {}),
        current: SubscriptionRef.get(reads),
        events: Stream.fromPubSub(events),
      }),
    ),
  );
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab(services).tab,
    settings: stubService<SettingTabContext["settings"]>("Settings", {
      current: Effect.succeed(defaults),
      changes: Stream.empty,
    }),
  });
  return { ctx, pref, reads, events, writes };
});

/** The rendered row with the given id, so a test reads what the user gets. */
function render(ctx: SettingTabContext, id: string) {
  const row = databaseLocationItems(ctx).find((item) => item.id === id);
  if (!row || !("render" in row) || !row.render)
    throw new Error(`Expected a render row: ${id}`);
  const setting = new Setting(document.createElement("div"));
  row.render(
    setting as unknown as ObsidianSetting,
    stubService<SettingGroup>("SettingGroup", {}),
  );
  const dropdown = setting.components.find(
    (control) => control instanceof DropdownComponent,
  );
  return {
    dropdown,
    text: () => (setting.desc as unknown as DocumentFragment).textContent,
  };
}

/** Wait for the row's fiber to paint what `assertion` checks. */
const eventually = (assertion: () => void) =>
  Effect.promise(() => vi.waitFor(assertion));

it.effect(
  "lists the profiles and writes a chosen profile folder through ZoteroPref",
  () =>
    Effect.gen(function* () {
      const { ctx, pref, writes } = yield* setup();
      const row = render(ctx, "settings_db_profile_dir");

      yield* eventually(() =>
        expect(row.dropdown?.options.map((option) => option.value)).toEqual([
          "",
          ...PROFILES.map((profile) => profile.dir),
          "\0browse",
        ]),
      );
      expect(row.text()).toContain("/home/ada/.zotero/abc.default/prefs.js");

      row.dropdown!.choose(PROFILES[1]!.dir);
      yield* eventually(() =>
        expect(writes).toEqual([`profileDirOverride=${PROFILES[1]!.dir}`]),
      );

      yield* SubscriptionRef.update(pref, (current) => ({
        ...current,
        state: "loading" as const,
        prefs: new Map(),
      }));
      yield* eventually(() =>
        expect(row.text()).toContain(m.settings_db_status_loading()),
      );
    }),
);

it.effect(
  "writes the data folder override and follows the resolved data folder",
  () =>
    Effect.gen(function* () {
      const { ctx, pref, writes } = yield* setup();
      const row = render(ctx, "settings_db_data_dir");
      yield* eventually(() => expect(row.text()).toContain("/home/ada/Zotero"));

      // A folder chosen elsewhere joins the dropdown as the selected entry.
      yield* SubscriptionRef.update(pref, (current) => ({
        ...current,
        dataDirOverride: "/mnt/library",
        dataDir: "/mnt/library",
      }));
      yield* eventually(() => {
        expect(row.text()).toContain("/mnt/library");
        expect(row.dropdown?.getValue()).toBe("/mnt/library");
      });

      row.dropdown!.choose("");
      yield* eventually(() => expect(writes).toEqual(["dataDirOverride=null"]));
    }),
);

it.effect("echoes the profile, data folder and Source ID as they move", () =>
  Effect.gen(function* () {
    const { ctx, pref } = yield* setup();
    const row = render(ctx, "settings_db_source_id");
    yield* eventually(() => expect(row.text()).toContain("source-1"));

    yield* SubscriptionRef.update(pref, (current) => ({
      ...current,
      prefs: new Map(),
      sourceId: "source-2",
    }));
    yield* eventually(() => expect(row.text()).toContain("source-2"));
  }),
);

it.effect("names the read mode again after the reads change", () =>
  Effect.gen(function* () {
    const { ctx, reads, events } = yield* setup();
    const row = render(ctx, "settings_db_read_mode");
    const named = (mode: () => string) =>
      m.settings_db_active_read_mode({ mode: mode() });
    yield* eventually(() =>
      expect(row.text()).toContain(named(m.settings_db_read_mode_copy)),
    );

    yield* SubscriptionRef.update(reads, (current) => ({
      ...current,
      activeReadMode: "reflink" as const,
    }));
    yield* PubSub.publish(events, { _tag: "changed" });
    yield* eventually(() =>
      expect(row.text()).toContain(named(m.settings_db_read_mode_reflink)),
    );
  }),
);
