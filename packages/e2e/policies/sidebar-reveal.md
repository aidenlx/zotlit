# Sidebar reveal

A collapsed sidebar opens from width 0 over an animation, and every End-to-end Run file starts with both sidebars collapsed. A press read while the animation runs measures the element at its old place, outside the window, and fails as `Covered: … (by nothing)` or clicks something else.

- An eval that reveals a sidebar leaf, through `revealLeaf` or `setViewState` on a leaf from `getRightLeaf` / `getLeftLeaf`, and then presses or clicks inside that leaf, first waits for `await page.stands(el, what)` from the callback context (`src/page-helpers.ts`) on the element it presses. `stands` resolves once no animation runs in the element's workspace split and the element is the one at its own centre.
- `stands` does not scroll. Scroll the element into view first (`el.scrollIntoView({block:'center',behavior:'instant'})`), or an element below the fold never stands.
- The wait comes before the first press after the reveal. Later presses in the same eval need no second wait unless the eval reveals or collapses a sidebar again.

The reviewer checks each eval that reveals a sidebar leaf and then presses, clicks, or dispatches a pointer event at a position read inside it: a `stands` call on the pressed element sits between the reveal and the first press.
