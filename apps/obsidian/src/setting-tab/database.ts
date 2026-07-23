import { join } from "node:path";
import {
  type DropdownComponent,
  type ExtraButtonComponent,
  type SettingDefinitionItem,
  type Setting,
} from "obsidian";

import { getLibraries, type Library } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import { requireDialog } from "@/lib/require";
import * as toast from "@/lib/toast";
import * as m from "@/paraglide/messages";
import {
  type ConfiguredReadMode,
  type EffectiveReadMode,
} from "@/services/database/read-source";
import { type DatabaseService } from "@/services/database/service";
import {
  getZoteroProfilesRoot,
  PREFS_FILENAME,
} from "@/services/zotero-pref/prefs-file";
import { type ZoteroProfileInfo } from "@/services/zotero-pref/service";

import { type SettingsKey, type SettingTabContext } from "./context";

const logger = getLogger(["setting-tab", "database"]);

/** Folder-picker dropdown sentinel for auto-detect — a real dir is never empty. */
const PICKER_AUTO = "";
/** Folder-picker dropdown sentinel that opens the folder picker; NUL can't be in a path. */
const PICKER_BROWSE = "\0browse";

/** Items for the "Zotero database" sub-page: connection, status, read mode. */
export function databasePageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    {
      name: m.settings_db_profile_dir_name(),
      desc: m.settings_db_profile_dir_desc(),
      render: (setting) => renderProfileDirRow(setting, ctx),
    },
    {
      name: m.settings_db_file_name(),
      desc: m.settings_db_file_desc(),
      render: (setting) => renderDatabaseFileRow(setting, ctx),
    },
    {
      name: m.settings_db_read_mode_name(),
      desc: m.settings_db_read_mode_desc(),
      render: (setting) => renderReadModeRow(setting, ctx),
    },
    {
      name: m.settings_db_auto_refresh_name(),
      desc: m.settings_db_auto_refresh_desc(),
      control: { type: "toggle", key: "zotero.auto-refresh" },
    },
    {
      type: "group",
      heading: m.settings_db_advanced(),
      items: [
        {
          name: m.settings_db_data_dir_name(),
          desc: m.settings_db_data_dir_desc(),
          render: (setting) => renderDataDirRow(setting, ctx),
        },
        {
          name: m.settings_db_source_id_name(),
          desc: m.settings_db_source_id_desc(),
          render: (setting) => renderSourceIdRow(setting, ctx),
        },
      ],
    },
  ];
}

/**
 * Default-library picker, surfaced on the main tab. Populated from
 * {@link getLibraries} when the DB is ready, repopulated on `changed`/`degraded`,
 * and seeded after the initial `loading→ready` settle (which `changed` skips).
 */
