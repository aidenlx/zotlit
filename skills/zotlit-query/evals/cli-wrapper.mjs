import { randomUUID } from "node:crypto";
import { appendFile, chmod, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

const commands = new Set([
  "help",
  "zotlit:query",
  "zotlit:query-schema",
  "zotlit:query-guide",
  "zotlit:query-cancel",
  "zotlit:annotation-image",
]);

// The runner executes the fixed CLI and writes receipts. The agent can call the
// socket, but its sandbox needs no write access to the receipt file or run root.
export async function startCliWrapper({ agentRoot, callLog, vaultId, invoke }) {
  // macOS Unix socket paths must fit in 104 bytes; worktree paths do not fit.
  // The agent sandbox matches resolved paths, and macOS resolves /tmp to
  // /private/tmp, so the allow-listed path must be the resolved one.
  const socketPath = join(await realpath("/tmp"), `zq-${randomUUID()}.sock`);
  const controller = new AbortController();
  const sockets = new Set(),
    pending = new Set();
  let logWrites = Promise.resolve();
  await writeFile(callLog, "", { flag: "wx", mode: 0o600 });
  async function call(socket, argv) {
    const timestamp = Temporal.Now.instant().toString();
    let result;
    try {
      if (!Array.isArray(argv) || !argv.every((arg) => typeof arg === "string"))
        throw new Error("CLI arguments must be strings");
      const args = argv.filter((arg) => !arg.startsWith("vault="));
      const vaults = argv.filter((arg) => arg.startsWith("vault="));
      if (vaults.length !== 1 || argv[0] !== `vault=${vaultId}`)
        throw new Error(`Use vault=${vaultId} before the command`);
      if (argv.some((arg) => arg.startsWith("--")))
        throw new Error("Use Obsidian command arguments, not driver options");
      if (!commands.has(args[0]))
        throw new Error("Use a Query command or help");
      result = await invoke(argv, controller.signal);
    } catch (error) {
      result = { code: 1, stdout: "", stderr: `${error.message}\n` };
    }
    const receipt = {
      argv,
      exitCode: result.code,
      stdoutBytes: result.stdoutBytes ?? Buffer.byteLength(result.stdout),
      timestamp,
    };
    logWrites = logWrites.then(() =>
      appendFile(callLog, `${JSON.stringify(receipt)}\n`),
    );
    await logWrites;
    if (!socket.destroyed) socket.end(`${JSON.stringify(result)}\n`);
  }
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    let input = "";
    socket.on("data", (chunk) => {
      if (controller.signal.aborted) {
        socket.destroy();
        return;
      }
      input += chunk;
      if (input.length > 1024 * 1024) {
        socket.destroy();
        return;
      }
      if (!input.includes("\n")) return;
      socket.pause();
      let argv;
      try {
        argv = JSON.parse(input.slice(0, input.indexOf("\n")));
      } catch {
        socket.destroy();
        return;
      }
      const task = call(socket, argv).catch((error) => {
        if (!socket.destroyed)
          socket.end(
            `${JSON.stringify({ code: 1, stdout: "", stderr: `CLI logging failed: ${error.message}\n` })}\n`,
          );
      });
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });
  });
  let closing;
  const close = () =>
    (closing ??= (async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      controller.abort();
      await Promise.allSettled(pending);
      for (const socket of sockets) socket.destroy();
      await closed;
      await rm(socketPath, { force: true });
    })());
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    await chmod(socketPath, 0o600);
    const executable = join(agentRoot, "obsidian");
    await writeFile(
      executable,
      `#!/usr/bin/env node
import { createConnection } from "node:net";
for (const stream of [process.stdout, process.stderr])
  stream.on("error", (error) => { if (error.code !== "EPIPE") throw error; });
const socket = createConnection(${JSON.stringify(socketPath)});
socket.setEncoding("utf8");
let response = "";
socket.on("connect", () => socket.write(JSON.stringify(process.argv.slice(2)) + "\\n"));
socket.on("data", (chunk) => { response += chunk; });
socket.on("error", (error) => { process.stderr.write(error.message + "\\n"); process.exitCode = 1; });
socket.on("end", () => {
  try {
    const result = JSON.parse(response);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.code ?? 1;
  } catch (error) { process.stderr.write(error.message + "\\n"); process.exitCode = 1; }
});
`,
      { mode: 0o700 },
    );
    return { executable, socketPath, close };
  } catch (error) {
    await close();
    throw error;
  }
}
