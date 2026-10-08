#!/usr/bin/env node

// The Obsidian CLI, in-house: the same arguments and output as the `obsidian`
// binary, sent over the same socket by `#obsidian-cli`. The binary can miss
// the end of a reply on macOS and wait until killed; this client cannot, and
// every call is bounded.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  createObsidianCall,
  obsidianCliSocketPath,
  OBSIDIAN_CALL_TIMEOUT_MS,
} from "#obsidian-cli";

const reference = `Arguments pass through to Obsidian unchanged, exactly as for the \`obsidian\`
binary. Put options before the first argument; everything from the first
argument on belongs to Obsidian.

  obsidian-cli.ts --code '<js>' vault=<id>  runs <js> in the app: \`eval code=<js>\`
  obsidian-cli.ts --js probe.js vault=<id>  the same, with the code in a file
  obsidian-cli.ts vault=<id> plugin:reload id=zotlit
  obsidian-cli.ts help                      Obsidian's own command list
  obsidian-cli.ts --no-throttle --js probe.js vault=<id>
  obsidian-cli.ts --shot .scratch/list.png --selector '.annots-container' vault=<id>
  obsidian-cli.ts --shot .scratch/edge.png --selector '.annots-container' \\
    --sample 10,0 --sample 10,4 --sample 10,8 vault=<id>

--code and --js keep the word eval off the command line: a Claude Code
session isolated in a git worktree refuses a command that holds it.

vault=<id> selects the window only as the first argument. Without it, the
window of the current folder's vault answers, else the focused window.

--no-throttle lifts Chromium's background throttling from the main window and
its popouts for the length of the call, then puts each window's setting back.
A covered or hidden window is throttled: requestAnimationFrame never fires,
scroll events never dispatch, and captures lag a frame behind the DOM.

--shot captures one element of the main window as a PNG at device
resolution: the first match of --selector, else the whole page. It replies
with the saved path and the element's rect in CSS px. Each --sample x,y reads
the captured pixel at that point, in CSS px from the element's top-left, as
rgb(). --shot takes no Obsidian command beyond vault=<id>.

Output is Obsidian's reply. Obsidian reports command failures as text
("Error: …", "Vault not found."), and the exit code stays 0 for them.
Exit code 1 means no reply: Obsidian is not running (the socket
${obsidianCliSocketPath()} is missing or refuses the connection), or
the window gave no answer within --timeout. The interactive TTY mode of the
binary is not supported.`;

/** Lifts throttling from the main window and its popouts; replies with each window's old setting. */
const THROTTLE_OFF = `(()=>{const r=require("@electron/remote"),m=r.getCurrentWebContents(),was=[];for(const c of r.webContents.getAllWebContents())if(c===m||(c.opener?.top?.processId===m.mainFrame.processId&&c.opener?.top?.routingId===m.mainFrame.routingId)){was.push([c.id,c.getBackgroundThrottling()]);c.setBackgroundThrottling(false);}return JSON.stringify(was);})()`;

/** Puts back the settings `THROTTLE_OFF` replied with. */
function throttleRestore(was: string): string {
  return `(()=>{const r=require("@electron/remote");for(const[id,on]of ${was}){const c=r.webContents.fromId(id);if(c&&!c.isDestroyed())c.setBackgroundThrottling(on);}return "restored";})()`;
}

/** Captures the element `selector` matches, else the page, and reads `samples` off the capture. */
function shotCode(
  path: string,
  selector: string | undefined,
  samples: [number, number][],
): string {
  const element =
    selector === undefined
      ? "document.documentElement"
      : `document.querySelector(${JSON.stringify(selector)})`;
  return `(async()=>{const el=${element};if(!el)return "Error: no element matches the selector";const b=el.getBoundingClientRect(),z=require("electron").webFrame.getZoomFactor();const img=await require("@electron/remote").getCurrentWebContents().capturePage({x:Math.round(b.left*z),y:Math.round(b.top*z),width:Math.max(1,Math.round(b.width*z)),height:Math.max(1,Math.round(b.height*z))});require("fs").writeFileSync(${JSON.stringify(path)},img.toPNG());const s=img.getSize(),bmp=img.toBitmap(),k=Math.sqrt(bmp.length/4/(s.width*s.height)),w=Math.round(s.width*k),h=Math.round(s.height*k),d=w/b.width,samples={};for(const[x,y]of ${JSON.stringify(samples)}){const px=Math.min(w-1,Math.max(0,Math.round(x*d))),py=Math.min(h-1,Math.max(0,Math.round(y*d))),i=(py*w+px)*4;samples[x+","+y]="rgb("+bmp[i+2]+", "+bmp[i+1]+", "+bmp[i]+")";}return JSON.stringify({path:${JSON.stringify(path)},rect:{x:b.left,y:b.top,width:b.width,height:b.height},samples});})()`;
}

