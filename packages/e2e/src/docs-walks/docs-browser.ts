// A clean web browser for the docs walks: a headless Chrome on a new, empty
// profile (no history, bookmarks, accounts or extensions), driven over the
// DevTools protocol. A walk opens a docs page in it and records the page
// content alone as one shot of a clip, with the same drawn pointer and
// camera log as an Obsidian shot (docs-walk.ts). Downloads go to a folder the
// walk names. See packages/e2e/AGENTS.md, "Docs walks".

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CameraEvent } from "./camera.ts";
import type { ClipSettings } from "./clip-settings.ts";

/** The Chrome binary; `DOCS_WALK_CHROME` names another. */
const CHROME =
  process.env.DOCS_WALK_CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

type Message = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
};

/** One DevTools protocol connection. */
class Cdp {
  readonly #ws: WebSocket;
  #next = 1;
  readonly #pending = new Map<
    number,
    {
      resolve: (v: Record<string, unknown>) => void;
      reject: (e: Error) => void;
    }
  >();
  readonly #listeners = new Set<(m: Message) => void>();

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Message;
      if (message.id !== undefined) {
        const waiter = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error) waiter?.reject(new Error(message.error.message));
        else waiter?.resolve(message.result ?? {});
      } else for (const listener of this.#listeners) listener(message);
    });
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new Cdp(ws);
  }

  /** Send `method`; a reply that takes over `timeoutMs` fails it. */
  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 60000,
  ): Promise<T> {
    const id = this.#next++;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`no reply to ${method} in ${timeoutMs} ms`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          (resolve as (v: Record<string, unknown>) => void)(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  on(listener: (m: Message) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The first event `method` whose params pass `test`. */
  once(
    method: string,
    test: (params: Record<string, unknown>) => boolean = () => true,
    timeoutMs = 30000,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`no ${method} in ${timeoutMs} ms`));
      }, timeoutMs);
      const off = this.on((m) => {
        if (m.method !== method || !test(m.params ?? {})) return;
        clearTimeout(timer);
        off();
        resolve(m.params ?? {});
      });
    });
  }

  close(): void {
    this.#ws.close();
  }
}

/** A page in the clean browser. */
export interface DocsBrowserPage {
  /** Evaluate `expression` in the page and answer its value, awaited. */
  eval<T>(expression: string): Promise<T>;
}

export interface DocsBrowser extends AsyncDisposable {
  /** Open `url` in the page and wait for it to load. */
  open(url: string): Promise<void>;
  /**
   * Run `actions` and record the page content into `dir` as a shot: one PNG
   * per frame, `frames.json` and `camera.json`, as `encodeClip` reads them.
   * The page has `window.docsWalkPointer` (point, park, look) meanwhile.
   */
  record<T>(
    dir: string,
    settings: ClipSettings,
    actions: (page: DocsBrowserPage) => Promise<T>,
  ): Promise<T>;
  /**
   * Take the next download whose file name passes `match` into the
   * downloads folder: answers its name once it ends, and downloads are off
   * again.
   */
  download(
    match: (name: string) => boolean,
    timeoutMs?: number,
  ): Promise<{ done: Promise<string> }>;
}

/**
 * Start the clean browser: a page of `width` × `height` CSS px at 2× pixels,
 * like the Obsidian window of a walk, saving downloads into `downloads`.
 */
