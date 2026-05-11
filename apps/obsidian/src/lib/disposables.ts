import type {
  EventRef,
  Events,
  KeymapEventListener,
  Modifier,
  Scope,
} from "obsidian";

export function disposable(dispose: () => void): Disposable {
  return { [Symbol.dispose]: dispose };
}

export function registerEvent(ref: EventRef): Disposable {
  return disposable(() => (ref as { e: Events }).e.offref(ref));
}

export function registerKeymap(
  scope: Scope,
  modifiers: Modifier[] | null,
  key: string | null,
  func: KeymapEventListener,
): Disposable {
  const handler = scope.register(modifiers, key, func);
  return disposable(() => scope.unregister(handler));
}

export function registerInterval(id: number): Disposable {
  return disposable(() => window.clearInterval(id));
}

export function registerDomEvent<K extends keyof WindowEventMap>(
  el: Window,
  type: K,
  callback: (this: HTMLElement, ev: WindowEventMap[K]) => any,
  options?: boolean | AddEventListenerOptions,
): Disposable;
export function registerDomEvent<K extends keyof DocumentEventMap>(
  el: Document,
  type: K,
  callback: (this: HTMLElement, ev: DocumentEventMap[K]) => any,
  options?: boolean | AddEventListenerOptions,
): Disposable;
export function registerDomEvent<K extends keyof HTMLElementEventMap>(
  el: HTMLElement,
  type: K,
  callback: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
  options?: boolean | AddEventListenerOptions,
): Disposable;
export function registerDomEvent(
  el: Window | Document | HTMLElement,
  type: string,
  callback: (this: HTMLElement, ev: Event) => any,
  options?: boolean | AddEventListenerOptions,
): Disposable {
  el.addEventListener(type, callback, options);
  return disposable(() => el.removeEventListener(type, callback, options));
}

export class DisposableAbortController
  extends AbortController
  implements Disposable
{
  [Symbol.dispose]() {
    this.abort(new DOMException("Disposed", "AbortError"));
  }
}
