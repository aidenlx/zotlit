import { Effect, Stream } from "effect";
import { join } from "node:path";
import type {
  DropdownComponent,
  ExtraButtonComponent,
  Setting,
  SettingGroupItem,
} from "obsidian";

import { passAborted } from "@/lib/abort-error";
import { DOCS_COMPANION, DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";
import type {
  ConfiguredReadMode,
  EffectiveReadMode,
} from "@/services/database/read-source";
import {
  getZoteroProfilesRoot,
  PREFS_FILENAME,
} from "@/services/zotero-pref/prefs-file";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroProfileInfo } from "@/services/zotero-pref/service";
import {
  changed,
  degraded,
  refreshFailed,
  refreshing,
} from "@/services/zotero-reads/events";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsState } from "@/services/zotero-reads/service";

import type { SettingsKey, SettingTabContext } from "./context";
import { appendDeviceOverrideNote, browseForDir } from "./device-override";
import { paintEach } from "./effect-tab";

/** Folder-picker dropdown sentinel for auto-detect — a real dir is never empty. */
const PICKER_AUTO = "";
/** Folder-picker dropdown sentinel that opens the folder picker; NUL can't be in a path. */
const PICKER_BROWSE = "\0browse";

/** The Zotero page's lead row: the database file, its status, and refresh. */
export function databaseFileItem(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_db_file",
    name: m.settings_db_file_name(),
    desc: m.settings_db_file_desc(),
    render: (setting) => renderDatabaseFileRow(setting, ctx),
  };
}

/**
 * The Zotero page's Sync rows the database owns: Companion setup, change
 * watching, and the stale-data guide. `liveUpdates` are the Companion's rows,
 * placed right after its setup row.
 */
export function databaseSyncItems(
  liveUpdates: SettingGroupItem<SettingsKey>[],
): SettingGroupItem<SettingsKey>[] {
  return [
    {
      id: "settings_db_companion",
      name: m.settings_db_companion_name(),
      desc: m.settings_db_companion_desc(),
      render: (setting) => {
        setting.addButton((button) =>
          button
            .setButtonText(m.settings_db_companion_install())
            .onClick(() => window.open(DOCS_COMPANION)),
        );
      },
    },
    ...liveUpdates,
    {
      id: "settings_db_auto_refresh",
      name: m.settings_db_auto_refresh_name(),
      desc: m.settings_db_auto_refresh_desc(),
      control: { type: "toggle", key: "zotero.auto-refresh" },
    },
    {
      id: "settings_db_stale_help",
      name: m.settings_db_stale_help_name(),
      desc: m.settings_db_stale_help_desc(),
      render: (setting) => {
        setting.addButton((button) =>
          button
            .setButtonText(m.settings_db_stale_help_action())
            .onClick(() =>
              window.open(`${DOCS_SITE_URL}/docs/how-to/fix-stale-data`),
            ),
        );
      },
    },
  ];
}

/**
 * The Zotero location page: where and how ZotLit reads Zotero — the profile,
 * the data directory override, read mode, and the Source ID they produce.
 */
