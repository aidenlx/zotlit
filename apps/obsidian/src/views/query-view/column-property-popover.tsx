// A Table column's "Edit property", as the Bases column menu opens it: the
// property's page of the Properties popover — its Display Name, its Formula
// and its "…" menu — standing alone at the column's header cell, with no
// rows under it to step back to.
import { useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

import { Chooser, useChooserOpenPage } from "@/components/chooser";
import type { PinnedPopoverHandle } from "@/components/pinned-popover";

import { PropertyPage } from "./property-page";
import type { QueryView } from "./view";
import type { ViewProperties } from "./view-properties";

/** Opens a column's page from outside the popover. */
export interface ColumnPropertyHandle {
  /** Open the page of the property at `path`, beside `anchor`. */
  open(anchor: HTMLElement, path: string): void;
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
  return (
    <Chooser value={NO_SELECTION} onValueChange={noop} pagesOnly>
      <Opener anchor={anchor} handle={handle} />
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
            const order = properties.visible.map((shown) => shown.path);
            return (
              <PropertyPage
                view={view}
                entry={entry}
                shown={order.includes(page)}
                onShownChange={(show) => {
                  // Hidden, the column takes the header cell the page
                  // hangs on off the page, and the page goes with it.
                  if (!show) popup.current?.hide();
                  view.document.editView({
                    order: properties.orderOf(
                      show
                        ? [...order, page]
                        : order.filter((path) => path !== page),
                    ),
                  });
                }}
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
  handle,
}: {
  anchor: { current: HTMLElement | null };
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
    }),
    [anchor, openPage],
  );
  return null;
}
