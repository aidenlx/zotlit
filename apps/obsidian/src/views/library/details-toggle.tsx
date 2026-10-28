// The Details button at the end of the search row: it shows and hides the
// item details, beside a wide list and under a narrow one, and looks
// pressed while they show.
//
// @see apps/obsidian/docs/adr/0071-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { tooltipAttrs } from "@/lib/utils";

export class DetailsToggle {
  readonly #root: Root;
  readonly #toggle: () => void;

  /** Draw the button into `el`; a press calls `toggle`. */
  constructor(el: HTMLElement, toggle: () => void) {
    this.#root = createRoot(el);
    this.#toggle = toggle;
  }

  /** Show the button pressed while the details show. */
  show(on: boolean): void {
    this.#root.render(
      <IconButton
        icon="panel-right"
        data-library-details-toggle=""
        pressed={on}
        {...tooltipAttrs(m.library_view_details_toggle())}
        onClick={this.#toggle}
      />,
    );
  }

  unmount(): void {
    this.#root.unmount();
  }
}
