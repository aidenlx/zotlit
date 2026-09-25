// Everything the Paired Run scenario needs from the Zotero half of a Paired
// Run: the two reachability probes that decide whether it runs, a Zotero Local
// API client, the RDP levers its authorization tiers pull, and the RDP reads
// and erases of Annotations the reader tests take. One module, because every
// part of it describes the same running Zotero.
//
// The wire facts this drives — the browser-traffic refusal, the authorize
// endpoint's outcomes, the single-use consumption rule, the rate limit — are
// the ones docs/fixture.md § "Trial the Zotero Local API" documents.

import { regex } from "arkregex";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { getFixtureLayout, livePairedZotero } from "@zotlit/scripts/fixture";
import type { FixtureLayout } from "@zotlit/scripts/fixture";
import { openRdpSession } from "@zotlit/zotero/debug/rdp-eval";

import { waitFor } from "./obsidian-cli.ts";

/**
 * Zotero's own header for "this is not browser traffic". Without it Zotero
 * closes the connection on any request carrying an `Origin` or a `Mozilla/`
 * user agent, and the caller sees a network failure with no status.
 */
const ALLOWED_REQUEST = { "Zotero-Allowed-Request": "1" } as const;

/** Where the Fixture build wrote the Zotero HTTP port this run allocated. */
const HTTP_PORT_PREF = regex('httpServer\\.port", *(?<port>\\d+)');

/**
 * What a Paired Run left reachable on this machine. Every field a probe could
 * not establish is null, and no probe throws: a missing file, a closed port or
 * an Obsidian that does not answer is a reason to skip, never a failure.
 */
export interface PairedRunReach {
  layout: FixtureLayout;
  /** `http://127.0.0.1:<port>/api/`, or null where nothing answers there. */
  baseUrl: string | null;
  /** The remote debugging port the run reported, or null. */
  debuggerPort: number | null;
}

/**
 * Probe the Paired Run on `fixtureRoot`. Safe to call at module scope: it
 * swallows its own failures.
 */
export async function probePairedRun(
  fixtureRoot: string,
): Promise<PairedRunReach> {
  const layout = getFixtureLayout(fixtureRoot);
  const baseUrl = await reachableLocalApi(layout);
  const debuggerPort = await reachableDebugger(layout);
  return { layout, baseUrl, debuggerPort };
}

async function reachableLocalApi(
  layout: FixtureLayout,
): Promise<string | null> {
  const prefs = await readFile(
    join(layout.profileDir, "prefs.js"),
    "utf-8",
  ).catch(() => null);
  const port =
    prefs === null ? undefined : HTTP_PORT_PREF.exec(prefs)?.groups.port;
  if (port === undefined) return null;
  const baseUrl = `http://127.0.0.1:${port}/api/`;
  // `GET /api/` answers 200 text/plain "Nothing to see here." and needs no key.
  const reply = await zoteroFetch(baseUrl, "").catch(() => null);
  return reply?.status === 200 ? baseUrl : null;
}

/**
 * The RDP port from the Paired Run's own report, or from `ZOTERO_RDP_PORT` for
 * a Zotero someone started by hand. Null unless a session actually opens on it.
 */
async function reachableDebugger(
  layout: FixtureLayout,
): Promise<number | null> {
  const reported = await livePairedZotero(layout).catch(() => null);
  const override = Number(process.env.ZOTERO_RDP_PORT);
  const port =
    reported?.debuggerPort ?? (Number.isInteger(override) ? override : null);
  if (port === null) return null;
  const session = await openRdpSession(port).catch(() => null);
  if (!session) return null;
  session[Symbol.dispose]();
  return port;
}

export interface ZoteroRequest {
  method?: string;
  /** Sent beside `Zotero-Allowed-Request`, which this always sends. */
  headers?: Record<string, string>;
  body?: string;
}

/**
 * One request to the Zotero Local API.
 *
 * Node's global `fetch` reads no proxy environment variable unless the process
 * opts in, so a loopback request reaches Zotero directly. That matters on a
 * machine running a local proxy: routed through one, Zotero's connection-close
 * refusal of browser traffic arrives as the proxy's own 503 page instead.
 */
export function zoteroFetch(
  baseUrl: string,
  path: string,
  request: ZoteroRequest = {},
): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    method: request.method ?? "GET",
    headers: { ...ALLOWED_REQUEST, ...request.headers },
    ...(request.body === undefined ? {} : { body: request.body }),
  });
}

