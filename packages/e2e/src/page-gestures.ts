/**
 * Declares `press(el, what)` and `until(what, ok, timeout?)` in an eval: the
 * gesture and the wait a case runs inside the window, so each eval string
 * presses and waits as every other does. Put it first in the eval's body;
 * `until` needs an `async` body, `press` does not.
 *
 * `press` presses `el` as a reader can: it scrolls `el` to the centre of its
 * scroll area, clear of the overlays at a pane's edges, and throws `what`
 * unless `el` is rendered with a box and is the topmost node at its centre (or
 * holds that node). A control in a folded section fails here. It then clicks
 * `el`, which answers `el`.
 *
 * The click is untrusted, so the browser's own handling of a real gesture —
 * a popover's light-dismiss, a close watcher — does not run; the
 * obsidian-debug skill's "Trusted input" reaches those by hand.
 *
 * `until` polls `ok` (sync or async) every 20 ms and answers its first truthy
 * result; after `timeout` ms (2000 by default) it throws `what`.
 *
 * `pick` chooses `value` in a select: a native `<select>` takes the value and
 * the events its change sends; a Select, the plugin's searchable popup, is
 * pressed open and its row for `value` pressed, and `pick` waits for the popup
 * to shut. `valueOf` reads the value either kind holds.
 */
export const PAGE = `const press=(el,what)=>{if(!el)throw new Error('Missing: '+what);el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=el.getBoundingClientRect();if(!el.checkVisibility()||r.width===0||r.height===0)throw new Error('Not visible: '+what+' ('+r.width+'x'+r.height+(el.checkVisibility()?'':', hidden')+')');const hit=el.ownerDocument.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!hit||!(hit===el||el.contains(hit)))throw new Error('Covered: '+what+' (by '+(hit?hit.outerHTML.slice(0,80):'nothing')+')');el.click();return el;};const until=async(what,ok,timeout=2000)=>{const end=Date.now()+timeout;for(;;){const value=await ok();if(value)return value;if(Date.now()>end)throw new Error('Timed out: '+what);await new Promise(r=>setTimeout(r,20));}};const valueOf=el=>el?(el.tagName==='BUTTON'?el.dataset.value:el.value):undefined;const pick=async(el,value,what)=>{if(!el)throw new Error('Missing: '+what);if(el.tagName==='SELECT'){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el;}press(el,what);const popup=await until(what+' opens',()=>el.popoverTargetElement?.matches(':popover-open')&&el.popoverTargetElement);const row=await until(what+' offers '+value,()=>popup.querySelector('[role=option][data-value="'+CSS.escape(value)+'"]'));press(row,what+' row '+value);await until(what+' shuts',()=>!popup.matches(':popover-open'));return el;};`;

/**
 * An eval that settles once an Obsidian `Menu` just shown has bound its keys,
 * answering `"ready"`. `Menu.showAtPosition` binds them a timer after it
 * shows, and a timer queued now runs after that one. A menu closed before
 * its keys bind leaves them behind, and they swallow the next Enter, so a
 * case evaluates this between seeing a menu and pressing one of its items.
 */
export const MENU_READY =
  "new Promise((resolve)=>activeWindow.setTimeout(()=>resolve('ready'),0))";

/**
 * Declares `trusted(win)` in an eval: the keys and clicks of `win` as the OS
 * delivers them, through its Electron web contents. `key(keyCode)` presses
 * and releases an Electron key code, such as `'Escape'`; `click(el)` clicks
 * the middle of `el`. Each waits until `win` has the event. Unlike `press`,
 * these reach the browser's own handling of a real gesture: a popover's
 * light dismiss, and Obsidian's keymap in the window that has the key.
 */
export const TRUSTED = `const trusted=(win)=>{const contents=win.electronWindow.webContents;const zoom=require('electron').webFrame.getZoomFactor();const delivered=(type)=>new Promise(r=>win.addEventListener(type,r,{once:true,capture:true}));return {key:async(keyCode)=>{const up=delivered('keyup');contents.sendInputEvent({type:'keyDown',keyCode});contents.sendInputEvent({type:'keyUp',keyCode});await up;},click:async(el)=>{const b=el.getBoundingClientRect();const at={x:Math.round((b.left+b.width/2)*zoom),y:Math.round((b.top+b.height/2)*zoom),button:'left',clickCount:1};const up=delivered('mouseup');contents.sendInputEvent({type:'mouseDown',...at});contents.sendInputEvent({type:'mouseUp',...at});await up;}};};`;

/**
 * Picks the view `name` in the view menu of a Query View, as a reader does:
 * presses the menu, waits for the view's row, and presses it. `view` is an
 * expression of the eval for the view; put it after `PAGE` in an `async` body.
 */
export function pickQueryView(view: string, name: string): string {
  const row = `[data-query-view-list]:popover-open [data-query-view-row=${JSON.stringify(name)}]`;
  return `{const host=${view};press(host.contentEl.querySelector('[data-query-view-menu]'),'View menu');const row=await until(${JSON.stringify(`view menu row ${name}`)},()=>host.contentEl.querySelector(${JSON.stringify(row)}));press(row,${JSON.stringify(name)});}`;
}
