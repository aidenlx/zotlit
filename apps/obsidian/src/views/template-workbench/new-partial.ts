// The one create flow every Shared Partial entry point runs: the completion's
// "New partial…", the Partials submenu, the Add partial settings row, and the
// placeholder's Create action. It asks a name under the shared rule, writes
// `zotlit-partial.<name>.md`, and opens the document in the Template Workbench
// View.

import { Modal, TextComponent } from "obsidian";
import type { App } from "obsidian";

import type { TemplateLanguage } from "@zotlit/templates/facade";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import {
  normalizePartialName,
  partialFilename,
  partialNameRefusal,
} from "@/services/template/defaults";
import type { PartialNameRefusal } from "@/services/template/defaults";
import type { TemplateService } from "@/services/template/service";
import {
  dialogFooter,
  field,
  footerButton,
  frameDialog,
  note,
} from "@/setting-tab/profile-dialog";

import { openTemplateWorkbench } from "./register";

const logger = getLogger(["views", "template-workbench"]);

/** The template surface every Shared Partial entry point reads. */
export type SharedPartialActions = Pick<
  TemplateService,
  "ready" | "getPartialNames" | "createPartial"
>;

export interface CreateSharedPartialOptions {
  /** Seeds the name field with what the reader typed at the call site. */
  name?: string;
  /** The source the new document starts from. @default "" */
  source?: string;
  /** Writes a manifest naming the language; a Liquid document needs none. */
  language?: TemplateLanguage;
  /**
   * Where the created document opens. `"split"` puts it beside the caller, so
   * an editor keeps its place; `false` leaves the workspace alone.
   *
   * @default "split"
   */
  open?: "split" | "tab" | false;
}

/**
 * Ask a name, create the Shared Partial, and open it.
 *
 * @returns the created name, which a caller writes into the call it is
 *   completing, or `null` when the reader dismisses the prompt.
 */
export async function createSharedPartial(
  app: App,
  template: SharedPartialActions,
  options: CreateSharedPartialOptions = {},
): Promise<string | null> {
  await template.ready;
  const taken = template.getPartialNames();
  const modal = new NewPartialModal(app, taken, options.name ?? "");
  modal.open();
  const name = await modal.result;
  if (name === null) return null;
  try {
    const file = await template.createPartial(name, {
      ...(options.source === undefined ? {} : { source: options.source }),
      ...(options.language === undefined ? {} : { language: options.language }),
    });
    const open = options.open ?? "split";
    if (open !== false)
      await openTemplateWorkbench(app, file, {
        leaf: app.workspace.getLeaf(open === "split" ? "split" : "tab"),
        explainUnsupported: false,
      });
    return name;
  } catch (error) {
    logger.error("Failed to create a Shared Partial", { name, error });
    new BaseNotice(m.notice_partial_create_failed());
    return null;
  }
}

/** The refusal as the prompt words it, under the name field. */
function refusalText(refusal: PartialNameRefusal, name: string): string {
  switch (refusal) {
    case "empty":
      return "";
    case "characters":
      return m.partial_name_characters();
    case "reserved":
      return m.partial_name_reserved({ name });
    case "duplicate":
      return m.partial_name_duplicate({ name });
  }
}

/**
 * The name prompt: one field, the resulting filename under it, and a Create
 * button that stays disabled until the rule accepts what is typed.
 */
class NewPartialModal extends Modal {
  readonly #taken: readonly string[];
  readonly #seed: string;
  readonly #decision = Promise.withResolvers<string | null>();
  readonly result = this.#decision.promise;
  #created = false;

  constructor(app: App, taken: readonly string[], seed: string) {
    super(app);
    this.#taken = taken;
    this.#seed = seed;
  }

  override onOpen(): void {
    frameDialog(this);
    this.setTitle(m.partial_new_title());
    let name = normalizePartialName(this.#seed);
    const input = new TextComponent(
      field(this.contentEl, m.partial_new_name_label()),
    ).setPlaceholder(m.partial_new_name_placeholder());
    const status = note(this.contentEl, { status: true });
    const submit = () => {
      if (partialNameRefusal(name, this.#taken)) return;
      this.#created = true;
      this.#decision.resolve(name);
      this.close();
    };
    const footer = dialogFooter(this);
    const create = footerButton(
      footer,
      m.partial_new_action(),
      submit,
    ).setCta();
    footerButton(footer, m.modal_cancel(), () => this.close());
    const update = (typed: string) => {
      name = normalizePartialName(typed);
      const refusal = partialNameRefusal(name, this.#taken);
      if (refusal)
        status.set(
          refusalText(refusal, name),
          refusal === "empty" ? "muted" : "error",
        );
      else status.set(m.partial_new_file({ file: partialFilename(name) }));
      create.setDisabled(refusal !== null);
    };
    input.onChange(update);
    input.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });
    input.setValue(this.#seed);
    update(this.#seed);
    input.inputEl.focus();
    input.inputEl.select();
  }

  override onClose(): void {
    if (!this.#created) this.#decision.resolve(null);
    this.contentEl.empty();
  }
}
