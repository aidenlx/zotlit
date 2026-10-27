// "Filter..." in the sidebar's More options menu: the Query View's Match
// editor in a dialog, with the conditions of the sidebar's one view. The
// filter that names the followed Attachment stays out of it.
import { useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { Modal } from "obsidian";
import type { App } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { AppContext } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { viewRuntime, ViewRegistryProvider } from "@/lib/view-atoms";
import { readFilterValues } from "@/views/query-view/atoms";
import { useFilterExpressions } from "@/views/query-view/expression-vocabulary";
import { FilterEditor } from "@/views/query-view/filter-popover";
import type { FilterValues } from "@/views/query-view/filter-popover";
import { allViewsDataset } from "@/views/query-view/query-file";
import type { QueryView } from "@/views/query-view/view";
import { useViewProperties } from "@/views/query-view/view-properties";

import { resultValue } from "./atoms";

const NO_VALUES: FilterValues = { tags: [], collections: [], libraries: [] };

const makeFilterModel = (query: QueryView) => ({
  state: Atom.make(query.state.getState()),
  values: viewRuntime.atom(
    readFilterValues.pipe(
      Effect.catch((error) =>
        Effect.logWarning("The filter values could not be read", error).pipe(
          Effect.as(NO_VALUES),
        ),
      ),
    ),
  ),
});

function SidebarFilter({
  query,
  model,
}: {
  query: QueryView;
  model: ReturnType<typeof makeFilterModel>;
}) {
  const { file, view: shown, failure } = useAtomValue(model.state);
  const filterIssue = failure?.filterIssue ?? null;
  const values = resultValue(useAtomValue(model.values)) ?? NO_VALUES;
  const properties = useViewProperties(query);
  // The dialog stands while it is mounted, so it reads the custom fields once.
  const expressions = useFilterExpressions(query, properties, {
    reading: true,
  });
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
  readonly #model;
  #release: (() => void) | null = null;

  constructor(app: App, query: QueryView) {
    super(app);
    this.#query = query;
    this.#model = makeFilterModel(query);
    this.setTitle(m.annot_view_filter_title());
  }

  override onOpen(): void {
    this.modalEl.addClass("zt-annot-filter-modal");
    this.contentEl.addClass("zt-root");
    const registry = this.#query.layout.store.registry;
    const releases = [
      registry.mount(this.#model.state),
      registry.mount(this.#model.values),
      this.#query.state.subscribe((state) =>
        registry.set(this.#model.state, state),
      ),
    ];
    this.#release = () => {
      for (const release of releases) release();
    };
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <ViewRegistryProvider registry={registry}>
        <AppContext value={this.app}>
          <SidebarFilter query={this.#query} model={this.#model} />
        </AppContext>
      </ViewRegistryProvider>,
    );
  }

  override onClose(): void {
    this.#root?.unmount();
    this.#root = null;
    this.#release?.();
    this.#release = null;
  }
}
