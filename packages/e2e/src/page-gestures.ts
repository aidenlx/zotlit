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
 */
export const PAGE = `const press=(el,what)=>{if(!el)throw new Error('Missing: '+what);el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=el.getBoundingClientRect();if(!el.checkVisibility()||r.width===0||r.height===0)throw new Error('Not visible: '+what+' ('+r.width+'x'+r.height+(el.checkVisibility()?'':', hidden')+')');const hit=el.ownerDocument.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!hit||!(hit===el||el.contains(hit)))throw new Error('Covered: '+what+' (by '+(hit?hit.outerHTML.slice(0,80):'nothing')+')');el.click();return el;};const until=async(what,ok,timeout=2000)=>{const end=Date.now()+timeout;for(;;){const value=await ok();if(value)return value;if(Date.now()>end)throw new Error('Timed out: '+what);await new Promise(r=>setTimeout(r,20));}};`;
