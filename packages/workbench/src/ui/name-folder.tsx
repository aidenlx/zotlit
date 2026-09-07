// The Name and folder tab: the Profile's own identity, the note-name template
// over the manifest's `filename` value, the five sparse bindings with their
// effective value and origin, the language key, and the locked details.

import type {
  InstalledCitationStyle,
  ProfileBindingDefaults,
} from "#/bridge/index";
import type {
  ManifestScalar,
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "#/document/index";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { m } from "./paraglide/messages.js";
import { WorkbenchSelect, WorkbenchOption } from "./select";
import { SliceEditor } from "./slice-editor";
import type { SuggestionSource } from "./slice-editor";
import { useParts, useIcon } from "./theme";

/** The manifest, named without depending on the templates package. */
type ProfileManifest = NonNullable<
  WorkbenchDocumentController["document"]
>["manifest"];

/** The manifest keys that carry a vault-local value the Profile may override. */
type BindingKey =
  | "folder"
  | "citationStyle"
  | "importFolder"
  | "importColoredHighlights"
  | "importAnnotationsAsTemplate";

interface Binding {
  readonly key: BindingKey;
  readonly label: () => string;
  /**
   * The control the value is edited through. A style is picked from the vault's
   * installed styles while a Workbench Connection lists them, and typed as its
   * CSL ID standalone, where no vault says which are installed.
   */
  readonly kind: "path" | "style" | "toggle";
}

const BINDINGS: readonly Binding[] = [
  { key: "folder", label: m.workbench_name_binding_folder, kind: "path" },
  {
    key: "citationStyle",
    label: m.workbench_name_binding_citation_style,
    kind: "style",
  },
  {
    key: "importFolder",
    label: m.workbench_name_binding_import_folder,
    kind: "path",
  },
  {
    key: "importColoredHighlights",
    label: m.workbench_name_binding_colored_highlights,
    kind: "toggle",
  },
  {
    key: "importAnnotationsAsTemplate",
    label: m.workbench_name_binding_annotation_template,
    kind: "toggle",
  },
];

/**
 * What an unset binding inherits with no vault to ask: the plugin's built-in
 * Default Profile, which is what a fresh install starts on. A Workbench
 * Connection replaces this with the vault's own effective values.
 * @see apps/obsidian/src/services/settings/schema.ts DEFAULT_LITERATURE_NOTE_PROFILE
 */
export const BUILT_IN_BINDING_DEFAULTS: ProfileBindingDefaults = {
  folder: "literatures",
  citationStyle: null,
  importFolder: "zotero_notes",
  importColoredHighlights: false,
  importAnnotationsAsTemplate: false,
};

/** The Profile whose bindings live in Obsidian's settings rather than here. */
const DEFAULT_PROFILE_ID = "default";

/**
 * The control that holds one manifest key. A problem the parser pinned to a key
 * opens the control under this id, so every field this form writes carries one.
 */
const FieldIdContext = createContext("workbench");

function fieldId(prefix: string, key: string): string {
  return `${prefix}-field-${key}`;
}

/** One binding value in the words the tab reads it in. */
function valueText(value: string | boolean | null | undefined): string {
  if (value === undefined) return m.workbench_name_unset();
  if (value === null) return m.workbench_name_value_no_style();
  if (typeof value === "boolean") {
    return value ? m.workbench_name_value_on() : m.workbench_name_value_off();
  }
  return value === "" ? m.workbench_name_value_vault_root() : value;
}

export interface NameFolderPaneProps {
  controller: WorkbenchDocumentController;
  onOpenSource?: () => void;
  /**
   * The manifest this form writes: the last one the document parsed with, so a
   * draft under repair keeps the values the reader is repairing. Null before
   * any parse has succeeded, which is what the form has nothing to show for.
   */
  manifest: ProfileManifest | null;
  /** The note name the current render produced, for the live result. */
  filename: string | null;
  /**
   * The styles the connected vault has installed, for the citation-style
   * picker. Null standalone, and while the connection lists none.
   */
  citationStyles?: readonly InstalledCitationStyle[] | null;
  /**
   * The values an unset binding inherits. A Workbench Connection carries the
   * vault's own; standalone this is the plugin's built-in Default Profile.
   */
  defaults?: ProfileBindingDefaults;
  /**
   * The manifest key to open, named by the problem that sent the reader here.
   * Each new object opens it again.
   */
  focus?: { readonly field: string } | null;
  /** The contract the note-name editor completes and explains against. */
  suggest?: SuggestionSource;
  reveal?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
}

export function NameFolderPane({
  controller,
  onOpenSource,
  manifest,
  filename,
  citationStyles,
  defaults = BUILT_IN_BINDING_DEFAULTS,
  focus,
  suggest,
  reveal,
  onSelection,
}: NameFolderPaneProps) {
  const prefix = useId();
  const container = useRef<HTMLDivElement>(null);
  const icon = useIcon();
  const part = useParts("nameFolder");
  // The control a problem named, brought on screen with the keyboard in it. A
  // key the locked details hold opens that block first, so the reader lands on
  // the field rather than on the summary that hides it.
  useEffect(() => {
    if (!focus) return;
    const control = container.current?.querySelector<HTMLElement>(
      `[id="${fieldId(prefix, focus.field)}"]`,
    );
    if (!control) return;
    control.closest("details")?.setAttribute("open", "");
    control.scrollIntoView({ block: "nearest" });
    control.focus();
  }, [focus, prefix]);

  if (!manifest) {
    return <p {...part("unreadable")}>{m.workbench_name_unreadable()}</p>;
  }

  const write = (key: string, value: ManifestScalar | undefined) =>
    controller.setManifestKey(key, value);

  return (
    <FieldIdContext.Provider value={prefix}>
      <div ref={container} {...part("pane")}>
        <Group
          heading={m.workbench_name_filename_heading()}
          lede={m.workbench_name_filename_lede()}
        >
          {controller.filenameSlice ? (
            <div {...part("filename-editor")}>
              <SliceEditor
                controller={controller}
                slice="filename"
                label={m.workbench_name_filename_label()}
                singleLine
                reveal={reveal}
                suggest={suggest}
                onSelection={onSelection}
              />
            </div>
          ) : (
            <p {...part("help")}>
              {m.workbench_name_filename_source_only()}
              {onOpenSource && (
                <button
                  type="button"
                  {...part("source-button")}
                  onClick={onOpenSource}
                >
                  {m.workbench_open_source()}
                </button>
              )}
            </p>
          )}
          <p {...part("filename-result")}>
            <span {...part("muted")}>{m.workbench_name_filename_result()}</span>
            <output {...part("filename-output")}>{filename}</output>
          </p>
        </Group>

        <Group
          heading={m.workbench_name_bindings_heading()}
          lede={
            manifest.id === DEFAULT_PROFILE_ID
              ? m.workbench_name_default_lede()
              : m.workbench_name_bindings_lede()
          }
        >
          {manifest.id === DEFAULT_PROFILE_ID ? (
            <>
              <dl {...part("defaults")}>
                {BINDINGS.map((binding) => (
                  <div key={binding.key} {...part("actions")}>
                    <dt {...part("default-label")}>{binding.label()}</dt>
                    <dd {...part("default-value")}>
                      {valueText(defaults[binding.key])}
                    </dd>
                  </div>
                ))}
              </dl>
              <p {...part("secondary")}>{m.workbench_name_default_note()}</p>
            </>
          ) : (
            BINDINGS.map((binding) => (
              <BindingRow
                key={binding.key}
                binding={binding}
                value={manifest[binding.key]}
                fallback={defaults[binding.key]}
                citationStyles={citationStyles ?? null}
                onWrite={(value) => write(binding.key, value)}
              />
            ))
          )}
        </Group>

        <details {...part("details")}>
          <summary {...part("summary")}>
            <span aria-hidden {...part("details-icon")}>
              {icon("chevron-right")}
            </span>
            {m.workbench_name_profile_heading()}
          </summary>
          <div {...part("identity-fields")}>
            <Field label={m.workbench_name_field_name()}>
              <TextValue
                field="name"
                value={manifest.name}
                onCommit={(value) => write("name", value)}
              />
            </Field>
            <Field label={m.workbench_name_field_description()}>
              <TextValue
                field="description"
                value={manifest.description ?? ""}
                optional
                onCommit={(value) => write("description", value)}
              />
            </Field>
            <Field label={m.workbench_name_field_version()}>
              <TextValue
                field="version"
                value={manifest.version}
                onCommit={(value) => write("version", value)}
              />
            </Field>
            <Field label={m.workbench_name_field_author()}>
              <TextValue
                field="author"
                value={manifest.author ?? ""}
                optional
                onCommit={(value) => write("author", value)}
              />
            </Field>
          </div>
        </details>

        <details {...part("details")}>
          <summary {...part("summary")}>
            <span aria-hidden {...part("details-icon")}>
              {icon("chevron-right")}
            </span>
            {m.workbench_name_advanced_summary()}
          </summary>
          <div {...part("advanced-fields")}>
            <LanguageGroup language={manifest.language} onWrite={write} />

            <div {...part("fields")}>
              <Field label={m.workbench_name_field_id()}>
                <input
                  readOnly
                  value={manifest.id}
                  {...part("readonly-input")}
                />
              </Field>
              <p {...part("help")}>{m.workbench_name_id_note()}</p>
              <Field label={m.workbench_name_field_contract()}>
                <input
                  readOnly
                  value={String(manifest.contract)}
                  {...part("readonly-input")}
                />
              </Field>
              <Field label={m.workbench_name_field_min_app_version()}>
                <input
                  readOnly
                  value={manifest.minAppVersion ?? m.workbench_name_unset()}
                  {...part("readonly-input")}
                />
              </Field>
              <p {...part("help")}>{m.workbench_name_locked_note()}</p>
            </div>
            <div {...part("fields")}>
              <Field label={m.workbench_name_field_sample_item_type()}>
                <TextValue
                  field="sampleItemType"
                  value={manifest.sampleItemType ?? ""}
                  optional
                  onCommit={(value) => write("sampleItemType", value)}
                />
              </Field>
              <p {...part("help")}>
                {m.workbench_name_sample_item_type_note()}
              </p>
            </div>
          </div>
        </details>
      </div>
    </FieldIdContext.Provider>
  );
}

function Group({
  heading,
  lede,
  children,
}: {
  heading: string;
  lede?: string;
  children: ReactNode;
}) {
  const part = useParts("nameFolder");
  return (
    <section {...part("group")}>
      <h3 {...part("heading")}>{heading}</h3>
      {lede && <p {...part("help")}>{lede}</p>}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const part = useParts("nameFolder");
  return (
    <label {...part("field")}>
      {label}
      {children}
    </label>
  );
}

/**
 * A box the reader types in freely, written to the manifest when they leave it,
 * so one edit is one undo step and no keystroke re-parses the document. The
 * draft is this box's own; a value written from anywhere else — an undo,
 * Override, Use default — replaces it. The box itself outlives every write, so
 * the control the reader moves focus to receives their click.
 */
function DraftText({
  id,
  value,
  disabled = false,
  placeholder,
  onCommit,
  binding = false,
}: {
  id?: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onCommit: (value: string) => void;
  binding?: boolean;
}) {
  const part = useParts("nameFolder");
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      id={id}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onInput={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next !== value) onCommit(next);
      }}
      {...part(binding ? "binding-input" : "input")}
    />
  );
}