export async function openDocsBrowser(options: {
  width: number;
  height: number;
  downloads: string;
}): Promise<DocsBrowser> {
  const profile = await mkdtemp(join(tmpdir(), "docs-walk-browser-"));
  await mkdir(options.downloads, { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      // Chrome's own component downloads would land in the downloads folder.
      "--disable-component-update",
      "--disable-background-networking",
      `--window-size=${options.width},${options.height}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const exited = new Promise((r) => chrome.once("exit", r));
  const portFile = join(profile, "DevToolsActivePort");
  let port = "";
  let browserPath = "";
  for (let i = 0; i < 100 && !port; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const text = await readFile(portFile, "utf8").catch(() => "");
    [port = "", browserPath = ""] = text.trim().split("\n");
  }
  if (!port) throw new Error(`Chrome did not start: ${CHROME}`);
  const browser = await Cdp.connect(`ws://127.0.0.1:${port}${browserPath}`);
  const targets = await browser.send<{
    targetInfos: { targetId: string; type: string }[];
  }>("Target.getTargets");
  const target = targets.targetInfos.find((t) => t.type === "page")!;
  const page = await Cdp.connect(
    `ws://127.0.0.1:${port}/devtools/page/${target.targetId}`,
  );
  await page.send("Page.enable");
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: options.width,
    height: options.height,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await page.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  // Downloads stay off but for the one the walk asks for: Chrome fetches
  // files of its own as well.
  const downloadsOn = (on: boolean) =>
    browser.send("Browser.setDownloadBehavior", {
      behavior: on ? "allow" : "deny",
      downloadPath: options.downloads,
      eventsEnabled: true,
    });
  await downloadsOn(false);
  const downloads = new Map<string, string>();
  browser.on((m) => {
    if (m.method === "Browser.downloadWillBegin")
      downloads.set(
        String(m.params!.guid),
        String(m.params!.suggestedFilename),
      );
  });

  const evaluate = async <T>(expression: string): Promise<T> => {
    const reply = await page.send<{
      result: { value?: T };
      exceptionDetails?: { exception?: { description?: string } };
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (reply.exceptionDetails)
      throw new Error(
        reply.exceptionDetails.exception?.description ?? "page error",
      );
    return reply.result.value as T;
  };

  return {
    async open(url) {
      const loaded = page.once("Page.loadEventFired", () => true, 60000);
      await page.send("Page.navigate", { url });
      await loaded;
      // Web fonts and the page's own scripts settle.
      await evaluate("document.fonts.ready.then(() => true)");
      await new Promise((r) => setTimeout(r, 800));
    },
    async record(dir, settings, actions) {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const frames: { file: string; t: number }[] = [];
      const writes: Promise<void>[] = [];
      const off = page.on((m) => {
        if (m.method !== "Page.screencastFrame") return;
        const p = m.params as {
          data: string;
          sessionId: number;
          metadata: { timestamp: number };
        };
        const file = `f${String(frames.length).padStart(5, "0")}.png`;
        frames.push({ file, t: p.metadata.timestamp });
        writes.push(writeFile(join(dir, file), Buffer.from(p.data, "base64")));
        page
          .send("Page.screencastFrameAck", { sessionId: p.sessionId })
          .catch(() => {});
      });
      await evaluate(
        `(${installPointer.toString()})(${JSON.stringify({
          glideMs: settings.glide * 1000,
          lookMs: settings.camera ? settings.ease * 1000 : 0,
        })})`,
      );
      await page.send("Page.startScreencast", {
        format: "png",
        everyNthFrame: 1,
      });
      await new Promise((r) => setTimeout(r, settings.opening * 1000));
      let result: Awaited<ReturnType<typeof actions>>;
      try {
        result = await actions({ eval: evaluate });
        await new Promise((r) => setTimeout(r, settings.rest * 1000));
      } finally {
        await page.send("Page.stopScreencast");
        off();
        await Promise.all(writes);
        const end = await evaluate<number>(
          "(performance.timeOrigin + performance.now()) / 1000",
        );
        const events = await evaluate<CameraEvent[]>(
          "window.docsWalkPointer?.events ?? []",
        );
        await evaluate(
          "document.querySelectorAll('[data-docs-walk-pointer]').forEach((e) => e.remove())",
        );
        const origin = frames[0]?.t ?? end;
        await writeFile(
          join(dir, "frames.json"),
          JSON.stringify([...frames, { file: "", t: end }], null, 2),
        );
        await writeFile(
          join(dir, "camera.json"),
          JSON.stringify(
            {
              viewport: { width: options.width, height: options.height },
              events: events.map((e) =>
                "end" in e
                  ? { ...e, t: e.t - origin, end: e.end - origin }
                  : { ...e, t: e.t - origin },
              ),
              settings,
            },
            null,
            2,
          ),
        );
      }
      return result;
    },
    async download(match, timeoutMs = 60000) {
      const started = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new Error(`no download began in ${timeoutMs} ms`));
        }, timeoutMs);
        const off = browser.on((m) => {
          if (
            m.method !== "Browser.downloadWillBegin" ||
            !match(String(m.params!.suggestedFilename))
          )
            return;
          clearTimeout(timer);
          off();
          resolve(String(m.params!.guid));
        });
      });
      await downloadsOn(true);
      const done = (async () => {
        const guid = await started;
        const done = await browser.once(
          "Browser.downloadProgress",
          (p) =>
            p.guid === guid &&
            (p.state === "completed" || p.state === "canceled"),
          timeoutMs,
        );
        await downloadsOn(false);
        if (done.state !== "completed")
          throw new Error("the download was canceled");
        return downloads.get(guid) ?? "";
      })();
      return { done };
    },
    async [Symbol.asyncDispose]() {
      page.close();
      browser.close();
      chrome.kill();
      await exited;
      await rm(profile, { recursive: true, force: true });
    },
  };
}

