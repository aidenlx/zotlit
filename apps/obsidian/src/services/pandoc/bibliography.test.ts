import { regex } from "arkregex";
import { describe, expect, it, vi } from "vitest";

import { type CslItemData } from "@zotlit/db";

import {
  fetchBibliography,
  LOCAL_API_PREF,
  ZOTERO_HTTP_PORT,
  type BibliographyHttpRequest,
  type BibliographyItemRef,
  type BibliographyPorts,
  type BibliographyResult,
} from "./bibliography";

const ORIGIN = `http://127.0.0.1:${ZOTERO_HTTP_PORT}`;
const RPC_URL = `${ORIGIN}/better-bibtex/json-rpc`;

/** The library route a local API read addresses: `users/0` or `groups/<id>`. */
const LIBRARY_ROUTE = regex("/api/(?<library>users/0|groups/\\d+)/");

const DOE: BibliographyItemRef = {
  itemKey: "AAAA1111",
  libraryID: 1,
  groupID: null,
};
const LEE: BibliographyItemRef = {
  itemKey: "BBBB2222",
  libraryID: 5,
  groupID: 42,
};

function csl(id: string, title: string): CslItemData {
  return { id, type: "article-journal", title };
}

interface Fixture {
  /**
   * Better BibTeX's answers per JSON-RPC method; absent methods answer 404. A
   * function answer is called with the call's params.
   */
  rpc?: Record<string, unknown>;
  /** Better BibTeX's JSON-RPC error message for `method`. */
  rpcError?: { method: string; message: string };
  /** Local API items per library route (`users/0`, `groups/42`). */
  api?: Record<string, { key: string; csljson: CslItemData[] }[]>;
  /** Status the local API answers with instead of `200`. */
  apiStatus?: number;
  localApiEnabled?: boolean;
  /** Zotero closed: every request rejects, as a refused connection does. */
  zoteroClosed?: boolean;
}

type Call = BibliographyHttpRequest & { rpcMethod?: string };

function ports(fixture: Fixture): BibliographyPorts & { calls: Call[] } {
  const calls: Call[] = [];
  const request = vi.fn(async (req: BibliographyHttpRequest) => {
    if (fixture.zoteroClosed) throw new Error("ECONNREFUSED");
    if (req.url === RPC_URL) {
      const { method, params } = JSON.parse(req.body ?? "{}") as {
        method: string;
        params: unknown[];
      };
      calls.push({ ...req, rpcMethod: method });
      if (fixture.rpcError?.method === method) {
        return rpcBody({
          error: { code: -32602, message: fixture.rpcError.message },
        });
      }
      if (!fixture.rpc || !(method in fixture.rpc)) {
        return { status: 404, text: "Endpoint does not exist" };
      }
      const answer = fixture.rpc[method];
      return rpcBody({
        result:
          typeof answer === "function"
            ? (answer as (params: unknown[]) => unknown)(params)
            : answer,
      });
    }
    calls.push({ ...req });
    if (fixture.apiStatus !== undefined) {
      return { status: fixture.apiStatus, text: "Local API is not enabled" };
    }
    const library = LIBRARY_ROUTE.exec(req.url)?.groups.library ?? "";
    const entries = fixture.api?.[library] ?? [];
    const requested = new Set(
      new URL(req.url).searchParams.get("itemKey")?.split(",") ?? [],
    );
    return {
      status: 200,
      text: JSON.stringify(
        entries
          .filter((entry) => requested.has(entry.key))
          .map((entry) => ({
            key: entry.key,
            version: 1,
            csljson: JSON.stringify(entry.csljson),
          })),
      ),
    };
  });
  return { calls, request, localApiEnabled: fixture.localApiEnabled ?? true };
}

function rpcBody(payload: object) {
  return {
    status: 200,
    text: JSON.stringify({ jsonrpc: "2.0", ...payload, id: 1 }),
  };
}

function entries(result: BibliographyResult): [string, string][] {
  if ("error" in result)
    throw new Error(`unexpected failure: ${result.error.code}`);
  return [...result.items].map(([indexedKey, item]) => [indexedKey, item.id]);
}

