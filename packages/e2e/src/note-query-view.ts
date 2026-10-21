// A Query View in a note, a Query File embed or a Query Block, as a case
// reaches it: drawn, settled, and drawn again on each use.

import { obEval, readUntil } from "./obsidian-cli.ts";

/**
 * How long one use waits for the view to draw, in milliseconds. Under the
 * CLI's per-call deadline, so a missing view fails with its own message.
 */
const DRAW_TIMEOUT_MS = 10_000;
/** A note just opened can take longer than one use's wait to load its query. */
const FIRST_DRAW_ATTEMPTS = 6;

/** Opens the message of a failure that no retry can change. */
const CANNOT_REVEAL = "Cannot reveal";
/** Opens the message of a view that stayed undrawn for a whole use. */
const NOT_DRAWN = "Not drawn";

/**
 * The page side of {@link revealQueryView}, as source for an eval. It finds
 * the view's lines in the note's text, then until the note draws an element
 * on those lines that holds a Query View: moves a Live Preview cursor off
 * them, scrolls the note to them, and waits. It awaits the query and answers
 * the element that holds the view.
 *
 * Reading view and Live Preview both draw only the part of a note near the
 * viewport: a view below the fold has no element until the note scrolls to
 * it, and loses it again when the note scrolls away. Live Preview shows the
 * source of an embed or block that holds the cursor.
 *
 * An element's line: Live Preview maps it through CodeMirror's `posAtDOM`;
 * Reading view's sections hold their line counts in document order, so a
 * section starts at the sum of those before it.
 */
const REVEAL = `async(path,kind)=>{
const leaves=app.workspace.getLeavesOfType('markdown').filter(l=>l.view.file?.path===path);
const leaf=leaves.find(l=>l===app.workspace.getMostRecentLeaf())??leaves[0];
if(!leaf)throw new Error('${CANNOT_REVEAL}: note not open: '+path);
const view=leaf.view;
const lines=view.data.split('\\n');
const opens=new RegExp(kind.opens);
const from=lines.flatMap((text,index)=>opens.test(text)?[index]:[])[kind.index];
if(from===undefined)throw new Error('${CANNOT_REVEAL}: no '+kind.name+' in '+path);
let to=from;
if(kind.closes!==null){const closes=new RegExp(kind.closes);to=lines.findIndex((text,index)=>index>from&&closes.test(text));if(to===-1)to=lines.length-1;}
const lineOf=el=>{
if(view.getMode()==='source'){const cm=view.editor.cm;if(!cm.contentDOM.contains(el))return null;return cm.state.doc.lineAt(cm.posAtDOM(el)).number-1;}
let start=0;for(const section of view.previewMode.renderer.sections){if(section.el.contains(el))return Math.max(start,Math.min(from,start+section.lines-1));start+=section.lines;}
return null;
};
const viewOf=el=>el.zotlitQueryView?el:el.querySelector('.block-language-zotquery');
const drawn=()=>[...view.containerEl.querySelectorAll(kind.selector)].filter(el=>el.isShown()&&(kind.src===null||el.getAttribute('src')===kind.src)&&viewOf(el)?.zotlitQueryView).find(el=>{const line=lineOf(el);return line!==null&&line>=from&&line<=to;});
const end=Date.now()+${DRAW_TIMEOUT_MS};
for(;;){
const el=drawn();
if(el){const host=viewOf(el);await host.zotlitQueryView.settled;if(host.isConnected&&host.isShown())return host;}
if(Date.now()>end)throw new Error('${NOT_DRAWN}: '+kind.name+' in '+path+' ('+view.getMode()+', lines '+from+'-'+to+')');
if(view.getMode()==='preview')view.setEphemeralState({scroll:from});
else{
const editor=view.editor;
if(editor.listSelections().some(({anchor,head})=>Math.max(anchor.line,head.line)>=from&&Math.min(anchor.line,head.line)<=to)){const off=to<editor.lastLine()?{line:to+1,ch:0}:{line:Math.max(from-1,0),ch:0};editor.setCursor(off);}
const at={line:from,ch:0};editor.scrollIntoView({from:at,to:at},true);
}
await new Promise(resolve=>setTimeout(resolve,50));
}
}`.replaceAll("\n", "");

