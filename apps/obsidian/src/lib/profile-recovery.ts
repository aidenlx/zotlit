// UI recovery for an unavailable Profile, shared by notes and citation surfaces.
import type { App } from "obsidian";

import * as m from "./i18n/generated/messages";
import { getLogger } from "./log";
import { BaseNotice } from "./notice";
import type { UnknownProfileDiagnostic } from "./profile-stamp";

const logger = getLogger("profile-recovery");

export function requestProfileSwitch(app: App, path: string): void {
  logger.debug("Requested Profile recovery for {path}", { path });
  app.workspace.trigger("zotlit:switch-profile", { path });
}

export function profileRecoveryNotice(
  app: App,
  diagnostic: UnknownProfileDiagnostic,
  options: { path?: string; imported?: boolean } = {},
): string | DocumentFragment {
  const path = options.path ?? diagnostic.path;
  const message =
    options.imported && path
      ? m.notice_imported_note_profile_unknown({
          stamp: diagnostic.stamp,
          target: path,
        })
      : m.notice_literature_note_profile_unknown({ stamp: diagnostic.stamp });
  if (!path) return message;
  return BaseNotice.render((renderer) => {
    renderer.setTitle(message).addAction((button) => {
      button.setButtonText(m.profile_switch_recovery()).onClick(() => {
        requestProfileSwitch(app, path);
      });
    });
  });
}

/** One recovery control per reading section, cleared when its failure clears. */
export function renderProfileRecovery(
  container: HTMLElement,
  app: App,
  options: { path?: string },
): void {
  container.querySelector("[data-profile-recovery]")?.remove();
  if (!options.path) return;
  const path = options.path;
  const button = container.ownerDocument.createElement("button");
  button.type = "button";
  button.dataset["profileRecovery"] = path;
  button.textContent = m.profile_switch_recovery();
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    requestProfileSwitch(app, path);
  });
  container.appendChild(button);
}
