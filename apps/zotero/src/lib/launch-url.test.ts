import { afterEach, describe, expect, it } from "vitest";

import { launchExternalUrl } from "./launch-url.js";

const LINK = "obsidian://zotlit/open?item=859&source-id=4c7df3cb";
const SYSTEM_PRINCIPAL = "system-principal";
const NS_ERROR_ILLEGAL_VALUE = 0x80070057;

/** The failure Zotero 10.0.2 raises for a null triggering principal. */
function missingPrincipalFailure(): Error {
  const error = new Error(
    "Component returned failure code: 0x80070057 (NS_ERROR_ILLEGAL_VALUE) [nsIExternalProtocolService.loadURI]",
  );
  error.name = "NS_ERROR_ILLEGAL_VALUE";
  return Object.assign(error, { result: NS_ERROR_ILLEGAL_VALUE });
}

interface Recorders {
  launched: string[];
  loaded: Array<{ spec: string; principal: unknown }>;
}

/**
 * Install the globals the plugin reads: Zotero, Components, Cc, Ci, Services.
 * `behavior` stands in for the Zotero build under test.
 */
function installGlobals(behavior: (url: string) => void): Recorders {
  const recorders: Recorders = { launched: [], loaded: [] };
  const protocolService = {
    loadURI(uri: { spec: string }, principal: unknown): void {
      recorders.loaded.push({ spec: uri.spec, principal });
    },
  };
  (globalThis as { Zotero?: unknown }).Zotero = {
    launchURL(url: string): void {
      recorders.launched.push(url);
      behavior(url);
    },
  };
  (globalThis as { Components?: unknown }).Components = {
    results: { NS_ERROR_ILLEGAL_VALUE },
  };
  (globalThis as { Cc?: unknown }).Cc = {
    "@mozilla.org/uriloader/external-protocol-service;1": {
      getService: () => protocolService,
    },
  };
  (globalThis as { Ci?: unknown }).Ci = { nsIExternalProtocolService: {} };
  (globalThis as { Services?: unknown }).Services = {
    io: { newURI: (spec: string) => ({ spec }) },
    scriptSecurityManager: { getSystemPrincipal: () => SYSTEM_PRINCIPAL },
  };
  return recorders;
}

afterEach(() => {
  delete (globalThis as { Zotero?: unknown }).Zotero;
  delete (globalThis as { Components?: unknown }).Components;
  delete (globalThis as { Cc?: unknown }).Cc;
  delete (globalThis as { Ci?: unknown }).Ci;
  delete (globalThis as { Services?: unknown }).Services;
});

describe("launchExternalUrl", () => {
  it("leaves a working Zotero.launchURL as the only launch", () => {
    const recorders = installGlobals(() => {});

    launchExternalUrl(LINK);

    expect(recorders.launched).toEqual([LINK]);
    expect(recorders.loaded).toEqual([]);
  });

  it("repeats the launch with a system principal when Zotero rejects the null principal", () => {
    const recorders = installGlobals(() => {
      throw missingPrincipalFailure();
    });

    launchExternalUrl(LINK);

    expect(recorders.loaded).toEqual([
      { spec: LINK, principal: SYSTEM_PRINCIPAL },
    ]);
  });

  it("keeps the Zotero error for a different failure", () => {
    const failure = new Error("Handler not found for 'obsidian' URLs");
    const recorders = installGlobals(() => {
      throw failure;
    });

    expect(() => launchExternalUrl(LINK)).toThrow(failure);
    expect(recorders.loaded).toEqual([]);
  });
});