export function databaseLocationItems(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey>[] {
  return [
    {
      id: "settings_db_profile_dir",
      name: m.settings_db_profile_dir_name(),
      desc: m.settings_db_profile_dir_desc(),
      render: (setting) => renderProfileDirRow(setting, ctx),
    },
    {
      id: "settings_db_data_dir",
      name: m.settings_db_data_dir_name(),
      desc: m.settings_db_data_dir_desc(),
      render: (setting) => renderDataDirRow(setting, ctx),
    },
    {
      id: "settings_db_read_mode",
      name: m.settings_db_read_mode_name(),
      desc: m.settings_db_read_mode_desc(),
      render: (setting) => renderReadModeRow(setting, ctx),
    },
    {
      id: "settings_db_source_id",
      name: m.settings_db_source_id_name(),
      desc: m.settings_db_source_id_desc(),
      render: (setting) => renderSourceIdRow(setting, ctx),
    },
  ];
}

/** What the Database file row's status line shows, folded from the reads' events. */
interface DatabaseFileStatus {
  readonly state: ZoteroReadsState["state"];
  readonly refreshing: boolean;
  readonly refreshFailed: boolean;
  readonly errorMessage: string | null;
}

/**
 * Database file row: resolved `zotero.sqlite` path + a refresh button + an
 * inline status line that surfaces loading / refreshing / degraded /
 * refresh-failed states. The path derives from the Zotero profile's data dir,
 * so it updates when the profile changes.
 */
function renderDatabaseFileRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const desc = createFragment();
  desc.append(m.settings_db_file_desc());
  desc.append(createEl("br"));
  const pathCode = createEl("code");
  desc.append(pathCode);
  const statusBr = createEl("br");
  const statusSpan = createSpan();
  statusBr.classList.add("zt:hidden");
  statusSpan.classList.add("zt:hidden");
  desc.append(statusBr, statusSpan);

  let refreshButton: ExtraButtonComponent | undefined;
  setting.setDesc(desc).addExtraButton((button) => {
    refreshButton = button
      .setIcon("refresh-cw")
      .setTooltip(m.settings_db_refresh());
  });

  const paintStatus = (status: DatabaseFileStatus): void => {
    const text =
      status.state === "loading"
        ? m.settings_db_status_loading()
        : status.refreshing
          ? m.settings_db_status_refreshing()
          : status.state === "degraded"
            ? m.settings_db_status_degraded()
            : status.refreshFailed
              ? m.settings_db_status_refresh_failed()
              : "";
    const isError =
      !status.refreshing &&
      status.state !== "loading" &&
      (status.state === "degraded" || status.refreshFailed);
    statusBr.classList.toggle("zt:hidden", !text);
    statusSpan.classList.toggle("zt:hidden", !text);
    statusSpan.textContent = text;
    statusSpan.classList.toggle("mod-warning", Boolean(text) && isError);
    statusSpan.ariaLabel = text ? (status.errorMessage ?? "") : null;
    refreshButton?.setDisabled(status.state === "loading" || status.refreshing);
  };

  return ctx.tab.mount(
    Effect.gen(function* () {
      const reads = yield* ZoteroReads;
      const pref = yield* ZoteroPref;
      const notifier = yield* Notifier;

      refreshButton?.onClick(
        () =>
          void ctx.tab.run(
            Effect.scoped(
              Effect.gen(function* () {
                const progress = yield* notifier.progress;
                yield* progress.setMessage(m.notice_db_refreshing());
                yield* reads.refresh;
              }),
            ).pipe(Effect.andThen(notifier.show(m.notice_db_refreshed()))),
            m.notice_db_refresh_failed(),
          ),
      );

      // Events miss the loading→ready/degraded transition (T14 contract), so
      // the error starts from the reads' own state when already degraded.
      const initial = yield* reads.current;
      const status = Stream.mergeAll(
        [
          reads.changes.pipe(
            Stream.map(
              ({ state }) =>
                (current: DatabaseFileStatus): DatabaseFileStatus => ({
                  ...current,
                  state,
                }),
            ),
          ),
          changed(reads).pipe(
            Stream.map(
              () =>
                (current: DatabaseFileStatus): DatabaseFileStatus => ({
                  ...current,
                  refreshFailed: false,
                  errorMessage: null,
                }),
            ),
          ),
          degraded(reads).pipe(
            Stream.map(
              (error) =>
                (current: DatabaseFileStatus): DatabaseFileStatus => ({
                  ...current,
                  errorMessage: extractErrorMessage(error),
                }),
            ),
          ),
          refreshFailed(reads).pipe(
            Stream.map(
              (error) =>
                (current: DatabaseFileStatus): DatabaseFileStatus => ({
                  ...current,
                  refreshFailed: true,
                  errorMessage: extractErrorMessage(error),
                }),
            ),
          ),
          refreshing(reads).pipe(
            Stream.map(
              (active) =>
                (current: DatabaseFileStatus): DatabaseFileStatus => ({
                  ...current,
                  refreshing: active,
                }),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Stream.scan(
          (): DatabaseFileStatus => ({
            state: initial.state,
            refreshing: false,
            refreshFailed: false,
            errorMessage:
              initial.state === "degraded" && initial.error
                ? extractErrorMessage(initial.error)
                : null,
          }),
          (
            current,
            step: (current: DatabaseFileStatus) => DatabaseFileStatus,
          ) => step(current),
        ),
      );
      const path = pref.changes.pipe(
        Stream.map((snapshot) => snapshot.databasePath),
        Stream.changes,
      );
      yield* Effect.all(
        [
          paintEach(status, paintStatus),
          paintEach(path, (databasePath) => {
            pathCode.textContent = databasePath;
          }),
        ],
        { concurrency: "unbounded", discard: true },
      );
    }),
  );
}

function renderReadModeRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const stack = new DisposableStack();

  const desc = createFragment();
  desc.append(m.settings_db_read_mode_desc());
  const options = createEl("ul");
  for (const [name, details] of [
    [m.settings_db_read_mode_reflink(), m.settings_db_read_mode_reflink_desc()],
    [m.settings_db_read_mode_copy(), m.settings_db_read_mode_copy_desc()],
    [
      m.settings_db_read_mode_immutable(),
      m.settings_db_read_mode_immutable_desc(),
    ],
  ] as const) {
    const item = createEl("li");
    item.append(`${name}: ${details}`);
    options.append(item);
  }
  desc.append(options);
  desc.append(createEl("br"));
  const activeMode = createSpan();
  desc.append(activeMode);

  const modeLabel = (mode: ConfiguredReadMode | EffectiveReadMode): string => {
    switch (mode) {
      case "auto":
        return m.settings_db_read_mode_auto();
      case "reflink":
        return m.settings_db_read_mode_reflink();
      case "copy":
        return m.settings_db_read_mode_copy();
      case "immutable":
        return m.settings_db_read_mode_immutable();
    }
  };

  const applyActiveMode = (): void => {
    const mode = ctx.db.activeReadMode;
    activeMode.textContent = mode
      ? m.settings_db_active_read_mode({ mode: modeLabel(mode) })
      : "";
  };

  setting.setDesc(desc).addDropdown((dropdown) => {
    dropdown
      .addOption("auto", modeLabel("auto"))
      .addOption("reflink", modeLabel("reflink"))
      .addOption("copy", modeLabel("copy"))
      .addOption("immutable", modeLabel("immutable"))
      .setValue(ctx.tab.sync(ctx.settings.current)["zotero.read-mode"])
      .onChange((value) => {
        ctx.tab.sync(
          ctx.settings.update({
            "zotero.read-mode": value as ConfiguredReadMode,
          }),
        );
      });
  });

  applyActiveMode();
  stack.defer(ctx.tab.mount(paintEach(ctx.db["changed"], applyActiveMode)));
  stack.defer(ctx.tab.mount(paintEach(ctx.db["degraded"], applyActiveMode)));
  stack.defer(
    ctx.tab.mount(paintEach(ctx.db["refresh-failed"], applyActiveMode)),
  );

  return () => stack.dispose();
}

/**
 * Profile picker row: a dropdown listing the `profiles.ini` profiles, plus an
 * "auto-detect default" entry (first) and a "choose folder" entry (last) that
 * opens a folder dialog. The description shows the resolved `prefs.js` path and
 * an inline loading / failed-to-read status from {@link PlainZoteroPref}.
 */
function renderProfileDirRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const stack = new DisposableStack();
  const pref = ctx.zoteroPref;

  const desc = createFragment();
  desc.append(m.settings_db_profile_dir_desc());
  appendDeviceOverrideNote(desc);
  desc.append(createEl("br"));
  const pathCode = createEl("code");
  desc.append(pathCode);
  const statusBr = createEl("br");
  const statusSpan = createSpan();
  statusBr.classList.add("zt:hidden");
  statusSpan.classList.add("zt:hidden");
  desc.append(statusBr, statusSpan);

  let dropdown: DropdownComponent | undefined;
  let profiles: readonly ZoteroProfileInfo[] = [];

  const selectedValue = (): string => pref.profileDirOverride ?? PICKER_AUTO;

  const repopulate = (): void => {
    if (!dropdown) return;
    const current = selectedValue();
    dropdown.selectEl.replaceChildren();
    dropdown.addOption(PICKER_AUTO, m.settings_db_profile_auto());
    for (const p of profiles) dropdown.addOption(p.dir, profileLabel(p));
    // A manually-chosen folder that isn't one of the listed profiles.
    if (current !== PICKER_AUTO && !profiles.some((p) => p.dir === current)) {
      dropdown.addOption(current, current);
    }
    dropdown.addOption(PICKER_BROWSE, m.settings_db_profile_browse());
    dropdown.setValue(current);
  };

  setting.setDesc(desc).addDropdown((d) => {
    dropdown = d;
    d.onChange((value) => {
      if (value === PICKER_BROWSE) {
        d.setValue(selectedValue()); // browse isn't itself a saved choice
        void browseForDir({
          title: m.settings_db_profile_dir_dialog_title(),
          startPath: pref.profileDirOverride ?? getZoteroProfilesRoot(),
          onPick: (path) => pref.setProfileDir(path),
        });
      } else if (value === PICKER_AUTO) {
        pref.setProfileDir(null);
      } else {
        pref.setProfileDir(value);
      }
    });
    repopulate();
  });

  const applyStatus = (): void => {
    const dir = pref.resolvedProfileDir;
    pathCode.textContent = dir ? join(dir, PREFS_FILENAME) : "";

    const state = pref.state;
    const text =
      state === "loading"
        ? m.settings_db_status_loading()
        : state === "degraded"
          ? m.settings_db_profile_status_degraded()
          : "";
    if (text) {
      statusBr.classList.remove("zt:hidden");
      statusSpan.classList.remove("zt:hidden");
      statusSpan.textContent = text;
      statusSpan.classList.toggle("mod-warning", state === "degraded");
    } else {
      statusBr.classList.add("zt:hidden");
      statusSpan.classList.add("zt:hidden");
      statusSpan.textContent = "";
      statusSpan.classList.remove("mod-warning");
    }
  };

  applyStatus();
  void pref
    .listProfiles()
    .then((list) => {
      if (!dropdown?.selectEl.isConnected) return;
      profiles = list;
      repopulate();
    })
    .catch(passAborted);

  stack.defer(
    ctx.tab.mount(
      paintEach(pref["changed"], () => {
        applyStatus();
        if (dropdown && dropdown.getValue() !== selectedValue()) repopulate();
      }),
    ),
  );

  return () => stack.dispose();
}

function profileLabel(p: ZoteroProfileInfo): string {
  const name = p.name ?? m.settings_db_profile_unnamed();
  return p.isDefault ? m.settings_db_profile_default({ name }) : name;
}

function extractErrorMessage(err: Error): string {
  const cause = err.cause;
  if (cause instanceof Error) return cause.message;
  return err.message;
}

/**
 * Advanced data-directory override (auto-detect / a chosen folder). Wins over
 * the profile-derived data dir in {@link PlainZoteroPref.dataDir}; the resolved
 * path is echoed live so the user sees the effective value either way.
 */
function renderDataDirRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const stack = new DisposableStack();
  const pref = ctx.zoteroPref;

  const desc = createFragment();
  desc.append(m.settings_db_data_dir_desc());
  appendDeviceOverrideNote(desc);
  desc.append(createEl("br"));
  const pathCode = createEl("code");
  desc.append(pathCode);

  let dropdown: DropdownComponent | undefined;

  const selectedValue = (): string => pref.dataDirOverride ?? PICKER_AUTO;

  const repopulate = (): void => {
    if (!dropdown) return;
    const current = selectedValue();
    dropdown.selectEl.replaceChildren();
    dropdown.addOption(PICKER_AUTO, m.settings_db_data_dir_auto());
    if (current !== PICKER_AUTO) dropdown.addOption(current, current);
    dropdown.addOption(PICKER_BROWSE, m.settings_db_profile_browse());
    dropdown.setValue(current);
  };

  const applyPath = (): void => {
    pathCode.textContent = pref.dataDir;
  };

  setting.setDesc(desc).addDropdown((d) => {
    dropdown = d;
    d.onChange((value) => {
      if (value === PICKER_BROWSE) {
        d.setValue(selectedValue()); // browse isn't itself a saved choice
        void browseForDir({
          title: m.settings_db_data_dir_dialog_title(),
          startPath: pref.dataDirOverride ?? undefined,
          onPick: (path) => pref.setDataDir(path),
        });
      } else if (value === PICKER_AUTO) {
        pref.setDataDir(null);
      } else {
        pref.setDataDir(value);
      }
    });
    repopulate();
  });

  applyPath();

  stack.defer(ctx.tab.mount(paintEach(pref["changed"], applyPath)));
  stack.defer(
    ctx.tab.mount(
      paintEach(pref["data-dir-changed"], () => {
        applyPath();
        if (dropdown && dropdown.getValue() !== selectedValue()) repopulate();
      }),
    ),
  );

  return () => stack.dispose();
}

