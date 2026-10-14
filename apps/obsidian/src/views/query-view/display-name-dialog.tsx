// "Rename property": the Display Name of one property of a Query View, which
// its headings, its labels and the header row of copy and CSV export show.
// An empty name shows the property's field label, else its path.
import { Modal } from "obsidian";
import type { App } from "obsidian";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useStore } from "zustand";

import * as m from "@/lib/i18n/generated/messages";

import { displayName } from "./query-file";
import type { QueryView } from "./view";
import { fieldLabel } from "./view-properties";

/** The Display Name field, as the rename dialog and the Formula dialog show it. */
export function DisplayNameField({
  property,
  value,
  onChange,
}: {
  /** The property the name is for; its column header shows while the name is empty. */
  property: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="zt:flex zt:flex-col zt:gap-1">
      <span className="zt:font-medium">{m.query_view_display_name()}</span>
      <input
        type="text"
        value={value}
        placeholder={fieldLabel(property)}
        data-query-display-name=""
        onInput={(event) => onChange(event.currentTarget.value)}
      />
      <span className="zt:text-xs zt:text-(--text-muted)">
        {m.query_view_display_name_desc({ label: fieldLabel(property) })}
      </span>
    </label>
  );
}

function DisplayNameForm({
  view,
  property,
  close,
}: {
  view: QueryView;
  property: string;
  close: () => void;
}) {
  const file = useStore(view.state, (s) => s.file);
  const [name, setName] = useState(
    () => (file && displayName(file, property)) ?? "",
  );
  return (
    <form
      className="zt:flex zt:flex-col zt:gap-3"
      data-query-rename-dialog={property}
      onSubmit={(event) => {
        event.preventDefault();
        if (view.renameProperty(property, name)) close();
      }}
    >
      <DisplayNameField property={property} value={name} onChange={setName} />
      <div className="modal-button-container">
        <button
          type="submit"
          className="mod-cta"
          data-query-display-name-save=""
        >
          {m.query_view_display_name_save()}
        </button>
      </div>
    </form>
  );
}

export class DisplayNameModal extends Modal {
  #root: Root | null = null;
  readonly #view: QueryView;
  readonly #property: string;

  constructor(app: App, view: QueryView, property: string) {
    super(app);
    this.#view = view;
    this.#property = property;
    this.setTitle(m.query_view_property_rename());
  }

  override onOpen(): void {
    this.modalEl.addClass("zt-query-display-name-modal");
    this.contentEl.addClass("zt-root");
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <DisplayNameForm
        view={this.#view}
        property={this.#property}
        close={() => this.close()}
      />,
    );
  }

  override onClose(): void {
    this.#root?.unmount();
    this.#root = null;
  }
}
