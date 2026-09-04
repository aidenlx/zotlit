// The Name and folder tab: the Profile's own identity, the note-name template
// over the manifest's `filename` value, the five sparse bindings with their
// effective value and origin, the language key, and the locked details.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { InstalledCitationStyle } from "@zotlit/workbench/bridge";
import type {
  ManifestScalar,
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";

import { m } from "@/paraglide/messages.js";

import { SliceEditor } from "./slice-editor";
import type { FieldTrigger } from "./slice-editor";

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
  /**
   * The value an unset binding takes: the plugin's built-in Default Profile,
   * connected or not. The bridge contract carries no vault-settings read, so a
   * vault that changed one of these is not what the Default origin names.
   * @see apps/obsidian/src/services/settings/schema.ts DEFAULT_LITERATURE_NOTE_PROFILE
   */
  readonly fallback: string | boolean | null;
}

const BINDINGS: readonly Binding[] = [
  {
    key: "folder",
    label: m.workbench_name_binding_folder,
    kind: "path",
    fallback: "literatures",
  },
  {
    key: "citationStyle",
    label: m.workbench_name_binding_citation_style,
    kind: "style",
    fallback: null,
  },
  {
    key: "importFolder",
    label: m.workbench_name_binding_import_folder,
    kind: "path",
    fallback: "zotero_notes",
  },
  {
    key: "importColoredHighlights",
    label: m.workbench_name_binding_colored_highlights,
    kind: "toggle",
    fallback: false,
  },
  {
    key: "importAnnotationsAsTemplate",
    label: m.workbench_name_binding_annotation_template,
    kind: "toggle",
    fallback: false,
  },
];

/** The Profile whose bindings live in Obsidian's settings rather than here. */
const DEFAULT_PROFILE_ID = "default";

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
  /** The parsed manifest, or null while the draft does not parse. */
  manifest: ProfileManifest | null;
  /** The note name the current render produced, for the live result. */
  filename: string | null;
  /**
   * The styles the connected vault has installed, for the citation-style
   * picker. Null standalone, and while the connection lists none.
   */
  citationStyles?: readonly InstalledCitationStyle[] | null;
  reveal?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  onFieldTrigger?: (trigger: FieldTrigger) => void;
}

