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
 *
 * `stands` waits until `el` stands where it shows: no animation runs in the
 * workspace split that holds it, and `el` is the element at its own centre.
 * `revealLeaf` opens a collapsed sidebar from width 0 over an animation, and
 * a press read before it ends lands outside the window.
 */
export const PAGE = `const press=(el,what)=>{if(!el)throw new Error('Missing: '+what);el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=el.getBoundingClientRect();if(!el.checkVisibility()||r.width===0||r.height===0)throw new Error('Not visible: '+what+' ('+r.width+'x'+r.height+(el.checkVisibility()?'':', hidden')+')');const hit=el.ownerDocument.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!hit||!(hit===el||el.contains(hit)))throw new Error('Covered: '+what+' (by '+(hit?hit.outerHTML.slice(0,80):'nothing')+')');el.click();return el;};const until=async(what,ok,timeout=2000)=>{const end=Date.now()+timeout;for(;;){const value=await ok();if(value)return value;if(Date.now()>end)throw new Error('Timed out: '+what);await new Promise(r=>setTimeout(r,20));}};const stands=(el,what,timeout=5000)=>until(what+' stands',()=>{if(!el)return false;const split=el.closest('.workspace-split')??el;const r=el.getBoundingClientRect();const hit=el.ownerDocument.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return split.getAnimations({subtree:true}).length===0&&hit&&(hit===el||el.contains(hit))?el:false;},timeout);const valueOf=el=>el?(el.tagName==='BUTTON'?el.dataset.value:el.value):undefined;const pick=async(el,value,what)=>{if(!el)throw new Error('Missing: '+what);if(el.tagName==='SELECT'){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el;}press(el,what);const popup=await until(what+' opens',()=>el.popoverTargetElement?.matches(':popover-open')&&el.popoverTargetElement);const row=await until(what+' offers '+value,()=>popup.querySelector('[role=option][data-value="'+CSS.escape(value)+'"]'));press(row,what+' row '+value);await until(what+' shuts',()=>!popup.matches(':popover-open'));return el;};`;

/**
 * Picks the view `name` in the view menu of a Query View, as a reader does:
 * presses the menu, waits for the view's row, and presses it. `view` is an
 * expression of the eval for the view; put it after `PAGE` in an `async` body.
 */
export function pickQueryView(view: string, name: string): string {
  const row = `[data-query-view-list]:popover-open [data-query-view-row=${JSON.stringify(name)}]`;
  return `{const host=${view};press(host.contentEl.querySelector('[data-query-view-menu]'),'View menu');const row=await until(${JSON.stringify(`view menu row ${name}`)},()=>host.contentEl.querySelector(${JSON.stringify(row)}));press(row,${JSON.stringify(name)});}`;
}
