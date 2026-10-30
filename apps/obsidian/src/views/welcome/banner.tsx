// The Welcome banner mounts one leaf's model and commands in the view registry.
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Component } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { ViewRegistryProvider } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";

import { WelcomeActionsContext } from "./actions";
import type { WelcomeActions, WelcomeBannerHost } from "./actions";
import {
  dismissWelcomeCommand,
  keepWelcomeCommand,
  openReleaseNoteCommand,
} from "./atoms";
import {
  holdWelcomeModel,
  makeWelcomeModel,
  requestWelcome,
  setConverted,
  WelcomeModelProvider,
} from "./model";
import { holdSetupCommands } from "./setup-actions";
import type { SetupActions } from "./setup-actions";
import { Welcome } from "./Welcome";

export interface WelcomeBannerDeps {
  registry: ViewRegistryHandle;
  setupActions: SetupActions;
}

export class WelcomeBanner extends Component {
  readonly model = makeWelcomeModel();
  readonly #deps;
  readonly #host;
  readonly el: HTMLElement;
  #release: (() => void) | null;
  #root: Root | null = null;
  #stack: DisposableStack | undefined;
  #decided: PromiseWithResolvers<boolean> | null = null;
  readonly #settling = new Map<() => void, () => void>();

  constructor(
    deps: WelcomeBannerDeps,
    host: WelcomeBannerHost,
    el: HTMLElement,
  ) {
    super();
    this.#deps = deps;
    this.#host = host;
    this.el = el;
    this.#release = holdWelcomeModel(deps.registry, this.model);
  }

  request(): void {
    const { registry } = this.#deps;
    registry.set(keepWelcomeCommand, {
      "welcome.dismissed": false,
      "welcome.requested": true,
    });
    registry.update(this.model.session, requestWelcome);
  }

  dismiss(): void {
    const { registry } = this.#deps;
    registry.update(this.model.session, setConverted(false));
    registry.set(dismissWelcomeCommand, undefined);
  }

  get shown(): boolean {
    return this.#deps.registry.get(this.model.shown);
  }
  get known(): boolean {
    return (
      this.shown ||
      this.#deps.registry.get(this.model.state).connection.status !== "checking"
    );
  }
  get decided(): Promise<boolean> {
    if (this.known) return Promise.resolve(this.shown);
    this.#decided ??= Promise.withResolvers();
    return this.#decided.promise;
  }
  #decide(): void {
    this.#decided?.resolve(this.shown);
    this.#decided = null;
  }

  subscribeShown(listener: (shown: boolean) => void): () => void {
    return this.#deps.registry.subscribe(this.model.shown, listener, {
      immediate: true,
    });
  }

  get settled(): Promise<void> {
    const { registry } = this.#deps;
    const done = () => {
      const result = registry.get(this.model.loaded);
      return !AsyncResult.isInitial(result) && !result.waiting;
    };
    if (done()) return Promise.resolve();
    return new Promise((resolve) => {
      const stop = registry.subscribe(this.model.loaded, () => {
        if (done()) {
          stop();
          this.#settling.delete(resolve);
          resolve();
        }
      });
      this.#settling.set(resolve, stop);
    });
  }

  override onload(): void {
    using stack = new DisposableStack();
    const { registry } = this.#deps;
    this.#release ??= holdWelcomeModel(registry, this.model);
    for (const command of [
      keepWelcomeCommand,
      dismissWelcomeCommand,
      openReleaseNoteCommand,
    ])
      stack.defer(registry.mount(command));
    stack.defer(registry.mount(this.model.conversion));
    stack.defer(holdSetupCommands(registry));
    const convert = (retry: boolean) => {
      if (!retry) registry.update(this.model.session, setConverted(true));
      registry.set(this.model.conversion, { retry });
    };
    const actions: WelcomeActions = {
      retryTemplateCleanup: () => convert(true),
      convertLiteratureNoteTemplates: () => convert(false),
      openExternal: (url) => window.open(url),
      dismiss: () => this.dismiss(),
      showSteps: (shown) =>
        registry.set(keepWelcomeCommand, { "welcome.steps-shown": shown }),
      openReleaseNote: () => registry.set(openReleaseNoteCommand, undefined),
      ...this.#deps.setupActions,
      ...this.#host,
    };
    this.#root = createRoot(this.el);
    this.#root.render(
      <ViewRegistryProvider registry={registry}>
        <WelcomeModelProvider value={this.model}>
          <WelcomeActionsContext value={actions}>
            <Welcome />
          </WelcomeActionsContext>
        </WelcomeModelProvider>
      </ViewRegistryProvider>,
    );
    stack.defer(
      registry.subscribe(this.model.state, () => {
        if (this.known) this.#decide();
      }),
    );
    this.#stack = stack.move();
  }

  override onunload(): void {
    this.#decide();
    for (const [resolve, stop] of this.#settling) {
      stop();
      resolve();
    }
    this.#settling.clear();
    this.#root?.unmount();
    this.#root = null;
    this.#stack?.dispose();
    this.#stack = undefined;
    this.#release?.();
    this.#release = null;
  }
}