/**
 * One manifest string. An emptied optional field removes its key rather than
 * writing the empty string the schema refuses.
 */
function TextValue({
  field,
  value,
  optional = false,
  onCommit,
}: {
  /** The manifest key this box writes, which names the control. */
  field: string;
  value: string;
  optional?: boolean;
  onCommit: (value: string | undefined) => void;
}) {
  const prefix = useContext(FieldIdContext);
  return (
    <DraftText
      id={fieldId(prefix, field)}
      value={value}
      placeholder={optional ? m.workbench_name_optional() : undefined}
      onCommit={(next) => onCommit(optional && next === "" ? undefined : next)}
    />
  );
}

/**
 * One sparse binding: the effective value with the origin it comes from, and
 * the two actions that move it between them. Override writes the current
 * default as an explicit value; Use default removes the key, so an empty path,
 * a null style, and a false toggle each stay distinct from unset.
 */
function BindingRow({
  binding,
  value,
  fallback,
  citationStyles,
  onWrite,
}: {
  binding: Binding;
  value: string | boolean | null | undefined;
  /** The value in effect where this binding is unset. */
  fallback: string | boolean | null;
  citationStyles: readonly InstalledCitationStyle[] | null;
  onWrite: (value: ManifestScalar | undefined) => void;
}) {
  const prefix = useContext(FieldIdContext);
  const part = useParts("nameFolder");
  const label = binding.label();
  const inherits = value === undefined;
  const effective = inherits ? fallback : value;
  const id = fieldId(prefix, binding.key);
  return (
    <div {...part("binding-row")}>
      <div {...part("binding-heading")}>
        <label htmlFor={id} {...part("binding-label")}>
          {label}
        </label>
        <span {...part("secondary")}>
          {inherits
            ? m.workbench_name_origin_default()
            : m.workbench_name_origin_profile()}
        </span>
        <button
          type="button"
          {...part("confirm-button")}
          aria-label={
            inherits
              ? m.workbench_name_override_for({ name: label })
              : m.workbench_name_use_default_for({ name: label })
          }
          onClick={() => onWrite(inherits ? fallback : undefined)}
        >
          {inherits
            ? m.workbench_name_override()
            : m.workbench_name_use_default()}
        </button>
      </div>
      {binding.kind === "style" && citationStyles ? (
        <StylePicker
          id={id}
          value={typeof effective === "string" ? effective : null}
          disabled={inherits}
          styles={citationStyles}
          onWrite={onWrite}
        />
      ) : binding.kind === "toggle" ? (
        <span {...part("toggle-row")}>
          <button
            type="button"
            role="switch"
            id={id}
            disabled={inherits}
            aria-checked={effective === true}
            {...part("switch", effective === true ? "checked" : "unchecked")}
            onClick={() => onWrite(effective !== true)}
          >
            <span
              {...part(
                "switch-thumb",
                effective === true ? "checked" : "unchecked",
              )}
            />
          </button>
          <span {...part("muted")}>{valueText(effective)}</span>
        </span>
      ) : (
        <DraftText
          id={id}
          value={effective === null ? "" : String(effective)}
          disabled={inherits}
          placeholder={
            binding.kind === "style"
              ? m.workbench_name_citation_style_placeholder()
              : m.workbench_name_value_vault_root()
          }
          // A style is named or absent; a folder path is a string, and its
          // empty form is the vault root.
          onCommit={(next) =>
            onWrite(binding.kind === "style" && next === "" ? null : next)
          }
          binding
        />
      )}
    </div>
  );
}