export function libraryDefinition(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey> {
  return {
    name: m.settings_db_library_name(),
    desc: m.settings_db_library_desc(),
    render: (setting) => renderLibraryRow(setting, ctx),
  };
}

/**
 * Database file row: resolved `zotero.sqlite` path + a refresh button + an
 * inline status line that surfaces loading / refreshing / degraded /
 * refresh-failed states. The path derives from the Zotero profile's data dir
 * ({@link ZoteroPrefService.databasePath}), so it updates when the profile changes.
 */
function renderDatabaseFileRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const stack = new DisposableStack();

  const desc = document.createDocumentFragment();
  desc.append(m.settings_db_file_desc());
  desc.append(document.createElement("br"));
  const pathCode = document.createElement("code");
  pathCode.textContent = ctx.zoteroPref.databasePath;
  desc.append(pathCode);
  const statusBr = document.createElement("br");
  const statusSpan = document.createElement("span");
  statusBr.style.display = "none";
  statusSpan.style.display = "none";
  desc.append(statusBr, statusSpan);

  let refreshButton: ExtraButtonComponent | undefined;

  setting.setDesc(desc).addExtraButton((button) => {
    refreshButton = button;
    button
      .setIcon("refresh-cw")
      .setTooltip(m.settings_db_refresh())
      .onClick(() => {
        void toast.promise(ctx.db.refresh(), {
          loading: m.notice_db_refreshing(),
          success: m.notice_db_refreshed(),
          error: m.notice_db_refresh_failed(),
        });
      });
  });

  let refreshing = false;
  let lastRefreshFailed = false;
  let lastErrorMessage: string | null = null;

  // Events miss the loading→ready/degraded transition (T14 contract), so we
  // seed the tooltip from the service's error when already degraded on mount.
  if (ctx.db.state === "degraded" && ctx.db.error) {
    lastErrorMessage = extractErrorMessage(ctx.db.error);
  }

  const applyStatus = (): void => {
    const state = ctx.db.state;
    let text = "";
    let isError = false;
    if (state === "loading") {
      text = m.settings_db_status_loading();
    } else if (refreshing) {
      text = m.settings_db_status_refreshing();
    } else if (state === "degraded") {
      text = m.settings_db_status_degraded();
      isError = true;
    } else if (lastRefreshFailed) {
      text = m.settings_db_status_refresh_failed();
      isError = true;
    }

    if (text) {
      statusBr.style.display = "";
      statusSpan.style.display = "";
      statusSpan.textContent = text;
      statusSpan.classList.toggle("mod-warning", isError);
      statusSpan.ariaLabel = lastErrorMessage ?? "";
    } else {
      statusBr.style.display = "none";
      statusSpan.style.display = "none";
      statusSpan.textContent = "";
      statusSpan.classList.remove("mod-warning");
      statusSpan.ariaLabel = null;
    }
    refreshButton?.setDisabled(state === "loading" || refreshing);
  };

  const applyPath = (): void => {
    pathCode.textContent = ctx.zoteroPref.databasePath;
  };

  applyStatus();

  stack.defer(ctx.zoteroPref.on("changed", applyPath));
  stack.defer(
    ctx.db.on("changed", () => {
      lastRefreshFailed = false;
      lastErrorMessage = null;
      applyStatus();
    }),
  );
  stack.defer(
    ctx.db.on("degraded", (err) => {
      lastErrorMessage = extractErrorMessage(err);
      applyStatus();
    }),
  );
  stack.defer(
    ctx.db.on("refresh-failed", (err) => {
      lastRefreshFailed = true;
      lastErrorMessage = extractErrorMessage(err);
      applyStatus();
    }),
  );
  stack.defer(
    ctx.db.on("refreshing", (active) => {
      refreshing = active;
      applyStatus();
    }),
  );

  return () => stack.dispose();
}

function renderReadModeRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const stack = new DisposableStack();

  const desc = document.createDocumentFragment();
  desc.append(m.settings_db_read_mode_desc());
  const options = document.createElement("ul");
  for (const [name, details] of [
    [m.settings_db_read_mode_reflink(), m.settings_db_read_mode_reflink_desc()],
    [m.settings_db_read_mode_copy(), m.settings_db_read_mode_copy_desc()],
    [
      m.settings_db_read_mode_immutable(),
      m.settings_db_read_mode_immutable_desc(),
    ],
  ] as const) {
    const item = document.createElement("li");
    item.append(`${name}: ${details}`);
    options.append(item);
  }
  desc.append(options);
  desc.append(document.createElement("br"));
  const activeMode = document.createElement("span");
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
      .setValue(ctx.settings.current!["zotero.read-mode"])
      .onChange((value) => {
        ctx.settings.update({
          "zotero.read-mode": value as ConfiguredReadMode,
        });
      });
  });

  applyActiveMode();
  stack.defer(ctx.db.on("changed", applyActiveMode));
  stack.defer(ctx.db.on("degraded", applyActiveMode));
  stack.defer(ctx.db.on("refresh-failed", applyActiveMode));

  return () => stack.dispose();
}

