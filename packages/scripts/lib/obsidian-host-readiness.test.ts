import { describe, expect, it } from "vitest";

import { createObsidianHostReadiness } from "./obsidian-host-readiness.ts";

describe("Obsidian host readiness", () => {
  it("reports recovery instructions when Obsidian is stopped", async () => {
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => false,
        readRegistry: async () => ({}),
        runObsidian: async () => {
          throw new Error("command not found");
        },
      },
      { environment: {} },
    );

    await expect(check()).rejects.toThrow(
      /No live Obsidian vault answered within 5 seconds[\s\S]*Open a host vault in Obsidian, then rerun:[\s\S]*obsidian-vault\.ts check/,
    );
  });

  it("requires a vault window when only the welcome window is open", async () => {
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => false,
        readRegistry: async () => ({}),
        runObsidian: async () => "Error: No active vault.",
      },
      { environment: {} },
    );

    await expect(check()).rejects.toThrow(
      "No live Obsidian vault answered within 5 seconds.",
    );
  });

  it("labels a persisted open entry with a missing path as stale", async () => {
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => false,
        readRegistry: async () => ({
          stale: { open: true, path: "/missing/research", ts: 1 },
        }),
        runObsidian: async () => "",
      },
      { environment: {} },
    );

    await expect(check()).rejects.toThrow(
      /Existing registered vaults:\n  none[\s\S]*Registered paths that are missing:\n  - \/missing\/research \(stale; persisted open: true\)/,
    );
  });

  it("lists a valid registered vault as a candidate even when it is closed", async () => {
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => true,
        readRegistry: async () => ({
          research: { open: false, path: "/vaults/research", ts: 1 },
        }),
        runObsidian: async () => "",
      },
      { environment: {} },
    );

    await expect(check()).rejects.toThrow(
      /Existing registered vaults:\n  - \/vaults\/research \(research; persisted open: false\)[\s\S]*Registered paths that are missing:\n  none/,
    );
  });

  it("uses ZT_HOST_VAULT to select an already open responder", async () => {
    const receivedArgs: string[][] = [];
    const check = createObsidianHostReadiness(
      {
        pathExists: async (path) => path.startsWith("/vaults/"),
        readRegistry: async () => ({}),
        runObsidian: async (args) => {
          receivedArgs.push(args);
          if (receivedArgs.length === 1) {
            return '=> {"id":"notes-id","path":"/vaults/notes"}';
          }
          if (receivedArgs.length === 2) {
            return '=> {"notes-id":{"open":true,"path":"/vaults/notes"},"research-id":{"open":true,"path":"/vaults/research"}}';
          }
          return '=> {"id":"research-id","path":"/vaults/research"}';
        },
      },
      { environment: { ZT_HOST_VAULT: "research" } },
    );

    await expect(check()).resolves.toEqual({
      id: "research-id",
      path: "/vaults/research",
    });
    expect(receivedArgs).toHaveLength(3);
    expect(receivedArgs.flat()).not.toContain("vault=research");
    expect(receivedArgs[2]).toContain("vault=research-id");
  });

  it("does not open a closed vault selected through ZT_HOST_VAULT", async () => {
    const receivedArgs: string[][] = [];
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => true,
        readRegistry: async () => ({}),
        runObsidian: async (args) => {
          receivedArgs.push(args);
          return receivedArgs.length === 1
            ? '=> {"id":"notes-id","path":"/vaults/notes"}'
            : '=> {"notes-id":{"open":true,"path":"/vaults/notes"},"research-id":{"open":false,"path":"/vaults/research"}}';
        },
      },
      { environment: { ZT_HOST_VAULT: "research" } },
    );

    await expect(check()).rejects.toThrow(
      "ZT_HOST_VAULT does not identify one open vault: research",
    );
    expect(receivedArgs.flat()).not.toContain("vault=research");
  });

  it("times out when an open selected vault does not answer its probe", async () => {
    let calls = 0;
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => true,
        readRegistry: async () => ({}),
        runObsidian: async () => {
          calls++;
          if (calls === 1) {
            return '=> {"id":"notes-id","path":"/vaults/notes"}';
          }
          if (calls === 2) {
            return '=> {"research-id":{"open":true,"path":"/vaults/research"}}';
          }
          return new Promise(() => {});
        },
      },
      {
        environment: { ZT_HOST_VAULT: "research" },
        timeoutMs: 10,
      },
    );

    await expect(check()).rejects.toThrow(
      "No live Obsidian vault answered within 10 milliseconds.",
    );
    expect(calls).toBe(3);
  });

  it("stops a nonresponsive CLI probe at the configured timeout", async () => {
    const check = createObsidianHostReadiness(
      {
        pathExists: async () => false,
        readRegistry: async () => ({}),
        runObsidian: async () => new Promise(() => {}),
      },
      { environment: {}, timeoutMs: 10 },
    );

    const result = Promise.race([
      check(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("probe hung")), 100),
      ),
    ]);
    await expect(result).rejects.toThrow(
      "No live Obsidian vault answered within 10 milliseconds.",
    );
  });
});