/**
 * The citation style as the vault's own list. A style the profile names that the
 * vault has not installed keeps its place in the list, so opening the picker
 * never quietly rewrites a value the reader did not touch.
 */
function StylePicker({
  id,
  value,
  disabled,
  styles,
  onWrite,
}: {
  id: string;
  value: string | null;
  disabled: boolean;
  styles: readonly InstalledCitationStyle[];
  onWrite: (value: ManifestScalar) => void;
}) {
  const options =
    value !== null &&
    value !== "" &&
    !styles.some((style) => style.id === value)
      ? [{ id: value, title: value }, ...styles]
      : styles;
  return (
    <WorkbenchSelect
      id={id}
      value={value ?? ""}
      disabled={disabled}
      onInput={(event) =>
        onWrite(
          event.currentTarget.value === "" ? null : event.currentTarget.value,
        )
      }
    >
      <WorkbenchOption value="">
        {m.workbench_name_value_no_style()}
      </WorkbenchOption>
      {options.map((style) => (
        <WorkbenchOption key={style.id} value={style.id}>
          {style.title}
        </WorkbenchOption>
      ))}
    </WorkbenchSelect>
  );
}

/**
 * The language key, which one confirmation changes on its own. Nothing is
 * translated: the note name, the note, and the Annotation Section stay as the
 * author wrote them, one undo away.
 */
