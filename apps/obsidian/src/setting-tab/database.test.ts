// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import {
  DropdownComponent,
  ExtraButtonComponent,
  Setting,
} from "@mock/obsidian";
import { Effect, Layer, PubSub, Stream, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";
import type { Setting as ObsidianSetting, SettingGroup } from "obsidian";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";
import type {
  ZoteroPrefSnapshot,
  ZoteroProfileInfo,
} from "@/services/zotero-pref/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import type {
  ZoteroReadsApi,
  ZoteroReadsEvent,
  ZoteroReadsState,
} from "@/services/zotero-reads/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { scopedSettingTab } from "./__fixtures__";
import type { SettingTabContext } from "./context";
import { databaseFileItem, databaseLocationItems } from "./database";

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
 * A folder write moves the override and keeps the preferences until they are
 * read again, as the real service does.
 */
const setup = Effect.fn("setup")(function* (
  refresh: ZoteroReads["Service"]["refresh"] = Effect.void,
) {
  const notifier = testNotifier();
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
          [field]: dir,
        })),
      ),
    );
  const services = yield* Layer.build(
    Layer.mergeAll(
      notifier.layer,
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
        changes: SubscriptionRef.changes(reads),
        refresh,
        events: Stream.fromPubSub(events),
      }),
    ),
  );
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: (yield* scopedSettingTab(services)).tab,
    settings: stubService<SettingTabContext["settings"]>("Settings", {
      current: Effect.succeed(defaults),
      changes: Stream.empty,
    }),
  });
  return { ctx, pref, reads, events, writes, notices: notifier.notices };
});

/**
 * The rendered row with the given id, so a test reads what the user gets. The
 * row's cleanup runs when the case ends.
 */
const render = Effect.fnUntraced(function* (
  ctx: SettingTabContext,
  id: string,
) {
  const row = [databaseFileItem(ctx), ...databaseLocationItems(ctx)].find(
    (item) => item.id === id,
  );
  if (!row || !("render" in row) || !row.render)
    throw new Error(`Expected a render row: ${id}`);
  const setting = new Setting(document.createElement("div"));
  const cleanup = row.render(
    setting as unknown as ObsidianSetting,
    stubService<SettingGroup>("SettingGroup", {}),
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => cleanup?.()));
  const dropdown = setting.components.find(
    (control) => control instanceof DropdownComponent,
  );
  const button = setting.components.find(
    (control) => control instanceof ExtraButtonComponent,
  );
  return {
    dropdown,
    button,
    text: () => (setting.desc as unknown as DocumentFragment).textContent,
  };
});

/** Let the row fibers take what is queued for them; no time passes. */
const settle = TestClock.adjust("0 millis");

it.effect(
  "lists the profiles and writes a chosen profile folder through ZoteroPref",
  () =>
    Effect.gen(function* () {
      const { ctx, pref, writes } = yield* setup();
      const row = yield* render(ctx, "settings_db_profile_dir");

      yield* settle;
      expect(row.dropdown?.options.map((option) => option.value)).toEqual([
        "",
        ...PROFILES.map((profile) => profile.dir),
        "\0browse",
      ]);
      expect(row.text()).toContain("/home/ada/.zotero/abc.default/prefs.js");

      row.dropdown!.choose(PROFILES[1]!.dir);
      yield* settle;
      expect(writes).toEqual([`profileDirOverride=${PROFILES[1]!.dir}`]);

      yield* SubscriptionRef.update(pref, (current) => ({
        ...current,
        state: "loading" as const,
        prefs: new Map(),
      }));
      yield* settle;
      expect(row.text()).toContain(m.settings_db_status_loading());
    }),
);

it.effect(
  "writes the data folder override and follows the resolved data folder",
  () =>
    Effect.gen(function* () {
      const { ctx, pref, writes } = yield* setup();
      const row = yield* render(ctx, "settings_db_data_dir");
      yield* settle;
      expect(row.text()).toContain("/home/ada/Zotero");

      // A folder chosen elsewhere joins the dropdown as the selected entry.
      yield* SubscriptionRef.update(pref, (current) => ({
        ...current,
        dataDirOverride: "/mnt/library",
        dataDir: "/mnt/library",
      }));
      yield* settle;
      expect(row.text()).toContain("/mnt/library");
      expect(row.dropdown?.getValue()).toBe("/mnt/library");

      row.dropdown!.choose("");
      yield* settle;
      expect(writes).toEqual(["dataDirOverride=null"]);
    }),
);

it.effect("echoes the profile, data folder and Source ID as they move", () =>
  Effect.gen(function* () {
    const { ctx, pref } = yield* setup();
    const row = yield* render(ctx, "settings_db_source_id");
    yield* settle;
    expect(row.text()).toContain("source-1");

    yield* SubscriptionRef.update(pref, (current) => ({
      ...current,
      prefs: new Map(),
      sourceId: "source-2",
    }));
    yield* settle;
    expect(row.text()).toContain("source-2");
  }),
);

it.effect("names the read mode again after the reads change", () =>
  Effect.gen(function* () {
    const { ctx, reads, events } = yield* setup();
    const row = yield* render(ctx, "settings_db_read_mode");
    const named = (mode: () => string) =>
      m.settings_db_active_read_mode({ mode: mode() });
    yield* settle;
    expect(row.text()).toContain(named(m.settings_db_read_mode_copy));

    yield* SubscriptionRef.update(reads, (current) => ({
      ...current,
      activeReadMode: "reflink" as const,
    }));
    yield* PubSub.publish(events, { _tag: "changed" });
    yield* settle;
    expect(row.text()).toContain(named(m.settings_db_read_mode_reflink));
  }),
);

/** Every message the notices showed, in order. */
const messages = (notices: readonly { messages: readonly unknown[] }[]) =>
  notices.flatMap((notice) => notice.messages);

it.effect("reports a refresh from the database row as it ends", () =>
  Effect.gen(function* () {
    const { ctx, notices } = yield* setup();
    const row = yield* render(ctx, "settings_db_file");
    // The path paints once the row's fiber has wired the button.
    yield* settle;
    expect(row.text()).toContain("/home/ada/Zotero/zotero.sqlite");

    row.button!.click();
    yield* settle;
    expect(messages(notices)).toEqual([m.notice_db_refreshed()]);
  }),
);

it.effect("shows a failed refresh in one notice", () =>
  Effect.gen(function* () {
    const { ctx, notices } = yield* setup(
      Effect.fail(new DbUnavailable({ message: "zotero.sqlite is locked" })),
    );
    const row = yield* render(ctx, "settings_db_file");
    yield* settle;
    expect(row.text()).toContain("/home/ada/Zotero/zotero.sqlite");

    row.button!.click();
    yield* settle;
    expect(messages(notices)).toEqual([m.notice_db_refresh_failed()]);
  }),
);