export function NameFolderPane({
  controller,
  manifest,
  filename,
  citationStyles,
  reveal,
  onSelection,
  onFieldTrigger,
}: NameFolderPaneProps) {
  // A draft that stopped parsing keeps the values the form last read, so the
  // form waits for the repair instead of emptying under the reader.
  const [shown, setShown] = useState(manifest);
  useEffect(() => {
    if (manifest) setShown(manifest);
  }, [manifest]);

  if (!shown) {
    return (
      <p className="text-sm text-fd-muted-foreground">
        {m.workbench_name_unreadable()}
      </p>
    );
  }

  const write = (key: string, value: ManifestScalar | undefined) =>
    controller.setManifestKey(key, value);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto pb-4">
      <Group heading={m.workbench_name_profile_heading()}>
        <Field label={m.workbench_name_field_name()}>
          <TextValue
            value={shown.name}
            onCommit={(value) => write("name", value)}
          />
        </Field>
        <Field label={m.workbench_name_field_description()}>
          <TextValue
            value={shown.description ?? ""}
            optional
            onCommit={(value) => write("description", value)}
          />
        </Field>
        <Field label={m.workbench_name_field_version()}>
          <TextValue
            value={shown.version}
            onCommit={(value) => write("version", value)}
          />
        </Field>
        <Field label={m.workbench_name_field_author()}>
          <TextValue
            value={shown.author ?? ""}
            optional
            onCommit={(value) => write("author", value)}
          />
        </Field>
      </Group>

      <Group
        heading={m.workbench_name_filename_heading()}
        lede={m.workbench_name_filename_lede()}
      >
        {controller.filenameSlice ? (
          <div className="border border-fd-border bg-fd-background">
            <SliceEditor
              controller={controller}
              slice="filename"
              label={m.workbench_name_filename_label()}
              singleLine
              reveal={reveal}
              onSelection={onSelection}
              onFieldTrigger={onFieldTrigger}
            />
          </div>
        ) : (
          <p className="text-xs text-fd-muted-foreground">
            {m.workbench_name_filename_source_only()}
          </p>
        )}
        <p className="flex items-baseline gap-2 text-xs">
          <span className="text-fd-muted-foreground">
            {m.workbench_name_filename_result()}
          </span>
          <output className="min-w-0 flex-1 truncate font-mono">
            {filename}
          </output>
        </p>
      </Group>

      <Group
        heading={m.workbench_name_bindings_heading()}
        lede={
          shown.id === DEFAULT_PROFILE_ID
            ? m.workbench_name_default_lede()
            : m.workbench_name_bindings_lede()
        }
      >
        {shown.id === DEFAULT_PROFILE_ID ? (
          <>
            <dl className="flex flex-col gap-1.5 text-xs">
              {BINDINGS.map((binding) => (
                <div key={binding.key} className="flex items-baseline gap-3">
                  <dt className="min-w-0 flex-1">{binding.label()}</dt>
                  <dd className="font-mono">{valueText(binding.fallback)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-fd-muted-foreground">
              {m.workbench_name_default_note()}
            </p>
          </>
        ) : (
          BINDINGS.map((binding) => (
            <BindingRow
              key={binding.key}
              binding={binding}
              value={shown[binding.key]}
              citationStyles={citationStyles ?? null}
              onWrite={(value) => write(binding.key, value)}
            />
          ))
        )}
      </Group>

      <LanguageGroup language={shown.language} onWrite={write} />

      <details className="border border-fd-border bg-fd-card px-3 py-2">
        <summary className="cursor-pointer font-mono text-[0.62rem] font-semibold tracking-widest text-fd-muted-foreground uppercase">
          {m.workbench_name_advanced_summary()}
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <Field label={m.workbench_name_field_id()}>
            <input
              readOnly
              value={shown.id}
              className="min-w-0 flex-1 border border-fd-border bg-fd-background px-2 py-1 font-mono text-[0.78rem] text-fd-muted-foreground"
            />
          </Field>
          <p className="text-xs text-fd-muted-foreground">
            {m.workbench_name_id_note()}
          </p>
          <Field label={m.workbench_name_field_contract()}>
            <input
              readOnly
              value={String(shown.contract)}
              className="min-w-0 flex-1 border border-fd-border bg-fd-background px-2 py-1 font-mono text-[0.78rem] text-fd-muted-foreground"
            />
          </Field>
          <Field label={m.workbench_name_field_min_app_version()}>
            <input
              readOnly
              value={shown.minAppVersion ?? m.workbench_name_unset()}
              className="min-w-0 flex-1 border border-fd-border bg-fd-background px-2 py-1 font-mono text-[0.78rem] text-fd-muted-foreground"
            />
          </Field>
          <p className="text-xs text-fd-muted-foreground">
            {m.workbench_name_locked_note()}
          </p>
          <Field label={m.workbench_name_field_sample_item_type()}>
            <TextValue
              value={shown.sampleItemType ?? ""}
              optional
              onCommit={(value) => write("sampleItemType", value)}
            />
          </Field>
          <p className="text-xs text-fd-muted-foreground">
            {m.workbench_name_sample_item_type_note()}
          </p>
        </div>
      </details>
    </div>
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
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-mono text-[0.62rem] font-semibold tracking-widest text-fd-muted-foreground uppercase">
        {heading}
      </h3>
      {lede && <p className="text-xs text-fd-muted-foreground">{lede}</p>}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-40 shrink-0 text-fd-muted-foreground">{label}</span>
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
  className,
}: {
  id?: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onCommit: (value: string) => void;
  className: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      id={id}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next !== value) onCommit(next);
      }}
      className={className}
    />
  );
}

