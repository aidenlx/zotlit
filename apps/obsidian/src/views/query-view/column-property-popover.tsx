// A Table column's "Edit property", as the Bases column menu opens it: the
// property's page of the Properties popover — its Display Name, its Formula
// and its "…" menu — standing alone at the column's header cell, with no
// rows under it to step back to. It closes once that cell leaves the page,
// as a hidden column or a switch of view takes it.
import { useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { Ref, RefObject } from "react";

import { Chooser, useChooserOpenPage } from "@/components/chooser";
import type { PinnedPopoverHandle } from "@/components/pinned-popover";

import { PropertyPage } from "./property-page";
import type { QueryView } from "./view";
import type { ViewProperties } from "./view-properties";

/** Opens a column's page from outside the popover, and closes it. */
export interface ColumnPropertyHandle {
  /** Open the page of the property at `path`, beside `anchor`. */
  open(anchor: HTMLElement, path: string): void;
  close(): void;
}

const NO_SELECTION: readonly string[] = [];
const noop = () => {};

export function ColumnPropertyPopover({
  view,
  properties,
  handle,
}: {
  view: QueryView;
  properties: ViewProperties;
  handle: Ref<ColumnPropertyHandle>;
}) {
  const anchor = useRef<HTMLElement | null>(null);
  const popup = useRef<PinnedPopoverHandle>(null);
  // The header renders again with the view's Properties: a cell that left
  // the page with them takes the page along.
  useLayoutEffect(() => {
    if (anchor.current && !anchor.current.isConnected) popup.current?.hide();
  }, [properties]);
  return (
    <Chooser value={NO_SELECTION} onValueChange={noop} pagesOnly>
      <Opener anchor={anchor} popup={popup} handle={handle} />
      <Chooser.Popup
        anchor={anchor}
        handle={popup}
        className="zt:[max-height:min(--spacing(120),calc(100vh_-_--spacing(2)))] zt:min-w-60"
        data-query-column-popover=""
      >
        <Chooser.Page>
          {(page) => {
            const entry = properties.kept(page);
            if (!entry) return <Chooser.PageGone />;
            return (
              <PropertyPage
                view={view}
                entry={entry}
                shown={properties.visible.some(({ path }) => path === page)}
                onShownChange={(show) =>
                  view.document.editView({
                    order: properties.withShown(page, show),
                  })
                }
              />
            );
          }}
        </Chooser.Page>
      </Chooser.Popup>
    </Chooser>
  );
}

/** The Chooser's own way in, handed to the header outside it. */
function Opener({
  anchor,
  popup,
  handle,
}: {
  anchor: RefObject<HTMLElement | null>;
  popup: RefObject<PinnedPopoverHandle | null>;
  handle: Ref<ColumnPropertyHandle>;
}) {
  const openPage = useChooserOpenPage();
  useImperativeHandle(
    handle,
    () => ({
      open: (el, path) => {
        anchor.current = el;
        openPage(path);
      },
      close: () => popup.current?.hide(),
    }),
    [anchor, popup, openPage],
  );
  return null;
}