/**
 * Zotero's 12-character id for the database it is serving. Generated once per
 * database and kept in its `settings` table, so it is read at runtime and never
 * asserted as a literal.
 */
export async function readServerID(baseUrl: string): Promise<string> {
  const reply = await zoteroFetch(baseUrl, "");
  const id = reply.headers.get("Zotero-Server-ID");
  if (!id) throw new Error("Zotero answered no Zotero-Server-ID");
  return id;
}

export interface AuthorizeReply {
  status: number;
  /** The parsed JSON body, or the raw text where the body is not JSON. */
  body: unknown;
}

/**
 * `POST /api/local/authorize`. Reaches Zotero's prompt, so it is rate limited
 * to five a minute and the caller resets that between cases.
 */
export async function authorize(
  baseUrl: string,
  options: { serverID: string; appName: string },
): Promise<AuthorizeReply> {
  const reply = await zoteroFetch(baseUrl, "local/authorize", {
    method: "POST",
    headers: {
      "Zotero-Server-ID": options.serverID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ appName: options.appName }),
  });
  const text = await reply.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // A refusal answers text/plain; the raw text is the whole oracle then.
  }
  return { status: reply.status, body };
}

/** A grant, as the authorize endpoint reports it. */
export interface Grant {
  key: string;
  remember: boolean;
}

export function isGrant(body: unknown): body is Grant {
  if (typeof body !== "object" || body === null) return false;
  const { key, remember } = body as Record<string, unknown>;
  return typeof key === "string" && typeof remember === "boolean";
}

/**
 * A live connection to Zotero's parent process. `json` is the only member the
 * scenario uses: every lever below goes through it.
 */
export interface ZoteroRdp extends Disposable {
  /**
   * Evaluate `body` as an `async` expression and parse its JSON result. The
   * expression must produce a value — an expression answering `undefined` has
   * no JSON form, and the underlying poll would wait for one that never comes.
   */
  json<T>(body: string): Promise<T>;
}

export async function openZoteroRdp(port: number): Promise<ZoteroRdp> {
  const session = await openRdpSession(port);
  return {
    async json<T>(body: string): Promise<T> {
      const packet = await session.evaluateAsync(body);
      const result = packet.result;
      if (typeof result !== "string") {
        throw new Error(
          `Zotero returned no result: ${JSON.stringify(
            packet.exceptionMessage ?? packet.exception ?? packet.result,
          )}`,
        );
      }
      if (result.startsWith("ERR:")) {
        throw new Error(`Zotero threw: ${result.slice("ERR:".length)}`);
      }
      return JSON.parse(result) as T;
    },
    [Symbol.dispose]() {
      session[Symbol.dispose]();
    },
  };
}

/**
 * Clear every stored authorization and the rate-limit window. This is the
 * per-case reset for the authorization tiers: it empties Zotero's cached key
 * store and deletes `localAPIKeys.json`.
 */
export async function resetAuthorizations(rdp: ZoteroRdp): Promise<void> {
  await rdp.json(`(async () => {
    Zotero.Server.LocalAPI._resetAuthorizeRateLimit();
    await Zotero.Server.LocalAPI.clearAuthorizations();
    return "ok";
  })()`);
}

/** How many **remembered** keys Zotero holds; single-use keys are not counted. */
export function authorizationCount(rdp: ZoteroRdp): Promise<number> {
  return rdp.json<number>("Zotero.Server.LocalAPI.getAuthorizationCount()");
}

/**
 * Put one remembered Write Authorization in place on a **running** Zotero, so
 * the tier that is not about authorization never raises a dialog.
 *
 * Writing `localAPIKeys.json` by hand does not work here, and that was
 * measured rather than assumed: Zotero caches its key store on the first
 * lookup and treats an empty array as a cache hit, `clearAuthorizations()`
 * leaves that empty array behind rather than dropping the cache, and
 * `Zotero.Server.LocalAPI` exposes no other cache lever. A key seeded into the
 * file after a clear answers `401 Invalid or expired API key`.
 *
 * So the key is taken from Zotero itself — one real `POST /api/local/authorize`
 * with the prompt scripted to Always Allow. Zotero's cache and its file stay
 * consistent, nothing is written behind its back, and the returned count is the
 * proof the authorization is held rather than assumed.
 */