/**
 * Live echo of the resolved profile dir, data dir, and computed
 * {@link PlainZoteroPref.sourceId}. Live updates are accepted only from a
 * Zotero install whose own profile + data dir hash to this same id, so showing
 * all three makes a mismatch diagnosable instead of silent.
 */
function renderSourceIdRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const stack = new DisposableStack();
  const pref = ctx.zoteroPref;

  const desc = createFragment();
  desc.append(m.settings_db_source_id_desc());
  const profileLine = appendLabeledCode(
    desc,
    m.settings_db_source_id_profile(),
  );
  const dataLine = appendLabeledCode(desc, m.settings_db_source_id_data());
  const idLine = appendLabeledCode(desc, m.settings_db_source_id_value());

  const refresh = (): void => {
    profileLine.textContent = pref.resolvedProfileDir ?? "—";
    dataLine.textContent = pref.dataDir;
    idLine.textContent = pref.sourceId ?? "—";
  };

  setting.setDesc(desc);
  refresh();

  stack.defer(ctx.tab.mount(paintEach(ctx.settings.changes, () => refresh())));
  stack.defer(ctx.tab.mount(paintEach(pref["changed"], refresh)));
  stack.defer(ctx.tab.mount(paintEach(pref["data-dir-changed"], refresh)));

  return () => stack.dispose();
}

/** Append a `label: <code/>` line to `frag`, returning the `<code>` to fill in. */
function appendLabeledCode(frag: DocumentFragment, label: string): HTMLElement {
  frag.append(createEl("br"));
  frag.append(label);
  const code = createEl("code");
  frag.append(" ", code);
  return code;
}