/**
 * Profile picker row: a dropdown listing the `profiles.ini` profiles, plus an
 * "auto-detect default" entry (first) and a "choose folder" entry (last) that
 * opens a folder dialog. The description shows the resolved `prefs.js` path and
 * an inline loading / failed-to-read status from {@link ZoteroPrefService}.
 */
function renderProfileDirRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const stack = new DisposableStack();
  const pref = ctx.zoteroPref;

  const desc = document.createDocumentFragment();
  desc.append(m.settings_db_profile_dir_desc());
  appendDeviceOverrideNote(desc);
  desc.append(document.createElement("br"));
  const pathCode = document.createElement("code");
  desc.append(pathCode);
  const statusBr = document.createElement("br");
  const statusSpan = document.createElement("span");
  statusBr.style.display = "none";
  statusSpan.style.display = "none";
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
      statusBr.style.display = "";
      statusSpan.style.display = "";
      statusSpan.textContent = text;
      statusSpan.classList.toggle("mod-warning", state === "degraded");
    } else {
      statusBr.style.display = "none";
      statusSpan.style.display = "none";
      statusSpan.textContent = "";
      statusSpan.classList.remove("mod-warning");
    }
  };

  applyStatus();
  if (pref.state === "loading") {
    void pref.ready.then(() => {
      if (pathCode.isConnected) applyStatus();
    });
  }
  void pref.listProfiles().then((list) => {
    if (!dropdown?.selectEl.isConnected) return;
    profiles = list;
    repopulate();
  });

  stack.defer(
    pref.on("changed", () => {
      applyStatus();
      if (dropdown && dropdown.getValue() !== selectedValue()) repopulate();
    }),
  );

  return () => stack.dispose();
}

function profileLabel(p: ZoteroProfileInfo): string {
  const name = p.name ?? m.settings_db_profile_unnamed();
  return p.isDefault ? m.settings_db_profile_default({ name }) : name;
}

function renderLibraryRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const stack = new DisposableStack();

  let dropdown: DropdownComponent | undefined;
  const repopulate = (): void => {
    if (!dropdown) return;
    const current = ctx.settings.current?.["zotero.citation-library"] ?? 1;
    const libraries = loadLibrariesSafe(ctx.db);
    fillLibraryDropdown(dropdown, libraries, current);
  };

  setting
    .setDesc(
      ctx.db.state === "ready"
        ? m.settings_db_library_desc()
        : m.settings_db_library_unavailable(),
    )
    .addDropdown((d) => {
      dropdown = d;
      d.onChange((value) => {
        const id = Number(value);
        if (!Number.isFinite(id)) return;
        ctx.settings.update({ "zotero.citation-library": id });
      });
      repopulate();
    });

  if (ctx.db.state === "loading") {
    void ctx.db.ready.then(() => {
      if (dropdown?.selectEl.isConnected) repopulate();
    });
  }

  stack.defer(
    ctx.settings.subscribe((value) => {
      if (value === null || !dropdown) return;
      const current = String(value["zotero.citation-library"]);
      if (dropdown.getValue() === current) return;
      ensureLibraryOption(dropdown, value["zotero.citation-library"]);
      dropdown.setValue(current);
    }),
  );
  stack.defer(ctx.db.on("changed", repopulate));
  stack.defer(ctx.db.on("degraded", repopulate));

  return () => stack.dispose();
}

function extractErrorMessage(err: Error): string {
  const cause = err.cause;
  if (cause instanceof Error) return cause.message;
  return err.message;
}

function loadLibrariesSafe(db: DatabaseService): Library[] {
  if (db.state !== "ready") return [];
  try {
    return getLibraries(db.client);
  } catch (error) {
    logger.warn("Failed to load Zotero libraries", { error });
    return [];
  }
}

function libraryLabel(lib: Library): string {
  if (lib.type === "user") return m.settings_db_library_user();
  return (
    lib.name ?? m.settings_db_library_unknown({ libraryID: lib.libraryID })
  );
}