/** Indexed Key to item title, for items whose `id` alone cannot tell them apart. */
function titles(result: BibliographyResult): [string, unknown][] {
  if ("error" in result)
    throw new Error(`unexpected failure: ${result.error.code}`);
  return [...result.items].map(([indexedKey, item]) => [
    indexedKey,
    item["title"],
  ]);
}

function failure(result: BibliographyResult) {
  if (!("error" in result)) throw new Error("expected a failure");
  return result.error;
}

describe("fetchBibliography", () => {
  it("prefers Better BibTeX when its endpoint answers", async () => {
    const deps = ports({
      rpc: {
        "api.ready": { zotero: "7.0.9", betterbibtex: "6.7.200" },
        "item.citationkey": { "1:AAAA1111": "doe2020" },
        "item.export": JSON.stringify([csl("doe2020", "On Things")]),
      },
      api: { "users/0": [{ key: "AAAA1111", csljson: [csl("uri", "Stale")] }] },
    });

    const result = await fetchBibliography([DOE], deps);

    expect(entries(result)).toEqual([["AAAA1111", "doe2020"]]);
    expect("source" in result && result.source).toBe("better-bibtex");
    expect(deps.calls.every((call) => call.url === RPC_URL)).toBe(true);
  });

  it("asks Better BibTeX for the Better CSL JSON translator, one library at a time", async () => {
    const deps = ports({
      rpc: {
        "api.ready": {},
        "item.citationkey": {
          "1:AAAA1111": "doe2020",
          "5:BBBB2222": "lee2023",
        },
        "item.export": JSON.stringify([
          csl("doe2020", "On Things"),
          csl("lee2023", "On Others"),
        ]),
      },
    });

    await fetchBibliography([DOE, LEE], deps);

    const exports = deps.calls
      .filter((call) => call.rpcMethod === "item.export")
      .map(
        (call) =>
          (JSON.parse(call.body ?? "{}") as { params: unknown[] }).params,
      );
    expect(exports).toEqual([
      [["doe2020"], "f4b52ab0-f878-4556-85a0-c7aeedd09dfc", 1],
      [["lee2023"], "f4b52ab0-f878-4556-85a0-c7aeedd09dfc", 5],
    ]);
  });

  it("keeps a citation key two libraries share bound to its own library", async () => {
    const deps = ports({
      rpc: {
        "api.ready": {},
        "item.citationkey": {
          "1:AAAA1111": "doe2020",
          "5:BBBB2222": "doe2020",
        },
        "item.export": (params: unknown[]) =>
          JSON.stringify([
            csl("doe2020", params[2] === 1 ? "On Things" : "On Others"),
          ]),
      },
    });

    const result = await fetchBibliography([DOE, LEE], deps);

    expect(titles(result)).toEqual([
      ["AAAA1111", "On Things"],
      ["BBBB2222g42", "On Others"],
    ]);
  });

  it("reads the local API once per library, with the allowed-request header", async () => {
    const deps = ports({
      api: {
        "users/0": [
          { key: "AAAA1111", csljson: [csl("doe2020", "On Things")] },
        ],
        "groups/42": [
          { key: "BBBB2222", csljson: [csl("lee2023", "On Others")] },
        ],
      },
    });

    const result = await fetchBibliography([DOE, LEE], deps);

    expect(entries(result)).toEqual([
      ["AAAA1111", "doe2020"],
      ["BBBB2222g42", "lee2023"],
    ]);
    expect("source" in result && result.source).toBe("local-api");
    const reads = deps.calls.filter((call) => call.url !== RPC_URL);
    expect(reads.map((call) => call.url)).toEqual([
      `${ORIGIN}/api/users/0/items?itemKey=AAAA1111&include=csljson`,
      `${ORIGIN}/api/groups/42/items?itemKey=BBBB2222&include=csljson`,
    ]);
    expect(reads.map((call) => call.headers["Zotero-Allowed-Request"])).toEqual(
      ["1", "1"],
    );
  });

  it("sends every item key of a library in one read", async () => {
    const other = { itemKey: "CCCC3333", libraryID: 1, groupID: null };
    const deps = ports({
      api: {
        "users/0": [
          { key: "AAAA1111", csljson: [csl("doe2020", "On Things")] },
          { key: "CCCC3333", csljson: [csl("roe2021", "On More")] },
        ],
      },
    });

    const result = await fetchBibliography([DOE, other], deps);

    expect(entries(result)).toEqual([
      ["AAAA1111", "doe2020"],
      ["CCCC3333", "roe2021"],
    ]);
    expect(deps.calls).toHaveLength(2);
    expect(deps.calls[1]!.url).toContain("itemKey=AAAA1111%2CCCCC3333");
  });

  it("keeps the item URI of an item Zotero holds no citation key for", async () => {
    const uri = "http://zotero.org/users/123/items/AAAA1111";
    const deps = ports({
      api: {
        "users/0": [{ key: "AAAA1111", csljson: [csl(uri, "On Things")] }],
      },
    });

    expect(entries(await fetchBibliography([DOE], deps))).toEqual([
      ["AAAA1111", uri],
    ]);
  });

  it("reports the disabled local API from prefs, before any read", async () => {
    const deps = ports({ localApiEnabled: false });

    expect(failure(await fetchBibliography([DOE], deps))).toEqual({
      code: "local-api-disabled",
      pref: LOCAL_API_PREF,
    });
    expect(deps.calls.every((call) => call.url === RPC_URL)).toBe(true);
  });

  it("reports the disabled local API when Zotero refuses the read", async () => {
    const deps = ports({ apiStatus: 403 });

    expect(failure(await fetchBibliography([DOE], deps))).toEqual({
      code: "local-api-disabled",
      pref: LOCAL_API_PREF,
    });
  });

  it("reports a closed Zotero rather than an unavailable source", async () => {
    const deps = ports({ zoteroClosed: true });

    expect(failure(await fetchBibliography([DOE], deps))).toEqual({
      code: "zotero-not-running",
      port: ZOTERO_HTTP_PORT,
    });
  });

  it("reports a local API that answers with an error status", async () => {
    const deps = ports({ apiStatus: 500 });

    expect(failure(await fetchBibliography([DOE], deps))).toMatchObject({
      code: "source-failed",
      source: "local-api",
    });
  });

  it("fails the whole request when Better BibTeX has no citation key", async () => {
    const deps = ports({
      rpc: {
        "api.ready": {},
        "item.citationkey": { "1:AAAA1111": "doe2020", "5:BBBB2222": null },
        "item.export": JSON.stringify([csl("doe2020", "On Things")]),
      },
    });

    expect(failure(await fetchBibliography([DOE, LEE], deps))).toEqual({
      code: "citation-key-missing",
      indexedKeys: ["BBBB2222g42"],
    });
  });

  it("fails the whole request when a requested item is absent from the answer", async () => {
    const deps = ports({
      api: {
        "users/0": [
          { key: "AAAA1111", csljson: [csl("doe2020", "On Things")] },
        ],
      },
    });

    expect(failure(await fetchBibliography([DOE, LEE], deps))).toEqual({
      code: "items-missing",
      source: "local-api",
      indexedKeys: ["BBBB2222g42"],
    });
  });

  it("reports a Better BibTeX export it refused", async () => {
    const deps = ports({
      rpc: {
        "api.ready": {},
        "item.citationkey": { "1:AAAA1111": "doe2020" },
      },
      rpcError: { method: "item.export", message: "not found: doe2020" },
    });

    expect(failure(await fetchBibliography([DOE], deps))).toEqual({
      code: "source-failed",
      source: "better-bibtex",
      detail: "not found: doe2020",
    });
  });

  it("asks nothing of Zotero when the document cites nothing", async () => {
    const deps = ports({ zoteroClosed: true });

    expect(entries(await fetchBibliography([], deps))).toEqual([]);
    expect(deps.calls).toHaveLength(0);
  });
});