export async function grantRememberedKey(
  baseUrl: string,
  rdp: ZoteroRdp,
  options: { serverID: string; appName: string },
): Promise<string> {
  await resetAuthorizations(rdp);
  await stubPrompt(rdp, { allow: true, remember: true });
  try {
    const reply = await authorize(baseUrl, options);
    if (reply.status !== 200 || !isGrant(reply.body)) {
      throw new Error(
        `Zotero refused a scripted Always Allow: ${reply.status}`,
      );
    }
    const held = await authorizationCount(rdp);
    if (held !== 1) {
      throw new Error(`Zotero holds ${held} remembered keys, not one`);
    }
    return reply.body.key;
  } finally {
    await restorePrompt(rdp);
  }
}

/** What Zotero's prompt should answer while the stub stands. */
export interface PromptOutcome {
  allow: boolean;
  remember: boolean;
}

/**
 * Replace `Zotero.Server.LocalAPI._promptForAuthorization` with a scripted
 * answer. The endpoint looks the function up on the object at call time, which
 * is what makes this replaceable — the pattern Zotero's own suite uses.
 *
 * Assertions belong on the HTTP response and on `getAuthorizationCount()`: the
 * stub picks the branch, the endpoint is the oracle.
 */
export async function stubPrompt(
  rdp: ZoteroRdp,
  outcome: PromptOutcome,
): Promise<void> {
  await rdp.json(`(() => {
    const local = Zotero.Server.LocalAPI;
    if (!local.__zlOriginalPrompt) {
      local.__zlOriginalPrompt = local._promptForAuthorization;
    }
    local.__zlOutcome = ${JSON.stringify(outcome)};
    local._promptForAuthorization = async () => local.__zlOutcome;
    return "stubbed";
  })()`);
}

/**
 * Put Zotero's own prompt back.
 *
 * @returns whether the original function stands again, and any leftover
 *   property the stub added — both asserted by the caller, so a restore that
 *   silently did nothing cannot pass.
 */
export function restorePrompt(
  rdp: ZoteroRdp,
): Promise<{ original: boolean; leftovers: string[] }> {
  return rdp.json(`(() => {
    const local = Zotero.Server.LocalAPI;
    if (local.__zlOriginalPrompt) {
      local._promptForAuthorization = local.__zlOriginalPrompt;
      delete local.__zlOriginalPrompt;
    }
    delete local.__zlOutcome;
    return {
      original: String(local._promptForAuthorization).includes("Zotero.Prompt"),
      leftovers: Object.keys(local).filter((name) => name.startsWith("__zl")),
    };
  })()`);
}

/**
 * Zotero's Write Authorization dialog is a plain Gecko common dialog, and RDP
 * keeps answering while its nested modal event loop spins. Slots, never labels:
 * the Fixture Zotero runs in the host OS locale, so the button text and the
 * window title are both translated.
 */
export type DialogButton = "accept" | "cancel" | "extra1";

const DIALOG_URL = "chrome://global/content/commonDialog.xhtml";

const FIND_DIALOG = `(() => {
  const windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    const candidate = windows.getNext();
    const dialog = candidate.document?.getElementById("commonDialog");
    if (candidate.location?.href === ${JSON.stringify(DIALOG_URL)}
      && dialog?.defaultButton === "extra1"
      && ["accept", "cancel", "extra1"].every(button => !dialog.getButton(button).hidden)) {
      return candidate;
    }
  }
  return null;
})()`;

/**
 * Poll until Zotero's authorization dialog exists. Its existence is itself the
 * "we really reached Zotero's own dialog" assertion, so this answers false
 * rather than throwing and lets the caller assert.
 */
export function waitForAuthorizationDialog(
  rdp: ZoteroRdp,
  tries = 60,
): Promise<boolean> {
  return waitFor(() => rdp.json<boolean>(`Boolean(${FIND_DIALOG})`), tries);
}

/**
 * Press one of the dialog's three buttons by slot: `accept` is Allow,
 * `cancel` is Always Allow, `extra1` is Deny.
 */
export async function clickAuthorizationDialog(
  rdp: ZoteroRdp,
  button: DialogButton,
): Promise<void> {
  const clicked = await rdp.json<boolean>(`(() => {
    const dialog = ${FIND_DIALOG};
    if (!dialog) return false;
    dialog.document.getElementById("commonDialog").getButton(${JSON.stringify(button)}).click();
    return true;
  })()`);
  if (!clicked) throw new Error("No authorization dialog was open to click");
}

