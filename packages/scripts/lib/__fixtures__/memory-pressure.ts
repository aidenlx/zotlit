// OS boundary for admission tests: the file supplies the kernel pressure level.
import childProcess from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

Object.defineProperty(process, "platform", { value: "darwin" });
childProcess.execFile = new Proxy(childProcess.execFile, {
  apply(target, receiver, args: Parameters<typeof childProcess.execFile>) {
    if (args[0] !== "sysctl") return Reflect.apply(target, receiver, args);
    const stdout = readFileSync(process.env.ZOTLIT_TEST_PRESSURE!, "utf8");
    if (stdout === "1" && process.env.ZOTLIT_TEST_PROBES)
      appendFileSync(process.env.ZOTLIT_TEST_PROBES, `${process.pid}\n`);
    queueMicrotask(() => args[3]?.(null, stdout, ""));
    return new childProcess.ChildProcess();
  },
});
syncBuiltinESMExports();
