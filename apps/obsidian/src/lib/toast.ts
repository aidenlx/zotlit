import { AbortError } from "./abort-error";
import { getLogger } from "./log";
import { LazyNotice } from "./notice";

const logger = getLogger("toast");

export function cancellableLoading(
  message: string,
  ac: AbortController,
  reason = "Cancelled",
): DocumentFragment {
  return createFragment((el) => {
    const div = el.createDiv();
    div.setText(message);
    div.addEventListener(
      "click",
      (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        ac.abort(new AbortError(reason));
      },
      { once: true },
    );
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface ToastPromiseOptions<T> {
  loading?: string | DocumentFragment;
  success?:
    | ((data: T) => string | DocumentFragment | undefined)
    | string
    | DocumentFragment;
  error?:
    | ((
        errorMessage: string,
        error: unknown,
      ) => string | DocumentFragment | undefined)
    | string
    | DocumentFragment;
  /** Delay before the loading toast is shown; suppresses flicker on fast resolves. */
  loadingDelay?: number;
  successDuration?: number;
  errorDuration?: number;
  throwAborted?: boolean;
}

interface RethrowWithNoticeOptions {
  error:
    | ((
        errorMessage: string,
        error: unknown,
      ) => string | DocumentFragment | undefined)
    | string
    | DocumentFragment;
  errorDuration?: number;
  throwAborted?: boolean;
}

const LOADING_SYMBOL = Symbol("loading");

async function promiseToast<T>(
  promise: Promise<T>,
  options: ToastPromiseOptions<T>,
): Promise<void> {
  const {
    loading,
    loadingDelay = 200,
    successDuration = 2000,
    errorDuration = 4000,
    throwAborted = false,
  } = options;

  using notice = new LazyNotice();

  if (loading) {
    // Race the promise against the loading delay so a fast resolve doesn't
    // flash the loading toast. If the promise rejects during the race, swallow
    // here — the catch below will report it, and otherwise the race itself
    // would surface an "Uncaught (in promise)" warning.
    try {
      const loadingTimeout =
        loadingDelay > 0 ? sleep(loadingDelay) : Promise.resolve();

      const raceResult = await Promise.race([
        promise,
        loadingTimeout.then(() => LOADING_SYMBOL),
      ]);

      if (raceResult === LOADING_SYMBOL) {
        notice.setMessage(loading);
      }
    } catch {
      // handled below
    }
  }

  try {
    const result = await promise;

    const successMessage =
      typeof options.success === "function"
        ? options.success(result)
        : options.success;
    if (!successMessage) return;
    notice.setMessage(successMessage);
    await sleep(successDuration);
  } catch (error) {
    if (!throwAborted && AbortError.test(error)) {
      return;
    }
    if (options.error === undefined) return;
    const errorMessage =
      typeof options.error === "function"
        ? options.error(formatErrorMessage(error), error)
        : options.error;
    const errorMessageText =
      errorMessage instanceof DocumentFragment
        ? errorMessage.textContent
        : errorMessage;
    logger.error("Toast reported error: {message}", {
      message: errorMessageText,
      error,
    });
    if (!errorMessage) return;
    notice.setMessage(errorMessage);
    await sleep(errorDuration);
  }
}

export async function promise<T>(
  promise: Promise<T>,
  options: ToastPromiseOptions<T> & {
    /**
     * If false, the promise result is propagated to the caller.
     * @default true
     */
    swallowError: false;
  },
): Promise<T>;
export async function promise<T>(
  promise: Promise<T>,
  options: ToastPromiseOptions<T> & {
    /**
     * If false, the promise result is propagated to the caller.
     * @default true
     */
    swallowError?: true;
  },
): Promise<void>;
export async function promise<T>(
  promise: Promise<T>,
  {
    swallowError = true,
    ...options
  }: ToastPromiseOptions<T> & { swallowError?: boolean },
): Promise<T | undefined> {
  try {
    promiseToast(promise, options).catch(() => void 0);
    const result = await promise;
    if (!swallowError) return result;
  } catch (err) {
    if (swallowError) {
      return;
    }
    throw err;
  }
}

export function rethrowWithNotice(
  error: unknown,
  options: RethrowWithNoticeOptions,
): never {
  promiseToast(Promise.reject(error), options).catch(() => void 0);
  throw error;
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}