/**
 * Close the dialog without pressing anything. Dismissal is not a refusal:
 * Gecko records it as the second button, which is Always Allow.
 *
 * @see docs/release-checklist.md § "A dismissed authorization dialog grants Always Allow"
 * @see https://github.com/aidenlx/zotlit/issues/1139
 */
export async function dismissAuthorizationDialog(
  rdp: ZoteroRdp,
): Promise<void> {
  const closed = await rdp.json<boolean>(`(() => {
    const dialog = ${FIND_DIALOG};
    if (!dialog) return false;
    dialog.close();
    return true;
  })()`);
  if (!closed) throw new Error("No authorization dialog was open to dismiss");
}

/**
 * Press Deny on any authorization dialog still standing, and say nothing when
 * none is. For teardown: a case that failed between raising the dialog and
 * answering it leaves the modal blocking every later request. Deny rather than
 * dismissal, because dismissal grants Always Allow.
 */
export async function denyAnyAuthorizationDialog(
  rdp: ZoteroRdp,
): Promise<boolean> {
  return await rdp.json<boolean>(`(() => {
    const dialog = ${FIND_DIALOG};
    if (!dialog) return false;
    dialog.document.getElementById("commonDialog").getButton("extra1").click();
    return true;
  })()`);
}

/** One Annotation on an Attachment Zotero's Reader has open. */
export interface ReaderAnnotation {
  rdp: ZoteroRdp;
  /** The Attachment's key in the user library. */
  attachmentKey: string;
  annotationKey: string;
}

/** The Reader open on an Attachment, as an RDP expression; `undefined` for none. */
function openReader(attachmentKey: string): string {
  return `(() => {
    const attachment = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      ${JSON.stringify(attachmentKey)},
    );
    return Zotero.Reader._readers.find(
      (candidate) => candidate.itemID === attachment.id,
    );
  })()`;
}

/**
 * The position and quoted text of one Annotation as Zotero's open Reader holds
 * it — the serialized Annotation its own item hands the view it draws — or
 * `null` where no Reader shows it.
 */
export function readerAnnotation({
  rdp,
  attachmentKey,
  annotationKey,
}: ReaderAnnotation): Promise<{
  position: string;
  text: string | null;
} | null> {
  return rdp.json(`(() => {
    const annotation = ${openReader(attachmentKey)}?._item
      .getAnnotations()
      .find(({ key }) => key === ${JSON.stringify(annotationKey)});
    return annotation
      ? {
          position: annotation.annotationPosition,
          text: annotation.annotationText ?? null,
        }
      : null;
  })()`);
}

/**
 * Waits until Zotero is done with the last position write on one Annotation.
 * The write drops the cached Excerpt Image of an image or ink in a commit
 * callback nothing awaits; Zotero's open Reader then renders a fresh image and
 * saves it. A write sent before that is done can meet a newer version and be
 * refused with 412, so this waits for the Reader's own state:
 *
 * - it holds the stored position at the stored modification time, with
 *   nothing left unsaved and no save in flight;
 * - for an image or ink, it holds an image, its renderer last rendered this
 *   modification (or never rendered this Annotation, whose image came from
 *   the cache), and the cache image is back;
 * - two Local API reads, one poll apart, agree on the version, with the
 *   Reader state holding at both.
 *
 * @param options.image whether the Annotation carries an Excerpt Image the
 *   Reader renders; a highlight or underline has none to wait for.
 * @throws when the Reader does not settle within the poll's bound.
 */