function LanguageGroup({
  language,
  onWrite,
}: {
  language: string;
  onWrite: (key: string, value: ManifestScalar) => void;
}) {
  const prefix = useContext(FieldIdContext);
  const part = useParts("nameFolder");
  const [pending, setPending] = useState<string | null>(null);
  return (
    <Group
      heading={m.workbench_name_language_heading()}
      lede={m.workbench_name_language_lede()}
    >
      <Field label={m.workbench_name_language_heading()}>
        <WorkbenchSelect
          id={fieldId(prefix, "language")}
          value={pending ?? language}
          onInput={(event) => setPending(event.currentTarget.value)}
        >
          <WorkbenchOption value="liquid">
            {m.workbench_name_language_liquid()}
          </WorkbenchOption>
          <WorkbenchOption value="eta">
            {m.workbench_name_language_eta()}
          </WorkbenchOption>
        </WorkbenchSelect>
      </Field>
      {pending !== null && pending !== language && (
        <div role="alert" {...part("confirmation")}>
          <strong {...part("strong")}>
            {m.workbench_name_language_confirm_heading()}
          </strong>
          <p {...part("prose")}>{m.workbench_name_language_confirm_body()}</p>
          <div {...part("confirmation-actions")}>
            <button
              type="button"
              {...part("confirm-button")}
              onClick={() => {
                onWrite("language", pending);
                setPending(null);
              }}
            >
              {m.workbench_name_language_confirm()}
            </button>
            <button
              type="button"
              {...part("cancel-button")}
              onClick={() => setPending(null)}
            >
              {m.workbench_name_language_cancel()}
            </button>
          </div>
        </div>
      )}
    </Group>
  );
}