/** A Query View in an open note. */
export interface NoteQueryView {
  /**
   * An expression for the element that holds the view, for the body of an
   * `async` eval. Each evaluation draws the view again if the note scrolled
   * it away or its cursor moved onto it, and awaits its query, so a case may
   * move focus or scroll between uses.
   */
  readonly el: string;
}

/**
 * Which Query View of a note: the `occurrence`-th embed of `embed`, its link
 * text as written (e.g. `Lab annotations.zotquery#This item`), or the
 * `block`-th ` ```zotquery ` block of its own text. Both count from 0.
 */
export type QueryViewTarget =
  | { embed: string; occurrence?: number }
  | { block: number };

/** What the page needs to find one kind of view, as JSON. */
interface Kind {
  name: string;
  /** Source of a RegExp matching the line the view opens on. */
  opens: string;
  /** Source of a RegExp matching its last line; `null` for one line. */
  closes: string | null;
  index: number;
  /** The element the view's line draws. */
  selector: string;
  /** The `src` that element must hold; `null` for any. */
  src: string | null;
}

const FENCE = "(```|~~~)";

/**
 * An embed's element is its `.internal-embed`, which holds the view of a Query
 * File, or of a Query Block in a section it shows.
 */
function kindOf(target: QueryViewTarget): Kind {
  if ("block" in target)
    return {
      name: `Query Block #${target.block}`,
      opens: `^${FENCE}zotquery\\b`,
      closes: `^${FENCE}\\s*$`,
      index: target.block,
      selector: ".block-language-zotquery",
      src: null,
    };
  const occurrence = target.occurrence ?? 0;
  const link = RegExp.escape(`![[${target.embed}`);
  return {
    name: `embed of ${target.embed} #${occurrence}`,
    opens: `${link}(\\]\\]|\\|)`,
    closes: null,
    index: occurrence,
    selector: ".internal-embed",
    src: target.embed,
  };
}

/** Whether `error`, from an eval that used a {@link NoteQueryView}, is a reveal that failed for good or for a whole use. */
function isRevealFailure(error: unknown): boolean {
  const message = String(error);
  return message.includes(CANNOT_REVEAL) || message.includes(NOT_DRAWN);
}

/**
 * Waits until `notePath`, open in a Markdown leaf, draws `target` with its
 * query settled, and answers a handle to it. With the note open in several
 * leaves, the most recent one counts. Call it for one view of a leaf at a
 * time: each scrolls the note.
 *
 * @throws At once when the note is not open or holds no such view; when it
 *   does not draw the view within about a minute.
 */
export async function revealQueryView(
  vaultId: string,
  notePath: string,
  target: QueryViewTarget,
): Promise<NoteQueryView> {
  const handle: NoteQueryView = {
    el: `(await (${REVEAL})(${JSON.stringify(notePath)},${JSON.stringify(kindOf(target))}))`,
  };
  let failure: unknown;
  for (let attempt = 0; attempt < FIRST_DRAW_ATTEMPTS; attempt++) {
    try {
      await obEval(vaultId, `(async()=>{${handle.el};return true;})()`);
      return handle;
    } catch (error) {
      if (String(error).includes(CANNOT_REVEAL)) throw error;
      failure = error;
    }
  }
  throw failure;
}

/**
 * Polls the JSON `code` answers until `ready` accepts it, as `obReadUntil`
 * does, for `code` that reads a {@link NoteQueryView}. A view the use cannot
 * reveal fails at once with the page's message rather than as a later retry;
 * any other failed call counts as "not ready yet", and the last one is named
 * when `tries` run out.
 */
export async function readQueryViewUntil<T>(
  vaultId: string,
  code: string,
  {
    ready,
    ...options
  }: { ready: (value: T) => boolean; what: string; tries?: number },
): Promise<T> {
  let lastError = null as string | null;
  try {
    return await readUntil(
      async () => {
        try {
          return JSON.parse(await obEval(vaultId, code)) as T | null;
        } catch (error) {
          if (isRevealFailure(error)) throw error;
          lastError = String(error);
          return null;
        }
      },
      ready,
      options,
    );
  } catch (error) {
    if (lastError === null || isRevealFailure(error)) throw error;
    throw new Error(`${String(error)}; last failed call: ${lastError}`, {
      cause: error,
    });
  }
}