function fillLibraryDropdown(
  dropdown: DropdownComponent,
  libraries: readonly Library[],
  current: number,
): void {
  dropdown.selectEl.replaceChildren();
  for (const lib of libraries) {
    dropdown.addOption(String(lib.libraryID), libraryLabel(lib));
  }
  ensureLibraryOption(dropdown, current);
  dropdown.setValue(String(current));
  dropdown.setDisabled(libraries.length === 0);
}

/**
 * Append the configured library as a fallback option when it isn't in the
 * fetched list — keeps the dropdown valid for stale or pre-load IDs.
 */
function ensureLibraryOption(
  dropdown: DropdownComponent,
  libraryID: number,
): void {
  const key = String(libraryID);
  const exists = Array.from(dropdown.selectEl.options).some(
    (opt) => opt.value === key,
  );
  if (!exists) {
    dropdown.addOption(key, m.settings_db_library_unknown({ libraryID }));
  }
}

/**
 * Open a folder picker and hand the chosen directory to `onPick`. `startPath`
 * seeds the dialog when the bound setting is unset.
 */
async function browseForDir(opts: {
  title: string;
  startPath: string | undefined;
  onPick: (path: string) => void;
}): Promise<void> {
  try {
    const result = await requireDialog().showOpenDialog({
      title: opts.title,
      defaultPath: opts.startPath,
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    opts.onPick(result.filePaths[0]!);
  } catch (error) {
    logger.error("Failed to open folder dialog", { error });
  }
}

/**
 * Advanced data-directory override (auto-detect / a chosen folder). Wins over
 * the profile-derived data dir in {@link ZoteroPrefService.dataDir}; the resolved
 * path is echoed live so the user sees the effective value either way.
 */
function renderDataDirRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const stack = new DisposableStack();
  const pref = ctx.zoteroPref;

  const desc = document.createDocumentFragment();
  desc.append(m.settings_db_data_dir_desc());
  appendDeviceOverrideNote(desc);
  desc.append(document.createElement("br"));
  const pathCode = document.createElement("code");
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
  if (pref.state === "loading") {
    void pref.ready.then(() => {
      if (pathCode.isConnected) applyPath();
    });
  }

  stack.defer(pref.on("changed", applyPath));
  stack.defer(
    pref.on("data-dir-changed", () => {
      applyPath();
      if (dropdown && dropdown.getValue() !== selectedValue()) repopulate();
    }),
  );

  return () => stack.dispose();
}

/**
 * Live echo of the resolved profile dir, data dir, and computed
 * {@link ZoteroPrefService.sourceId}. Live updates are accepted only from a
 * Zotero install whose own profile + data dir hash to this same id, so showing
 * all three makes a mismatch diagnosable instead of silent.
 */
function renderSourceIdRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const stack = new DisposableStack();
  const pref = ctx.zoteroPref;

  const desc = document.createDocumentFragment();
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
  if (pref.state === "loading") {
    void pref.ready.then(() => {
      if (idLine.isConnected) refresh();
    });
  }

  stack.defer(ctx.settings.subscribe(() => refresh()));
  stack.defer(pref.on("changed", refresh));
  stack.defer(pref.on("data-dir-changed", refresh));

  return () => stack.dispose();
}

/** Append the "stored on this device only" Device Override note as a fresh description line. */
function appendDeviceOverrideNote(frag: DocumentFragment): void {
  frag.append(document.createElement("br"));
  const note = document.createElement("small");
  note.textContent = m.settings_db_device_override_note();
  frag.append(note);
}

/** Append a `label: <code/>` line to `frag`, returning the `<code>` to fill in. */
function appendLabeledCode(frag: DocumentFragment, label: string): HTMLElement {
  frag.append(document.createElement("br"));
  frag.append(label);
  const code = document.createElement("code");
  frag.append(" ", code);
  return code;
}
