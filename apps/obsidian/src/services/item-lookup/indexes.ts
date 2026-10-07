import type { IndexedItem, LanguageNameLookup } from "@zotlit/db";
import { cleanQuery, tokenize, tokenizeIndexItems } from "@zotlit/item-lookup";
import type { TokenizerOptions } from "@zotlit/item-lookup";

import type { IsolatedProcess } from "@/services/isolated-process";

import { decodeIndexReply } from "./worker-protocol";
import type { IndexCommand, IndexHit } from "./worker-protocol";

export interface LookupIndex extends AsyncDisposable {
  readonly count: number;
  search(
    query: string,
    tokenizer: TokenizerOptions,
    limit: number,
  ): Promise<IndexHit[]>;
}
interface IndexBuilder extends AsyncDisposable {
  add(items: readonly IndexedItem[]): Promise<void>;
  build(): Promise<LookupIndex>;
}

/** Builds replacement indexes while the current index continues to answer searches. */
export class LookupIndexes implements AsyncDisposable {
  readonly #worker;
  readonly #startup = Promise.withResolvers<void>();
  readonly #pending = new Map<
    number,
    ReturnType<typeof Promise.withResolvers<unknown>>
  >();
  #nextRequest = 0;
  #nextIndex = 0;
  #error: Error | undefined;
  #disposal: Promise<void> | undefined;
  readonly ready = this.#startup.promise;

  constructor(worker: IsolatedProcess) {
    this.#worker = worker;
    worker.on("message", (text: string) => {
      const reply = decodeIndexReply(text);
      if (reply.type === "ready") {
        this.#startup.resolve();
        return;
      }
      const pending = this.#pending.get(reply.id);
      if (!pending) return;
      this.#pending.delete(reply.id);
      if (reply.type === "error") pending.reject(new Error(reply.message));
      else pending.resolve(reply.value);
    });
    worker.on("error", (error: Error) => this.#fail(error));
    worker.on("exit", (code: number) =>
      this.#fail(new Error(`Item Lookup process exited (${code})`)),
    );
  }

  async createBuilder(options: {
    libraries: number[];
    locale: string;
    tokenizer: TokenizerOptions;
    languageLookup: LanguageNameLookup;
  }): Promise<IndexBuilder> {
    const index = ++this.#nextIndex;
    await this.#request({
      type: "begin",
      index,
      libraries: options.libraries,
      locale: options.locale,
    });
    let transferred = false;
    const drop = async () => {
      if (this.#error) return;
      try {
        await this.#request({ type: "drop", index });
      } catch (error) {
        if (!this.#error) throw error;
      }
    };
    return {
      add: async (items) => {
        await this.#request({
          type: "add",
          index,
          items: items.map((item) => ({
            ...item,
            dateModified: item.dateModified.epochMilliseconds,
          })),
          tokens: tokenizeIndexItems(
            items,
            options.tokenizer,
            options.languageLookup,
          ),
        });
      },
      build: async () => {
        const count = (await this.#request({ type: "build", index })) as number;
        transferred = true;
        return {
          count,
          search: async (query, tokenizer, limit) =>
            (await this.#request({
              type: "search",
              index,
              query,
              limit,
              tokens: tokenize(cleanQuery(query), tokenizer),
            })) as IndexHit[],
          [Symbol.asyncDispose]: drop,
        };
      },
      [Symbol.asyncDispose]: async () => {
        if (!transferred) await drop();
      },
    };
  }

  async #request(request: IndexCommand): Promise<unknown> {
    await this.ready;
    if (this.#error) throw this.#error;
    const id = ++this.#nextRequest;
    const pending = Promise.withResolvers<unknown>();
    this.#pending.set(id, pending);
    try {
      this.#worker.postMessage(JSON.stringify({ ...request, id }));
    } catch (error) {
      this.#fail(error instanceof Error ? error : new Error(String(error)));
    }
    return pending.promise;
  }

  #fail(error: Error): void {
    this.#error ??= error;
    this.#startup.reject(error);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return (this.#disposal ??= this.#close());
  }

  async #close(): Promise<void> {
    this.#fail(new Error("Item Lookup is closed"));
    await this.#worker.terminate();
    this.#worker.removeAllListeners();
  }
}
