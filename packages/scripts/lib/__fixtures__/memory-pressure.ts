// OS boundary for admission tests: the file supplies the kernel pressure level.
import childProcess from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";

Object.defineProperty(process, "platform", { value: "darwin" });
const original = promisify(childProcess.execFile);
childProcess.execFile = Object.assign(childProcess.execFile.bind(childProcess), {
  __promisify__: original,
  [promisify.custom]: async (...args: Parameters<typeof original>) => {
    if (args[0] !== "sysctl") return original(...args);
    const stdout = readFileSync(process.env.ZOTLIT_TEST_PRESSURE!, "utf8");
    if (stdout === "1" && process.env.ZOTLIT_TEST_PROBES)
      appendFileSync(process.env.ZOTLIT_TEST_PROBES, `${process.pid}\n`);
    return { stdout, stderr: "" };
  },
});
syncBuiltinESMExports();