/**
 * The drawn pointer in a browser page: the arrow and click ring of the
 * Obsidian shots, and the same camera log, on the screencast's clock.
 * Serialized into the page, so it uses nothing outside itself.
 */
function installPointer(o: { glideMs: number; lookMs: number }): void {
  type Box = { left: number; top: number; right: number; bottom: number };
  const events: unknown[] = [];
  const now = () => (performance.timeOrigin + performance.now()) / 1000;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const arrow = document.createElement("div");
  arrow.dataset.docsWalkPointer = "";
  arrow.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform ${Math.max(0, o.glideMs - 50)}ms cubic-bezier(.4,0,.2,1);`;
  arrow.innerHTML =
    '<svg width="22" height="26" viewBox="0 0 22 26" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M2 1.5v20.2l5.3-5.1 3.4 7.8 3.4-1.5-3.3-7.6 7.4-.2z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const ring = document.createElement("div");
  ring.dataset.docsWalkPointer = "";
  ring.style.cssText =
    "position:fixed;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:2px solid #7c5cff;background:rgba(124,92,255,.18);z-index:2147483646;pointer-events:none;opacity:0;";
  document.body.append(arrow, ring);
  const at = {
    x: Math.round(innerWidth * 0.55),
    y: Math.round(innerHeight * 0.6),
  };
  arrow.style.transform = `translate(${at.x}px,${at.y}px)`;
  const glide = async (x: number, y: number) => {
    at.x = Math.min(Math.max(x, 0), innerWidth - 22);
    at.y = Math.min(Math.max(y, 0), innerHeight - 26);
    arrow.style.transform = `translate(${at.x}px,${at.y}px)`;
    await wait(o.glideMs);
  };
  const rect = (b: Box) => ({
    x: b.left,
    y: b.top,
    w: b.right - b.left,
    h: b.bottom - b.top,
  });
  (window as unknown as { docsWalkPointer: unknown }).docsWalkPointer = {
    events,
    async point(el: Element) {
      el.scrollIntoView({ block: "nearest", behavior: "instant" });
      const b = el.getBoundingClientRect();
      const x = Math.round(b.left + Math.min(b.width / 2, 120));
      const y = Math.round(b.top + b.height / 2);
      await glide(x, y);
      events.push({ kind: "point", t: now(), x, y, rect: rect(b) });
      ring.style.left = `${x}px`;
      ring.style.top = `${y}px`;
      ring.animate(
        [
          { opacity: 1, transform: "scale(.5)" },
          { opacity: 0, transform: "scale(1.4)" },
        ],
        { duration: 450, easing: "ease-out" },
      );
      await wait(150);
    },
    async park(x: number, y: number) {
      await glide(Math.round(x), Math.round(y));
      events.push({ kind: "park", t: now(), x, y });
    },
    async look(targets: Element[], padding?: number) {
      const boxes = targets
        .map((t) => t.getBoundingClientRect())
        .map((b) => ({
          left: Math.max(b.left, 0),
          top: Math.max(b.top, 0),
          right: Math.min(b.right, innerWidth),
          bottom: Math.min(b.bottom, innerHeight),
        }))
        .filter((b) => b.right > b.left && b.bottom > b.top);
      if (boxes.length === 0) return;
      const box = {
        left: Math.min(...boxes.map((b) => b.left)),
        top: Math.min(...boxes.map((b) => b.top)),
        right: Math.max(...boxes.map((b) => b.right)),
        bottom: Math.max(...boxes.map((b) => b.bottom)),
      };
      events.push({
        kind: "look",
        t: now(),
        rect: rect(box),
        ...(padding !== undefined && { padding }),
      });
      await wait(o.lookMs);
    },
  };
}
