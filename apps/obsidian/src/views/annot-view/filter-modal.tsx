// "Filter..." in the sidebar's More options menu: the Query View's Match
// editor in a dialog, with the conditions of the sidebar's one view. The
// filter that names the followed Attachment stays out of it.
import { Modal } from "obsidian";
import type { App } from "obsidian";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useStore } from "zustand";

import { AppContext } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { useFilterExpressions } from "@/views/query-view/expression-vocabulary";
import { FilterEditor } from "@/views/query-view/filter-popover";
import type { FilterValues } from "@/views/query-view/filter-popover";
import { allViewsDataset } from "@/views/query-view/query-file";
import type { QueryView } from "@/views/query-view/view";
import { useViewProperties } from "@/views/query-view/view-properties";

const logger = getLogger(["views", "annot-view", "filter"]);

const NO_VALUES: FilterValues = { tags: [], collections: [], libraries: [] };

function SidebarFilter({ query }: { query: QueryView }) {
  const file = useStore(query.state, (s) => s.file);
  const shown = useStore(query.state, (s) => s.view);
  const filterIssue = useStore(
    query.state,
    (s) => s.failure?.filterIssue ?? null,
  );
  const properties = useViewProperties(query);
  // The dialog stands while it is mounted, so it reads the custom fields once.
  const expressions = useFilterExpressions(query, properties, {
    reading: true,
  });
  const [values, setValues] = useState<FilterValues>(NO_VALUES);
  useEffect(() => {
    query.filterValues().then(setValues, (error: unknown) => {
      logger.warn("The filter values could not be read", { error });
    });
  }, [query]);
  // The followed Attachment can go while the dialog is open.
  if (!file || !shown) return null;
  return (
    <FilterEditor
      dataset={shown.from ?? "annotations"}
      allViewsDataset={allViewsDataset(file)}
      allViews={file.filters}
      thisView={shown.filters}
      values={values}
      issue={filterIssue}
      properties={properties}
      expressions={expressions}
      sections={["view"]}
      onChange={(section, next) => query.document.setFilters(section, next)}
    />
  );
}

export class SidebarFilterModal extends Modal {
  #root: Root | null = null;
  readonly #query: QueryView;

  constructor(app: App, query: QueryView) {
    super(app);
    this.#query = query;
    this.setTitle(m.annot_view_filter_title());
  }

  override onOpen(): void {
    this.modalEl.addClass("zt-annot-filter-modal");
    this.contentEl.addClass("zt-root");
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <AppContext value={this.app}>
        <SidebarFilter query={this.#query} />
      </AppContext>,
    );
  }

  override onClose(): void {
    this.#root?.unmount();
    this.#root = null;
  }
}
