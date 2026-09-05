// The Name and folder tab: the Profile's own identity, the note-name template
// over the manifest's `filename` value, the five sparse bindings with their
// effective value and origin, the language key, and the locked details.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type {
  InstalledCitationStyle,
  ProfileBindingDefaults,
} from "@zotlit/workbench/bridge";
import type {
  ManifestScalar,
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { m } from "@/paraglide/messages.js";

import { SliceEditor } from "./slice-editor";
import type { SuggestionSource } from "./slice-editor";

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
function fieldId(key: string): string {
  return `workbench-field-${key}`;
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
  // The control a problem named, brought on screen with the keyboard in it. A
  // key the locked details hold opens that block first, so the reader lands on
  // the field rather than on the summary that hides it.
  useEffect(() => {
    if (!focus) return;
    const control = document.getElementById(fieldId(focus.field));
    if (!control) return;
    control.closest("details")?.setAttribute("open", "");
    control.scrollIntoView({ block: "nearest" });
    control.focus();
  }, [focus]);

  if (!manifest) {
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
      <Group
        heading={m.workbench_name_filename_heading()}
        lede={m.workbench_name_filename_lede()}
      >
        {controller.filenameSlice ? (
          <div className="rounded-md border border-fd-border bg-fd-card">
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
          <p className="text-xs text-fd-muted-foreground">
            {m.workbench_name_filename_source_only()}
            {onOpenSource && (
              <Button variant="outline" className="mt-2" onClick={onOpenSource}>
                {m.workbench_open_source()}
              </Button>
            )}
          </p>
        )}
        <p className="flex items-baseline gap-2 text-xs">
          <span className="text-fd-muted-foreground">
            {m.workbench_name_filename_result()}
          </span>
          <output className="min-w-0 flex-1 font-mono break-words">
            {filename}
          </output>
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
            <dl className="flex flex-col gap-1.5 text-xs">
              {BINDINGS.map((binding) => (
                <div
                  key={binding.key}
                  className="flex flex-wrap items-center gap-2"
                >
                  <dt className="min-w-0 flex-1">{binding.label()}</dt>
                  <dd className="font-mono">
                    {valueText(defaults[binding.key])}
                  </dd>
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
              value={manifest[binding.key]}
              fallback={defaults[binding.key]}
              citationStyles={citationStyles ?? null}
              onWrite={(value) => write(binding.key, value)}
            />
          ))
        )}
      </Group>

      <details className="rounded-md border border-fd-border bg-fd-card p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {m.workbench_name_profile_heading()}
        </summary>
        <div className="mt-4">
          <Group heading={m.workbench_name_profile_heading()}>
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
          </Group>
        </div>
      </details>

      <details className="rounded-md border border-fd-border bg-fd-card p-4">
        <summary className="cursor-pointer text-sm font-medium text-fd-muted-foreground">
          {m.workbench_name_advanced_summary()}
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <LanguageGroup language={manifest.language} onWrite={write} />

          <Field label={m.workbench_name_field_id()}>
            <Input
              readOnly
              value={manifest.id}
              className="flex-1 bg-fd-background font-mono text-fd-muted-foreground"
            />
          </Field>
          <p className="text-xs text-fd-muted-foreground">
            {m.workbench_name_id_note()}
          </p>
          <Field label={m.workbench_name_field_contract()}>
            <Input
              readOnly
              value={String(manifest.contract)}
              className="flex-1 bg-fd-background font-mono text-fd-muted-foreground"
            />
          </Field>
          <Field label={m.workbench_name_field_min_app_version()}>
            <Input
              readOnly
              value={manifest.minAppVersion ?? m.workbench_name_unset()}
              className="flex-1 bg-fd-background font-mono text-fd-muted-foreground"
            />
          </Field>
          <p className="text-xs text-fd-muted-foreground">
            {m.workbench_name_locked_note()}
          </p>
          <Field label={m.workbench_name_field_sample_item_type()}>
            <TextValue
              field="sampleItemType"
              value={manifest.sampleItemType ?? ""}
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
      <h3 className="text-sm font-semibold">{heading}</h3>
      {lede && <p className="text-xs text-fd-muted-foreground">{lede}</p>}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-fd-muted-foreground">{label}</span>
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
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
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
  return (
    <DraftText
      id={fieldId(field)}
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
  const label = binding.label();
  const inherits = value === undefined;
  const effective = inherits ? fallback : value;
  const id = fieldId(binding.key);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-fd-border bg-fd-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="min-w-0 flex-1 text-sm font-medium">
          {label}
        </label>
        <span className="text-xs text-fd-muted-foreground">
          {inherits
            ? m.workbench_name_origin_default()
            : m.workbench_name_origin_profile()}
        </span>
        <Button
          variant="outline"
          size="sm"
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
        </Button>
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
        <span className="flex items-center gap-3 py-2 text-sm">
          <Switch
            id={id}
            disabled={inherits}
            checked={effective === true}
            onCheckedChange={onWrite}
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
          className="bg-fd-background disabled:text-fd-muted-foreground"
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
    <NativeSelect
      id={id}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) =>
        onWrite(event.target.value === "" ? null : event.target.value)
      }
      className="w-full"
    >
      <NativeSelectOption value="">
        {m.workbench_name_value_no_style()}
      </NativeSelectOption>
      {options.map((style) => (
        <NativeSelectOption key={style.id} value={style.id}>
          {style.title}
        </NativeSelectOption>
      ))}
    </NativeSelect>
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
        <NativeSelect
          id={fieldId("language")}
          value={pending ?? language}
          onChange={(event) => setPending(event.target.value)}
          className="w-full"
        >
          <NativeSelectOption value="liquid">
            {m.workbench_name_language_liquid()}
          </NativeSelectOption>
          <NativeSelectOption value="eta">
            {m.workbench_name_language_eta()}
          </NativeSelectOption>
        </NativeSelect>
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onWrite("language", pending);
                setPending(null);
              }}
            >
              {m.workbench_name_language_confirm()}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
              {m.workbench_name_language_cancel()}
            </Button>
          </div>
        </div>
      )}
    </Group>
  );
}