export async function readerSettled(
  annotation: ReaderAnnotation,
  { api, serverID, image }: { api: string; serverID: string; image: boolean },
): Promise<void> {
  const { rdp, attachmentKey, annotationKey } = annotation;
  const key = JSON.stringify(annotationKey);
  /** What the Reader has yet to finish, by name; empty once it is done. */
  const readerPending = () =>
    rdp.json<string[]>(`(async () => {
      const reader = ${openReader(attachmentKey)};
      const item = reader
        ? Zotero.Items.getByLibraryAndKey(reader._item.libraryID, ${key})
        : null;
      const manager = reader?._internalReader?._annotationManager;
      if (!item || !manager) return ["reader"];
      // The Reader's annotations live in its content window, so they are read
      // by index rather than handed a chrome callback.
      let held = null;
      for (let index = 0; index < manager._annotations.length; index++) {
        const candidate = manager._annotations[index];
        if (candidate.id === ${key}) held = candidate;
      }
      if (!held) return ["annotation"];
      const canonical = (position) =>
        JSON.stringify(position, Object.keys(position).sort());
      // Zotero stores "YYYY-MM-DD hh:mm:ss" in UTC; the Reader holds ISO.
      const modified = item.dateModified.replace(" ", "T") + "Z";
      const rendered = reader._internalReader._primaryView?._pdfRenderer
        ?._lastRendered.get(${key});
      const image = ${JSON.stringify(image)};
      return Object.entries({
        position:
          canonical(held.position) !==
          canonical(JSON.parse(item.annotationPosition)),
        modified: held.dateModified !== modified,
        unsaved: manager._unsavedAnnotations.size > 0,
        saving: !!manager._savingInProgress,
        image: image && !held.image,
        rendered:
          image && rendered !== undefined && rendered !== held.dateModified,
        cache: image && !(await Zotero.Annotations.hasCacheImage(item)),
      })
        .filter(([, pending]) => pending)
        .map(([name]) => name);
    })()`);
  const version = async () =>
    (
      (await (
        await zoteroFetch(api, `users/0/items/${annotationKey}`, {
          headers: { "Zotero-Server-ID": serverID },
        })
      ).json()) as { version: number }
    ).version;
  let seen: number | null = null;
  let pending: string[] = [];
  const settled = await waitFor(async () => {
    pending = await readerPending();
    if (pending.length > 0) {
      seen = null;
      return false;
    }
    const now = await version();
    const still = now === seen;
    seen = now;
    return still;
  }, 120);
  if (!settled)
    throw new Error(
      `the Zotero Reader never settled on ${annotationKey}: ${pending.join(", ") || "version moving"}`,
    );
}

/**
 * The Annotations Zotero holds on an item, by key, read over RDP.
 *
 * @param item the Zotero item as an RDP expression.
 */
export function heldAnnotationKeys(
  rdp: ZoteroRdp,
  item: string,
): Promise<string[]> {
  return rdp.json<string[]>(`${item}.getAnnotations().map(({ key }) => key)`);
}

/**
 * The one Annotation Zotero holds on `item` beyond `before`, once it does.
 * Every fresh key is handed to `created`, where given, before the count is
 * asserted, so a test that made more than one still erases them all.
 */
export async function freshAnnotationKey(
  rdp: ZoteroRdp,
  {
    item,
    before,
    created,
  }: {
    item: string;
    before: readonly string[];
    created?: (keys: readonly string[]) => void;
  },
): Promise<string> {
  let fresh: string[] = [];
  expect(
    await waitFor(async () => {
      fresh = (await heldAnnotationKeys(rdp, item)).filter(
        (key) => !before.includes(key),
      );
      return fresh.length > 0;
    }),
  ).toBe(true);
  created?.(fresh);
  expect(fresh).toHaveLength(1);
  return fresh[0]!;
}

/** The fields of one Annotation a create test reads from the Local API. */
export interface StoredAnnotation {
  annotationType: string;
  annotationColor: string;
  annotationComment: string;
  annotationPosition: string;
  annotationPageLabel: string;
  annotationSortIndex: string;
}

/** One Annotation's fields, as the Local API answers them. */
export async function storedAnnotation(
  baseUrl: string,
  serverID: string,
  key: string,
): Promise<StoredAnnotation> {
  const reply = await zoteroFetch(baseUrl, `users/0/items/${key}`, {
    headers: { "Zotero-Server-ID": serverID },
  });
  return ((await reply.json()) as { data: StoredAnnotation }).data;
}

/** Erases Annotations from Zotero by key, over RDP; a key already gone is skipped. */
export async function eraseAnnotations(
  rdp: ZoteroRdp,
  keys: readonly string[],
): Promise<void> {
  await rdp.json(`(async () => {
    for (const key of ${JSON.stringify(keys)}) {
      const item = Zotero.Items.getByLibraryAndKey(
        Zotero.Libraries.userLibraryID,
        key,
      );
      if (item) await item.eraseTx();
    }
    return "erased";
  })()`);
}