/**
 * One manifest string. An emptied optional field removes its key rather than
 * writing the empty string the schema refuses.
 */
function TextValue({
  value,
  optional = false,
  onCommit,
}: {
  value: string;
  optional?: boolean;
  onCommit: (value: string | undefined) => void;
}) {
  return (
    <DraftText
      value={value}
      placeholder={optional ? m.workbench_name_optional() : undefined}
      onCommit={(next) => onCommit(optional && next === "" ? undefined : next)}
      className="min-w-0 flex-1 border border-fd-border bg-fd-background px-2 py-1 text-[0.78rem]"
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
  citationStyles,
  onWrite,
}: {
  binding: Binding;
  value: string | boolean | null | undefined;
  citationStyles: readonly InstalledCitationStyle[] | null;
  onWrite: (value: ManifestScalar | undefined) => void;
}) {
  const label = binding.label();
  const inherits = value === undefined;
  const effective = inherits ? binding.fallback : value;
  const id = `workbench-binding-${binding.key}`;
  return (
    <div className="flex flex-col gap-1.5 border border-fd-border bg-fd-card px-3 py-2">
      <div className="flex items-baseline gap-3">
        <label htmlFor={id} className="min-w-0 flex-1 text-xs">
          {label}
        </label>
        <span className="font-mono text-[0.6rem] font-semibold tracking-widest text-fd-muted-foreground uppercase">
          {inherits
            ? m.workbench_name_origin_default()
            : m.workbench_name_origin_profile()}
        </span>
        <button
          type="button"
          aria-label={
            inherits
              ? m.workbench_name_override_for({ name: label })
              : m.workbench_name_use_default_for({ name: label })
          }
          onClick={() => onWrite(inherits ? binding.fallback : undefined)}
          className="cursor-pointer border border-fd-border px-2 py-0.5 text-xs"
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
        <span className="flex items-center gap-2 text-xs">
          <input
            id={id}
            type="checkbox"
            role="switch"
            disabled={inherits}
            checked={effective === true}
            onChange={(event) => onWrite(event.target.checked)}
          />
          <span className="text-fd-muted-foreground">
            {valueText(effective)}
          </span>
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
          className="min-w-0 border border-fd-border bg-fd-background px-2 py-1 font-mono text-[0.78rem] disabled:text-fd-muted-foreground"
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
    <select
      id={id}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) =>
        onWrite(event.target.value === "" ? null : event.target.value)
      }
      className="min-w-0 border border-fd-border bg-fd-background px-2 py-1 text-[0.78rem] disabled:text-fd-muted-foreground"
    >
      <option value="">{m.workbench_name_value_no_style()}</option>
      {options.map((style) => (
        <option key={style.id} value={style.id}>
          {style.title}
        </option>
      ))}
    </select>
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
  const [pending, setPending] = useState<string | null>(null);
  return (
    <Group
      heading={m.workbench_name_language_heading()}
      lede={m.workbench_name_language_lede()}
    >
      <Field label={m.workbench_name_language_heading()}>
        <select
          value={pending ?? language}
          onChange={(event) => setPending(event.target.value)}
          className="border border-fd-border bg-fd-background px-2 py-1 text-xs"
        >
          <option value="liquid">{m.workbench_name_language_liquid()}</option>
          <option value="eta">{m.workbench_name_language_eta()}</option>
        </select>
      </Field>
      {pending !== null && pending !== language && (
        <div
          role="alert"
          className="flex flex-col gap-2 border-l-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-xs"
        >
          <strong className="font-medium">
            {m.workbench_name_language_confirm_heading()}
          </strong>
          <p>{m.workbench_name_language_confirm_body()}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onWrite("language", pending);
                setPending(null);
              }}
              className="cursor-pointer border border-fd-border px-2 py-1"
            >
              {m.workbench_name_language_confirm()}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="cursor-pointer px-2 py-1 underline underline-offset-2"
            >
              {m.workbench_name_language_cancel()}
            </button>
          </div>
        </div>
      )}
    </Group>
  );
}