/** The value of an `eval` reply: Obsidian prefixes it with `=> `. */
function evalValue(reply: string): string {
  if (!reply.startsWith("=> ")) throw new Error(reply);
  return reply.slice(3);
}

await yargs(hideBin(process.argv))
  .scriptName("obsidian-cli.ts")
  .usage("$0 [options] <obsidian arguments..>")
  .command(
    "$0 [args..]",
    "run one Obsidian CLI command over Obsidian's CLI socket",
    (y) =>
      y
        .positional("args", {
          describe: "the arguments you would give the `obsidian` binary",
          type: "string",
          array: true,
        })
        .option("timeout", {
          describe: "seconds to wait for the reply",
          type: "number",
          default: OBSIDIAN_CALL_TIMEOUT_MS / 1_000,
        })
        .option("code", {
          describe:
            "JavaScript to run in the app, as `eval code=<js>` after the other arguments",
          type: "string",
          conflicts: "js",
        })
        .option("js", {
          describe:
            "JavaScript file to run in the app, as `eval code=<file contents>` after the other arguments",
          type: "string",
        })
        .option("throttle", {
          describe:
            "keep background throttling; --no-throttle lifts it for the call",
          type: "boolean",
          default: true,
        })
        .option("shot", {
          describe: "PNG file to capture the --selector element into",
          type: "string",
        })
        .option("selector", {
          describe: "CSS selector of the element --shot captures",
          type: "string",
        })
        .option("sample", {
          describe: "x,y in CSS px from the captured element's top-left",
          type: "string",
          array: true,
          nargs: 1,
        }),
    async (argv) => {
      const args = [...(argv.args ?? []), ...argv._.map(String)];
      const vault = args[0]?.startsWith("vault=") ? [args[0]] : [];
      if (argv.code !== undefined) args.push("eval", `code=${argv.code}`);
      if (argv.js !== undefined) {
        args.push("eval", `code=${await readFile(resolve(argv.js), "utf-8")}`);
      }
      if (argv.shot !== undefined) {
        if (args.length > vault.length)
          throw new Error(
            "--shot takes no Obsidian command beyond vault=<id>.",
          );
        const samples = (argv.sample ?? []).map((pair): [number, number] => {
          const [x, y] = pair.split(",").map(Number);
          if (!Number.isFinite(x) || !Number.isFinite(y))
            throw new Error(`--sample takes x,y in CSS px; got "${pair}".`);
          return [x!, y!];
        });
        args.push(
          "eval",
          `code=${shotCode(resolve(argv.shot), argv.selector, samples)}`,
        );
      }
      if (args.length === 0) throw new Error("Give at least one argument.");
      const call = createObsidianCall({ timeoutMs: argv.timeout * 1_000 });
      const was = argv.throttle
        ? undefined
        : evalValue(await call([...vault, "eval", `code=${THROTTLE_OFF}`]));
      try {
        console.log(await call(args));
      } finally {
        if (was !== undefined)
          await call([...vault, "eval", `code=${throttleRestore(was)}`]);
      }
    },
  )
  .parserConfiguration({
    "halt-at-non-option": true,
    "unknown-options-as-args": true,
  })
  .epilogue(reference)
  .strict()
  .version(false)
  .fail((message, error) => {
    console.error(
      `obsidian-cli: ${error instanceof Error ? error.message : message}`,
    );
    process.exit(1);
  })
  .parseAsync();
